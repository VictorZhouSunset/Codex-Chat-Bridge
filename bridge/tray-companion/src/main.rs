mod bridge_status;
mod menu_model;

use std::io;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use bridge_status::{BridgeMode, BridgeStatus, StatusResponse};
use menu_model::build_menu_model;
use reqwest::blocking::Client;
use tao::event::{Event, StartCause};
use tao::event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy};
use tray_icon::menu::{Menu, MenuEvent, MenuItem};
use tray_icon::{Icon, TrayIconBuilder};

const DEFAULT_BRIDGE_BASE_URL: &str = "http://127.0.0.1:47821";
const STATUS_POLL_INTERVAL: Duration = Duration::from_secs(2);
const SHUTDOWN_POLL_INTERVAL: Duration = Duration::from_millis(500);
const MAX_TRANSIENT_STATUS_FAILURES: usize = 3;

#[derive(Debug)]
enum AppCommand {
    Status(BridgeStatus),
    BridgeGone,
    ShutdownRequested,
}

#[derive(Debug)]
enum PollDecision {
    UpdateStatus(BridgeStatus),
    Retry,
    Exit,
}

#[derive(Debug, thiserror::Error)]
enum AppError {
    #[error("http error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("io error: {0}")]
    Io(#[from] io::Error),
    #[error("tray error: {0}")]
    Tray(#[from] tray_icon::Error),
    #[error("menu error: {0}")]
    Menu(#[from] tray_icon::menu::Error),
    #[error("icon error: {0}")]
    Icon(#[from] tray_icon::BadIcon),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}

fn main() {
    if let Err(error) = run() {
        eprintln!("telegram bridge tray companion failed: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), AppError> {
    let client = Client::builder().timeout(Duration::from_secs(3)).build()?;
    let bridge_base_url = std::env::var("TELEGRAM_BRIDGE_BASE_URL")
        .unwrap_or_else(|_| DEFAULT_BRIDGE_BASE_URL.to_string());
    let _pid_file_guard = TrayPidFileGuard::create_from_env()?;
    let event_loop = EventLoopBuilder::<AppCommand>::with_user_event().build();
    let proxy = event_loop.create_proxy();
    let shutdown_requested = Arc::new(AtomicBool::new(false));

    spawn_status_poller(
        client.clone(),
        bridge_base_url.clone(),
        proxy.clone(),
        shutdown_requested.clone(),
    );

    let mut current_status = BridgeStatus {
        mode: BridgeMode::Ready,
        healthy: true,
        thread_label: None,
        thread_short_id: None,
    };
    let mut tray_ui: Option<TrayUi> = None;

    event_loop.run(move |event, _event_loop_window_target, control_flow| {
        *control_flow = ControlFlow::Wait;

        match event {
            Event::NewEvents(StartCause::Init) => {
                match TrayUi::new(proxy.clone()) {
                    Ok(ui) => {
                        if let Err(error) = apply_menu_state(
                            &ui.status_item,
                            &ui.shutdown_item,
                            &current_status,
                        ) {
                            abort_event_loop(control_flow, error);
                            return;
                        }
                        tray_ui = Some(ui);
                    }
                    Err(error) => {
                        abort_event_loop(control_flow, error);
                    }
                }
            }
            Event::UserEvent(AppCommand::Status(status)) => {
                current_status = status;
                if let Some(ui) = tray_ui.as_ref() {
                    if let Err(error) =
                        apply_menu_state(&ui.status_item, &ui.shutdown_item, &current_status)
                    {
                        abort_event_loop(control_flow, error);
                    }
                }
            }
            Event::UserEvent(AppCommand::BridgeGone) => {
                *control_flow = ControlFlow::Exit;
            }
            Event::UserEvent(AppCommand::ShutdownRequested) => {
                let shutdown_response = match client
                    .post(format!("{bridge_base_url}/shutdown"))
                    .json(&serde_json::json!({ "source": "tray" }))
                    .send()
                    .and_then(|response| response.error_for_status())
                    .and_then(|response| response.json::<ShutdownResponse>())
                {
                    Ok(response) => response,
                    Err(error) => {
                        abort_event_loop(control_flow, error.into());
                        return;
                    }
                };

                shutdown_requested.store(true, Ordering::SeqCst);

                if shutdown_response.safe_to_stop {
                    *control_flow = ControlFlow::Exit;
                    return;
                }

                current_status = BridgeStatus::from_response(shutdown_response.status);
                if let Some(ui) = tray_ui.as_ref() {
                    if let Err(error) =
                        apply_menu_state(&ui.status_item, &ui.shutdown_item, &current_status)
                    {
                        abort_event_loop(control_flow, error);
                    }
                }
            }
            Event::LoopDestroyed => {
                MenuEvent::set_event_handler::<Box<dyn Fn(MenuEvent) + Send + Sync>>(None);
            }
            _ => {}
        }
    });
}

fn spawn_status_poller(
    client: Client,
    bridge_base_url: String,
    proxy: EventLoopProxy<AppCommand>,
    shutdown_requested: Arc<AtomicBool>,
) {
    thread::spawn(move || {
        let mut consecutive_failures = 0usize;
        loop {
            let shutdown_pending = shutdown_requested.load(Ordering::SeqCst);
            match classify_poll_result(
                fetch_status(&client, &bridge_base_url),
                consecutive_failures,
                shutdown_pending,
            ) {
                (PollDecision::UpdateStatus(status), next_failures) => {
                    consecutive_failures = next_failures;
                    if proxy.send_event(AppCommand::Status(status)).is_err() {
                        break;
                    }
                }
                (PollDecision::Retry, next_failures) => {
                    consecutive_failures = next_failures;
                }
                (PollDecision::Exit, _) => {
                    let _ = proxy.send_event(AppCommand::BridgeGone);
                    break;
                }
            }

            thread::sleep(poll_interval(shutdown_pending));
        }
    });
}

fn fetch_status(client: &Client, bridge_base_url: &str) -> Result<BridgeStatus, AppError> {
    let response = client
        .get(format!("{bridge_base_url}/status"))
        .send()?
        .error_for_status()?;

    let response: StatusResponse = response.json()?;
    Ok(BridgeStatus::from_response(response))
}

fn apply_menu_state(
    status_item: &MenuItem,
    shutdown_item: &MenuItem,
    status: &BridgeStatus,
) -> Result<(), AppError> {
    let model = build_menu_model(status);
    status_item.set_text(model.status_label);
    shutdown_item.set_enabled(model.shutdown_enabled);
    Ok(())
}

fn build_icon() -> Result<Icon, AppError> {
    let rgba = [0x37, 0x99, 0x6B, 0xFF];
    let mut pixels = vec![0u8; 4 * 16 * 16];
    for chunk in pixels.chunks_exact_mut(4) {
        chunk.copy_from_slice(&rgba);
    }
    Ok(Icon::from_rgba(pixels, 16, 16)?)
}

fn classify_poll_result(
    fetch_result: Result<BridgeStatus, AppError>,
    consecutive_failures: usize,
    shutdown_requested: bool,
) -> (PollDecision, usize) {
    match fetch_result {
        Ok(status) if status.is_terminal() => (PollDecision::Exit, 0),
        Ok(status) => (PollDecision::UpdateStatus(status), 0),
        Err(_) if shutdown_requested => (PollDecision::Exit, consecutive_failures + 1),
        Err(_) if consecutive_failures + 1 >= MAX_TRANSIENT_STATUS_FAILURES => {
            (PollDecision::Exit, consecutive_failures + 1)
        }
        Err(_) => (PollDecision::Retry, consecutive_failures + 1),
    }
}

fn poll_interval(shutdown_requested: bool) -> Duration {
    if shutdown_requested {
        SHUTDOWN_POLL_INTERVAL
    } else {
        STATUS_POLL_INTERVAL
    }
}

struct TrayUi {
    _tray: tray_icon::TrayIcon,
    status_item: MenuItem,
    shutdown_item: MenuItem,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShutdownResponse {
    #[serde(flatten)]
    status: StatusResponse,
    #[serde(default)]
    safe_to_stop: bool,
}

impl TrayUi {
    fn new(proxy: EventLoopProxy<AppCommand>) -> Result<Self, AppError> {
        let menu = Menu::new();
        let status_item = MenuItem::with_id("status", "Bridge: starting...", false, None);
        let shutdown_item = MenuItem::with_id("shutdown", "Shutdown bridge", true, None);
        let shutdown_id = shutdown_item.id().clone();
        menu.append_items(&[&status_item, &shutdown_item])?;

        MenuEvent::set_event_handler(Some(move |event: MenuEvent| {
            if event.id() == &shutdown_id {
                let _ = proxy.send_event(AppCommand::ShutdownRequested);
            }
        }));

        let tray = TrayIconBuilder::new()
            .with_menu(Box::new(menu))
            .with_tooltip("Telegram bridge")
            .with_icon(build_icon()?)
            .build()?;

        Ok(Self {
            _tray: tray,
            status_item,
            shutdown_item,
        })
    }
}

fn abort_event_loop(control_flow: &mut ControlFlow, error: AppError) {
    eprintln!("telegram bridge tray companion failed: {error}");
    *control_flow = ControlFlow::Exit;
}

struct TrayPidFileGuard {
    path: Option<PathBuf>,
}

impl TrayPidFileGuard {
    fn create_from_env() -> Result<Self, AppError> {
        let Some(pid_file_path) = std::env::var_os("TELEGRAM_BRIDGE_PID_FILE") else {
            return Ok(Self { path: None });
        };

        let path = PathBuf::from(pid_file_path);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let payload = serde_json::json!({
            "pid": std::process::id(),
        });
        std::fs::write(&path, serde_json::to_vec(&payload)?)?;

        Ok(Self { path: Some(path) })
    }
}

impl Drop for TrayPidFileGuard {
    fn drop(&mut self) {
        if let Some(path) = self.path.as_ref() {
            let _ = std::fs::remove_file(path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_status(mode: BridgeMode) -> BridgeStatus {
        BridgeStatus {
            mode,
            healthy: true,
            thread_label: None,
            thread_short_id: None,
        }
    }

    #[test]
    fn transient_poll_failures_retry_before_exit() {
        let (decision, failures) = classify_poll_result(
            Err(AppError::Io(io::Error::new(io::ErrorKind::TimedOut, "timeout"))),
            0,
            false,
        );
        assert!(matches!(decision, PollDecision::Retry));
        assert_eq!(failures, 1);

        let (decision, failures) = classify_poll_result(
            Err(AppError::Io(io::Error::new(io::ErrorKind::TimedOut, "timeout"))),
            MAX_TRANSIENT_STATUS_FAILURES - 1,
            false,
        );
        assert!(matches!(decision, PollDecision::Exit));
        assert_eq!(failures, MAX_TRANSIENT_STATUS_FAILURES);
    }

    #[test]
    fn successful_poll_resets_failure_count_and_updates_status() {
        let (decision, failures) =
            classify_poll_result(Ok(sample_status(BridgeMode::Busy)), 2, false);
        assert!(matches!(decision, PollDecision::UpdateStatus(_)));
        assert_eq!(failures, 0);
    }

    #[test]
    fn shutdown_mode_exits_on_first_poll_failure() {
        let (decision, failures) = classify_poll_result(
            Err(AppError::Io(io::Error::new(io::ErrorKind::ConnectionRefused, "gone"))),
            0,
            true,
        );
        assert!(matches!(decision, PollDecision::Exit));
        assert_eq!(failures, 1);
    }

    #[test]
    fn shutdown_mode_uses_faster_poll_interval() {
        assert_eq!(poll_interval(false), STATUS_POLL_INTERVAL);
        assert_eq!(poll_interval(true), SHUTDOWN_POLL_INTERVAL);
    }
}

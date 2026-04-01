use serde::Deserialize;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BridgeMode {
    Ready,
    Busy,
    Draining,
    Offline,
    Unknown(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BridgeStatus {
    pub mode: BridgeMode,
    pub healthy: bool,
    pub thread_label: Option<String>,
    pub thread_short_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusResponse {
    #[serde(default)]
    #[serde(alias = "bridge_mode")]
    pub mode: Option<String>,
    #[serde(default)]
    pub healthy: Option<bool>,
    #[serde(default)]
    pub health: Option<bool>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub thread: Option<ThreadInfo>,
    #[serde(default)]
    #[serde(alias = "current_thread")]
    pub current_thread: Option<ThreadInfo>,
    #[serde(default)]
    pub binding: Option<ThreadInfo>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadInfo {
    #[serde(default)]
    #[serde(alias = "threadId")]
    pub id: Option<String>,
    #[serde(default)]
    pub short_id: Option<String>,
    #[serde(default)]
    #[serde(alias = "threadLabel")]
    pub label: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
}

impl BridgeStatus {
    pub fn from_response(response: StatusResponse) -> Self {
        let mode = response
            .mode
            .as_deref()
            .map(parse_mode)
            .or_else(|| response.status.as_deref().map(parse_mode))
            .unwrap_or(BridgeMode::Unknown(String::new()));
        let thread = response
            .thread
            .or(response.current_thread)
            .or(response.binding);

        let (thread_label, thread_short_id) = thread
            .as_ref()
            .map(|thread| {
                let label = thread
                    .label
                    .as_deref()
                    .or(thread.title.as_deref())
                    .or(thread.name.as_deref())
                    .unwrap_or("Thread");
                let short_id = thread
                    .short_id
                    .as_deref()
                    .or(thread.id.as_deref())
                    .map(short_thread_id);
                let label = short_id
                    .as_deref()
                    .map(|short_id| format_thread_label(label, short_id))
                    .unwrap_or_else(|| label.to_string());
                (Some(label), short_id)
            })
            .unwrap_or((None, None));

        Self {
            healthy: response.healthy.or(response.health).unwrap_or(true),
            mode,
            thread_label,
            thread_short_id,
        }
    }

    pub fn is_draining(&self) -> bool {
        matches!(self.mode, BridgeMode::Draining)
    }

    pub fn is_terminal(&self) -> bool {
        matches!(self.mode, BridgeMode::Offline)
    }
}

pub fn parse_mode(raw: &str) -> BridgeMode {
    match raw.trim().to_ascii_lowercase().as_str() {
        "idle" => BridgeMode::Ready,
        "ready" => BridgeMode::Ready,
        "busy" => BridgeMode::Busy,
        "draining" => BridgeMode::Draining,
        "offline" | "gone" | "ready_to_stop" => BridgeMode::Offline,
        other => BridgeMode::Unknown(other.to_string()),
    }
}

pub fn short_thread_id(raw: &str) -> String {
    raw.chars().take(8).collect()
}

pub fn format_thread_label(thread_label: &str, short_id: &str) -> String {
    format!("{thread_label} · {short_id}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_thread_label_with_short_id() {
        assert_eq!(
            format_thread_label("Project Alpha", "01234567"),
            "Project Alpha · 01234567"
        );
    }

    #[test]
    fn shortens_thread_id_to_eight_chars() {
        assert_eq!(short_thread_id("0123456789abcdef"), "01234567");
    }

    #[test]
    fn maps_status_response_into_bridge_status() {
        let status = BridgeStatus::from_response(StatusResponse {
            mode: Some("busy".to_string()),
            healthy: Some(true),
            health: None,
            status: None,
            thread: None,
            current_thread: None,
            binding: Some(ThreadInfo {
                id: Some("0123456789abcdef".to_string()),
                short_id: None,
                label: Some("Project A".to_string()),
                title: None,
                name: None,
            }),
        });

        assert_eq!(status.mode, BridgeMode::Busy);
        assert_eq!(status.thread_short_id, Some("01234567".to_string()));
        assert_eq!(
            status.thread_label,
            Some("Project A · 01234567".to_string())
        );
    }

    #[test]
    fn maps_offline_and_unknown_status_variants() {
        let offline = BridgeStatus::from_response(StatusResponse {
            mode: None,
            healthy: None,
            health: Some(true),
            status: Some("offline".to_string()),
            thread: None,
            current_thread: None,
            binding: None,
        });
        assert!(offline.is_terminal());

        let unknown = BridgeStatus::from_response(StatusResponse {
            mode: Some("mystery".to_string()),
            healthy: Some(true),
            health: None,
            status: None,
            thread: None,
            current_thread: None,
            binding: None,
        });
        assert_eq!(unknown.mode, BridgeMode::Unknown("mystery".to_string()));
        assert_eq!(unknown.thread_label, None);
    }

    #[test]
    fn maps_idle_mode_and_binding_aliases_into_bridge_status() {
        let status: StatusResponse = serde_json::from_value(serde_json::json!({
            "mode": "idle",
            "binding": {
                "threadId": "019d3324-d3c4-7f32-97a4-61a03b7f7ff8",
                "threadLabel": "个人网站开发1"
            }
        }))
        .expect("status response should deserialize");

        let status = BridgeStatus::from_response(status);
        assert_eq!(status.mode, BridgeMode::Ready);
        assert_eq!(status.thread_short_id, Some("019d3324".to_string()));
        assert_eq!(
            status.thread_label,
            Some("个人网站开发1 · 019d3324".to_string())
        );
    }
}

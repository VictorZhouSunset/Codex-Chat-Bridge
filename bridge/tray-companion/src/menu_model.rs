use crate::bridge_status::{BridgeMode, BridgeStatus};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MenuModel {
    pub status_label: String,
    pub shutdown_enabled: bool,
}

pub fn bridge_mode_label(mode: &BridgeMode) -> &'static str {
    match mode {
        BridgeMode::Ready => "Bridge ready",
        BridgeMode::Busy => "Bridge busy",
        BridgeMode::Draining => "Bridge draining",
        BridgeMode::Offline => "Bridge offline",
        BridgeMode::Unknown(_) => "Bridge status unknown",
    }
}

pub fn build_menu_model(status: &BridgeStatus) -> MenuModel {
    let status_label = if let Some(thread_label) = status.thread_label.as_ref() {
        format!("{} | {}", bridge_mode_label(&status.mode), thread_label)
    } else {
        bridge_mode_label(&status.mode).to_string()
    };

    MenuModel {
        status_label,
        shutdown_enabled: !status.is_draining(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bridge_status::BridgeStatus;

    #[test]
    fn maps_bridge_modes_to_menu_text() {
        assert_eq!(bridge_mode_label(&BridgeMode::Ready), "Bridge ready");
        assert_eq!(bridge_mode_label(&BridgeMode::Busy), "Bridge busy");
        assert_eq!(bridge_mode_label(&BridgeMode::Draining), "Bridge draining");
        assert_eq!(bridge_mode_label(&BridgeMode::Offline), "Bridge offline");
    }

    #[test]
    fn disables_shutdown_when_draining() {
        let status = BridgeStatus {
            mode: BridgeMode::Draining,
            healthy: true,
            thread_label: None,
            thread_short_id: None,
        };

        let model = build_menu_model(&status);
        assert!(!model.shutdown_enabled);
        assert_eq!(model.status_label, "Bridge draining");
    }
}

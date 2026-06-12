use std::sync::Arc;

use crate::config::{self, AppConfig};
use crate::history::{self, HistoryEntry};
use crate::{audio, hotkey};

pub trait CommandHost: Send + Sync + 'static {
    fn on_settings_changed(&self) {}

    fn hotkey_capture_preview(&self, _shortcut: String) {}

    fn hotkey_capture_captured(&self, _shortcut: String) {}
}

pub fn load_config() -> Result<AppConfig, String> {
    config::load()
}

pub fn store_config(cfg: AppConfig, host: &dyn CommandHost) -> Result<(), String> {
    config::save(&cfg)?;
    host.on_settings_changed();
    Ok(())
}

pub fn audio_device_names() -> Vec<String> {
    audio::list_devices()
}

pub fn load_history() -> Vec<HistoryEntry> {
    history::load()
}

pub fn delete_history_entry(id: &str) -> Result<(), String> {
    history::remove(id)
}

pub fn delete_all_history() -> Result<(), String> {
    history::clear()
}

pub fn begin_hotkey_capture(host: Arc<dyn CommandHost>) {
    let preview_host = Arc::clone(&host);
    hotkey::begin_capture(
        move |shortcut| {
            preview_host.hotkey_capture_preview(shortcut);
        },
        move |shortcut| {
            host.hotkey_capture_captured(shortcut);
        },
    );
}

pub fn stop_hotkey_capture() {
    hotkey::cancel_capture();
}

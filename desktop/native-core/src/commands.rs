use crate::audio;
use crate::config::{self, AppConfig};
use crate::history::{self, HistoryEntry};

pub trait CommandHost: Send + Sync + 'static {
    fn on_settings_changed(&self) {}
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

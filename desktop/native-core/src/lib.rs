mod audio;
mod audio_ducking;
pub mod commands;
pub mod config;
pub mod dictation;
mod formatting;
pub mod history;
mod hotkey;
mod log;
mod paste;
mod sidecar;
mod speech;
mod transcription;
mod vad;
#[cfg(target_os = "windows")]
mod win_overlay;

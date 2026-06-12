//! Native overlay sidecar (macOS only).
//!
//! Spawns the Swift helper binary that renders the overlay using NSPanel +
//! SwiftUI.  Communication is newline-delimited JSON over stdin/stdout.

#[cfg(target_os = "macos")]
use std::io::Write;
#[cfg(target_os = "macos")]
use std::path::PathBuf;
#[cfg(target_os = "macos")]
use std::sync::Mutex;

#[cfg(target_os = "macos")]
use serde::Serialize;

// ---------------------------------------------------------------------------
// Child process handle
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
static CHILD_STDIN: Mutex<Option<std::process::ChildStdin>> = Mutex::new(None);

// ---------------------------------------------------------------------------
// Messages: Rust → Sidecar (stdin)
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
#[derive(Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum OutMessage {
    State {
        state: String,
        #[serde(rename = "handsFree")]
        hands_free: bool,
        paused: bool,
        elapsed: f64,
    },
    Levels {
        level: f32,
        bars: Vec<f32>,
    },
    Error {
        message: String,
    },
    Permission {
        title: String,
        message: String,
        #[serde(rename = "actionLabel")]
        action_label: String,
        visible: bool,
    },
    Onboarding {
        step: String,
        text: String,
        #[serde(rename = "hotkeyLabel")]
        hotkey_label: String,
    },
    OnboardingPress {
        pressed: bool,
    },
    Config {
        #[serde(rename = "gradientEnabled")]
        gradient_enabled: bool,
        #[serde(rename = "alwaysVisible")]
        always_visible: bool,
        #[serde(rename = "hotkeyLabel")]
        hotkey_label: String,
    },
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Send a message to the sidecar overlay.  No-op if sidecar isn't running.
#[cfg(target_os = "macos")]
pub fn send(msg: &OutMessage) {
    let mut guard = match CHILD_STDIN.lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    let stdin = match guard.as_mut() {
        Some(s) => s,
        None => return,
    };
    if let Ok(json) = serde_json::to_string(msg) {
        let _ = writeln!(stdin, "{}", json);
        let _ = stdin.flush();
    }
}

/// Stop sending messages to the sidecar overlay. Closing stdin lets the Swift
/// helper exit on its own read loop.
#[cfg(target_os = "macos")]
pub fn stop() {
    if let Ok(mut guard) = CHILD_STDIN.lock() {
        *guard = None;
    }
}

/// Spawn the sidecar overlay process for `yap-core`.
#[cfg(target_os = "macos")]
pub fn spawn_for_core(on_event: impl Fn(String) + Send + 'static) {
    spawn_process(on_event);
}

#[cfg(target_os = "macos")]
fn spawn_process(on_event: impl Fn(String) + Send + 'static) {
    use std::process::{Command, Stdio};

    if CHILD_STDIN
        .lock()
        .map(|guard| guard.is_some())
        .unwrap_or(false)
    {
        crate::log::info("Sidecar: already running");
        return;
    }

    let Some(bin) = resolve_sidecar_binary() else {
        crate::log::info("Sidecar: binary not found");
        return;
    };

    crate::log::info(&format!("Sidecar: launching {:?}", bin));

    let mut child = match Command::new(&bin)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            crate::log::info(&format!("Sidecar: failed to spawn: {e}"));
            return;
        }
    };

    let Some(stdin) = child.stdin.take() else {
        crate::log::info("Sidecar: failed to open stdin");
        return;
    };
    let Some(stdout) = child.stdout.take() else {
        crate::log::info("Sidecar: failed to open stdout");
        return;
    };

    *CHILD_STDIN.lock().unwrap() = Some(stdin);

    std::thread::Builder::new()
        .name("yap-sidecar-reader".into())
        .spawn(move || {
            use std::io::BufRead;
            let reader = std::io::BufReader::new(stdout);

            for line in reader.lines() {
                let line = match line {
                    Ok(l) => l,
                    Err(_) => break,
                };
                if line.is_empty() {
                    continue;
                }

                let parsed: serde_json::Value = match serde_json::from_str(&line) {
                    Ok(v) => v,
                    Err(_) => continue,
                };

                if let Some(event) = parsed["event"].as_str() {
                    on_event(event.to_string());
                }
            }

            crate::log::info("Sidecar: process exited");
            stop();
        })
        .expect("failed to spawn sidecar reader thread");
}

#[cfg(target_os = "macos")]
fn resolve_sidecar_binary() -> Option<PathBuf> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let architecture_binary = if cfg!(target_arch = "aarch64") {
        "yap-overlay-aarch64-apple-darwin"
    } else {
        "yap-overlay-x86_64-apple-darwin"
    };

    let mut candidates = vec![
        manifest_dir.join("sidecar-overlay/.build/debug/yap-overlay"),
        manifest_dir.join("sidecar-overlay/.build/release/yap-overlay"),
        manifest_dir.join("binaries").join(architecture_binary),
    ];

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            candidates.push(parent.join("yap-overlay"));
            candidates.push(parent.join(architecture_binary));
        }
    }

    candidates.into_iter().find(|path| path.exists())
}

#[cfg(not(target_os = "macos"))]
#[allow(dead_code)]
pub fn stop() {}

//! On-device speech recognition via platform-native APIs.
//!
//! macOS: SpeechAnalyzer helper process (macOS 26+)
//! Windows: not yet implemented (returns error)
//!
//! Entry point:
//!   - `transcribe()` — full on-device transcription (used when provider = None)

use std::path::Path;

// ---------------------------------------------------------------------------
// macOS implementation — SpeechAnalyzer helper
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
mod platform {
    use crate::log;

    use std::path::{Path, PathBuf};
    use std::process::Command;
    use std::time::Duration;

    /// Transcribe audio using Apple's SpeechAnalyzer helper.
    ///
    /// `locale` should be a BCP 47 string like "en-US".
    /// Returns the transcribed text, or an error.
    pub fn transcribe(audio_path: &Path, locale: &str) -> Result<String, String> {
        let timeout = recognition_timeout(audio_path);
        let helper = speech_helper_path().ok_or_else(|| {
            "SpeechAnalyzer helper not found. Rebuild the macOS sidecar with `pnpm run electron:build-sidecar`.".to_string()
        })?;

        transcribe_with_helper(&helper, audio_path, locale, timeout)
    }

    fn recognition_timeout(audio_path: &Path) -> Duration {
        let estimated_seconds = std::fs::metadata(audio_path)
            .map(|metadata| metadata.len() as f64 / 64_000.0)
            .unwrap_or(0.0);
        Duration::from_secs_f64((30.0 + estimated_seconds).clamp(30.0, 180.0))
    }

    fn transcribe_with_helper(
        helper: &Path,
        audio_path: &Path,
        locale: &str,
        timeout: Duration,
    ) -> Result<String, String> {
        let audio_metadata = describe_wav(audio_path).unwrap_or_else(|error| error);
        log::info(&format!(
            "SpeechAnalyzer: starting helper path={audio_path:?} locale={locale} timeout={timeout:?} {audio_metadata}"
        ));

        let output = Command::new(helper)
            .arg(audio_path)
            .arg(locale)
            .arg(format!("{:.3}", timeout.as_secs_f64()))
            .output()
            .map_err(|error| format!("failed to run SpeechAnalyzer helper: {error}"))?;

        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if !stderr.is_empty() {
            log::info(&format!("SpeechAnalyzer helper: {stderr}"));
        }

        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if output.status.success() {
            log::info(&format!(
                "SpeechAnalyzer: helper completed len={}",
                stdout.len()
            ));
            return Ok(stdout);
        }

        let message = if stderr.is_empty() {
            format!("SpeechAnalyzer helper failed with status {}", output.status)
        } else {
            stderr
        };
        Err(message)
    }

    fn describe_wav(audio_path: &Path) -> Result<String, String> {
        let reader = hound::WavReader::open(audio_path)
            .map_err(|error| format!("wav_metadata_error={error}"))?;
        let spec = reader.spec();
        if spec.sample_rate == 0 || spec.channels == 0 {
            return Err("wav_metadata_error=invalid_rate_or_channels".to_string());
        }
        let frames = reader.duration() as f64 / spec.channels as f64;
        let duration = frames / spec.sample_rate as f64;
        Ok(format!(
            "duration={duration:.3}s sample_rate={} channels={} bits={} format={:?}",
            spec.sample_rate, spec.channels, spec.bits_per_sample, spec.sample_format
        ))
    }

    fn speech_helper_path() -> Option<PathBuf> {
        let helper_name = if cfg!(target_arch = "aarch64") {
            "yap-speech-aarch64-apple-darwin"
        } else {
            "yap-speech-x86_64-apple-darwin"
        };
        let exe = std::env::current_exe().ok()?;
        let exe_dir = exe.parent()?;

        let mut candidates = vec![exe_dir.join(helper_name)];
        if let Some(native_core_dir) = exe_dir.parent().and_then(|target_dir| target_dir.parent()) {
            candidates.push(native_core_dir.join("binaries").join(helper_name));
        }

        candidates.into_iter().find(|path| path.exists())
    }
}

// ---------------------------------------------------------------------------
// Non-macOS fallback
// ---------------------------------------------------------------------------

#[cfg(not(target_os = "macos"))]
mod platform {
    use std::path::Path;

    pub fn transcribe(_audio_path: &Path, _locale: &str) -> Result<String, String> {
        Err("On-device speech recognition is only available on macOS 26 or newer".into())
    }
}

// ---------------------------------------------------------------------------
// Public API (delegates to platform module)
// ---------------------------------------------------------------------------

/// Transcribe audio using on-device speech recognition.
pub fn transcribe(audio_path: &Path, locale: &str) -> Result<String, String> {
    platform::transcribe(audio_path, locale)
}

//! On-device speech recognition via platform-native APIs.
//!
//! macOS: SFSpeechRecognizer (Speech framework)
//! Windows: not yet implemented (returns error)
//!
//! Entry point:
//!   - `transcribe()` — full on-device transcription (used when provider = None)

use std::path::Path;

// ---------------------------------------------------------------------------
// macOS implementation — SFSpeechRecognizer via objc2 FFI
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
mod platform {
    use crate::log;

    use std::ffi::{c_char, CStr, CString};
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use std::sync::{mpsc, Arc, Mutex};
    use std::time::Duration;

    use block2::RcBlock;
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject};

    const AUTH_NOT_DETERMINED: isize = 0;
    const AUTH_DENIED: isize = 1;
    const AUTH_RESTRICTED: isize = 2;
    const AUTH_AUTHORIZED: isize = 3;

    /// Transcribe audio using on-device SFSpeechRecognizer.
    ///
    /// `locale` should be a BCP 47 string like "en-US".
    /// Returns the transcribed text, or an error.
    pub fn transcribe(audio_path: &Path, locale: &str) -> Result<String, String> {
        let recognition_timeout = recognition_timeout(audio_path);
        if let Some(helper) = speech_helper_path() {
            return transcribe_with_helper(&helper, audio_path, locale, recognition_timeout);
        }
        log::info("Speech: Swift helper not found; falling back to Rust Speech bridge");

        let path_str = audio_path
            .to_str()
            .ok_or_else(|| "invalid audio path".to_string())?;
        let path_cstr = CString::new(path_str).map_err(|e| format!("path encoding error: {e}"))?;
        let locale_cstr =
            CString::new(locale).map_err(|e| format!("locale encoding error: {e}"))?;

        let (tx, rx) = mpsc::channel::<Result<String, String>>();
        let latest_transcription = Arc::new(Mutex::new(String::new()));
        log::info(&format!(
            "Speech: starting on-device recognition path={path_str:?} locale={locale} timeout={recognition_timeout:?}"
        ));

        let recognizer_cls = AnyClass::get(c"SFSpeechRecognizer")
            .ok_or("SFSpeechRecognizer not found — is the Speech framework available?")?;

        unsafe {
            ensure_speech_authorized(recognizer_cls)?;

            // -- Create autorelease pool --
            let pool_cls =
                AnyClass::get(c"NSAutoreleasePool").ok_or("NSAutoreleasePool not found")?;
            let pool: *mut AnyObject = msg_send![pool_cls, new];

            // -- Create NSString helpers --
            let ns_str_cls = AnyClass::get(c"NSString").ok_or("NSString not found")?;
            let path_ns: *mut AnyObject =
                msg_send![ns_str_cls, stringWithUTF8String: path_cstr.as_ptr()];
            let locale_ns: *mut AnyObject =
                msg_send![ns_str_cls, stringWithUTF8String: locale_cstr.as_ptr()];

            // -- Create NSURL from file path --
            let url_cls = AnyClass::get(c"NSURL").ok_or("NSURL not found")?;
            let url: *mut AnyObject = msg_send![url_cls, fileURLWithPath: path_ns];

            // -- Create NSLocale --
            let locale_cls = AnyClass::get(c"NSLocale").ok_or("NSLocale not found")?;
            let ns_locale: *mut AnyObject =
                msg_send![locale_cls, localeWithLocaleIdentifier: locale_ns];

            // -- Create SFSpeechRecognizer with locale --
            let recognizer: *mut AnyObject = msg_send![recognizer_cls, alloc];
            let recognizer: *mut AnyObject = msg_send![recognizer, initWithLocale: ns_locale];

            if recognizer.is_null() {
                let _: () = msg_send![pool, drain];
                return Err(format!(
                    "SFSpeechRecognizer not available for locale: {locale}"
                ));
            }

            // Check availability
            let available: bool = msg_send![recognizer, isAvailable];
            if !available {
                let _: () = msg_send![pool, drain];
                return Err("SFSpeechRecognizer is not available on this device".to_string());
            }

            // -- Create SFSpeechURLRecognitionRequest --
            let request_cls = AnyClass::get(c"SFSpeechURLRecognitionRequest")
                .ok_or("SFSpeechURLRecognitionRequest not found")?;
            let request: *mut AnyObject = msg_send![request_cls, alloc];
            let request: *mut AnyObject = msg_send![request, initWithURL: url];
            let _: () = msg_send![request, setShouldReportPartialResults: true];
            let _: () = msg_send![request, setRequiresOnDeviceRecognition: true];

            // -- Build the result handler block --
            // Called by the Speech framework with partial/final results.
            // Keep the latest partial result because macOS can delay or skip a
            // final callback long enough to make short dictations feel broken.
            let latest_for_handler = Arc::clone(&latest_transcription);
            let block = RcBlock::new(move |result: *mut AnyObject, error: *mut AnyObject| {
                // Error with no result → terminal failure
                if !error.is_null() && result.is_null() {
                    let desc: *mut AnyObject = msg_send![error, localizedDescription];
                    if !desc.is_null() {
                        let cstr: *const c_char = msg_send![desc, UTF8String];
                        if !cstr.is_null() {
                            let err_str = CStr::from_ptr(cstr).to_string_lossy().to_string();
                            let _ = tx.send(Err(err_str));
                            return;
                        }
                    }
                    let _ = tx.send(Err("Speech recognition error".to_string()));
                    return;
                }

                if !result.is_null() {
                    let transcription: *mut AnyObject = msg_send![result, bestTranscription];
                    if !transcription.is_null() {
                        let text: *mut AnyObject = msg_send![transcription, formattedString];
                        if !text.is_null() {
                            let cstr: *const c_char = msg_send![text, UTF8String];
                            if !cstr.is_null() {
                                let s = CStr::from_ptr(cstr).to_string_lossy().to_string();
                                let trimmed_len = s.trim().len();
                                if let Ok(mut latest) = latest_for_handler.lock() {
                                    *latest = s.clone();
                                }

                                let is_final: bool = msg_send![result, isFinal];
                                if is_final {
                                    log::info(&format!(
                                        "Speech: final result received len={trimmed_len}"
                                    ));
                                    let _ = tx.send(Ok(s));
                                }
                                return;
                            }
                        }
                    }

                    let is_final: bool = msg_send![result, isFinal];
                    if is_final {
                        let _ = tx.send(Ok(String::new()));
                    }
                }
            });

            // -- Start recognition task --
            let task: *mut AnyObject = msg_send![
                recognizer,
                recognitionTaskWithRequest: request,
                resultHandler: &*block
            ];

            let result = match rx.recv_timeout(recognition_timeout) {
                Ok(result) => result,
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    let latest = latest_transcription
                        .lock()
                        .ok()
                        .map(|text| text.trim().to_string())
                        .unwrap_or_default();
                    log::info(&format!(
                        "Speech: recognition timed out latest_len={}",
                        latest.len()
                    ));
                    if latest.is_empty() {
                        Err("Speech recognition timed out".to_string())
                    } else {
                        Ok(latest)
                    }
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    log::info("Speech: recognition channel closed unexpectedly");
                    Err("Speech recognition channel closed unexpectedly".to_string())
                }
            };

            if !task.is_null() {
                let _: () = msg_send![task, cancel];
            }
            let _: () = msg_send![pool, drain];
            result
        }
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
        log::info(&format!(
            "Speech: starting Swift helper path={audio_path:?} locale={locale} timeout={timeout:?}"
        ));
        let output = Command::new(helper)
            .arg(audio_path)
            .arg(locale)
            .arg(format!("{:.3}", timeout.as_secs_f64()))
            .output()
            .map_err(|error| format!("failed to run speech helper: {error}"))?;

        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if !stderr.is_empty() {
            log::info(&format!("Speech helper: {stderr}"));
        }

        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if output.status.success() {
            log::info(&format!(
                "Speech: Swift helper completed len={}",
                stdout.len()
            ));
            return Ok(stdout);
        }

        let message = if stderr.is_empty() {
            format!("speech helper failed with status {}", output.status)
        } else {
            stderr
        };
        Err(message)
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

    unsafe fn ensure_speech_authorized(recognizer_cls: &'static AnyClass) -> Result<(), String> {
        let status: isize = msg_send![recognizer_cls, authorizationStatus];
        log::info(&format!(
            "Speech: authorization status={}",
            authorization_label(status)
        ));

        if status == AUTH_AUTHORIZED {
            return Ok(());
        }
        if status == AUTH_DENIED || status == AUTH_RESTRICTED {
            return Err(format!(
                "Speech recognition permission is {}",
                authorization_label(status)
            ));
        }
        if status != AUTH_NOT_DETERMINED {
            return Err(format!(
                "Speech recognition permission is {}",
                authorization_label(status)
            ));
        }

        let (tx, rx) = mpsc::channel::<isize>();
        let block = RcBlock::new(move |next_status: isize| {
            let _ = tx.send(next_status);
        });
        let _: () = msg_send![recognizer_cls, requestAuthorization: &*block];

        match rx.recv_timeout(Duration::from_secs(30)) {
            Ok(next_status) => {
                log::info(&format!(
                    "Speech: authorization request returned status={}",
                    authorization_label(next_status)
                ));
                if next_status == AUTH_AUTHORIZED {
                    Ok(())
                } else {
                    Err(format!(
                        "Speech recognition permission is {}",
                        authorization_label(next_status)
                    ))
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                log::info("Speech: authorization request timed out");
                Err("Speech recognition permission request timed out".to_string())
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                Err("Speech recognition permission request was interrupted".to_string())
            }
        }
    }

    fn authorization_label(status: isize) -> &'static str {
        match status {
            AUTH_NOT_DETERMINED => "notDetermined",
            AUTH_DENIED => "denied",
            AUTH_RESTRICTED => "restricted",
            AUTH_AUTHORIZED => "authorized",
            _ => "unknown",
        }
    }
}

// ---------------------------------------------------------------------------
// Non-macOS fallback
// ---------------------------------------------------------------------------

#[cfg(not(target_os = "macos"))]
mod platform {
    use std::path::Path;

    pub fn transcribe(_audio_path: &Path, _locale: &str) -> Result<String, String> {
        Err("On-device speech recognition is only available on macOS".into())
    }
}

// ---------------------------------------------------------------------------
// Public API (delegates to platform module)
// ---------------------------------------------------------------------------

/// Transcribe audio using on-device speech recognition.
pub fn transcribe(audio_path: &Path, locale: &str) -> Result<String, String> {
    platform::transcribe(audio_path, locale)
}

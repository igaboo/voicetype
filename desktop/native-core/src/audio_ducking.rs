use once_cell::sync::Lazy;
use std::sync::Mutex;

use crate::config::BackgroundAudioMode;
use crate::log;

static ACTIVE_SESSION: Lazy<Mutex<Option<Session>>> = Lazy::new(|| Mutex::new(None));

enum Session {
    Mute(platform::Session),
    Pause(media::Session),
}

impl Session {
    fn end(self) -> Result<(), String> {
        match self {
            Self::Mute(session) => session.end(),
            Self::Pause(session) => session.end(),
        }
    }
}

pub fn begin(mode: BackgroundAudioMode) {
    if mode == BackgroundAudioMode::Off {
        end();
        return;
    }

    let Ok(mut guard) = ACTIVE_SESSION.lock() else {
        log::info("Audio ducking unavailable: session lock poisoned");
        return;
    };

    if guard.is_some() {
        return;
    }

    let session = match mode {
        BackgroundAudioMode::Off => unreachable!(),
        BackgroundAudioMode::Mute => platform::Session::begin().map(Session::Mute),
        BackgroundAudioMode::Pause => begin_pause_session(),
    };

    match session {
        Ok(session) => {
            *guard = Some(session);
        }
        Err(e) => {
            log::info(&format!("Audio ducking unavailable: {e}"));
        }
    }
}

pub fn end() {
    let session = ACTIVE_SESSION
        .lock()
        .ok()
        .and_then(|mut guard| guard.take());
    if let Some(session) = session {
        if let Err(e) = session.end() {
            log::info(&format!("Audio ducking restore failed: {e}"));
        }
    }
}

fn begin_pause_session() -> Result<Session, String> {
    media::Session::begin().map(Session::Pause)
}

#[cfg(target_os = "macos")]
mod media {
    use super::log;
    use std::process::{Command, Stdio};

    #[derive(Clone, Copy)]
    struct MediaApp {
        process_name: &'static str,
        script_name: &'static str,
        display_name: &'static str,
    }

    const MEDIA_APPS: &[MediaApp] = &[
        MediaApp {
            process_name: "Music",
            script_name: "Music",
            display_name: "Music",
        },
        MediaApp {
            process_name: "Spotify",
            script_name: "Spotify",
            display_name: "Spotify",
        },
    ];

    const MEDIA_PLAYBACK_ASSERTION_MARKERS: &[&str] =
        &["Media Playback", "Audio Playback", "Playing audio"];

    pub struct Session {
        paused_apps: Vec<MediaApp>,
        media_key_toggled: bool,
    }

    impl Session {
        pub fn begin() -> Result<Self, String> {
            let mut paused_apps = Vec::new();

            for app in MEDIA_APPS {
                if !is_process_running(app.process_name) {
                    continue;
                }

                match is_playing(*app) {
                    Ok(true) => match pause_app(*app) {
                        Ok(()) => {
                            log::info(&format!("Background audio: paused {}", app.display_name));
                            paused_apps.push(*app);
                        }
                        Err(error) => {
                            log::info(&format!(
                                "Background audio: could not pause {}: {error}",
                                app.display_name
                            ));
                        }
                    },
                    Ok(false) => {}
                    Err(error) => {
                        log::info(&format!(
                            "Background audio: could not inspect {}: {error}",
                            app.display_name
                        ));
                    }
                }
            }

            let mut media_key_toggled = false;
            if paused_apps.is_empty() {
                media_key_toggled = pause_system_media_with_media_key();
                if !media_key_toggled {
                    log::info("Background audio: no supported playing media app to pause");
                }
            }

            Ok(Self {
                paused_apps,
                media_key_toggled,
            })
        }

        pub fn end(self) -> Result<(), String> {
            for app in self.paused_apps {
                match play_app(app) {
                    Ok(()) => log::info(&format!("Background audio: resumed {}", app.display_name)),
                    Err(error) => log::info(&format!(
                        "Background audio: could not resume {}: {error}",
                        app.display_name
                    )),
                }
            }
            if self.media_key_toggled {
                match send_play_pause() {
                    Ok(()) => log::info("Background audio: sent media resume"),
                    Err(error) => log::info(&format!(
                        "Background audio: could not send media resume: {error}",
                    )),
                }
            }
            Ok(())
        }
    }

    fn is_process_running(process_name: &str) -> bool {
        Command::new("pgrep")
            .args(["-x", process_name])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }

    fn pause_system_media_with_media_key() -> bool {
        if !has_media_playback_assertion() {
            return false;
        }

        match send_play_pause() {
            Ok(()) => {
                log::info("Background audio: sent media pause");
                true
            }
            Err(error) => {
                log::info(&format!(
                    "Background audio: could not send media pause: {error}",
                ));
                false
            }
        }
    }

    fn has_media_playback_assertion() -> bool {
        let Ok(output) = Command::new("pmset").args(["-g", "assertions"]).output() else {
            return false;
        };

        if !output.status.success() {
            return false;
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        MEDIA_PLAYBACK_ASSERTION_MARKERS
            .iter()
            .any(|marker| stdout.contains(marker))
    }

    fn is_playing(app: MediaApp) -> Result<bool, String> {
        let output = run_script(
            app,
            r#"if player state is playing then return "playing" else return "not_playing""#,
        )?;
        Ok(output.trim() == "playing")
    }

    fn pause_app(app: MediaApp) -> Result<(), String> {
        run_script(app, "pause").map(|_| ())
    }

    fn play_app(app: MediaApp) -> Result<(), String> {
        run_script(app, "play").map(|_| ())
    }

    fn run_script(app: MediaApp, command: &str) -> Result<String, String> {
        let script = format!("tell application \"{}\" to {}", app.script_name, command);
        let output = Command::new("osascript")
            .arg("-e")
            .arg(script)
            .output()
            .map_err(|error| error.to_string())?;

        if output.status.success() {
            return Ok(String::from_utf8_lossy(&output.stdout).to_string());
        }

        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            Err(format!("osascript exited with {}", output.status))
        } else {
            Err(stderr)
        }
    }

    fn send_play_pause() -> Result<(), String> {
        use enigo::{Direction, Enigo, Key, Keyboard, Settings};

        let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
        enigo
            .key(Key::MediaPlayPause, Direction::Click)
            .map_err(|e| e.to_string())
    }
}

#[cfg(not(target_os = "macos"))]
mod media {
    use super::log;

    pub struct Session {
        toggled: bool,
    }

    impl Session {
        pub fn begin() -> Result<Self, String> {
            send_play_pause()?;
            log::info("Background audio: sent media pause");
            Ok(Self { toggled: true })
        }

        pub fn end(self) -> Result<(), String> {
            if self.toggled {
                send_play_pause()?;
                log::info("Background audio: sent media resume");
            }
            Ok(())
        }
    }

    fn send_play_pause() -> Result<(), String> {
        use enigo::{Direction, Enigo, Key, Keyboard, Settings};

        let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
        enigo
            .key(Key::MediaPlayPause, Direction::Click)
            .map_err(|e| e.to_string())
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::log;
    use std::collections::HashMap;
    use std::ffi::c_void;
    use std::mem::size_of;
    use std::ptr;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc;
    use std::sync::Arc;
    use std::thread::JoinHandle;
    use std::time::Duration;

    type AudioObjectID = u32;
    type AudioObjectPropertySelector = u32;
    type AudioObjectPropertyScope = u32;
    type AudioObjectPropertyElement = u32;
    type AudioObjectPropertyElementName = AudioObjectPropertyElement;
    type OSStatus = i32;

    #[repr(C)]
    struct AudioObjectPropertyAddress {
        m_selector: AudioObjectPropertySelector,
        m_scope: AudioObjectPropertyScope,
        m_element: AudioObjectPropertyElementName,
    }

    #[link(name = "CoreAudio", kind = "framework")]
    extern "C" {
        fn AudioObjectHasProperty(
            inObjectID: AudioObjectID,
            inAddress: *const AudioObjectPropertyAddress,
        ) -> u8;
        fn AudioObjectGetPropertyData(
            inObjectID: AudioObjectID,
            inAddress: *const AudioObjectPropertyAddress,
            inQualifierDataSize: u32,
            inQualifierData: *const c_void,
            ioDataSize: *mut u32,
            outData: *mut c_void,
        ) -> OSStatus;
        fn AudioObjectSetPropertyData(
            inObjectID: AudioObjectID,
            inAddress: *const AudioObjectPropertyAddress,
            inQualifierDataSize: u32,
            inQualifierData: *const c_void,
            inDataSize: u32,
            inData: *const c_void,
        ) -> OSStatus;
    }

    const K_AUDIO_OBJECT_SYSTEM_OBJECT: AudioObjectID = 1;
    const K_AUDIO_OBJECT_PROPERTY_ELEMENT_MAIN: AudioObjectPropertyElement = 0;
    const K_AUDIO_HARDWARE_PROPERTY_DEFAULT_OUTPUT_DEVICE: u32 = fourcc(*b"dOut");
    const K_AUDIO_DEVICE_PROPERTY_MUTE: u32 = fourcc(*b"mute");
    const K_AUDIO_OBJECT_PROPERTY_SCOPE_GLOBAL: u32 = fourcc(*b"glob");
    const K_AUDIO_DEVICE_PROPERTY_SCOPE_OUTPUT: u32 = fourcc(*b"outp");

    pub struct Session {
        stop: Arc<AtomicBool>,
        thread: Option<JoinHandle<()>>,
    }

    struct MutedDevice {
        previous_muted: bool,
        changed: bool,
    }

    impl Session {
        pub fn begin() -> Result<Self, String> {
            let stop = Arc::new(AtomicBool::new(false));
            let thread_stop = Arc::clone(&stop);
            let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();

            let thread = std::thread::Builder::new()
                .name("yap-audio-ducking-macos".into())
                .spawn(move || run_mute_worker(thread_stop, ready_tx))
                .map_err(|e| format!("failed to spawn audio ducking worker: {e}"))?;

            match ready_rx.recv_timeout(Duration::from_secs(2)) {
                Ok(Ok(())) => Ok(Self {
                    stop,
                    thread: Some(thread),
                }),
                Ok(Err(e)) => {
                    stop.store(true, Ordering::SeqCst);
                    let _ = thread.join();
                    Err(e)
                }
                Err(e) => {
                    stop.store(true, Ordering::SeqCst);
                    let _ = thread.join();
                    Err(format!("audio ducking worker did not start: {e}"))
                }
            }
        }

        pub fn end(mut self) -> Result<(), String> {
            self.stop.store(true, Ordering::SeqCst);
            if let Some(thread) = self.thread.take() {
                let _ = thread.join();
            }
            Ok(())
        }
    }

    fn run_mute_worker(stop: Arc<AtomicBool>, ready_tx: mpsc::Sender<Result<(), String>>) {
        let mut muted_devices = HashMap::<AudioObjectID, MutedDevice>::new();

        match keep_default_output_muted(&mut muted_devices) {
            Ok(()) => {
                let _ = ready_tx.send(Ok(()));
            }
            Err(error) => {
                let _ = ready_tx.send(Err(error));
                restore_output_devices(muted_devices);
                return;
            }
        }

        while !stop.load(Ordering::SeqCst) {
            if let Err(error) = keep_default_output_muted(&mut muted_devices) {
                log::info(&format!(
                    "Audio ducking: failed to keep output muted: {error}"
                ));
            }
            std::thread::sleep(Duration::from_millis(250));
        }

        restore_output_devices(muted_devices);
    }

    fn keep_default_output_muted(
        muted_devices: &mut HashMap<AudioObjectID, MutedDevice>,
    ) -> Result<(), String> {
        let device_id = default_output_device()?;

        if muted_devices.contains_key(&device_id) {
            if !get_device_mute(device_id)? {
                set_device_mute(device_id, true)?;
                log::info(&format!(
                    "Audio ducking: re-muted output device {device_id}"
                ));
            }
            return Ok(());
        }

        let previous_muted = get_device_mute(device_id)?;
        if previous_muted {
            log::info(&format!(
                "Audio ducking: output device {device_id} is already muted"
            ));
            muted_devices.insert(
                device_id,
                MutedDevice {
                    previous_muted,
                    changed: false,
                },
            );
            return Ok(());
        }

        set_device_mute(device_id, true)?;
        log::info(&format!(
            "Audio ducking: muted default output device {device_id}"
        ));
        muted_devices.insert(
            device_id,
            MutedDevice {
                previous_muted,
                changed: true,
            },
        );

        Ok(())
    }

    fn restore_output_devices(muted_devices: HashMap<AudioObjectID, MutedDevice>) {
        for (device_id, device) in muted_devices {
            if !device.changed {
                continue;
            }

            match set_device_mute(device_id, device.previous_muted) {
                Ok(()) => log::info(&format!(
                    "Audio ducking: restored output device {device_id} mute state to {}",
                    device.previous_muted
                )),
                Err(error) => log::info(&format!(
                    "Audio ducking: failed to restore output device {device_id}: {error}",
                )),
            }
        }
    }

    const fn fourcc(bytes: [u8; 4]) -> u32 {
        ((bytes[0] as u32) << 24)
            | ((bytes[1] as u32) << 16)
            | ((bytes[2] as u32) << 8)
            | bytes[3] as u32
    }

    fn default_output_device() -> Result<AudioObjectID, String> {
        let address = AudioObjectPropertyAddress {
            m_selector: K_AUDIO_HARDWARE_PROPERTY_DEFAULT_OUTPUT_DEVICE,
            m_scope: K_AUDIO_OBJECT_PROPERTY_SCOPE_GLOBAL,
            m_element: K_AUDIO_OBJECT_PROPERTY_ELEMENT_MAIN,
        };
        let mut device_id: AudioObjectID = 0;
        let mut size = size_of::<AudioObjectID>() as u32;
        let status = unsafe {
            AudioObjectGetPropertyData(
                K_AUDIO_OBJECT_SYSTEM_OBJECT,
                &address,
                0,
                ptr::null(),
                &mut size,
                (&mut device_id as *mut AudioObjectID).cast(),
            )
        };

        if status != 0 {
            return Err(format!(
                "failed to read default output device, OSStatus {status}"
            ));
        }
        if device_id == 0 {
            return Err("default output device is unknown".to_string());
        }

        Ok(device_id)
    }

    fn mute_address() -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress {
            m_selector: K_AUDIO_DEVICE_PROPERTY_MUTE,
            m_scope: K_AUDIO_DEVICE_PROPERTY_SCOPE_OUTPUT,
            m_element: K_AUDIO_OBJECT_PROPERTY_ELEMENT_MAIN,
        }
    }

    fn get_device_mute(device_id: AudioObjectID) -> Result<bool, String> {
        let address = mute_address();
        let has_property = unsafe { AudioObjectHasProperty(device_id, &address) } != 0;
        if !has_property {
            return Err(format!(
                "output device {device_id} does not expose a mute property"
            ));
        }

        let mut muted: u32 = 0;
        let mut size = size_of::<u32>() as u32;
        let status = unsafe {
            AudioObjectGetPropertyData(
                device_id,
                &address,
                0,
                ptr::null(),
                &mut size,
                (&mut muted as *mut u32).cast(),
            )
        };

        if status != 0 {
            return Err(format!(
                "failed to read output device {device_id} mute state, OSStatus {status}"
            ));
        }

        Ok(muted != 0)
    }

    fn set_device_mute(device_id: AudioObjectID, muted: bool) -> Result<(), String> {
        let address = mute_address();
        let value: u32 = u32::from(muted);
        let status = unsafe {
            AudioObjectSetPropertyData(
                device_id,
                &address,
                0,
                ptr::null(),
                size_of::<u32>() as u32,
                (&value as *const u32).cast(),
            )
        };

        if status != 0 {
            return Err(format!(
                "failed to set output device {device_id} mute state to {muted}, OSStatus {status}"
            ));
        }

        Ok(())
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::log;
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc;
    use std::sync::Arc;
    use std::thread::JoinHandle;
    use std::time::Duration;

    use windows::core::Interface;
    use windows::Win32::Foundation::{RPC_E_CHANGED_MODE, S_FALSE, S_OK};
    use windows::Win32::Media::Audio::{
        eConsole, eRender, IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator,
        ISimpleAudioVolume, MMDeviceEnumerator,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
        COINIT_MULTITHREADED,
    };

    const MUTED_VOLUME: f32 = 0.0;

    pub struct Session {
        stop: Arc<AtomicBool>,
        thread: Option<JoinHandle<()>>,
    }

    impl Session {
        pub fn begin() -> Result<Self, String> {
            let stop = Arc::new(AtomicBool::new(false));
            let thread_stop = Arc::clone(&stop);
            let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();

            let thread = std::thread::Builder::new()
                .name("yap-audio-ducking".into())
                .spawn(move || {
                    let result = run_session_ducker(thread_stop, ready_tx);
                    if let Err(e) = result {
                        log::info(&format!("Audio ducking worker stopped: {e}"));
                    }
                })
                .map_err(|e| format!("failed to spawn audio ducking worker: {e}"))?;

            match ready_rx.recv_timeout(Duration::from_secs(2)) {
                Ok(Ok(())) => {
                    log::info("Audio ducking: lowered Windows audio sessions");
                    Ok(Self {
                        stop,
                        thread: Some(thread),
                    })
                }
                Ok(Err(e)) => {
                    stop.store(true, Ordering::SeqCst);
                    let _ = thread.join();
                    Err(e)
                }
                Err(e) => {
                    stop.store(true, Ordering::SeqCst);
                    let _ = thread.join();
                    Err(format!("audio ducking worker did not start: {e}"))
                }
            }
        }

        pub fn end(mut self) -> Result<(), String> {
            self.stop.store(true, Ordering::SeqCst);
            if let Some(thread) = self.thread.take() {
                let _ = thread.join();
            }
            log::info("Audio ducking: restored Windows audio sessions");
            Ok(())
        }
    }

    struct DuckedSession {
        volume: ISimpleAudioVolume,
        previous_volume: f32,
        applied_volume: f32,
    }

    fn run_session_ducker(
        stop: Arc<AtomicBool>,
        ready_tx: mpsc::Sender<Result<(), String>>,
    ) -> Result<(), String> {
        let coinit = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        let should_uninitialize = coinit == S_OK || coinit == S_FALSE;
        if coinit == RPC_E_CHANGED_MODE {
            let _ = ready_tx.send(Err(
                "COM is already initialized with an incompatible apartment".to_string(),
            ));
            return Err("COM apartment mismatch".to_string());
        }
        if let Err(e) = coinit.ok() {
            let _ = ready_tx.send(Err(format!("failed to initialize COM: {e}")));
            return Err(format!("failed to initialize COM: {e}"));
        }

        let startup_tx = ready_tx.clone();
        let result = unsafe { run_session_ducker_inner(stop, startup_tx) };
        if let Err(e) = &result {
            let _ = ready_tx.send(Err(e.clone()));
        }

        if should_uninitialize {
            unsafe { CoUninitialize() };
        }

        result
    }

    unsafe fn run_session_ducker_inner(
        stop: Arc<AtomicBool>,
        ready_tx: mpsc::Sender<Result<(), String>>,
    ) -> Result<(), String> {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|e| format!("failed to create audio device enumerator: {e}"))?;
        let device = enumerator
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .map_err(|e| format!("failed to get default render device: {e}"))?;
        let manager: IAudioSessionManager2 = device
            .Activate(CLSCTX_ALL, None)
            .map_err(|e| format!("failed to activate audio session manager: {e}"))?;

        let mut ducked = HashMap::<String, DuckedSession>::new();
        duck_output_sessions(&manager, &mut ducked);
        let _ = ready_tx.send(Ok(()));

        while !stop.load(Ordering::SeqCst) {
            duck_output_sessions(&manager, &mut ducked);
            std::thread::sleep(Duration::from_millis(250));
        }

        restore_output_sessions(ducked);
        Ok(())
    }

    unsafe fn duck_output_sessions(
        manager: &IAudioSessionManager2,
        ducked: &mut HashMap<String, DuckedSession>,
    ) {
        let enumerator = match manager.GetSessionEnumerator() {
            Ok(enumerator) => enumerator,
            Err(e) => {
                log::info(&format!("Audio ducking: failed to enumerate sessions: {e}"));
                return;
            }
        };
        let count = match enumerator.GetCount() {
            Ok(count) => count,
            Err(e) => {
                log::info(&format!("Audio ducking: failed to count sessions: {e}"));
                return;
            }
        };
        let own_pid = std::process::id();

        for index in 0..count {
            let control = match enumerator.GetSession(index) {
                Ok(control) => control,
                Err(_) => continue,
            };
            let control2 = match control.cast::<IAudioSessionControl2>() {
                Ok(control2) => control2,
                Err(_) => continue,
            };
            if control2.GetProcessId().ok() == Some(own_pid) {
                continue;
            }

            let key = session_key(&control2, index);
            if ducked.contains_key(&key) {
                continue;
            }

            let volume = match control.cast::<ISimpleAudioVolume>() {
                Ok(volume) => volume,
                Err(_) => continue,
            };
            let previous_volume = match volume.GetMasterVolume() {
                Ok(previous_volume) => previous_volume,
                Err(_) => continue,
            };
            let ducked_volume = previous_volume.min(MUTED_VOLUME);
            if (previous_volume - ducked_volume).abs() < f32::EPSILON {
                continue;
            }
            if volume
                .SetMasterVolume(ducked_volume, std::ptr::null())
                .is_err()
            {
                continue;
            }

            ducked.insert(
                key,
                DuckedSession {
                    volume,
                    previous_volume,
                    applied_volume: ducked_volume,
                },
            );
        }
    }

    unsafe fn restore_output_sessions(ducked: HashMap<String, DuckedSession>) {
        for session in ducked.into_values() {
            let current_volume = session
                .volume
                .GetMasterVolume()
                .unwrap_or(session.applied_volume);
            if (current_volume - session.applied_volume).abs() < 0.001 {
                let _ = session
                    .volume
                    .SetMasterVolume(session.previous_volume, std::ptr::null());
            }
        }
    }

    unsafe fn session_key(control: &IAudioSessionControl2, fallback_index: i32) -> String {
        match control.GetSessionInstanceIdentifier() {
            Ok(identifier) => {
                let text = identifier.to_string().unwrap_or_default();
                CoTaskMemFree(Some(identifier.0.cast()));
                if text.is_empty() {
                    format!("session-index:{fallback_index}")
                } else {
                    text
                }
            }
            Err(_) => format!("session-index:{fallback_index}"),
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod platform {
    pub struct Session;

    impl Session {
        pub fn begin() -> Result<Self, String> {
            Err("audio ducking is not supported on this platform".to_string())
        }

        pub fn end(self) -> Result<(), String> {
            Ok(())
        }
    }
}

use tauri::{AppHandle, Manager, WebviewWindow, Window, WindowEvent};

const APP_WINDOW_LABELS: &[&str] = &["settings"];

pub fn show_app_window(app: &AppHandle, label: &str) -> Result<(), String> {
    let window = app
        .get_webview_window(label)
        .ok_or_else(|| format!("window not found: {label}"))?;

    activate_app(app);
    window.unminimize().map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;

    Ok(())
}

pub fn hide_app_window(app: &AppHandle, label: &str) -> Result<(), String> {
    let window = app
        .get_webview_window(label)
        .ok_or_else(|| format!("window not found: {label}"))?;

    window.hide().map_err(|e| e.to_string())?;
    hide_app_if_no_windows_visible(app);

    Ok(())
}

pub fn handle_window_event(window: &Window, event: &WindowEvent) {
    if !APP_WINDOW_LABELS.contains(&window.label()) {
        return;
    }

    if let WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = hide_app_window(window.app_handle(), window.label());
    }
}

pub fn hide_app_if_no_windows_visible(app: &AppHandle) {
    if app_windows(app).any(|window| window.is_visible().unwrap_or(false)) {
        return;
    }

    deactivate_app(app);
}

pub fn style_app_windows(app: &AppHandle) {
    for window in app_windows(app) {
        style_app_window(&window);
    }
}

fn app_windows(app: &AppHandle) -> impl Iterator<Item = WebviewWindow> + '_ {
    APP_WINDOW_LABELS
        .iter()
        .filter_map(|label| app.get_webview_window(label))
}

#[cfg(target_os = "windows")]
fn style_app_window(window: &WebviewWindow) {
    use ::windows::Win32::Foundation::HWND;
    use ::windows::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_CAPTION_COLOR, DWMWA_TEXT_COLOR,
        DWMWA_USE_IMMERSIVE_DARK_MODE,
    };
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};

    let Ok(handle) = window.window_handle() else {
        return;
    };
    let RawWindowHandle::Win32(handle) = handle.as_raw() else {
        return;
    };

    let hwnd = HWND(handle.hwnd.get() as *mut std::ffi::c_void);
    let dark_mode: i32 = 1;
    let caption_color: u32 = 0x001f1f1f;
    let text_color: u32 = 0x00ffffff;
    let border_color: u32 = 0x001f1f1f;

    unsafe {
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_USE_IMMERSIVE_DARK_MODE,
            (&dark_mode as *const i32).cast(),
            std::mem::size_of::<i32>() as u32,
        );
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_CAPTION_COLOR,
            (&caption_color as *const u32).cast(),
            std::mem::size_of::<u32>() as u32,
        );
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_TEXT_COLOR,
            (&text_color as *const u32).cast(),
            std::mem::size_of::<u32>() as u32,
        );
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_BORDER_COLOR,
            (&border_color as *const u32).cast(),
            std::mem::size_of::<u32>() as u32,
        );
    }
}

#[cfg(not(target_os = "windows"))]
fn style_app_window(_window: &WebviewWindow) {}

#[cfg(target_os = "macos")]
fn activate_app(app: &AppHandle) {
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
    let _ = app.show();
}

#[cfg(not(target_os = "macos"))]
fn activate_app(_app: &AppHandle) {}

#[cfg(target_os = "macos")]
fn deactivate_app(app: &AppHandle) {
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
}

#[cfg(not(target_os = "macos"))]
fn deactivate_app(_app: &AppHandle) {}

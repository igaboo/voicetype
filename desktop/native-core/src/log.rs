pub fn info(message: &str) {
    eprintln!("[yap-core] {message}");

    let Some(home) = dirs::home_dir() else {
        return;
    };
    let dir = home.join(".config").join("yap");
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let path = dir.join("debug.log");
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        use std::io::Write;
        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
        let _ = writeln!(file, "[{timestamp}] [core] {message}");
    }
}

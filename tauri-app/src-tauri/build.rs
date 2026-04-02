fn main() {
    // Build the native overlay sidecar on macOS
    #[cfg(target_os = "macos")]
    {
        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
        let script = std::path::PathBuf::from(&manifest_dir)
            .join("sidecar-overlay/build-sidecar.sh");

        if script.exists() {
            let status = std::process::Command::new("bash")
                .arg(&script)
                .status()
                .expect("failed to run build-sidecar.sh");
            assert!(status.success(), "build-sidecar.sh failed");
        }
    }

    tauri_build::build();

    // Link the Speech framework on macOS for SFSpeechRecognizer
    #[cfg(target_os = "macos")]
    println!("cargo:rustc-link-lib=framework=Speech");
}

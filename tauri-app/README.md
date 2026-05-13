# Yap Desktop App

This directory contains the canonical Yap desktop app. It is the package root for the Tauri/Svelte application.

For normal installation, use the latest installer from the root README or GitHub Releases:

https://github.com/oobagi/yap/releases/latest

## Commands

```bash
npm install
npm run dev
npm run check
npm run tauri -- dev
npm run tauri -- build
```

## Structure

- `package.json` - frontend scripts, Tauri CLI, and JavaScript dependencies.
- `src/` - Svelte app shell plus standalone settings/overlay entrypoints.
- `src/lib/settings/` - settings UI, update checks, and transcription history.
- `src/lib/overlay/` - shared overlay UI used where a web renderer is active.
- `src-tauri/` - standard Tauri Rust project nested inside the JavaScript app.
- `src-tauri/src/` - Rust application code.
- `src-tauri/sidecar-overlay/` - macOS Swift/AppKit overlay sidecar.
- `src-tauri/icons/` - app, Windows, macOS, and tray icons.
- `src-tauri/sounds/` - bundled feedback sounds.

## Tauri Layout

Tauri projects normally place the JavaScript project at the package root and the Rust project in a nested `src-tauri/` directory. Yap follows that convention inside `tauri-app/`. The repository root is intentionally one level above the Tauri package so root docs and GitHub metadata stay separate from the app package.

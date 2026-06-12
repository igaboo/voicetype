# Yap Desktop App

This directory contains the canonical Yap desktop app. It is the package root for the Electron/Svelte shell and the Rust `yap-core` native runtime.

For normal installation, use the latest installer from the root README or GitHub Releases:

https://github.com/oobagi/yap/releases/latest

## Commands

```bash
pnpm install
pnpm run check
pnpm run electron:check
pnpm run electron:dev
pnpm run electron:package
pnpm run electron:package:ci
```

Use `electron:package` for local packaging. Use `electron:package:ci` in GitHub Actions or other automation so Electron Builder does not publish from the build matrix.

## Structure

- `package.json` - frontend scripts, Electron scripts, and JavaScript dependencies.
- `electron/` - Electron main process, preload bridge, tray, windows, IPC, updater, and `yap-core` sidecar management.
- `electron-builder.yml` - Electron package and updater artifact configuration.
- `src/` - Svelte app shell plus standalone settings entrypoint.
- `src/lib/settings/` - settings UI, update checks, and transcription history.
- `native-core/` - Rust crate that provides the `yap-core` native runtime.
- `native-core/src/yap_core.rs` - JSON-RPC native runtime launched by Electron.
- `native-core/src/dictation.rs` - Electron-backed native dictation runtime.
- `native-core/src/` - shared Rust native modules for audio, hotkeys, transcription, formatting, paste, history, and overlays.
- `native-core/sidecar-overlay/` - macOS Swift/AppKit overlay sidecar; Windows overlay rendering lives in Rust.
- `native-core/icons/` - app, Windows, macOS, and tray icons.
- `native-core/sounds/` - bundled feedback sounds.

## Layout

Electron owns the desktop shell. `yap-core` is the native runtime process Electron launches for dictation, hotkeys, overlays, transcription, formatting, history, and paste.

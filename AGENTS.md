# AGENTS.md

This file gives Codex and other coding agents repository context for Yap.

## Build & Run

```bash
cd desktop
pnpm install
pnpm run check
pnpm run electron:check
pnpm run electron:dev
pnpm run electron:package
```

User installation should point to GitHub Releases first. These commands are for development and source builds.

The canonical application lives in `desktop/`. Electron is the desktop shell. The old root-level Swift package has been removed; Swift remains only as the macOS overlay sidecar under `desktop/native-core/sidecar-overlay/`.

Rust native code still lives under `desktop/native-core/` for continuity with the existing modules. Electron launches the `yap-core` binary from that crate over newline-delimited JSON-RPC.

Runtime permissions:

- macOS: Microphone, Speech Recognition, and Accessibility.
- Windows: Microphone access.

## Architecture

Yap is a cross-platform tray/menu bar dictation app. It records speech from a global hotkey, transcribes it, optionally formats it with an LLM, and pastes the result into the active app.

```
Hotkey provider
  -> Audio recorder
  -> Overlay pill
  -> Transcription provider
  -> Optional formatter
  -> Clipboard paste manager
```

## Key Paths

- `desktop/electron/` - Electron main process, preload bridge, tray, windows, IPC, updater, and native sidecar management.
- `desktop/electron-builder.yml` - Electron bundle, native resource, and updater artifact configuration.
- `desktop/native-core/src/yap_core.rs` - Electron native runtime entry point.
- `desktop/native-core/src/commands.rs` - runtime command facade shared by Electron-side native commands.
- `desktop/native-core/src/dictation.rs` - Electron-backed native state machine and pipeline coordination.
- `desktop/native-core/src/audio.rs` - CPAL audio capture, WAV writing, audio levels, and FFT bars.
- `desktop/native-core/src/hotkey.rs` - global hotkey handling.
- `desktop/native-core/src/transcription.rs` - Apple/on-device pre-checks and API transcription providers.
- `desktop/native-core/src/formatting.rs` - LLM cleanup and style formatting.
- `desktop/native-core/src/paste.rs` - clipboard write, paste simulation, and clipboard restore.
- `desktop/native-core/src/win_overlay.rs` - Windows native overlay implementation.
- `desktop/native-core/src/sidecar.rs` - macOS overlay sidecar process management.
- `desktop/native-core/sidecar-overlay/` - Swift/AppKit overlay sidecar for macOS.
- `desktop/native-core/sounds/` - bundled WAV sound effects.
- `desktop/native-core/icons/` - app, Windows, macOS, and tray icons used by builds.
- `desktop/src/lib/settings/` - Svelte settings UI, transcription history, and update checks.
- `desktop/src/lib/overlay/` - Svelte overlay view used where needed.

## Config

Config is stored at `~/.config/yap/config.json` on macOS and `%APPDATA%\yap\config.json` on Windows. Important fields include:

- `hotkey`
- `audio_device`
- `press_enter_after_paste`
- `tx_provider`, `tx_api_key`, `tx_model`
- `fmt_provider`, `fmt_api_key`, `fmt_model`, `fmt_style`
- `sounds_enabled`, `quiet_audio_while_recording`, `gradient_enabled`, `always_visible_pill`
- `history_enabled`, `speech_locale`
- provider-specific Deepgram, OpenAI, Gemini, and ElevenLabs options

Empty model strings fall back to provider defaults. Formatting falls back to the transcription API key when its own API key is blank.

## Working Rules

- Keep cross-platform behavior in the Rust `yap-core` command/dictation runtime where possible.
- Use platform-specific code only for OS integration: hotkeys, overlay behavior, paste, speech, bundling, and permissions.
- macOS on-device transcription is implemented; Windows on-device transcription currently returns unavailable, so Windows needs an API transcription provider.

## Repo Skills

- `.codex/skills/yap-release-bump/` - use this bundled skill when preparing Yap version bumps or releases. It exists to keep releases on branch/PR flow, split changes into feature-grouped commits, choose the semantic version from the update contents, and produce GitHub Release notes that match older Yap releases.

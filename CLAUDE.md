# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run

```bash
./build.sh                                    # Compile + ad-hoc codesign → build/Yap.app
cp -r build/Yap.app /Applications/            # Install
open /Applications/Yap.app                    # Run
```

No package manager or Xcode project — just `swiftc` compiling all `Sources/*.swift` directly. Requires macOS 12+ and Xcode Command Line Tools.

**Runtime permissions**: Microphone, Speech Recognition, and Accessibility (System Settings → Privacy & Security). The app won't function without these.

**GitHub**: `oobagi/yap`

## Architecture

Yap is a macOS menu bar app (LSUIElement) that records speech via a hotkey, transcribes it, optionally formats it with an LLM, and pastes the result. No SPM, no XIBs — pure Swift with SwiftUI embedded via `NSHostingView`.

### Pipeline

```
HotkeyManager (CGEventTap: fn/Option key)
  → AudioRecorder (AVAudioEngine → 16-bit PCM WAV + FFT levels)
  → OverlayPanel (floating pill with real-time waveform bars)
  → Transcription (Apple Speech on-device OR API: Gemini/OpenAI/Deepgram/ElevenLabs)
  → Formatting (optional LLM: Gemini/OpenAI/Anthropic with casual/formatted/professional styles)
  → PasteManager (clipboard write + simulated Cmd+V, restores previous clipboard)
```

### Key Files

- **`main.swift`** — App entry point. Sets `.accessory` activation policy, builds Edit menu for Cmd+C/V/X/A support.
- **`AppDelegate.swift`** — Central orchestrator. Owns the state machine (`idle → recording → processing → idle`), menu bar setup, permission requests, and coordinates the full pipeline. Loads config, initializes engines, handles start/stop recording logic including pre-checks (duration < 0.4s = cancel, peak < 0.15 = silence).
- **`AudioRecorder.swift`** — AVAudioEngine tap on input node. Writes WAV to temp file. Computes 1024-point FFT with Hann windowing across 6 logarithmic bands (80Hz–8kHz), mirrored to 11 display bars.
- **`HotkeyManager.swift`** — CGEventTap at session level monitoring `flagsChanged` events. Supports fn (Globe) and Option modifiers. Consumes events to prevent system side effects. Requires Accessibility permission.
- **`TextFormatter.swift`** — Contains both `AudioTranscriber` (API-based transcription) and `TextFormatter` (LLM formatting). Handles retry logic (up to 2 retries with exponential backoff), timeout scaling with audio length, Gemini one-shot transcribe+format optimization, and prompt engineering for JSON responses. Anthropic integration prefills assistant with `{` to force JSON structure.
- **`OverlayPanel.swift`** — NSPanel (floating, non-activating, click-through). SwiftUI view with three modes: recording (FFT-reactive bars), processing (gaussian wave sweep with shimmer), error (auto-dismissing message).
- **`PasteManager.swift`** — CGEvent-based Cmd+V simulation with clipboard save/restore (50ms paste delay, 300ms restore delay).
- **`SettingsWindow.swift`** — SwiftUI settings form + JSON config I/O. Config lives at `~/.config/yap/config.json`. Uses `SettingsDelegate` protocol to notify AppDelegate of changes.
- **`Transcriber.swift`** — Thin wrapper around Apple's `SFSpeechRecognizer` for on-device transcription. Also used as a pre-check before expensive API calls.

### Design Patterns

- **State machine**: `AppState` enum guards against overlapping operations
- **Completion handlers**: Async operations use `Result<String, Error>` callbacks dispatched to main thread
- **Lazy UI**: `overlayPanel` is lazy; `settingsWindow` is created on-demand and reused; engines are recreated on settings change
- **Gemini one-shot**: When Gemini is both transcriber and formatter, a single API call handles both (audio + style prompt → JSON response)
- **Apple Speech pre-check**: Before expensive API transcription, a quick on-device check confirms speech exists in the audio
- **Prompt regurgitation guard**: Discards results that contain the system prompt text

### Config Structure

```json
{
  "hotkey": "fn|option",
  "transcription": { "provider": "none|gemini|openai|deepgram|elevenlabs", "api_key": "", "model": "" },
  "formatting": { "provider": "none|gemini|openai|anthropic", "api_key": "", "model": "", "style": "casual|formatted|professional" }
}
```

Empty model string falls back to provider defaults. Formatting can share the transcription API key via a toggle.

### Logging

`os.log` output plus `~/.config/yap/debug.log` file. Log calls go through the global `log()` function in `AppDelegate.swift`.

<p align="center">
  <img src="tauri-app/src-tauri/icons/icon.png" width="128" height="128" alt="Yap icon">
</p>

<h1 align="center">Yap</h1>

<p align="center">
  Hold a key, speak, release. Yap transcribes your words and pastes them wherever you are typing.
</p>

<p align="center">
  <a href="https://github.com/oobagi/yap/releases/latest">Download</a>
  &middot;
  <a href="https://github.com/oobagi/yap/releases">Releases</a>
  &middot;
  <a href="https://github.com/oobagi/yap/issues">Issues</a>
  &middot;
  <a href="https://github.com/oobagi/yap/actions/workflows/tauri-build.yml">Builds</a>
  &middot;
  <a href="https://github.com/oobagi/yap/blob/main/LICENSE">License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/macOS-13%2B-blue" alt="macOS 13+">
  <img src="https://img.shields.io/badge/Windows-10%2B-blue" alt="Windows 10+">
  <img src="https://img.shields.io/badge/Tauri-2-24c8db" alt="Tauri 2">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT">
</p>

---

## Install

Download the latest macOS or Windows installer from the repository's **Resources -> Releases** section:

https://github.com/oobagi/yap/releases/latest

## Features

- Push-to-talk dictation: hold a hotkey, speak, release to paste.
- Hands-free recording by double-tapping the hotkey or clicking the floating pill.
- Transcription with Apple on-device speech, Gemini, OpenAI, Deepgram, or ElevenLabs.
- Optional formatting with Gemini, OpenAI, Anthropic, or Groq.
- Clipboard restore after paste.
- Local speech checks so very short or silent recordings are discarded before paid APIs are called.

## Set Up Transcription

Open the tray/menu bar icon, choose **Settings**, then pick a transcription provider.

| Provider | Key |
|---|---|
| On-device | No key needed. macOS only. |
| [Gemini](https://ai.google.dev/gemini-api/docs/api-key) | Gemini API key |
| [OpenAI](https://platform.openai.com/api-keys) | OpenAI API key |
| [Deepgram](https://developers.deepgram.com/docs/create-additional-api-keys) | Deepgram API key |
| [ElevenLabs](https://elevenlabs.io/docs/api-reference/authentication) | ElevenLabs API key |

Paste the key into **Settings -> Transcription -> API key**. Leave the model field blank to use Yap's default.

Windows does not have the macOS on-device option, so choose one of the API providers above.

## Optional Formatting

Formatting can clean up the transcript after transcription. Choose **Casual**, **Formatted**, or **Professional**, then add a key if needed.

| Provider | Key |
|---|---|
| [Gemini](https://ai.google.dev/gemini-api/docs/api-key) | Gemini API key |
| [OpenAI](https://platform.openai.com/api-keys) | OpenAI API key |
| [Anthropic](https://platform.claude.com/settings/keys) | Anthropic API key |
| [Groq](https://console.groq.com/keys) | Groq API key |

Paste the key into **Settings -> Formatting -> API key**. If formatting uses the same provider as transcription, Yap can reuse the transcription key.

Your settings are stored locally in `~/.config/yap/config.json` on macOS and `%APPDATA%\yap\config.json` on Windows.

## Build From Source

```bash
git clone https://github.com/oobagi/yap.git
cd yap/tauri-app
npm install
npm run dev                 # frontend dev server
npm run check               # Svelte/type checks
npm run tauri -- dev        # run the desktop app in development
npm run tauri -- build      # create app bundles/installers
```

macOS builds require Xcode Command Line Tools for the Swift overlay sidecar. Windows builds require the standard Tauri Windows toolchain.

## License

MIT

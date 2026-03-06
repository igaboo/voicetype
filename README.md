<p align="center">
  <img src="Resources/AppIcon.png" width="128" height="128" alt="VoiceType icon">
</p>

<h1 align="center">VoiceType</h1>

<p align="center">
  Hold a key, speak, release — your words are transcribed and pasted wherever you're typing.<br>
  Like <a href="https://wisprflow.com">Wispr Flow</a>, but free and open source.
</p>

---

## Install

```bash
git clone https://github.com/igaboo/voicetype.git
cd voicetype
./build.sh
cp -r build/VoiceType.app /Applications/
open /Applications/VoiceType.app
```

Requires macOS 12+ and Xcode Command Line Tools (`xcode-select --install`).

## Setup

Click the menu bar icon → **Settings** to configure your transcription and formatting providers. Works out of the box with Apple Dictation (free, on-device) — add an API key to upgrade accuracy and enable AI formatting.

| | Providers |
|---|---|
| **Transcription** | Apple Dictation, Gemini, OpenAI, Deepgram, ElevenLabs |
| **Formatting** | Gemini, OpenAI, Anthropic — Casual, Formatted, or Professional |

Gemini can handle both transcription and formatting in a single API call.

## License

MIT

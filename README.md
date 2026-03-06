# VoiceType 🎙️

Hold a key, speak, release — your words are transcribed and pasted wherever you're typing. Like [Wispr Flow](https://wisprflow.com), but free and open source.

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

**Transcription:** Apple Dictation, Gemini, OpenAI, Deepgram, or ElevenLabs

**Formatting:** Gemini, OpenAI, or Anthropic — with Casual, Formatted, or Professional modes

Gemini can handle both transcription and formatting in a single API call.

## License

MIT

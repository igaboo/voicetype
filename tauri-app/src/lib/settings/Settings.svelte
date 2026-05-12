<script lang="ts">
  /**
   * Full settings UI for the Yap Tauri app.
   *
   * Sections: General, Transcription, Formatting, Behavior, History, Advanced
   * Loads/saves config via Tauri invoke commands.
   * Dark theme matching the overlay pill aesthetic.
   */

  import './settings.css';
  import { invoke } from '@tauri-apps/api/core';
  import { confirm as confirmDialog } from '@tauri-apps/plugin-dialog';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { onDestroy } from 'svelte';

  // ── Config Shape (matches Rust AppConfig with camelCase serde) ─────────

  interface AppConfig {
    hotkey: string;
    audioDevice: string;
    pressEnterAfterPaste: boolean;
    txProvider: string;
    txApiKey: string;
    txModel: string;
    fmtProvider: string;
    fmtApiKey: string;
    fmtModel: string;
    fmtStyle: string;
    onboardingComplete: boolean;
    dgSmartFormat: boolean;
    dgKeywords: string;
    dgLanguage: string;
    oaiLanguage: string;
    oaiPrompt: string;
    geminiTemperature: number;
    elLanguageCode: string;
    soundsEnabled: boolean;
    quietAudioWhileRecording: boolean;
    gradientEnabled: boolean;
    alwaysVisiblePill: boolean;
    historyEnabled: boolean;
    speechLocale: string;
  }

  interface HistoryEntry {
    id: string;
    timestamp: string;
    text: string;
    transcriptionProvider: string;
    formattingProvider: string | null;
    formattingStyle: string | null;
  }

  // ── Provider Metadata ─────────────────────────────────────────────────

  const isWindows = navigator.userAgent.toLowerCase().includes('windows');
  const isTauriRuntime = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  const defaultHotkey = isWindows ? 'ctrl+space' : 'fn';
  const defaultTxProvider = isWindows ? 'openai' : 'none';

  const txProviders: Array<{ value: string; label: string; disabled?: boolean }> = [
    { value: 'none', label: isWindows ? 'On-device (macOS only)' : 'On-device', disabled: isWindows },
    { value: 'gemini', label: 'Gemini' },
    { value: 'openai', label: 'OpenAI' },
    { value: 'deepgram', label: 'Deepgram' },
    { value: 'elevenlabs', label: 'ElevenLabs' },
  ];

  const fmtProviders = [
    { value: 'none', label: 'None' },
    { value: 'gemini', label: 'Gemini' },
    { value: 'openai', label: 'OpenAI' },
    { value: 'anthropic', label: 'Anthropic' },
    { value: 'groq', label: 'Groq' },
  ];

  const txDefaultModels: Record<string, string> = {
    none: '',
    gemini: 'gemini-2.5-flash',
    openai: 'gpt-4o-transcribe',
    deepgram: 'nova-3',
    elevenlabs: 'scribe_v1',
  };

  const fmtDefaultModels: Record<string, string> = {
    none: '',
    gemini: 'gemini-2.5-flash',
    openai: 'gpt-4o-mini',
    anthropic: 'claude-haiku-4-5-20251001',
    groq: 'llama-3.3-70b-versatile',
  };

  const languageOptions = [
    { value: 'auto', label: 'Auto-detect', providerCode: '', speechLocale: '' },
    { value: 'en', label: 'English', providerCode: 'en', speechLocale: 'en-US' },
    { value: 'es', label: 'Spanish', providerCode: 'es', speechLocale: 'es-ES' },
    { value: 'fr', label: 'French', providerCode: 'fr', speechLocale: 'fr-FR' },
    { value: 'de', label: 'German', providerCode: 'de', speechLocale: 'de-DE' },
    { value: 'it', label: 'Italian', providerCode: 'it', speechLocale: 'it-IT' },
    { value: 'pt', label: 'Portuguese', providerCode: 'pt', speechLocale: 'pt-PT' },
    { value: 'ja', label: 'Japanese', providerCode: 'ja', speechLocale: 'ja-JP' },
    { value: 'ko', label: 'Korean', providerCode: 'ko', speechLocale: 'ko-KR' },
    { value: 'zh', label: 'Chinese', providerCode: 'zh', speechLocale: 'zh-CN' },
  ];

  const styleData: Record<string, { label: string; description: string; example: string }> = {
    casual: {
      label: 'Casual',
      description: 'Lowercase, minimal punctuation, conversational tone',
      example: 'yeah i was thinking we could try that new place on friday if you\'re free',
    },
    formatted: {
      label: 'Formatted',
      description: 'Proper capitalization and punctuation, natural writing style',
      example: 'Yeah, I was thinking we could try that new place on Friday if you\'re free.',
    },
    professional: {
      label: 'Professional',
      description: 'Polished, clear, and business-appropriate language',
      example: 'I was considering whether we might visit the new restaurant on Friday, if your schedule allows.',
    },
  };

  const styleExampleInput = 'yeah i was thinking we could try that new place on friday if youre free';
  const modifierOrder = ['cmd', 'ctrl', 'option', 'shift', 'fn'];

  const providerLabels: Record<string, string> = {
    none: 'On-device',
    gemini: 'Gemini',
    openai: 'OpenAI',
    deepgram: 'Deepgram',
    elevenlabs: 'ElevenLabs',
    anthropic: 'Anthropic',
    groq: 'Groq',
  };

  type SectionId = 'general' | 'transcription' | 'formatting' | 'behavior' | 'history' | 'advanced';

  const settingsSections: Array<{ id: SectionId; label: string; description: string }> = [
    { id: 'general', label: 'General', description: 'Shortcut and microphone' },
    { id: 'transcription', label: 'Transcription', description: 'Provider, model, and accuracy' },
    { id: 'formatting', label: 'Formatting', description: 'Cleanup provider and style' },
    { id: 'behavior', label: 'Behavior', description: 'Paste, audio, and launch' },
    { id: 'history', label: 'History', description: 'Saved transcripts' },
    { id: 'advanced', label: 'Advanced', description: 'Onboarding and reset' },
  ];

  // ── State ─────────────────────────────────────────────────────────────

  let loading = $state(true);
  let activeSection = $state<SectionId>('general');
  let configReady = $state(false);

  // General
  let hotkey = $state(defaultHotkey);
  let capturingHotkey = $state(false);
  let hotkeyPreview = $state('');
  let webPressedHotkeyParts: string[] = [];
  let webLastHotkey = '';
  let microphones = $state<string[]>([]);
  let selectedMic = $state('');
  let pressEnterAfterPaste = $state(false);

  // Transcription
  let txProvider = $state(defaultTxProvider);
  let txApiKey = $state('');
  let txModel = $state('');
  let txLanguage = $state('auto');
  let showTxApiKey = $state(false);

  // Transcription provider options
  let dgSmartFormat = $state(true);
  let dgKeywords = $state('');
  let oaiPrompt = $state('');
  let geminiTemperature = $state(0);

  // Formatting
  let fmtProvider = $state('none');
  let fmtApiKey = $state('');
  let fmtModel = $state('');
  let fmtStyle = $state('formatted');
  let fmtUseSameKey = $state(true);
  let showFmtApiKey = $state(false);

  // Behavior
  let soundsEnabled = $state(true);
  let quietAudioWhileRecording = $state(true);
  let gradientEnabled = $state(true);
  let alwaysVisiblePill = $state(true);
  let startWithSystem = $state(false);

  // Load + sync autostart state with the OS
  async function loadAutostart() {
    if (!isTauriRuntime) return;

    try {
      const { isEnabled } = await import('@tauri-apps/plugin-autostart');
      startWithSystem = await isEnabled();
    } catch (e) {
      console.error('Failed to load autostart state:', e);
    }
  }
  loadAutostart();

  async function toggleAutostart(enabled: boolean) {
    if (!isTauriRuntime) return;

    try {
      const { enable, disable } = await import('@tauri-apps/plugin-autostart');
      if (enabled) { await enable(); } else { await disable(); }
    } catch (e) {
      startWithSystem = !enabled;
      console.error('Failed to update autostart state:', e);
    }
  }

  // History
  let historyEnabled = $state(true);
  let historyLoading = $state(true);
  let historyEntries = $state<HistoryEntry[]>([]);
  let copiedHistoryId = $state<string | null>(null);
  let historyLoadStarted = false;
  let copyTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

  // Advanced
  let onboardingComplete = $state(false);

  // ── Derived ───────────────────────────────────────────────────────────

  let hasTxProvider = $derived(txProvider !== 'none');
  let hasFmtProvider = $derived(fmtProvider !== 'none');

  let canShareApiKey = $derived.by(() => {
    if (!hasTxProvider || !hasFmtProvider) return false;
    return (
      (txProvider === 'gemini' && fmtProvider === 'gemini') ||
      (txProvider === 'openai' && fmtProvider === 'openai')
    );
  });

  let effectiveFmtApiKey = $derived(
    fmtUseSameKey && canShareApiKey ? txApiKey : fmtApiKey
  );

  let currentStyleData = $derived(styleData[fmtStyle] ?? styleData.formatted);

  function languageOptionFor(value: string) {
    return languageOptions.find((option) => option.value === value) ?? languageOptions[0];
  }

  function languageValueFromConfig(cfg: AppConfig): string {
    const candidates = [
      cfg.oaiLanguage,
      cfg.dgLanguage,
      cfg.elLanguageCode,
      cfg.speechLocale,
    ].filter(Boolean);

    for (const candidate of candidates) {
      const normalized = candidate.toLowerCase();
      const match = languageOptions.find((option) => (
        option.providerCode === normalized ||
        option.speechLocale.toLowerCase() === normalized ||
        option.value === normalized
      ));
      if (match) return match.value;
    }

    return 'auto';
  }

  // ── Load Config ───────────────────────────────────────────────────────

  async function loadConfig() {
    if (!isTauriRuntime) {
      loading = false;
      configReady = true;
      return;
    }

    configReady = false;
    try {
      const cfg = await invoke<AppConfig>('get_config');
      hotkey = cfg.hotkey;
      selectedMic = cfg.audioDevice ?? '';
      pressEnterAfterPaste = cfg.pressEnterAfterPaste ?? false;
      txProvider = isWindows && cfg.txProvider === 'none' ? defaultTxProvider : cfg.txProvider;
      txApiKey = cfg.txApiKey;
      txModel = cfg.txModel;
      txLanguage = languageValueFromConfig(cfg);
      fmtProvider = cfg.fmtProvider;
      fmtApiKey = cfg.fmtApiKey;
      fmtModel = cfg.fmtModel;
      fmtStyle = cfg.fmtStyle;
      onboardingComplete = cfg.onboardingComplete;
      dgSmartFormat = cfg.dgSmartFormat;
      dgKeywords = cfg.dgKeywords;
      oaiPrompt = cfg.oaiPrompt;
      geminiTemperature = cfg.geminiTemperature;
      soundsEnabled = cfg.soundsEnabled;
      quietAudioWhileRecording = cfg.quietAudioWhileRecording ?? true;
      gradientEnabled = cfg.gradientEnabled;
      alwaysVisiblePill = cfg.alwaysVisiblePill;
      historyEnabled = cfg.historyEnabled;

      // Determine if formatting shares the transcription key
      fmtUseSameKey = cfg.fmtApiKey === '' || cfg.fmtApiKey === cfg.txApiKey;
    } catch (e) {
      console.error('Failed to load config:', e);
    }

    try {
      const devices = await invoke<string[]>('list_audio_devices');
      microphones = devices;
      if (selectedMic && !devices.includes(selectedMic)) {
        microphones = [selectedMic, ...devices];
      }
    } catch (e) {
      console.error('Failed to list audio devices:', e);
    }

    loading = false;
    configReady = true;
  }

  // ── Save Config ───────────────────────────────────────────────────────

  function currentConfig(): AppConfig {
    const language = languageOptionFor(txLanguage);

    return {
      hotkey,
      audioDevice: selectedMic,
      pressEnterAfterPaste,
      txProvider,
      txApiKey,
      txModel,
      fmtProvider,
      fmtApiKey: fmtUseSameKey && canShareApiKey ? '' : fmtApiKey,
      fmtModel,
      fmtStyle,
      onboardingComplete,
      dgSmartFormat,
      dgKeywords,
      dgLanguage: language.providerCode,
      oaiLanguage: language.providerCode,
      oaiPrompt,
      geminiTemperature,
      elLanguageCode: language.providerCode,
      soundsEnabled,
      quietAudioWhileRecording,
      gradientEnabled,
      alwaysVisiblePill,
      historyEnabled,
      speechLocale: language.speechLocale,
    };
  }

  async function persistConfig() {
    if (!isTauriRuntime) return;

    try {
      await invoke('save_config', { cfg: currentConfig() });
    } catch (e) {
      console.error('Failed to save config:', e);
    }
  }

  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  function scheduleSave() {
    if (!isTauriRuntime || !configReady || loading) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void persistConfig();
    }, 300);
  }

  $effect(() => {
    hotkey;
    selectedMic;
    pressEnterAfterPaste;
    txProvider;
    txApiKey;
    txModel;
    txLanguage;
    fmtProvider;
    fmtApiKey;
    fmtModel;
    fmtStyle;
    onboardingComplete;
    dgSmartFormat;
    dgKeywords;
    oaiPrompt;
    geminiTemperature;
    soundsEnabled;
    quietAudioWhileRecording;
    gradientEnabled;
    alwaysVisiblePill;
    historyEnabled;
    fmtUseSameKey;

    scheduleSave();
  });

  // ── Close Window ──────────────────────────────────────────────────────

  async function closeWindow() {
    if (capturingHotkey) {
      if (isTauriRuntime) {
        await invoke('cancel_hotkey_capture');
      }
    }
    if (isTauriRuntime) {
      await invoke('hide_app_window', { label: 'settings' });
    }
  }

  async function startWindowDrag(e: MouseEvent) {
    if (!isTauriRuntime || e.button !== 0) return;
    e.preventDefault();

    try {
      await getCurrentWindow().startDragging();
    } catch (error) {
      console.error('Failed to start window drag:', error);
    }
  }

  function selectSection(section: SectionId) {
    if (capturingHotkey) {
      hotkeyPreview = '';
      resetWebHotkeyCapture();
      capturingHotkey = false;
      if (isTauriRuntime) {
        void invoke('cancel_hotkey_capture');
      }
    }
    activeSection = section;
    if (section === 'history') {
      void loadHistory();
    }
  }

  async function toggleHotkeyCapture() {
    hotkeyPreview = '';
    resetWebHotkeyCapture();
    capturingHotkey = !capturingHotkey;

    if (capturingHotkey) {
      if (isTauriRuntime) {
        await invoke('start_hotkey_capture');
      }
    } else {
      if (isTauriRuntime) {
        await invoke('cancel_hotkey_capture');
      }
    }
  }

  function setCapturedHotkey(value: string) {
    hotkey = value;
    hotkeyPreview = '';
    resetWebHotkeyCapture();
    capturingHotkey = false;
    if (isTauriRuntime) {
      void invoke('cancel_hotkey_capture');
    }
  }

  // ── Keyboard ──────────────────────────────────────────────────────────

  function onKeyDown(e: KeyboardEvent) {
    if (capturingHotkey) {
      e.preventDefault();
      e.stopPropagation();

      if (
        e.key === 'Escape'
        && !e.metaKey
        && !e.ctrlKey
        && !e.altKey
        && !e.shiftKey
        && webPressedHotkeyParts.length === 0
      ) {
        hotkeyPreview = '';
        resetWebHotkeyCapture();
        capturingHotkey = false;
        if (isTauriRuntime) {
          void invoke('cancel_hotkey_capture');
        }
        return;
      }

      const key = canonicalKeyFromEvent(e);
      syncWebModifiers(e);
      if (key) addWebHotkeyPart(key);

      const preview = webHotkeyFromPressed();
      if (preview) {
        webLastHotkey = preview;
        hotkeyPreview = preview;
      }
      return;
    }

    if (e.key === 'Escape') {
      closeWindow();
    }
  }

  function onKeyUp(e: KeyboardEvent) {
    if (!capturingHotkey) return;
    e.preventDefault();
    e.stopPropagation();

    const key = canonicalKeyFromEvent(e);
    if (key) removeWebHotkeyPart(key);
    syncWebModifiers(e);

    if (webPressedHotkeyParts.length === 0 && webLastHotkey) {
      setCapturedHotkey(webLastHotkey);
    }
  }

  function resetWebHotkeyCapture() {
    webPressedHotkeyParts = [];
    webLastHotkey = '';
  }

  function addWebHotkeyPart(part: string) {
    if (!webPressedHotkeyParts.includes(part)) {
      webPressedHotkeyParts = [...webPressedHotkeyParts, part];
    }
  }

  function removeWebHotkeyPart(part: string) {
    webPressedHotkeyParts = webPressedHotkeyParts.filter((pressed) => pressed !== part);
  }

  function syncWebModifiers(e: KeyboardEvent) {
    syncWebModifier('cmd', e.metaKey);
    syncWebModifier('ctrl', e.ctrlKey);
    syncWebModifier('option', e.altKey);
    syncWebModifier('shift', e.shiftKey);
  }

  function syncWebModifier(part: string, pressed: boolean) {
    if (pressed) {
      addWebHotkeyPart(part);
    } else {
      removeWebHotkeyPart(part);
    }
  }

  function webHotkeyFromPressed(): string {
    const modifiers = modifierOrder.filter((modifier) => webPressedHotkeyParts.includes(modifier));
    const triggers = webPressedHotkeyParts.filter((part) => !modifierOrder.includes(part));
    return [...modifiers, ...triggers].join('+');
  }

  function canonicalKeyFromEvent(e: KeyboardEvent): string {
    if (e.key === 'Meta' || e.code === 'MetaLeft' || e.code === 'MetaRight') return 'cmd';
    if (e.key === 'Control' || e.code === 'ControlLeft' || e.code === 'ControlRight') return 'ctrl';
    if (e.key === 'Alt' || e.key === 'Option' || e.code === 'AltLeft' || e.code === 'AltRight') return 'option';
    if (e.key === 'Shift' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') return 'shift';
    if (e.key === 'Fn' || e.key === 'fn' || e.key === 'F24') return 'fn';
    if (e.code.startsWith('Key')) return e.code.slice(3).toLowerCase();
    if (e.code.startsWith('Digit')) return e.code.slice(5);
    if (e.code.startsWith('Numpad') && e.code.length === 7) return e.code.slice(6);
    if (e.code.startsWith('F') && /^F\d{1,2}$/.test(e.code)) return e.code.toLowerCase();

    const namedKeys: Record<string, string> = {
      Space: 'space',
      Enter: 'return',
      Return: 'return',
      Tab: 'tab',
      Escape: 'escape',
      Backspace: 'delete',
      Delete: 'forwarddelete',
      CapsLock: 'capslock',
      ArrowLeft: 'left',
      ArrowRight: 'right',
      ArrowUp: 'up',
      ArrowDown: 'down',
      Home: 'home',
      End: 'end',
      PageUp: 'pageup',
      PageDown: 'pagedown',
      Semicolon: ';',
      Equal: '=',
      Comma: ',',
      Minus: '-',
      Period: '.',
      Slash: '/',
      Backquote: '`',
      BracketLeft: '[',
      Backslash: '\\',
      BracketRight: ']',
      Quote: "'",
    };

    if (namedKeys[e.code]) return namedKeys[e.code];
    if (e.key.length === 1) return e.key.toLowerCase();
    return '';
  }

  // ── Hotkey Display ────────────────────────────────────────────────────

  function hotkeyDisplayParts(key: string): string[] {
    return key
      .split('+')
      .filter(Boolean)
      .map(hotkeyDisplayPartLabel);
  }

  function hotkeyDisplayLabel(key: string): string {
    return key
      .split('+')
      .filter(Boolean)
      .map(hotkeyDisplayPartLabel)
      .join('+');
  }

  function hotkeyDisplayPartLabel(part: string): string {
    if (part === 'cmd') return 'Cmd';
    if (part === 'ctrl') return 'Ctrl';
    if (part === 'option') return 'Option';
    if (part === 'shift') return 'Shift';
    if (part === 'fn') return 'fn';
    if (part === 'space') return 'Space';
    if (part === 'return') return 'Return';
    if (part === 'escape') return 'Esc';
    if (part === 'delete') return 'Delete';
    if (part === 'forwarddelete') return 'Forward Delete';
    if (part === 'capslock') return 'Caps Lock';
    if (part === 'pageup') return 'Page Up';
    if (part === 'pagedown') return 'Page Down';
    if (part === 'left') return 'Left';
    if (part === 'right') return 'Right';
    if (part === 'up') return 'Up';
    if (part === 'down') return 'Down';
    if (part.startsWith('keycode:')) return `Key ${part.slice('keycode:'.length)}`;
    if (part.startsWith('vk:')) return `Key ${part.slice('vk:'.length)}`;
    if (part.length === 1) return part.toUpperCase();
    if (/^f\d{1,2}$/.test(part)) return part.toUpperCase();
    return part;
  }

  // ── History Entries ──────────────────────────────────────────────────

  async function loadHistory() {
    historyLoadStarted = true;
    historyLoading = true;

    if (!isTauriRuntime) {
      historyEntries = [];
      historyLoading = false;
      return;
    }

    try {
      historyEntries = await invoke<HistoryEntry[]>('get_history');
    } catch (e) {
      console.error('Failed to load history:', e);
      historyEntries = [];
    }

    historyLoading = false;
  }

  function providerLabel(tx: string, fmt: string | null): string {
    const txLabel = providerLabels[tx] ?? tx;
    if (!fmt || fmt === 'none') return txLabel;
    const fmtLabel = providerLabels[fmt] ?? fmt;
    if (txLabel === fmtLabel) return txLabel;
    return `${txLabel} + ${fmtLabel}`;
  }

  function relativeTime(isoString: string): string {
    const now = Date.now();
    const then = new Date(isoString).getTime();
    const diffMs = now - then;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHr = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHr / 24);

    if (Number.isNaN(then)) return '';
    if (diffSec < 10) return 'just now';
    if (diffSec < 60) return `${diffSec}s ago`;
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    if (diffDay === 1) return 'Yesterday';
    if (diffDay < 7) return `${diffDay}d ago`;
    if (diffDay < 30) return `${Math.floor(diffDay / 7)}w ago`;
    return new Date(isoString).toLocaleDateString();
  }

  async function copyHistoryEntry(entry: HistoryEntry) {
    try {
      await navigator.clipboard.writeText(entry.text);

      const existing = copyTimeouts.get(entry.id);
      if (existing) clearTimeout(existing);

      copiedHistoryId = entry.id;
      const timeout = setTimeout(() => {
        if (copiedHistoryId === entry.id) copiedHistoryId = null;
      }, 1500);
      copyTimeouts.set(entry.id, timeout);
    } catch (e) {
      console.error('Failed to copy history entry:', e);
    }
  }

  async function deleteHistoryEntry(id: string) {
    if (!isTauriRuntime) return;

    try {
      await invoke('remove_history_entry', { id });
      historyEntries = historyEntries.filter((entry) => entry.id !== id);
      void invoke('refresh_history_menu');
    } catch (e) {
      console.error('Failed to delete history entry:', e);
    }
  }

  async function clearHistoryEntries() {
    const count = historyEntries.length;
    const confirmed = await confirmAction(
      `Clear all history? This will permanently delete ${count} transcription ${count === 1 ? 'entry' : 'entries'}.`,
      'Clear'
    );
    if (!confirmed || !isTauriRuntime) return;

    try {
      await invoke('clear_history');
      historyEntries = [];
      void invoke('refresh_history_menu');
    } catch (e) {
      console.error('Failed to clear history:', e);
    }
  }

  // ── Reset Onboarding ─────────────────────────────────────────────────

  async function confirmAction(message: string, okLabel: string): Promise<boolean> {
    if (!isTauriRuntime) {
      return window.confirm(message);
    }

    return confirmDialog(message, {
      title: 'Yap',
      kind: 'warning',
      okLabel,
      cancelLabel: 'Cancel',
    });
  }

  async function confirmReset(message: string): Promise<boolean> {
    return confirmAction(message, 'Reset');
  }

  async function resetOnboarding() {
    const confirmed = await confirmReset(
      'Reset onboarding? Yap will show setup prompts again the next time they are needed.'
    );
    if (!confirmed) return;

    onboardingComplete = false;
    if (!isTauriRuntime) return;

    try {
      await invoke('reset_onboarding');
    } catch (e) {
      console.error('Failed to reset onboarding:', e);
    }
  }

  async function resetDefaults() {
    const confirmed = await confirmReset(
      'Reset settings to defaults? This will restore every setting in this window and turn off Start with system.'
    );
    if (!confirmed) return;

    hotkey = defaultHotkey;
    selectedMic = '';
    pressEnterAfterPaste = false;
    txProvider = defaultTxProvider;
    txApiKey = '';
    txModel = '';
    txLanguage = 'auto';
    fmtProvider = 'none';
    fmtApiKey = '';
    fmtModel = '';
    fmtStyle = 'casual';
    onboardingComplete = false;
    dgSmartFormat = true;
    dgKeywords = '';
    oaiPrompt = '';
    geminiTemperature = 0;
    soundsEnabled = true;
    quietAudioWhileRecording = true;
    gradientEnabled = true;
    alwaysVisiblePill = true;
    startWithSystem = false;
    void toggleAutostart(false);
    historyEnabled = true;
    void persistConfig();
  }

  // ── Init ──────────────────────────────────────────────────────────────

  // Load config immediately on mount.
  loadConfig();

  // Re-load config whenever the settings window is shown / focused, so
  // the form always reflects the latest persisted values (the window is
  // hidden rather than destroyed when closed).
  let unlistenFocus: (() => void) | undefined;
  let unlistenHotkeyPreview: (() => void) | undefined;
  let unlistenHotkeyCapture: (() => void) | undefined;
  let unlistenShowHistory: (() => void) | undefined;
  let unlistenHistoryCleared: (() => void) | undefined;

  if (isTauriRuntime) {
    getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (focused) {
          loading = true;
          loadConfig();
          if (activeSection === 'history' || historyLoadStarted) {
            void loadHistory();
          }
        }
      })
      .then((fn) => {
        unlistenFocus = fn;
      });

    getCurrentWindow()
      .listen<string>('settings:hotkey-preview', ({ payload }) => {
        if (capturingHotkey) {
          hotkeyPreview = payload;
        }
      })
      .then((fn) => {
        unlistenHotkeyPreview = fn;
      });

    getCurrentWindow()
      .listen<string>('settings:hotkey-captured', ({ payload }) => {
        setCapturedHotkey(payload);
      })
      .then((fn) => {
        unlistenHotkeyCapture = fn;
      });

    getCurrentWindow()
      .listen('settings:show-history', () => {
        activeSection = 'history';
        void loadHistory();
      })
      .then((fn) => {
        unlistenShowHistory = fn;
      });

    getCurrentWindow()
      .listen('tray:history-cleared', () => {
        if (activeSection === 'history' || historyLoadStarted) {
          void loadHistory();
        }
      })
      .then((fn) => {
        unlistenHistoryCleared = fn;
      });
  }

  onDestroy(() => {
    unlistenFocus?.();
    unlistenHotkeyPreview?.();
    unlistenHotkeyCapture?.();
    unlistenShowHistory?.();
    unlistenHistoryCleared?.();
    if (saveTimer) clearTimeout(saveTimer);
    for (const timeout of copyTimeouts.values()) {
      clearTimeout(timeout);
    }
    if (isTauriRuntime) {
      void invoke('cancel_hotkey_capture');
    }
  });
</script>

<svelte:window onkeydown={onKeyDown} onkeyup={onKeyUp} />

{#if loading}
  <div class="settings-container loading-state">
    <span>Loading...</span>
  </div>
{:else}
  <div class="settings-container">
    <div
      class="settings-drag-region"
      data-tauri-drag-region
      aria-hidden="true"
      onmousedown={startWindowDrag}
    ></div>
    <aside class="settings-sidebar" aria-label="Settings sections">
      <div class="sidebar-header">
        <img class="app-icon" src="/favicon.png" alt="" aria-hidden="true" />
        <div>
          <div class="sidebar-title">Yap</div>
          <div class="sidebar-subtitle">Settings</div>
        </div>
      </div>

      <nav class="section-nav">
        {#each settingsSections as section}
          <button
            class="section-nav-item"
            class:active={activeSection === section.id}
            type="button"
            aria-current={activeSection === section.id ? 'page' : undefined}
            aria-controls={'settings-panel-' + section.id}
            onclick={() => selectSection(section.id)}
          >
            <span class="section-nav-label">{section.label}</span>
            <span class="section-nav-description">{section.description}</span>
          </button>
        {/each}
      </nav>

    </aside>

    <div class="settings-main">
      <main class="settings-content" id={'settings-panel-' + activeSection}>
        {#if activeSection === 'general'}
          <section class="settings-section" aria-label="General settings">
            <div class="section-body">
              <div class="field-row hotkey-field">
                <div class="field-copy">
                  <span class="field-label">Hotkey</span>
                  <span class="field-description">
                    {isWindows
                      ? 'Press the exact key or combination. Fn works only on keyboards that expose it to Windows.'
                      : 'Press the exact key or combination. Fn/Globe is captured natively.'}
                  </span>
                </div>
                <button
                  class="hotkey-button"
                  class:capturing={capturingHotkey}
                  onclick={toggleHotkeyCapture}
                  type="button"
                  aria-label={capturingHotkey ? 'Press shortcut' : `Current hotkey: ${hotkeyDisplayLabel(hotkey)}`}
                >
                  {#if capturingHotkey}
                    {#if hotkeyPreview}
                      <span class="keycap-stack" aria-hidden="true">
                        {#each hotkeyDisplayParts(hotkeyPreview) as part, index}
                          <span class="keycap keycap-live">{part}</span>
                          {#if index < hotkeyDisplayParts(hotkeyPreview).length - 1}
                            <span class="keycap-plus" aria-hidden="true">+</span>
                          {/if}
                        {/each}
                      </span>
                      <span class="sr-only">{hotkeyDisplayLabel(hotkeyPreview)}</span>
                    {:else}
                      <span class="hotkey-placeholder">Press shortcut...</span>
                    {/if}
                  {:else}
                    <span class="keycap-stack" aria-hidden="true">
                      {#each hotkeyDisplayParts(hotkey) as part, index}
                        <span class="keycap">{part}</span>
                        {#if index < hotkeyDisplayParts(hotkey).length - 1}
                          <span class="keycap-plus" aria-hidden="true">+</span>
                        {/if}
                      {/each}
                    </span>
                    <span class="sr-only">{hotkeyDisplayLabel(hotkey)}</span>
                  {/if}
                </button>
              </div>

              <div class="field-row">
                <span class="field-label">Microphone</span>
                <select class="select" bind:value={selectedMic}>
                  <option value="">System Default</option>
                  {#each microphones as mic}
                    <option value={mic}>{mic}</option>
                  {/each}
                  {#if microphones.length === 0}
                    <option value="">No devices found</option>
                  {/if}
                </select>
              </div>
            </div>
          </section>
        {/if}

        {#if activeSection === 'transcription'}
          <section class="settings-section" aria-label="Transcription settings">
            <div class="section-body">
              <div class="field-row">
                <span class="field-label">Provider</span>
                <select class="select" bind:value={txProvider}>
                  {#each txProviders as p}
                    <option value={p.value} disabled={p.disabled}>{p.label}</option>
                  {/each}
                </select>
              </div>

              <div class="field-row">
                <span class="field-label">Language</span>
                <select class="select" bind:value={txLanguage}>
                  {#each languageOptions as language}
                    <option value={language.value}>{language.label}</option>
                  {/each}
                </select>
                <span class="field-description">Auto-detect works best for most people. Choose a language when recognition needs a hint.</span>
              </div>

              {#if hasTxProvider}
                <div class="field-divider"></div>

                <div class="field-row">
                  <span class="field-label">API Key</span>
                  <div class="password-wrapper">
                    <input
                      class="input"
                      type={showTxApiKey ? 'text' : 'password'}
                      placeholder="Required"
                      bind:value={txApiKey}
                      autocomplete="off"
                    />
                    <button
                      class="password-toggle"
                      onclick={() => { showTxApiKey = !showTxApiKey; }}
                      aria-label={showTxApiKey ? 'Hide API key' : 'Show API key'}
                      type="button"
                    >
                      {#if showTxApiKey}
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                          <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5Z"/>
                          <circle cx="8" cy="8" r="2"/>
                        </svg>
                      {:else}
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                          <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5Z"/>
                          <circle cx="8" cy="8" r="2"/>
                          <line x1="2" y1="14" x2="14" y2="2"/>
                        </svg>
                      {/if}
                    </button>
                  </div>
                </div>

                <div class="field-row">
                  <span class="field-label">Model</span>
                  <input
                    class="input"
                    type="text"
                    placeholder={txDefaultModels[txProvider] ?? ''}
                    bind:value={txModel}
                  />
                  <span class="field-description">
                    Leave empty to use the default ({txDefaultModels[txProvider] ?? 'none'}).
                  </span>
                </div>

                {#if txProvider === 'deepgram'}
                  <div class="field-divider"></div>

                  <div class="toggle-row">
                    <div class="toggle-info">
                      <span class="toggle-label">Smart Format</span>
                      <span class="toggle-description">Auto-formats numbers, dates, currencies, and adds punctuation</span>
                    </div>
                    <label class="toggle-switch">
                      <input type="checkbox" bind:checked={dgSmartFormat} />
                      <span class="toggle-track"></span>
                      <span class="toggle-thumb"></span>
                    </label>
                  </div>

                  <div class="field-row">
                    <span class="field-label">Keywords</span>
                    <input
                      class="input"
                      type="text"
                      placeholder="e.g. Kubernetes, Jira, OAuth"
                      bind:value={dgKeywords}
                    />
                    <span class="field-description">Boost recognition of specific words or names, separated by commas.</span>
                  </div>
                {/if}

                {#if txProvider === 'openai'}
                  <div class="field-divider"></div>

                  <div class="field-row">
                    <span class="field-label">Prompt</span>
                    <input
                      class="input"
                      type="text"
                      placeholder="e.g. The speaker discusses SwiftUI and Xcode"
                      bind:value={oaiPrompt}
                    />
                    <span class="field-description">Guide the model with context -- useful for domain-specific terms, names, or jargon it might mishear.</span>
                  </div>
                {/if}

                {#if txProvider === 'gemini'}
                  <div class="field-divider"></div>

                  <div class="field-row">
                    <span class="field-label">Temperature</span>
                    <div class="slider-row">
                      <input
                        class="slider-input"
                        type="range"
                        min="0"
                        max="1"
                        step="0.1"
                        bind:value={geminiTemperature}
                      />
                      <span class="slider-value">{geminiTemperature.toFixed(1)}</span>
                    </div>
                    <span class="field-description">Controls randomness. 0 = precise and deterministic, 1 = creative and varied. Lower is better for transcription.</span>
                  </div>
                {/if}

              {/if}
            </div>
            {#if !hasTxProvider}
              <div class="section-footer">
                Select a provider and enter your API key to enable transcription.
              </div>
            {/if}
          </section>
        {/if}

        {#if activeSection === 'formatting'}
          <section class="settings-section" aria-label="Formatting settings">
            <div class="section-body">
              <div class="field-row">
                <span class="field-label">Provider</span>
                <select class="select" bind:value={fmtProvider}>
                  {#each fmtProviders as p}
                    <option value={p.value}>{p.label}</option>
                  {/each}
                </select>
              </div>

              {#if hasFmtProvider}
                <div class="field-divider"></div>

                <div class="field-row">
                  <span class="field-label">API Key</span>
                  <div class="password-wrapper">
                    <input
                      class="input"
                      type={showFmtApiKey ? 'text' : 'password'}
                      placeholder="Required"
                      value={effectiveFmtApiKey}
                      oninput={(e: Event) => { fmtApiKey = (e.target as HTMLInputElement).value; }}
                      disabled={fmtUseSameKey && canShareApiKey}
                      autocomplete="off"
                    />
                    <button
                      class="password-toggle"
                      onclick={() => { showFmtApiKey = !showFmtApiKey; }}
                      aria-label={showFmtApiKey ? 'Hide API key' : 'Show API key'}
                      type="button"
                    >
                      {#if showFmtApiKey}
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                          <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5Z"/>
                          <circle cx="8" cy="8" r="2"/>
                        </svg>
                      {:else}
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                          <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5Z"/>
                          <circle cx="8" cy="8" r="2"/>
                          <line x1="2" y1="14" x2="14" y2="2"/>
                        </svg>
                      {/if}
                    </button>
                  </div>
                  {#if canShareApiKey}
                    <label class="checkbox-row">
                      <input type="checkbox" bind:checked={fmtUseSameKey} />
                      <span class="checkbox-label">Use same API key as transcription</span>
                    </label>
                  {/if}
                </div>

                <div class="field-row">
                  <span class="field-label">Model</span>
                  <input
                    class="input"
                    type="text"
                    placeholder={fmtDefaultModels[fmtProvider] ?? ''}
                    bind:value={fmtModel}
                  />
                  <span class="field-description">
                    Leave empty to use the default ({fmtDefaultModels[fmtProvider] ?? 'none'}).
                  </span>
                </div>

                <div class="field-divider"></div>

                <div class="field-row">
                  <span class="field-label">Style</span>
                  <div class="style-picker">
                    {#each Object.entries(styleData) as [value, data]}
                      <div class="style-option">
                        <input
                          type="radio"
                          name="fmtStyle"
                          id="style-{value}"
                          {value}
                          checked={fmtStyle === value}
                          onchange={() => { fmtStyle = value; }}
                        />
                        <label for="style-{value}">{data.label}</label>
                      </div>
                    {/each}
                  </div>
                </div>

                <div class="style-preview">
                  <div class="style-preview-header">
                    <div class="style-preview-title">{currentStyleData.label}</div>
                    <div class="style-preview-desc">{currentStyleData.description}</div>
                  </div>
                  <div class="style-preview-body">
                    <div class="style-preview-col">
                      <div class="style-preview-label before">Before</div>
                      <div class="style-preview-text">{styleExampleInput}</div>
                    </div>
                    <div class="style-preview-col">
                      <div class="style-preview-label after">After</div>
                      <div class="style-preview-text">{currentStyleData.example}</div>
                    </div>
                  </div>
                </div>
              {/if}
            </div>
            {#if !hasFmtProvider}
              <div class="section-footer">
                No formatting -- raw transcription will be pasted as-is.
              </div>
            {/if}
          </section>
        {/if}

        {#if activeSection === 'behavior'}
          <section class="settings-section" aria-label="Behavior settings">
            <div class="section-body">
              <div class="toggle-row">
                <div class="toggle-info">
                  <span class="toggle-label">Press Enter after paste</span>
                  <span class="toggle-description">Send Return after Yap inserts the transcription</span>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" bind:checked={pressEnterAfterPaste} />
                  <span class="toggle-track"></span>
                  <span class="toggle-thumb"></span>
                </label>
              </div>

              <div class="field-divider"></div>

              <div class="toggle-row">
                <div class="toggle-info">
                  <span class="toggle-label">Sound effects</span>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" bind:checked={soundsEnabled} />
                  <span class="toggle-track"></span>
                  <span class="toggle-thumb"></span>
                </label>
              </div>

              <div class="field-divider"></div>

              <div class="toggle-row">
                <div class="toggle-info">
                  <span class="toggle-label">Quiet background audio</span>
                  <span class="toggle-description">Reduce or mute other app audio while recording</span>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" bind:checked={quietAudioWhileRecording} />
                  <span class="toggle-track"></span>
                  <span class="toggle-thumb"></span>
                </label>
              </div>

              <div class="field-divider"></div>

              <div class="toggle-row">
                <div class="toggle-info">
                  <span class="toggle-label">Gradient background</span>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" bind:checked={gradientEnabled} />
                  <span class="toggle-track"></span>
                  <span class="toggle-thumb"></span>
                </label>
              </div>

              <div class="field-divider"></div>

              <div class="toggle-row">
                <div class="toggle-info">
                  <span class="toggle-label">Always-visible pill</span>
                  <span class="toggle-description">Keep the overlay pill visible even when idle</span>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" bind:checked={alwaysVisiblePill} />
                  <span class="toggle-track"></span>
                  <span class="toggle-thumb"></span>
                </label>
              </div>

              <div class="field-divider"></div>

              <div class="toggle-row">
                <div class="toggle-info">
                  <span class="toggle-label">Start with system</span>
                  <span class="toggle-description">Launch Yap automatically when you log in</span>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" bind:checked={startWithSystem} onchange={() => { void toggleAutostart(startWithSystem); }} />
                  <span class="toggle-track"></span>
                  <span class="toggle-thumb"></span>
                </label>
              </div>
            </div>
          </section>
        {/if}

        {#if activeSection === 'history'}
          <section class="settings-section" aria-label="History settings">
            <div class="section-body">
              <div class="toggle-row">
                <div class="toggle-info">
                  <span class="toggle-label">Save transcription history</span>
                  <span class="toggle-description">Keep recent transcripts available for review and reuse</span>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" bind:checked={historyEnabled} />
                  <span class="toggle-track"></span>
                  <span class="toggle-thumb"></span>
                </label>
              </div>

              <div class="field-divider"></div>

              <div class="history-toolbar">
                <div class="field-copy">
                  <span class="field-label">Transcription history</span>
                  <span class="field-description">
                    {#if historyLoading}
                      Loading entries...
                    {:else if historyEntries.length === 1}
                      1 saved entry
                    {:else}
                      {historyEntries.length} saved entries
                    {/if}
                  </span>
                </div>
                <button
                  class="btn btn-danger"
                  onclick={clearHistoryEntries}
                  type="button"
                  disabled={historyLoading || historyEntries.length === 0}
                >
                  Clear
                </button>
              </div>

              {#if historyLoading}
                <div class="history-empty-state">
                  <span>Loading...</span>
                </div>
              {:else if historyEntries.length === 0}
                <div class="history-empty-state">
                  <span class="history-empty-title">No transcriptions yet</span>
                  <span class="field-description">Your saved transcriptions will appear here.</span>
                </div>
              {:else}
                <div class="settings-history-list" aria-label="Saved transcriptions">
                  {#each historyEntries as entry (entry.id)}
                    <article class="settings-history-entry">
                      <div class="history-entry-copy">
                        <div class="history-entry-text">{entry.text}</div>
                        <div class="history-entry-meta">
                          <span>{relativeTime(entry.timestamp)}</span>
                          <span class="history-badge">{providerLabel(entry.transcriptionProvider, entry.formattingProvider)}</span>
                          {#if entry.formattingStyle && entry.formattingStyle !== 'none'}
                            <span class="history-badge">{entry.formattingStyle}</span>
                          {/if}
                        </div>
                      </div>
                      <div class="history-entry-actions">
                        <button
                          class="icon-button"
                          class:success={copiedHistoryId === entry.id}
                          onclick={() => copyHistoryEntry(entry)}
                          aria-label="Copy transcription"
                          type="button"
                        >
                          {#if copiedHistoryId === entry.id}
                            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                              <polyline points="3.5 8.5 6.5 11.5 12.5 5.5"/>
                            </svg>
                          {:else}
                            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                              <rect x="5" y="5" width="9" height="9" rx="1.5"/>
                              <path d="M3 11V3a1.5 1.5 0 0 1 1.5-1.5H11"/>
                            </svg>
                          {/if}
                        </button>
                        <button
                          class="icon-button danger"
                          onclick={() => deleteHistoryEntry(entry.id)}
                          aria-label="Delete transcription"
                          type="button"
                        >
                          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                            <path d="M2 4h12M5.333 4V2.667a1.333 1.333 0 0 1 1.334-1.334h2.666a1.333 1.333 0 0 1 1.334 1.334V4m2 0v9.333a1.333 1.333 0 0 1-1.334 1.334H4.667a1.333 1.333 0 0 1-1.334-1.334V4h9.334Z"/>
                          </svg>
                        </button>
                      </div>
                    </article>
                  {/each}
                </div>
              {/if}
            </div>
            {#if !historyEnabled}
              <div class="section-footer">
                Transcriptions will not be saved to disk.
              </div>
            {/if}
          </section>
        {/if}

        {#if activeSection === 'advanced'}
          <section class="settings-section" aria-label="Advanced settings">
            <div class="section-body">
              <div class="action-row">
                <div class="field-copy">
                  <span class="field-label">Onboarding</span>
                  <span class="field-description">Show setup prompts again the next time Yap needs them.</span>
                </div>
                <button class="btn btn-secondary" onclick={resetOnboarding} type="button">
                  Reset Onboarding
                </button>
              </div>

              <div class="field-divider"></div>

              <div class="action-row">
                <div class="field-copy">
                  <span class="field-label">Default settings</span>
                  <span class="field-description">Restore every setting in this window and turn off Start with system.</span>
                </div>
                <button class="btn btn-secondary" onclick={resetDefaults} type="button">
                  Reset Defaults
                </button>
              </div>
            </div>
          </section>
        {/if}
      </main>
    </div>
  </div>
{/if}

import { app } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type BackgroundAudioMode = "off" | "mute" | "pause";
export type TranscriptionProvider = "none" | "gemini" | "openai" | "deepgram" | "elevenlabs";
export type FormattingProvider = "none" | "gemini" | "openai" | "anthropic" | "groq";
export type FormattingStyle = "casual" | "formatted" | "professional";

export interface AppConfig {
  hotkey: string;
  audioDevice: string;
  pressEnterAfterPaste: boolean;
  txProvider: TranscriptionProvider;
  txApiKey: string;
  txModel: string;
  fmtProvider: FormattingProvider;
  fmtApiKey: string;
  fmtModel: string;
  fmtStyle: FormattingStyle;
  onboardingComplete: boolean;
  dgSmartFormat: boolean;
  dgKeywords: string;
  dgLanguage: string;
  oaiLanguage: string;
  oaiPrompt: string;
  geminiTemperature: number;
  elLanguageCode: string;
  soundsEnabled: boolean;
  backgroundAudioMode: BackgroundAudioMode;
  gradientEnabled: boolean;
  alwaysVisiblePill: boolean;
  historyEnabled: boolean;
  speechLocale: string;
}

type PersistedAppConfig = Partial<AppConfig> & {
  quietAudioWhileRecording?: unknown;
};

let cachedConfig: AppConfig = defaultConfig();

export function configDir(): string {
  const base = process.platform === "win32" ? app.getPath("appData") : join(homedir(), ".config");
  return join(base, "yap");
}

export function configPath(): string {
  return join(configDir(), "config.json");
}

export async function loadConfig(): Promise<AppConfig> {
  await mkdir(configDir(), { recursive: true });

  let config: AppConfig;
  try {
    const data = await readFile(configPath(), "utf8");
    config = normalizeConfig(JSON.parse(data));
  } catch {
    config = defaultConfig();
    await saveConfig(config);
  }

  cachedConfig = config;
  return config;
}

export async function saveConfig(config: AppConfig): Promise<void> {
  const normalized = normalizeConfig(config);
  await mkdir(configDir(), { recursive: true });
  await writeFile(configPath(), `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  cachedConfig = normalized;
}

export function getConfigSnapshot(): AppConfig {
  return cachedConfig;
}

function defaultConfig(): AppConfig {
  return {
    hotkey: process.platform === "win32" ? "capslock" : "fn",
    audioDevice: "",
    pressEnterAfterPaste: false,
    txProvider: process.platform === "win32" ? "openai" : "none",
    txApiKey: "",
    txModel: "",
    fmtProvider: "none",
    fmtApiKey: "",
    fmtModel: "",
    fmtStyle: "formatted",
    onboardingComplete: false,
    dgSmartFormat: true,
    dgKeywords: "",
    dgLanguage: "",
    oaiLanguage: "",
    oaiPrompt: "",
    geminiTemperature: 0,
    elLanguageCode: "",
    soundsEnabled: true,
    backgroundAudioMode: "mute",
    gradientEnabled: true,
    alwaysVisiblePill: true,
    historyEnabled: true,
    speechLocale: "",
  };
}

function normalizeConfig(input: PersistedAppConfig | null | undefined): AppConfig {
  const defaults = defaultConfig();
  const persisted = input ?? {};
  const config = { ...defaults, ...(input ?? {}) };
  const backgroundAudioMode = resolveBackgroundAudioMode(persisted, defaults.backgroundAudioMode);

  return {
    ...config,
    hotkey: stringOrDefault(config.hotkey, defaults.hotkey),
    audioDevice: stringOrDefault(config.audioDevice, ""),
    txApiKey: stringOrDefault(config.txApiKey, ""),
    txModel: stringOrDefault(config.txModel, ""),
    fmtApiKey: stringOrDefault(config.fmtApiKey, ""),
    fmtModel: stringOrDefault(config.fmtModel, ""),
    dgKeywords: stringOrDefault(config.dgKeywords, ""),
    dgLanguage: stringOrDefault(config.dgLanguage, ""),
    oaiLanguage: stringOrDefault(config.oaiLanguage, ""),
    oaiPrompt: stringOrDefault(config.oaiPrompt, ""),
    elLanguageCode: stringOrDefault(config.elLanguageCode, ""),
    speechLocale: stringOrDefault(config.speechLocale, ""),
    backgroundAudioMode,
  };
}

function stringOrDefault(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function isBackgroundAudioMode(value: unknown): value is BackgroundAudioMode {
  return value === "off" || value === "mute" || value === "pause";
}

function resolveBackgroundAudioMode(
  input: PersistedAppConfig,
  fallback: BackgroundAudioMode
): BackgroundAudioMode {
  if (isBackgroundAudioMode(input.backgroundAudioMode)) {
    return input.backgroundAudioMode;
  }

  if (typeof input.quietAudioWhileRecording === "boolean") {
    return input.quietAudioWhileRecording ? "mute" : "off";
  }

  return fallback;
}

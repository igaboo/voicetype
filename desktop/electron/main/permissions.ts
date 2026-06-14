import { shell, systemPreferences } from "electron";

type AccessibilityPromptReason = "startup" | "runtime" | "user-action";

interface PermissionSupervisorOptions {
  onAccessibilityGranted: () => Promise<void> | void;
}

const ACCESSIBILITY_SETTINGS_URL =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";
const MICROPHONE_SETTINGS_URL =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone";
const ACCESSIBILITY_POLL_INTERVAL_MS = 1_000;

export class PermissionSupervisor {
  private accessibilityPoll: NodeJS.Timeout | null = null;
  private accessibilityPromptShown = false;
  private accessibilitySettingsOpened = false;
  private accessibilityGrantInFlight = false;

  constructor(private readonly options: PermissionSupervisorOptions) {}

  async preflight(): Promise<void> {
    if (process.platform !== "darwin") return;

    try {
      await requestMicrophoneAccess();
    } catch (error) {
      console.warn("[yap] microphone permission preflight failed:", error);
    }

    try {
      this.ensureAccessibility("startup");
    } catch (error) {
      console.warn("[yap] Accessibility permission preflight failed:", error);
    }
  }

  ensureAccessibility(reason: AccessibilityPromptReason): void {
    if (process.platform !== "darwin") return;

    if (systemPreferences.isTrustedAccessibilityClient(false)) {
      this.stopAccessibilityPolling();
      return;
    }

    console.warn(`[yap] Accessibility permission required (${reason})`);

    if (!this.accessibilityPromptShown) {
      this.accessibilityPromptShown = true;
      const trustedAfterPrompt = systemPreferences.isTrustedAccessibilityClient(true);
      console.warn(`[yap] Accessibility prompt returned trusted=${trustedAfterPrompt}`);
      if (trustedAfterPrompt) return;
    }

    if (!this.accessibilitySettingsOpened) {
      this.accessibilitySettingsOpened = true;
      void shell.openExternal(ACCESSIBILITY_SETTINGS_URL).catch((error) => {
        console.warn("[yap] failed to open Accessibility settings:", error);
      });
    }

    this.startAccessibilityPolling();
  }

  stop(): void {
    this.stopAccessibilityPolling();
  }

  private startAccessibilityPolling(): void {
    if (this.accessibilityPoll) return;

    console.warn("[yap] waiting for Accessibility grant");
    this.accessibilityPoll = setInterval(() => {
      if (!systemPreferences.isTrustedAccessibilityClient(false)) return;
      if (this.accessibilityGrantInFlight) return;

      this.accessibilityGrantInFlight = true;
      console.warn("[yap] Accessibility grant detected; relaunching");
      this.stopAccessibilityPolling();
      Promise.resolve(this.options.onAccessibilityGranted()).catch((error) => {
        console.warn("[yap] failed to relaunch after Accessibility grant:", error);
        this.accessibilityGrantInFlight = false;
      });
    }, ACCESSIBILITY_POLL_INTERVAL_MS);
    this.accessibilityPoll.unref();
  }

  private stopAccessibilityPolling(): void {
    if (!this.accessibilityPoll) return;
    clearInterval(this.accessibilityPoll);
    this.accessibilityPoll = null;
    this.accessibilityGrantInFlight = false;
  }
}

export function isAccessibilityPayload(payload: unknown): boolean {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "permission" in payload &&
    (payload as { permission?: unknown }).permission === "accessibility"
  );
}

async function requestMicrophoneAccess(): Promise<void> {
  const status = systemPreferences.getMediaAccessStatus("microphone");
  console.info(`[yap] microphone permission status=${status}`);

  if (status === "not-determined") {
    const granted = await systemPreferences.askForMediaAccess("microphone");
    console.info(`[yap] microphone permission prompt granted=${granted}`);
    return;
  }

  if (status === "denied" || status === "restricted") {
    console.warn(`[yap] microphone permission is ${status}; opening Microphone settings`);
    await shell.openExternal(MICROPHONE_SETTINGS_URL);
  }
}

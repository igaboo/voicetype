import type { Input, WebContents } from "electron";
import { sendToWindow } from "./windows";

let captureContents: WebContents | null = null;
let captureHandler: ((event: Electron.Event, input: Input) => void) | null = null;

export function startHotkeyCapture(webContents: WebContents): void {
  cancelHotkeyCapture();
  captureContents = webContents;
  captureHandler = (event, input) => {
    if (input.type !== "keyDown") return;

    const shortcut = shortcutFromInput(input);
    if (!shortcut) return;

    event.preventDefault();
    sendToWindow("settings", "settings:hotkey-preview", shortcut);

    if (shortcut === "escape") {
      cancelHotkeyCapture();
      return;
    }

    sendToWindow("settings", "settings:hotkey-captured", shortcut);
    cancelHotkeyCapture();
  };

  captureContents.on("before-input-event", captureHandler);
}

export function cancelHotkeyCapture(): void {
  if (captureContents && captureHandler && !captureContents.isDestroyed()) {
    captureContents.off("before-input-event", captureHandler);
  }
  captureContents = null;
  captureHandler = null;
}

function shortcutFromInput(input: Input): string {
  const parts: string[] = [];
  if (input.control) parts.push("ctrl");
  if (input.meta) parts.push("cmd");
  if (input.alt) parts.push("option");
  if (input.shift) parts.push("shift");

  const key = normalizeKey(input.key);
  if (key && !parts.includes(key)) parts.push(key);

  return parts.join("+");
}

function normalizeKey(key: string): string {
  const value = key.toLowerCase();
  const aliases: Record<string, string> = {
    " ": "space",
    arrowup: "up",
    arrowdown: "down",
    arrowleft: "left",
    arrowright: "right",
    control: "ctrl",
    meta: "cmd",
    escape: "escape",
  };
  return aliases[value] ?? value;
}

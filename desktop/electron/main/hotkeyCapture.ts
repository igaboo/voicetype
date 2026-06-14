import type { Input, WebContents } from "electron";
import { sendToWindow } from "./windows";

let captureContents: WebContents | null = null;
let captureHandler: ((event: Electron.Event, input: Input) => void) | null = null;
let pressedParts = new Set<string>();
let lastShortcut = "";

export function startHotkeyCapture(webContents: WebContents): void {
  cancelHotkeyCapture();
  captureContents = webContents;
  pressedParts = new Set();
  lastShortcut = "";
  captureHandler = (event, input) => {
    if (input.type !== "keyDown" && input.type !== "keyUp") return;

    event.preventDefault();

    const key = normalizeKey(input.key);
    if (input.type === "keyDown" && key === "escape") {
      cancelHotkeyCapture();
      return;
    }

    updatePressedParts(input, key);

    if (input.type === "keyDown") {
      const shortcut = shortcutFromPressedParts();
      if (!shortcut) return;
      lastShortcut = shortcut;
      sendToWindow("settings", "settings:hotkey-preview", shortcut);
      return;
    }

    if (pressedParts.size === 0 && lastShortcut) {
      sendToWindow("settings", "settings:hotkey-captured", lastShortcut);
      cancelHotkeyCapture();
    }
  };

  captureContents.on("before-input-event", captureHandler);
}

export function cancelHotkeyCapture(): void {
  if (captureContents && captureHandler && !captureContents.isDestroyed()) {
    captureContents.off("before-input-event", captureHandler);
  }
  captureContents = null;
  captureHandler = null;
  pressedParts = new Set();
  lastShortcut = "";
}

function updatePressedParts(input: Input, key: string): void {
  syncModifier("cmd", input.meta);
  syncModifier("ctrl", input.control);
  syncModifier("option", input.alt);
  syncModifier("shift", input.shift);

  if (!key) return;

  if (input.type === "keyDown") {
    pressedParts.add(key);
  } else {
    pressedParts.delete(key);
  }
}

function syncModifier(part: string, pressed: boolean): void {
  if (pressed) {
    pressedParts.add(part);
  } else {
    pressedParts.delete(part);
  }
}

function shortcutFromPressedParts(): string {
  const modifierOrder = ["cmd", "ctrl", "option", "shift"];
  const modifiers = modifierOrder.filter((modifier) => pressedParts.has(modifier));
  const triggers = [...pressedParts].filter((part) => !modifierOrder.includes(part));
  return [...modifiers, ...triggers].join("+");
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

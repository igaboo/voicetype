import { app, Menu, nativeImage, Tray } from "electron";
import type { MenuItemConstructorOptions } from "electron";
import { join } from "node:path";
import {
  clearHistory,
  copyHistoryEntryToClipboard,
  historyMenuLabel,
  loadHistory,
  menuEntries,
} from "./history";
import { sendToWindow, showAppWindow } from "./windows";

let tray: Tray | null = null;
let appRoot = "";
let enabled = true;

interface RuntimeController {
  setEnabled(enabled: boolean): Promise<void>;
}

let runtimeController: RuntimeController | null = null;

export async function installTray(root: string, controller: RuntimeController): Promise<void> {
  if (tray) return;

  appRoot = root;
  runtimeController = controller;
  const trayIcon = nativeImage.createFromPath(join(appRoot, "native-core/icons/tray.png"));
  tray = new Tray(trayIcon.isEmpty() ? nativeImage.createEmpty() : trayIcon.resize({ width: 18, height: 18 }));
  tray.setToolTip("Yap");
  await refreshHistoryMenu();
}

export async function refreshHistoryMenu(): Promise<void> {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate(await menuTemplate()));
}

async function menuTemplate(): Promise<MenuItemConstructorOptions[]> {
  const historyEntries = menuEntries(await loadHistory());
  const historySubmenu: MenuItemConstructorOptions[] =
    historyEntries.length === 0
      ? [{ label: "No entries", enabled: false }]
      : [
          ...historyEntries.map((entry) => ({
            label: historyMenuLabel(entry.text),
            click: () => {
              void copyHistoryEntryToClipboard(entry.id);
            },
          })),
          { type: "separator" as const },
          {
            label: "Show All...",
            click: () => {
              void showAppWindow("settings").then(() => sendToWindow("settings", "settings:show-history"));
            },
          },
          {
            label: "Clear History",
            click: () => {
              void clearHistory().then(async () => {
                await refreshHistoryMenu();
                sendToWindow("settings", "tray:history-cleared");
              });
            },
          },
        ];

  return [
    { label: "Yap", enabled: false },
    { type: "separator" },
    {
      label: "Enabled",
      type: "checkbox",
      checked: enabled,
      click: (item) => {
        const nextEnabled = item.checked;
        void setEnabled(nextEnabled);
      },
    },
    { label: "History", submenu: historySubmenu },
    {
      label: "Open Settings",
      click: () => {
        void showAppWindow("settings");
      },
    },
    {
      label: "Check for Updates...",
      click: () => {
        void showAppWindow("settings").then(() => sendToWindow("settings", "settings:show-updates"));
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => app.quit(),
    },
  ];
}

async function setEnabled(nextEnabled: boolean): Promise<void> {
  const previousEnabled = enabled;
  enabled = nextEnabled;
  await refreshHistoryMenu();

  try {
    await runtimeController?.setEnabled(nextEnabled);
  } catch (error) {
    enabled = previousEnabled;
    await refreshHistoryMenu();
    const message = error instanceof Error ? error.message : String(error);
    sendToWindow("settings", "dictation:error", {
      title: "Yap could not update",
      message,
    });
  }
}

import { app, dialog, ipcMain, shell, type WebContents } from "electron";
import { loadConfig } from "./config";
import { cancelHotkeyCapture, startHotkeyCapture } from "./hotkeyCapture";
import { relaunchApp } from "./relaunch";
import type { YapCoreSidecar } from "./sidecar";
import { refreshHistoryMenu } from "./tray";
import {
  checkForElectronUpdate,
  configureUpdater,
  downloadAndInstallElectronUpdate,
} from "./updater";
import { hideAppWindow, showAppWindow, windowLabelFor, type WindowLabel } from "./windows";

type InvokeArgs = Record<string, unknown>;

export function installIpcHandlers(sidecar: YapCoreSidecar): void {
  configureUpdater();

  ipcMain.handle("yap:app-info", () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    packaged: app.isPackaged,
  }));

  ipcMain.handle("yap:invoke", async (event, command: string, args: InvokeArgs = {}) => {
    return dispatchInvoke(sidecar, command, args, event.sender);
  });
}

async function dispatchInvoke(
  sidecar: YapCoreSidecar,
  command: string,
  args: InvokeArgs,
  sender: WebContents
): Promise<unknown> {
  if (isElectronLocalCommand(command)) {
    return dispatchElectronLocal(sidecar, command, args, sender);
  }

  return sidecar.invoke(command, args);
}

async function dispatchElectronLocal(
  sidecar: YapCoreSidecar,
  command: string,
  args: InvokeArgs,
  sender: WebContents
): Promise<unknown> {
  switch (command) {
    case "window.open_settings":
      await showAppWindow("settings");
      return null;
    case "window.open_main":
      await showAppWindow("main");
      return null;
    case "window.hide":
      hideAppWindow(labelFromArgs(args));
      return null;
    case "config.get":
      return loadConfig();
    case "hotkey_capture.start": {
      const window = await showAppWindow("settings");
      startHotkeyCapture(window.webContents);
      return null;
    }
    case "hotkey_capture.cancel":
      cancelHotkeyCapture();
      return null;
    case "history_menu.refresh":
      await refreshHistoryMenu();
      return null;
    case "window.list":
      return [{ label: windowLabelFor(sender.id) }];
    case "dialog.confirm":
      return showDialogMessage(args);
    case "shell.open_external":
      await shell.openExternal(String(args.url ?? ""));
      return null;
    case "autostart.is_enabled":
      return app.getLoginItemSettings().openAtLogin;
    case "autostart.enable":
      app.setLoginItemSettings({ openAtLogin: true, name: app.getName() });
      return null;
    case "autostart.disable":
      app.setLoginItemSettings({ openAtLogin: false, name: app.getName() });
      return null;
    case "updater.check":
      return checkForElectronUpdate();
    case "updater.download_and_install":
      return downloadAndInstallElectronUpdate(sender);
    case "app.relaunch":
      await relaunchApp(() => sidecar.stop());
      return null;
    default:
      throw new Error(`Electron backend command is not implemented: ${command}`);
  }
}

function isElectronLocalCommand(command: string): boolean {
  return (
    command === "window.open_settings" ||
    command === "window.open_main" ||
    command === "window.hide" ||
    command === "config.get" ||
    command === "hotkey_capture.start" ||
    command === "hotkey_capture.cancel" ||
    command === "history_menu.refresh" ||
    command === "window.list" ||
    command === "dialog.confirm" ||
    command === "shell.open_external" ||
    command === "autostart.is_enabled" ||
    command === "autostart.enable" ||
    command === "autostart.disable" ||
    command === "updater.check" ||
    command === "updater.download_and_install" ||
    command === "app.relaunch"
  );
}

function labelFromArgs(args: InvokeArgs): WindowLabel {
  return args.label === "settings" ? "settings" : "main";
}

async function showDialogMessage(args: InvokeArgs): Promise<string> {
  const message = String(args.message ?? "");
  const title = typeof args.title === "string" ? args.title : "Yap";
  const buttons = dialogButtons(args.buttons);
  const { response } = await dialog.showMessageBox({
    type: args.kind === "error" ? "error" : args.kind === "warning" ? "warning" : "question",
    title,
    message,
    buttons,
    cancelId: buttons.length > 1 ? 1 : 0,
    defaultId: 0,
  });
  return buttons[response] ?? buttons[0];
}

function dialogButtons(value: unknown): string[] {
  if (value === "OkCancel") return ["Ok", "Cancel"];
  if (value === "YesNo") return ["Yes", "No"];
  if (typeof value === "object" && value && "OkCancelCustom" in value) {
    const custom = (value as { OkCancelCustom?: unknown }).OkCancelCustom;
    return Array.isArray(custom) ? [String(custom[0]), String(custom[1])] : ["Ok", "Cancel"];
  }
  if (typeof value === "object" && value && "OkCustom" in value) {
    const custom = (value as { OkCustom?: unknown }).OkCustom;
    return [String(custom ?? "Ok")];
  }
  return ["Ok"];
}

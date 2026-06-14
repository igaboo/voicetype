import { app, Menu } from "electron";
import { configureAppIdentity } from "./appIdentity";
import { loadConfig } from "./config";
import { installIpcHandlers } from "./ipc";
import { appRoot } from "./paths";
import { isAccessibilityPayload, PermissionSupervisor } from "./permissions";
import { relaunchApp } from "./relaunch";
import { YapCoreSidecar } from "./sidecar";
import { installTray, refreshHistoryMenu } from "./tray";
import {
  activateAppWindow,
  createMainWindow,
  hideAppIfNoWindowsVisible,
  sendToAllWindows,
  sendToWindow,
  showAppWindow,
} from "./windows";

if (process.platform === "darwin") {
  app.commandLine.appendSwitch("use-mock-keychain");
}

const sidecar = new YapCoreSidecar({
  appRoot,
  onEvent: handleSidecarEvent,
});
const permissions = new PermissionSupervisor({
  onAccessibilityGranted: () => relaunchApp(() => sidecar.stop()),
});

app.whenReady().then(async () => {
  configureAppIdentity();
  Menu.setApplicationMenu(null);
  installIpcHandlers(sidecar);
  await loadConfig();
  await permissions.preflight();
  await installTray({
    setEnabled: async (enabled) => {
      await sidecar.invoke(enabled ? "runtime.start" : "runtime.stop", {});
    },
  });
  await createMainWindow();
  hideAppIfNoWindowsVisible();
  void sidecar.invoke("runtime.start", {}).catch((error) => {
    console.warn("[yap-core] runtime start skipped:", error.message);
  });
});

app.on("activate", () => {
  void activateAppWindow();
});

app.on("window-all-closed", () => {
  // Yap remains tray-first; the tray Quit action owns process shutdown.
});

app.on("before-quit", () => {
  permissions.stop();
  void sidecar.stop();
});

async function handleSidecarEvent({
  event,
  payload,
  target = "all",
}: {
  event: string;
  payload?: unknown;
  target?: "main" | "settings" | "all" | "tray";
}): Promise<void> {
  if (target === "tray" || event === "history:changed" || event === "tray:refresh-history") {
    await refreshHistoryMenu();
    if (target === "tray") return;
  }

  if (event === "settings:show-section") {
    await showAppWindow("settings");
    sendToWindow("settings", event, payload);
    return;
  }

  if (event === "dictation:permission-required" && isAccessibilityPayload(payload)) {
    permissions.ensureAccessibility("runtime");
  }

  if (target === "main" || target === "settings") {
    sendToWindow(target, event, payload);
    return;
  }

  sendToAllWindows(event, payload);
}

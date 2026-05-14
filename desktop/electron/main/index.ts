import { app, Menu } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config";
import { installIpcHandlers } from "./ipc";
import { YapCoreSidecar } from "./sidecar";
import { installTray, refreshHistoryMenu } from "./tray";
import { createMainWindow, hideAppIfNoWindowsVisible, sendToAllWindows, sendToWindow, showAppWindow } from "./windows";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = join(__dirname, "../..");
const sidecar = new YapCoreSidecar({
  appRoot,
  onEvent: handleSidecarEvent,
});

app.whenReady().then(async () => {
  app.setName("Yap");
  Menu.setApplicationMenu(null);
  installIpcHandlers(sidecar);
  await loadConfig();
  await installTray(appRoot, {
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
  void showAppWindow("main");
});

app.on("window-all-closed", () => {
  // Yap remains tray-first; the tray Quit action owns process shutdown.
});

app.on("before-quit", () => {
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

  if (target === "main" || target === "settings") {
    sendToWindow(target, event, payload);
    return;
  }

  sendToAllWindows(event, payload);
}

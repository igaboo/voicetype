import { app, BrowserWindow, shell } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = join(__dirname, "../..");
const preloadPath = join(appRoot, "dist-electron/preload/index.mjs");
const rendererDevUrl =
  process.env.YAP_RENDERER_URL || process.env.ELECTRON_RENDERER_URL || "http://localhost:1420";

export type WindowLabel = "main" | "settings";

const windows = new Map<WindowLabel, BrowserWindow>();

export function getWindow(label: WindowLabel): BrowserWindow | null {
  const window = windows.get(label);
  return window && !window.isDestroyed() ? window : null;
}

export function windowLabelFor(webContentsId: number): WindowLabel {
  for (const [label, window] of windows) {
    if (window.webContents.id === webContentsId) return label;
  }
  return "main";
}

export async function showAppWindow(label: WindowLabel): Promise<BrowserWindow> {
  const window = label === "settings" ? await createSettingsWindow() : await createMainWindow();
  if (process.platform === "darwin") {
    app.dock?.show();
  }
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  return window;
}

export function hideAppWindow(label: WindowLabel): void {
  getWindow(label)?.hide();
  hideAppIfNoWindowsVisible();
}

export function hideAppIfNoWindowsVisible(): void {
  const anyVisible = [...windows.values()].some(
    (window) => !window.isDestroyed() && window.isVisible()
  );
  if (!anyVisible && process.platform === "darwin") {
    app.dock?.hide();
  }
}

export function sendToWindow(label: WindowLabel, event: string, payload?: unknown): void {
  getWindow(label)?.webContents.send("yap:event", {
    event,
    payload,
    id: Date.now(),
  });
}

export function sendToAllWindows(event: string, payload?: unknown): void {
  for (const window of windows.values()) {
    if (window.isDestroyed()) continue;
    window.webContents.send("yap:event", {
      event,
      payload,
      id: Date.now(),
    });
  }
}

export async function createMainWindow(): Promise<BrowserWindow> {
  const existing = getWindow("main");
  if (existing) return existing;

  const window = createFramelessWindow("main", {
    title: "Yap",
    width: 460,
    height: 620,
    minWidth: 360,
    minHeight: 420,
  });

  await loadRenderer(window, "main");
  return window;
}

export async function createSettingsWindow(): Promise<BrowserWindow> {
  const existing = getWindow("settings");
  if (existing) return existing;

  const window = createFramelessWindow("settings", {
    title: "Yap Settings",
    width: 1040,
    height: 760,
    minWidth: 760,
    minHeight: 560,
  });

  await loadRenderer(window, "settings");
  return window;
}

function createFramelessWindow(
  label: WindowLabel,
  options: {
    title: string;
    width: number;
    height: number;
    minWidth: number;
    minHeight: number;
  }
): BrowserWindow {
  const window = new BrowserWindow({
    ...options,
    show: false,
    frame: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    titleBarOverlay:
      process.platform === "darwin"
        ? false
        : {
            color: "#101215",
            symbolColor: "#f6f7f9",
            height: 36,
          },
    trafficLightPosition: { x: 14, y: 14 },
    backgroundColor: "#101215",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  windows.set(label, window);

  window.on("close", (event) => {
    if (label === "settings") {
      event.preventDefault();
      hideAppWindow(label);
    }
  });
  window.on("closed", () => {
    windows.delete(label);
  });
  window.on("focus", () => {
    sendToWindow(label, "window:focus", null);
  });
  window.on("blur", () => {
    sendToWindow(label, "window:blur", null);
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  return window;
}

async function loadRenderer(window: BrowserWindow, label: WindowLabel): Promise<void> {
  if (app.isPackaged) {
    await window.loadFile(join(appRoot, "build", label === "settings" ? "settings.html" : "index.html"));
    return;
  }

  await window.loadURL(new URL(label === "settings" ? "/settings.html" : "/", rendererDevUrl).toString());
}

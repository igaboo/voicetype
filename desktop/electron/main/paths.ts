import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const electronDistDir = dirname(fileURLToPath(import.meta.url));

export const appRoot = join(electronDistDir, "../..");
export const preloadPath = join(appRoot, "dist-electron/preload/index.mjs");
export const rendererDevUrl =
  process.env.YAP_RENDERER_URL || process.env.ELECTRON_RENDERER_URL || "http://localhost:1420";

export function appAssetPath(...segments: string[]): string {
  return join(appRoot, ...segments);
}

export function iconPath(name: string): string {
  return appAssetPath("native-core", "icons", name);
}

export function appIconPath(): string {
  if (process.platform === "win32") return iconPath("icon.ico");
  return iconPath("icon.png");
}

export function trayIconPath(): string {
  return iconPath("tray.png");
}

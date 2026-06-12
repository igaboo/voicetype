import { app, nativeImage } from "electron";
import { appIconPath } from "./paths";

const APP_ID = "com.yap.desktop";

export function configureAppIdentity(): void {
  app.setName("Yap");

  if (process.platform === "win32") {
    app.setAppUserModelId(APP_ID);
    return;
  }

  if (process.platform === "darwin") {
    const icon = nativeImage.createFromPath(appIconPath());
    if (!icon.isEmpty()) {
      app.dock?.setIcon(icon);
    }
  }
}

import { app, type WebContents } from "electron";
import electronUpdater from "electron-updater";
import { allowWindowCloseForQuit } from "./windows";

const { autoUpdater } = electronUpdater;

export function configureUpdater(): void {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
}

export async function checkForElectronUpdate(): Promise<{ version: string } | null> {
  if (!app.isPackaged) return null;

  const result = await autoUpdater.checkForUpdates();
  if (!result?.isUpdateAvailable) return null;

  const version = result?.updateInfo?.version;
  return version ? { version } : null;
}

export async function downloadAndInstallElectronUpdate(sender: WebContents): Promise<null> {
  if (!app.isPackaged) return null;

  const result = await autoUpdater.checkForUpdates();
  if (!result?.isUpdateAvailable) {
    throw new Error("No update is available to install. Check for updates again.");
  }

  let transferred = 0;
  console.info("[yap-updater] starting update download");
  sender.send("yap:updater-download", {
    event: "Started",
    data: {},
  });

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      autoUpdater.off("download-progress", onProgress);
      autoUpdater.off("update-downloaded", onDownloaded);
      autoUpdater.off("error", onError);
    };
    const onProgress = (progress: { total?: number; transferred?: number }) => {
      const nextTransferred = progress.transferred ?? transferred;
      const chunkLength = Math.max(0, nextTransferred - transferred);
      transferred = nextTransferred;
      sender.send("yap:updater-download", {
        event: "Progress",
        data: {
          contentLength: progress.total,
          chunkLength,
        },
      });
    };
    const onDownloaded = () => {
      cleanup();
      console.info("[yap-updater] update download completed");
      sender.send("yap:updater-download", {
        event: "Finished",
        data: {},
      });
      allowWindowCloseForQuit();
      try {
        console.info("[yap-updater] calling quitAndInstall");
        autoUpdater.quitAndInstall(false, true);
      } catch (error) {
        console.error("[yap-updater] quitAndInstall failed:", error);
        reject(error);
        return;
      }
      setTimeout(() => {
        console.warn("[yap-updater] quitAndInstall did not exit promptly; falling back to app.quit");
        app.quit();
      }, 5000).unref();
      resolve(null);
    };
    const onError = (error: Error) => {
      cleanup();
      console.error("[yap-updater] update install failed:", error);
      reject(error);
    };

    autoUpdater.on("download-progress", onProgress);
    autoUpdater.once("update-downloaded", onDownloaded);
    autoUpdater.once("error", onError);
    autoUpdater.downloadUpdate().catch(onError);
  });
}

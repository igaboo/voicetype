import { app, type WebContents } from "electron";
import electronUpdater from "electron-updater";

const { autoUpdater } = electronUpdater;

export function configureUpdater(): void {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
}

export async function checkForElectronUpdate(): Promise<{ version: string } | null> {
  if (!app.isPackaged) return null;

  const result = await autoUpdater.checkForUpdates();
  const version = result?.updateInfo?.version;
  return version ? { version } : null;
}

export async function downloadAndInstallElectronUpdate(sender: WebContents): Promise<null> {
  if (!app.isPackaged) return null;

  let transferred = 0;
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
      sender.send("yap:updater-download", {
        event: "Finished",
        data: {},
      });
      autoUpdater.quitAndInstall(false, true);
      resolve(null);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    autoUpdater.on("download-progress", onProgress);
    autoUpdater.once("update-downloaded", onDownloaded);
    autoUpdater.once("error", onError);
    autoUpdater.downloadUpdate().catch(onError);
  });
}

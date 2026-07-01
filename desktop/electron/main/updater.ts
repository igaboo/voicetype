import { app, type WebContents } from "electron";
import electronUpdater from "electron-updater";
import { allowWindowCloseForQuit } from "./windows";

const { autoUpdater } = electronUpdater;
const INSTALL_HANDOFF_TIMEOUT_MS = 120_000;

type ElectronUpdate = {
  version: string;
};

type DownloadProgress = {
  total?: number;
  transferred?: number;
  delta?: number;
  percent?: number;
  bytesPerSecond?: number;
};

type UpdateFileInfo = {
  url?: string;
  size?: number;
};

type UpdateInfoWithFiles = {
  files?: UpdateFileInfo[];
  path?: string;
};

export function configureUpdater(): void {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.autoRunAppAfterInstall = true;
}

export async function checkForElectronUpdate(): Promise<ElectronUpdate | null> {
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

  const contentLength = updateContentLength(result.updateInfo);
  let transferred = 0;
  console.info("[yap-updater] starting update download");
  sender.send("yap:updater-download", {
    event: "Started",
    data: {
      contentLength,
      total: contentLength,
    },
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    let installTimer: NodeJS.Timeout | undefined;

    const cleanupDownloadListeners = () => {
      autoUpdater.off("download-progress", onProgress);
      autoUpdater.off("update-downloaded", onDownloaded);
    };
    const cleanup = () => {
      cleanupDownloadListeners();
      autoUpdater.off("error", onError);
      app.off("before-quit", onBeforeQuit);
      if (installTimer) {
        clearTimeout(installTimer);
        installTimer = undefined;
      }
    };
    const resolveOnce = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(null);
    };
    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onBeforeQuit = () => {
      console.info("[yap-updater] app is quitting for update install");
      resolveOnce();
    };
    const onProgress = (progress: DownloadProgress) => {
      const nextTransferred = progress.transferred ?? transferred;
      const chunkLength = Math.max(0, progress.delta ?? nextTransferred - transferred);
      transferred = nextTransferred;
      sender.send("yap:updater-download", {
        event: "Progress",
        data: {
          contentLength: progress.total,
          chunkLength,
          transferred: nextTransferred,
          total: progress.total,
          percent: progress.percent,
          bytesPerSecond: progress.bytesPerSecond,
        },
      });
    };
    const onDownloaded = () => {
      cleanupDownloadListeners();
      console.info("[yap-updater] update download completed");
      sender.send("yap:updater-download", {
        event: "Finished",
        data: {
          contentLength,
          total: contentLength,
          transferred,
          percent: 100,
        },
      });
      allowWindowCloseForQuit();
      try {
        console.info("[yap-updater] calling quitAndInstall");
        if (process.platform === "darwin") {
          autoUpdater.quitAndInstall();
        } else {
          autoUpdater.quitAndInstall(false, true);
        }
      } catch (error) {
        console.error("[yap-updater] quitAndInstall failed:", error);
        rejectOnce(error);
        return;
      }
      installTimer = setTimeout(() => {
        rejectOnce(new Error("The update installer did not start. Restart Yap and try again."));
      }, INSTALL_HANDOFF_TIMEOUT_MS);
      installTimer.unref();
    };
    const onError = (error: Error) => {
      console.error("[yap-updater] update install failed:", error);
      rejectOnce(error);
    };

    autoUpdater.on("download-progress", onProgress);
    autoUpdater.once("update-downloaded", onDownloaded);
    autoUpdater.once("error", onError);
    app.once("before-quit", onBeforeQuit);
    autoUpdater.downloadUpdate().catch((error: unknown) => {
      onError(normalizeError(error));
    });
  });
}

function updateContentLength(updateInfo: unknown): number | undefined {
  const info = updateInfo as UpdateInfoWithFiles | undefined;
  const files = info?.files ?? [];
  const preferredFile =
    files.find((file) => typeof file.url === "string" && file.url.endsWith(".zip")) ?? files[0];

  return positiveNumber(preferredFile?.size);
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(String(error));
}

import { spawnSync } from "node:child_process";
import { app, type WebContents } from "electron";
import electronUpdater from "electron-updater";
import { allowWindowCloseForQuit } from "./windows";

const { autoUpdater } = electronUpdater;
const INSTALL_HANDOFF_TIMEOUT_MS = 120_000;
const GITHUB_RELEASES_URL = "https://github.com/oobagi/yap/releases/latest";
const GITHUB_LATEST_RELEASE_API_URL = "https://api.github.com/repos/oobagi/yap/releases/latest";
const RELEASE_CHECK_TIMEOUT_MS = 15_000;

type ElectronUpdate = {
  version: string;
  canInstallInApp: boolean;
  releaseUrl?: string;
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

type GitHubReleaseInfo = {
  tag_name?: string;
  html_url?: string;
};

export function configureUpdater(): void {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.autoRunAppAfterInstall = true;
}

export async function checkForElectronUpdate(): Promise<ElectronUpdate | null> {
  if (!app.isPackaged) return null;

  if (!canUseInAppInstaller()) {
    return checkLatestGitHubRelease();
  }

  const result = await autoUpdater.checkForUpdates();
  if (!result?.isUpdateAvailable) return null;

  const version = result?.updateInfo?.version;
  return version ? { version, canInstallInApp: true } : null;
}

export async function downloadAndInstallElectronUpdate(sender: WebContents): Promise<null> {
  if (!app.isPackaged) return null;
  assertCanUseInAppInstaller();

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

function assertCanUseInAppInstaller(): void {
  if (canUseInAppInstaller()) return;

  throw new Error(
    "This copy of Yap is unsigned, so it cannot install macOS updates in-app. Download the latest release from GitHub Releases."
  );
}

function canUseInAppInstaller(): boolean {
  if (process.platform !== "darwin") return true;

  return hasDeveloperIdSignature();
}

function hasDeveloperIdSignature(): boolean {
  const appBundlePath = macAppBundlePath();
  if (!appBundlePath) return true;

  let signatureDetails: string;
  try {
    const result = spawnSync("codesign", ["-dv", "--verbose=4", appBundlePath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    signatureDetails = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(signatureDetails);
  } catch (error) {
    console.warn(
      `[yap-updater] macOS signature check failed; using manual update mode: ${normalizeError(error).message}`
    );
    return false;
  }

  return /^Authority=Developer ID Application:/m.test(signatureDetails);
}

async function checkLatestGitHubRelease(): Promise<ElectronUpdate | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RELEASE_CHECK_TIMEOUT_MS);

  try {
    const response = await fetch(GITHUB_LATEST_RELEASE_API_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "Yap updater",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`GitHub Releases returned HTTP ${response.status}`);
    }

    const release = (await response.json()) as GitHubReleaseInfo;
    const version = normalizeVersion(release.tag_name);
    if (!version || compareVersions(version, app.getVersion()) <= 0) return null;

    return {
      version,
      canInstallInApp: false,
      releaseUrl: release.html_url ?? GITHUB_RELEASES_URL,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeVersion(value: string | undefined): string | null {
  const version = value?.trim().replace(/^v/i, "");
  return version && /^\d+\.\d+\.\d+(?:[-+].+)?$/.test(version) ? version : null;
}

function compareVersions(left: string, right: string): number {
  const leftParts = parseVersionParts(left);
  const rightParts = parseVersionParts(right);

  for (let index = 0; index < 3; index += 1) {
    const delta = leftParts[index] - rightParts[index];
    if (delta !== 0) return delta;
  }

  return 0;
}

function parseVersionParts(version: string): [number, number, number] {
  const [major = "0", minor = "0", patch = "0"] = version.split(/[+-]/)[0].split(".");
  return [major, minor, patch].map((part) => Number.parseInt(part, 10) || 0) as [
    number,
    number,
    number,
  ];
}

function macAppBundlePath(): string | null {
  const marker = "/Contents/MacOS/";
  const executablePath = app.getPath("exe");
  const markerIndex = executablePath.indexOf(marker);
  return markerIndex === -1 ? null : executablePath.slice(0, markerIndex);
}

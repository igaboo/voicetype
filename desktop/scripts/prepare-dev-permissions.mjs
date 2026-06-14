import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

if (process.platform !== "darwin") {
  process.exit(0);
}

const root = process.cwd();
const require = createRequire(import.meta.url);
const electronPackageDir = dirname(require.resolve("electron/package.json"));
const electronApp = join(electronPackageDir, "dist", "Electron.app");
const infoPlist = join(electronApp, "Contents", "Info.plist");
const entitlements = join(root, "electron", "entitlements.mac.plist");
const debugCore = join(root, "native-core", "target", "debug", "yap-core");

if (!existsSync(infoPlist)) {
  console.warn(`[yap-dev-permissions] missing Electron Info.plist: ${infoPlist}`);
  process.exit(0);
}

setPlistValue(
  infoPlist,
  "NSMicrophoneUsageDescription",
  "Yap records your voice so it can transcribe and paste what you say.",
);
setPlistValue(
  infoPlist,
  "NSSpeechRecognitionUsageDescription",
  "Yap uses speech recognition to transcribe audio locally when available.",
);

sign(electronApp, ["--deep"]);
if (existsSync(debugCore)) {
  sign(debugCore);
}

function setPlistValue(plist, key, value) {
  const setResult = spawnSync("/usr/libexec/PlistBuddy", ["-c", `Set :${key} ${value}`, plist], {
    stdio: "ignore",
  });
  if (setResult.status === 0) {
    return;
  }

  const addResult = spawnSync(
    "/usr/libexec/PlistBuddy",
    ["-c", `Add :${key} string ${value}`, plist],
    { stdio: "inherit" },
  );
  if (addResult.status !== 0) {
    throw new Error(`failed to set ${key} in ${plist}`);
  }
}

function sign(target, extraArgs = []) {
  const result = spawnSync(
    "codesign",
    [
      "--force",
      ...extraArgs,
      "--sign",
      "-",
      "--entitlements",
      entitlements,
      target,
    ],
    { stdio: "inherit" },
  );
  if (result.status !== 0) {
    throw new Error(`failed to sign ${target}`);
  }
}

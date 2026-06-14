import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const outputDir = resolve("release-electron");
const requiredEntitlements = ["com.apple.security.device.audio-input"];

if (process.platform !== "darwin") {
  console.log("Skipping macOS entitlement verification on non-macOS host.");
  process.exit(0);
}

const appPath = findNewestAppBundle(outputDir);
if (!appPath) {
  console.error(`Packaged Yap.app not found under: ${outputDir}`);
  process.exit(1);
}

const targets = [
  { label: "Yap.app", path: appPath },
  { label: "yap-core", path: join(appPath, "Contents/Resources/bin/yap-core") },
];

for (const target of targets) {
  if (!existsSync(target.path)) {
    console.error(`Signed target not found: ${target.path}`);
    process.exit(1);
  }

  const entitlements = execFileSync("codesign", ["-d", "--entitlements", ":-", target.path], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  for (const entitlement of requiredEntitlements) {
    if (!entitlements.includes(`<key>${entitlement}</key>`)) {
      console.error(`${target.label} is missing entitlement: ${entitlement}`);
      process.exit(1);
    }
  }
}

execFileSync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath], {
  stdio: "inherit",
});

console.log(`macOS entitlements verified for ${appPath}.`);

function findNewestAppBundle(root) {
  const bundles = findAppBundles(root);
  bundles.sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
  return bundles[0] ?? null;
}

function findAppBundles(root) {
  if (!existsSync(root)) return [];

  const entries = readdirSync(root, { withFileTypes: true });
  const bundles = [];

  for (const entry of entries) {
    const path = join(root, entry.name);
    if (!entry.isDirectory()) continue;

    if (basename(path) === "Yap.app") {
      bundles.push(path);
      continue;
    }

    bundles.push(...findAppBundles(path));
  }

  return bundles;
}

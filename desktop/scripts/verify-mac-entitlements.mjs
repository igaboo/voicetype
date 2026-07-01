import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const outputDir = resolve("release-electron");
const requireTrustedSigning = process.env.YAP_REQUIRE_MAC_TRUSTED_SIGNING === "1";
const requiredEntitlements = [
  "com.apple.security.device.audio-input",
  "com.apple.security.personal-information.speech-recognition",
];
const forbiddenEntitlements = [
  "com.apple.security.cs.allow-unsigned-executable-memory",
  "com.apple.security.cs.disable-library-validation",
];

if (process.platform !== "darwin") {
  console.log("Skipping macOS entitlement verification on non-macOS host.");
  process.exit(0);
}

const appPath = findNewestAppBundle(outputDir);
if (!appPath) {
  console.error(`Packaged Yap.app not found under: ${outputDir}`);
  process.exit(1);
}
const binDir = join(appPath, "Contents/Resources/bin");
const speechHelper = findBinary(binDir, /^yap-speech-.*-apple-darwin$/);
if (!speechHelper) {
  console.error(`Packaged yap-speech helper not found under: ${binDir}`);
  process.exit(1);
}

const targets = [
  { label: "Yap.app", path: appPath },
  { label: "yap-core", path: join(binDir, "yap-core") },
  { label: "yap-speech", path: speechHelper },
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

  for (const entitlement of forbiddenEntitlements) {
    if (entitlements.includes(`<key>${entitlement}</key>`)) {
      console.error(`${target.label} includes forbidden entitlement: ${entitlement}`);
      process.exit(1);
    }
  }
}

execFileSync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath], {
  stdio: "inherit",
});

if (requireTrustedSigning) {
  verifyTrustedMacSignature(appPath);
}

console.log(`macOS entitlements verified for ${appPath}.`);

function verifyTrustedMacSignature(appPath) {
  const signatureDetails = capture("codesign", ["-dv", "--verbose=4", appPath]);

  if (/^Signature=adhoc$/m.test(signatureDetails)) {
    fail(
      "Yap.app is ad-hoc signed. macOS auto-update release builds need a Developer ID Application certificate."
    );
  }

  if (!/^Authority=Developer ID Application:/m.test(signatureDetails)) {
    fail("Yap.app is not signed with a Developer ID Application identity.");
  }

  const teamIdentifier = signatureDetails.match(/^TeamIdentifier=(.+)$/m)?.[1]?.trim();
  if (!teamIdentifier || teamIdentifier === "not set") {
    fail("Yap.app has no TeamIdentifier. macOS auto-update release builds need a trusted Apple signing identity.");
  }

  try {
    execFileSync("spctl", ["--assess", "--type", "execute", "--verbose=4", appPath], {
      stdio: "inherit",
    });
  } catch {
    fail("Gatekeeper rejected Yap.app. macOS auto-update release builds need successful notarization/stapling.");
  }
}

function capture(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

  if (result.error) {
    fail(`${command} failed: ${result.error.message}`);
  }

  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} failed:\n${output}`);
  }

  return output;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function findNewestAppBundle(root) {
  const bundles = findAppBundles(root);
  bundles.sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
  return bundles[0] ?? null;
}

function findBinary(root, pattern) {
  if (!existsSync(root)) return null;
  return readdirSync(root)
    .map((name) => join(root, name))
    .find((path) => pattern.test(basename(path)) && existsSync(path)) ?? null;
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

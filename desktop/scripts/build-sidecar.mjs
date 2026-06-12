import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

if (process.platform !== "darwin") {
  console.log("Skipping macOS overlay sidecar build on this platform.");
  process.exit(0);
}

const scriptPath = join(process.cwd(), "native-core", "sidecar-overlay", "build-sidecar.sh");
if (!existsSync(scriptPath)) {
  console.error(`Missing sidecar build script: ${scriptPath}`);
  process.exit(1);
}

const result = spawnSync("bash", [scriptPath], {
  cwd: join(process.cwd(), "native-core", "sidecar-overlay"),
  stdio: "inherit",
});

process.exit(result.status ?? 1);

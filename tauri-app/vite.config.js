import { defineConfig, build as viteBuild } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { sveltekit } from "@sveltejs/kit/vite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

const host = process.env.TAURI_DEV_HOST;
const packageJson = JSON.parse(readFileSync(resolve("package.json"), "utf-8"));

/**
 * @param {string} command
 * @param {string} fallback
 */
function commandOutput(command, fallback) {
  try {
    return execSync(command, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim() || fallback;
  } catch {
    return fallback;
  }
}

const gitCommit = commandOutput("git rev-parse HEAD", "unknown");
const gitCommitShort = commandOutput("git rev-parse --short HEAD", "unknown");
const githubCommitUrl =
  gitCommit === "unknown" ? "https://github.com/oobagi/yap" : `https://github.com/oobagi/yap/commit/${gitCommit}`;
const appBuildMetadata = {
  __APP_VERSION__: JSON.stringify(packageJson.version),
  __GIT_COMMIT_SHORT__: JSON.stringify(gitCommitShort),
  __GITHUB_COMMIT_URL__: JSON.stringify(githubCommitUrl),
};

/** Standalone HTML pages used by Tauri windows (not SvelteKit routes). */
const standalonePages = ["settings"];

/**
 * Vite plugin that serves standalone HTML entry points (settings)
 * alongside the SvelteKit app. These Tauri windows don't use
 * SvelteKit routing — they mount Svelte components directly.
 *
 * - Dev: middleware intercepts requests and transforms the HTML through Vite.
 * - Build: after the SvelteKit build finishes, a secondary Vite build bundles
 *   each standalone page into the same output directory (../build).
 */
function tauriMultiWindow() {
  let isBuild = false;

  return {
    name: "tauri-multi-window",

    /** @param {import('vite').ResolvedConfig} config */
    configResolved(config) {
      isBuild = config.command === "build";
    },

    /** @param {import('vite').ViteDevServer} server */
    configureServer(server) {
      const paths = standalonePages.map((p) => `/${p}.html`);

      server.middlewares.use((req, res, next) => {
        const url = req.url;
        if (url && paths.includes(url)) {
          let html = readFileSync(resolve("src" + url), "utf-8");
          // Rewrite relative script/link paths to /src/ so Vite can resolve them
          html = html.replace(/src="\.\/([^"]+)"/g, 'src="/src/$1"');
          html = html.replace(/href="\.\/([^"]+)"/g, 'href="/src/$1"');
          server.transformIndexHtml(url, html).then((transformed) => {
            res.setHeader("Content-Type", "text/html");
            res.end(transformed);
          });
          return;
        }
        next();
      });
    },

    /** After the SvelteKit build, run a second Vite build for standalone pages. */
    async closeBundle() {
      // Only build standalone pages during production builds, not dev server
      if (!isBuild) return;

      const input = Object.fromEntries(
        standalonePages.map((p) => [p, resolve("src", `${p}.html`)])
      );

      console.log(
        "\n[tauri-multi-window] Building standalone pages:",
        Object.keys(input).join(", ")
      );

      await viteBuild({
        // Use src/ as root so HTML entry paths resolve correctly and
        // output filenames don't include the "src/" prefix.
        root: resolve("src"),
        plugins: [svelte()],
        define: appBuildMetadata,
        build: {
          rollupOptions: { input },
          outDir: resolve("build"),
          // Don't wipe the SvelteKit output that was already written.
          emptyOutDir: false,
        },
        // Prevent infinite recursion — this nested build must not re-run
        // the sveltekit() or tauriMultiWindow() plugins.
        configFile: false,
      });

      console.log("[tauri-multi-window] Standalone pages built successfully.\n");
    },
  };
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [sveltekit(), tauriMultiWindow()],
  define: appBuildMetadata,

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));

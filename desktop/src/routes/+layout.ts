// Electron serves static files from the packaged app.
// Use SPA mode so the same Svelte build works in dev and packaged windows.
// See: https://svelte.dev/docs/kit/single-page-apps
export const ssr = false;

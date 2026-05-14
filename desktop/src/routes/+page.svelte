<script lang="ts">
  import { showSettings } from "$lib/runtime/yap";

  async function openSettings() {
    await showSettings();
  }
</script>

<main>
  <img src="/favicon.png" alt="Yap" width="72" height="72" />
  <h1>Yap</h1>
  <p>Yap is running from the tray/menu bar.</p>
  <button type="button" onclick={openSettings}>Open Settings</button>
</main>

<style>
  :global(body) {
    margin: 0;
    background: #f7f7f4;
    color: #111;
    font-family:
      Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  main {
    min-height: 100vh;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 14px;
    text-align: center;
  }

  h1,
  p {
    margin: 0;
  }

  h1 {
    font-size: 28px;
    font-weight: 700;
  }

  p {
    max-width: 280px;
    color: #555;
    font-size: 14px;
    line-height: 1.45;
  }

  button {
    border: 1px solid #ccc7bd;
    border-radius: 8px;
    background: #fff;
    color: #111;
    padding: 8px 14px;
    font: inherit;
    cursor: pointer;
  }
</style>

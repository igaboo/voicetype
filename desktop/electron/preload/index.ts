import { contextBridge, ipcRenderer } from "electron";
import type { YapBridge, YapDownloadEvent, YapEvent, YapInfo, YapUpdate } from "./types";

type Callback = (payload: unknown) => void;

let nextCallbackId = 1;
let nextListenerId = 1;
const callbacks = new Map<number, { callback: Callback; once: boolean }>();
const eventListeners = new Map<number, { event: string; handlerId: number }>();
const pendingEvents: YapEvent[] = [];
let updaterDownloadHandler: ((event: YapDownloadEvent) => void) | null = null;

function transformCallback(callback: Callback, once = false): number {
  const id = nextCallbackId++;
  callbacks.set(id, { callback, once });
  return id;
}

function unregisterCallback(id: number): void {
  callbacks.delete(id);
}

function runCallback(id: number, payload: unknown): void {
  const entry = callbacks.get(id);
  if (!entry) return;
  entry.callback(payload);
  if (entry.once) callbacks.delete(id);
}

async function invoke<T = unknown>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  if (command === "events.listen") {
    const id = nextListenerId++;
    eventListeners.set(id, {
      event: String(args.event ?? ""),
      handlerId: Number(args.handler),
    });
    return id as T;
  }

  if (command === "events.unlisten") {
    eventListeners.delete(Number(args.eventId));
    return null as T;
  }

  return ipcRenderer.invoke("yap:invoke", command, args) as Promise<T>;
}

ipcRenderer.on("yap:event", (_event, payload: YapEvent) => {
  let delivered = false;
  for (const [id, listener] of eventListeners) {
    if (listener.event !== payload.event) continue;
    delivered = true;
    runCallback(listener.handlerId, {
      event: payload.event,
      id,
      payload: payload.payload,
    });
  }
  if (!delivered) {
    pendingEvents.push(payload);
    if (pendingEvents.length > 50) pendingEvents.shift();
  }
});

ipcRenderer.on("yap:updater-download", (_event, payload: YapDownloadEvent) => {
  updaterDownloadHandler?.(payload);
});

const bridge: YapBridge = {
  platform: process.platform,
  versions: {
    chrome: process.versions.chrome,
    electron: process.versions.electron,
    node: process.versions.node,
  },
  app: {
    getInfo: () => ipcRenderer.invoke("yap:app-info") as Promise<YapInfo>,
  },
  windows: {
    openSettings: () => invoke("window.open_settings"),
    showMain: () => invoke("window.open_main"),
    hide: (label: string) => invoke("window.hide", { label }),
    onFocusChanged: async (handler: (focused: boolean) => void) => {
      const focusListener = await bridge.events.listen("window:focus", () => handler(true));
      const blurListener = await bridge.events.listen("window:blur", () => handler(false));
      return () => {
        focusListener();
        blurListener();
      };
    },
  },
  commands: {
    invoke,
  },
  dialog: {
    confirm: async (message, options = {}) => {
      const okLabel = options.okLabel ?? "Ok";
      const cancelLabel = options.cancelLabel ?? "Cancel";
      const response = await invoke<string>("dialog.confirm", {
        message,
        title: options.title ?? "Yap",
        kind: options.kind ?? "info",
        buttons: { OkCancelCustom: [okLabel, cancelLabel] },
      });
      return response === okLabel;
    },
  },
  shell: {
    openExternal: (url: string) => invoke("shell.open_external", { url }),
  },
  autostart: {
    isEnabled: () => invoke("autostart.is_enabled"),
    enable: () => invoke("autostart.enable"),
    disable: () => invoke("autostart.disable"),
  },
  updater: {
    check: async () => {
      const update = await invoke<{ version: string } | null>("updater.check");
      if (!update) return null;
      return {
        version: update.version,
        downloadAndInstall: async (onEvent) => {
          updaterDownloadHandler = onEvent ?? null;
          try {
            await invoke("updater.download_and_install");
          } finally {
            updaterDownloadHandler = null;
          }
        },
      } satisfies YapUpdate;
    },
  },
  events: {
    listen: async <T>(event: string, handler: (event: YapEvent<T>) => void) => {
      const handlerId = transformCallback(handler as Callback);
      const eventId = await invoke<number>("events.listen", { event, handler: handlerId });
      for (let index = pendingEvents.length - 1; index >= 0; index -= 1) {
        const pending = pendingEvents[index];
        if (pending.event !== event) continue;
        pendingEvents.splice(index, 1);
        runCallback(handlerId, {
          event: pending.event,
          id: eventId,
          payload: pending.payload,
        });
      }
      return () => {
        eventListeners.delete(eventId);
        unregisterCallback(handlerId);
      };
    },
  },
};

contextBridge.exposeInMainWorld("yap", bridge);

declare global {
  interface Window {
    yap: YapBridge;
  }
}

export type YapPlatform = NodeJS.Platform;

export interface YapInfo {
  name: string;
  version: string;
  platform: YapPlatform;
  packaged: boolean;
}

export interface YapEvent<T = unknown> {
  event: string;
  id: number;
  payload: T;
}

export interface YapDownloadEvent {
  event: "Started" | "Progress" | "Finished";
  data?: {
    contentLength?: number;
    chunkLength?: number;
    transferred?: number;
    total?: number;
    percent?: number;
    bytesPerSecond?: number;
  };
}

export interface YapUpdate {
  version: string;
  canInstallInApp: boolean;
  releaseUrl?: string;
  downloadAndInstall(onEvent?: (event: YapDownloadEvent) => void): Promise<void>;
}

export interface YapBridge {
  platform: YapPlatform;
  versions: {
    chrome: string;
    electron: string;
    node: string;
  };
  app: {
    getInfo(): Promise<YapInfo>;
  };
  windows: {
    openSettings(): Promise<void>;
    showMain(): Promise<void>;
    hide(label: string): Promise<void>;
    onFocusChanged(handler: (focused: boolean) => void): Promise<() => void>;
  };
  commands: {
    invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T>;
  };
  dialog: {
    confirm(
      message: string,
      options?: {
        title?: string;
        kind?: "info" | "warning" | "error";
        okLabel?: string;
        cancelLabel?: string;
      }
    ): Promise<boolean>;
  };
  shell: {
    openExternal(url: string): Promise<void>;
  };
  autostart: {
    isEnabled(): Promise<boolean>;
    enable(): Promise<void>;
    disable(): Promise<void>;
  };
  updater: {
    check(options?: { timeout?: number }): Promise<YapUpdate | null>;
  };
  events: {
    listen<T = unknown>(event: string, handler: (event: YapEvent<T>) => void): Promise<() => void>;
  };
}

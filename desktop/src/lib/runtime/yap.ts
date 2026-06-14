export type Unlisten = () => void;

export interface RuntimeDownloadEvent {
  event: 'Started' | 'Progress' | 'Finished';
  data?: {
    contentLength?: number;
    chunkLength?: number;
  };
}

export interface RuntimeUpdate {
  version: string;
  downloadAndInstall(onEvent?: (event: RuntimeDownloadEvent) => void): Promise<void>;
}

interface ConfirmOptions {
  title?: string;
  kind?: 'info' | 'warning' | 'error';
  okLabel?: string;
  cancelLabel?: string;
}

interface YapAppInfo {
  name: string;
  version: string;
  platform: string;
  packaged: boolean;
}

interface YapBridge {
  platform?: string;
  versions?: Record<string, string>;
  app?: {
    getInfo?: () => Promise<YapAppInfo>;
  };
  windows?: {
    openSettings?: () => Promise<void>;
    showMain?: () => Promise<void>;
    hide?: (label: string) => Promise<void>;
    onFocusChanged?: (handler: (focused: boolean) => void) => Promise<Unlisten> | Unlisten;
  };
  commands?: {
    invoke?: <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>;
  };
  dialog?: {
    confirm?: (message: string, options?: ConfirmOptions) => Promise<boolean>;
  };
  shell?: {
    openExternal?: (url: string) => Promise<void>;
  };
  autostart?: {
    isEnabled?: () => Promise<boolean>;
    enable?: () => Promise<void>;
    disable?: () => Promise<void>;
  };
  updater?: {
    check?: (options?: { timeout?: number }) => Promise<RuntimeUpdate | null>;
  };
  events?: {
    listen?: <T = unknown>(event: string, handler: (event: { payload: T }) => void) => Promise<Unlisten> | Unlisten;
  };
}

declare global {
  interface Window {
    yap?: YapBridge;
  }
}

function electronBridge(): YapBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.yap;
}

export function isNativeRuntime(): boolean {
  return electronBridge() !== undefined;
}

function requiredElectronBridge(): YapBridge {
  const electron = electronBridge();
  if (!electron) {
    throw new Error('Electron preload bridge is not available');
  }
  return electron;
}

export async function invokeRuntime<T = unknown>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> {
  const electron = requiredElectronBridge();
  if (electron?.commands?.invoke) {
    return electron.commands.invoke<T>(command, args);
  }

  throw new Error(`No native runtime command bridge is available for ${command}`);
}

export async function invokeRuntimeOptional<T = unknown>(
  command: string,
  args?: Record<string, unknown>,
  timeoutMs?: number
): Promise<T | null> {
  try {
    const request = invokeRuntime<T>(command, args);
    if (!timeoutMs) {
      return await request;
    }
    return await Promise.race([
      request,
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } catch (error) {
    console.error(`Runtime command failed: ${command}`, error);
    return null;
  }
}

export async function showSettings(): Promise<void> {
  const electron = requiredElectronBridge();
  if (electron?.windows?.openSettings) {
    await electron.windows.openSettings();
  }
}

export async function hideWindow(label: string): Promise<void> {
  const electron = requiredElectronBridge();
  if (electron?.windows?.hide) {
    await electron.windows.hide(label);
  }
}

export async function openExternal(url: string): Promise<void> {
  const electron = requiredElectronBridge();
  if (electron?.shell?.openExternal) {
    await electron.shell.openExternal(url);
    return;
  }

  throw new Error('Electron shell bridge is not available');
}

export async function confirmRuntime(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  const electron = requiredElectronBridge();
  if (electron?.dialog?.confirm) {
    return electron.dialog.confirm(message, options);
  }

  throw new Error('Electron dialog bridge is not available');
}

export async function isAutostartEnabled(): Promise<boolean | null> {
  const electron = requiredElectronBridge();
  if (electron?.autostart?.isEnabled) {
    return electron.autostart.isEnabled();
  }

  return null;
}

export async function setAutostartEnabled(enabled: boolean): Promise<boolean> {
  const electron = requiredElectronBridge();
  if (electron?.autostart?.enable && electron.autostart.disable) {
    if (enabled) {
      await electron.autostart.enable();
    } else {
      await electron.autostart.disable();
    }
    return true;
  }

  return false;
}

export async function checkForRuntimeUpdate(options?: { timeout?: number }): Promise<RuntimeUpdate | null> {
  const electron = requiredElectronBridge();
  if (electron?.updater?.check) {
    const request = electron.updater.check(options);
    if (!options?.timeout) return request;
    return Promise.race([
      request,
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), options.timeout);
      }),
    ]);
  }

  return null;
}

export async function onRuntimeFocusChanged(handler: (focused: boolean) => void): Promise<Unlisten> {
  const electron = requiredElectronBridge();
  if (electron?.windows?.onFocusChanged) {
    return electron.windows.onFocusChanged(handler);
  }

  throw new Error('Electron window event bridge is not available');
}

export async function listenRuntimeEvent<T = unknown>(
  event: string,
  handler: (payload: T) => void
): Promise<Unlisten> {
  const electron = requiredElectronBridge();
  if (electron?.events?.listen) {
    return electron.events.listen<T>(event, ({ payload }) => handler(payload));
  }

  throw new Error('Electron event bridge is not available');
}

export type RuntimeName = 'electron' | 'web';
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

interface YapCommandResult {
  ok: boolean;
  command: string;
  reason?: string;
  value?: unknown;
  data?: unknown;
  payload?: unknown;
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
    relaunch?: () => Promise<void>;
  };
  windows?: {
    openSettings?: () => Promise<void>;
    showMain?: () => Promise<void>;
    hide?: (label: string) => Promise<void>;
    hideSettings?: () => Promise<void>;
    onFocusChanged?: (handler: (focused: boolean) => void) => Promise<Unlisten> | Unlisten;
  };
  commands?: {
    invoke?: <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>;
    invokePlaceholder?: (command: string) => Promise<YapCommandResult>;
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

export function runtimeName(): RuntimeName {
  if (electronBridge()) return 'electron';
  return 'web';
}

export function isNativeRuntime(): boolean {
  return runtimeName() !== 'web';
}

export async function invokeRuntime<T = unknown>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> {
  const electron = electronBridge();
  if (electron?.commands?.invoke) {
    return electron.commands.invoke<T>(command, args);
  }

  if (electron?.commands?.invokePlaceholder) {
    const result = await electron.commands.invokePlaceholder(command);
    if (result.ok) {
      return (result.value ?? result.data ?? result.payload) as T;
    }
    throw new Error(result.reason ?? `Electron command is not implemented: ${command}`);
  }

  throw new Error(`No native runtime command bridge is available for ${command}`);
}

export async function invokeRuntimeOptional<T = unknown>(
  command: string,
  args?: Record<string, unknown>
): Promise<T | null> {
  try {
    return await invokeRuntime<T>(command, args);
  } catch (error) {
    if (runtimeName() !== 'web') {
      console.error(`Runtime command failed: ${command}`, error);
    }
    return null;
  }
}

export async function showSettings(): Promise<void> {
  const electron = electronBridge();
  if (electron?.windows?.openSettings) {
    await electron.windows.openSettings();
    return;
  }

}

export async function hideWindow(label: string): Promise<void> {
  const electron = electronBridge();
  if (electron?.windows?.hide) {
    await electron.windows.hide(label);
    return;
  }
  if (label === 'settings' && electron?.windows?.hideSettings) {
    await electron.windows.hideSettings();
    return;
  }

}

export async function openExternal(url: string): Promise<void> {
  const electron = electronBridge();
  if (electron?.shell?.openExternal) {
    await electron.shell.openExternal(url);
    return;
  }

  window.open(url, '_blank', 'noopener,noreferrer');
}

export async function confirmRuntime(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  const electron = electronBridge();
  if (electron?.dialog?.confirm) {
    return electron.dialog.confirm(message, options);
  }

  return window.confirm(message);
}

export async function isAutostartEnabled(): Promise<boolean | null> {
  const electron = electronBridge();
  if (electron?.autostart?.isEnabled) {
    return electron.autostart.isEnabled();
  }

  return null;
}

export async function setAutostartEnabled(enabled: boolean): Promise<boolean> {
  const electron = electronBridge();
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
  const electron = electronBridge();
  if (electron?.updater?.check) {
    return electron.updater.check(options);
  }

  return null;
}

export async function relaunchRuntime(): Promise<void> {
  const electron = electronBridge();
  if (electron?.app?.relaunch) {
    await electron.app.relaunch();
    return;
  }

}

export async function onRuntimeFocusChanged(handler: (focused: boolean) => void): Promise<Unlisten> {
  const electron = electronBridge();
  if (electron?.windows?.onFocusChanged) {
    return electron.windows.onFocusChanged(handler);
  }

  const onFocus = () => handler(true);
  window.addEventListener('focus', onFocus);
  return () => window.removeEventListener('focus', onFocus);
}

export async function listenRuntimeEvent<T = unknown>(
  event: string,
  handler: (payload: T) => void
): Promise<Unlisten> {
  const electron = electronBridge();
  if (electron?.events?.listen) {
    return electron.events.listen<T>(event, ({ payload }) => handler(payload));
  }

  return () => {};
}

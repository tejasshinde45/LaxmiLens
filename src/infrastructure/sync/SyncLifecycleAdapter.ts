export interface SyncLifecycleHandlers {
  onOnline: () => void;
  onOffline: () => void;
  onForeground: () => void;
}

export interface SyncLifecycleAdapter {
  isOnline(): boolean;
  subscribe(handlers: SyncLifecycleHandlers): () => void;
}

export interface SyncTimerProvider {
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimeout(timerId: ReturnType<typeof setTimeout>): void;
  nowMs(): number;
}

export const defaultSyncTimerProvider: SyncTimerProvider = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (timerId) => globalThis.clearTimeout(timerId),
  nowMs: () => Date.now()
};

/**
 * Browser implementation of SyncLifecycleAdapter.
 * Keeps DOM/window listeners isolated behind SyncLifecycleAdapter so future
 * mobile/Capacitor App/Network plugins can swap in without rewriting AutoSyncScheduler.
 */
export class BrowserSyncLifecycleAdapter implements SyncLifecycleAdapter {
  public isOnline(): boolean {
    if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
      return navigator.onLine;
    }
    return true;
  }

  public subscribe(handlers: SyncLifecycleHandlers): () => void {
    const cleanups: Array<() => void> = [];

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      const handleOnline = () => handlers.onOnline();
      const handleOffline = () => handlers.onOffline();
      const handleFocus = () => handlers.onForeground();

      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
      window.addEventListener('focus', handleFocus);

      cleanups.push(() => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
        window.removeEventListener('focus', handleFocus);
      });
    }

    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          handlers.onForeground();
        }
      };

      document.addEventListener('visibilitychange', handleVisibilityChange);
      cleanups.push(() => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      });
    }

    return () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  }
}

export const defaultSyncLifecycleAdapter = new BrowserSyncLifecycleAdapter();

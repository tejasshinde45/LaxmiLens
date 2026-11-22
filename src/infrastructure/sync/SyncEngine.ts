import { APP_CONFIG } from '@/config/constants';
import { OutboxManager } from './OutboxManager';
import { SyncStatusDTO } from '@/application/dto/SyncDTO';
import { LocalOutboxRecord } from '../database/local/schema';

export type SyncState = 'idle' | 'syncing' | 'offline' | 'error';
export type SyncListener = (status: SyncStatusDTO) => void;

export class SyncEngine {
  private state: SyncState = 'idle';
  private lastSyncedAt: string | null = null;
  private lastError: string | null = null;
  private listeners: Set<SyncListener> = new Set();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly outboxManager: OutboxManager = new OutboxManager()) {
    this.initNetworkListeners();
  }

  private initNetworkListeners(): void {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);

      if (!navigator.onLine) {
        this.state = 'offline';
      }
    }
  }

  private handleOnline = (): void => {
    this.state = 'idle';
    this.notify();
    // Safety Hotfix: Intentionally do NOT trigger this.sync() here.
    // Premature synchronization is disabled until real remote cloud dispatchers are implemented.
  };

  private handleOffline = (): void => {
    this.state = 'offline';
    this.notify();
  };

  public subscribe(listener: SyncListener): () => void {
    this.listeners.add(listener);
    void this.getStatus().then((status) => listener(status));
    return () => {
      this.listeners.delete(listener);
    };
  }

  public async getStatus(userId?: string): Promise<SyncStatusDTO> {
    let pendingCount = 0;
    try {
      pendingCount = await (this.outboxManager.getPendingCount as (id?: string) => Promise<number>)(userId);
    } catch {
      // Fallback for non-IndexedDB environments (e.g. headless SSR / unit test runners or unauthenticated)
      pendingCount = 0;
    }
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

    return {
      pendingOutboxCount: pendingCount,
      lastSyncedAt: this.lastSyncedAt,
      isSyncing: this.state === 'syncing',
      isOnline,
      lastError: this.lastError
    };
  }

  public async sync(userId?: string): Promise<void> {
    if (this.state === 'syncing' || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      return;
    }

    this.state = 'syncing';
    this.lastError = null;
    this.notify();

    try {
      const pendingEntries = await (this.outboxManager.getPendingEntries as (id?: string) => Promise<LocalOutboxRecord[]>)(userId);

      // Safety Hotfix:
      // Real cloud synchronization dispatchers are not yet implemented.
      // Under no circumstance should pending outbox entries be marked as successful
      // or deleted from the local database without a verified remote operation.
      // Every pending outbox entry remains completely untouched and preserved.
      for (const entry of pendingEntries) {
        if (entry.attempts >= APP_CONFIG.sync.maxRetries) {
          continue;
        }
        // Remote dispatchers are unimplemented; entries remain pending.
      }

      // Do not update lastSyncedAt since zero remote cloud operations were performed.
      this.state = 'idle';
    } catch (err) {
      this.state = 'error';
      this.lastError = err instanceof Error ? err.message : 'Sync failed';
    } finally {
      this.notify();
    }
  }

  public startPeriodicSync(): void {
    // Safety Hotfix: Periodic sync timer is disabled until real remote cloud
    // synchronization dispatchers are implemented.
    if (this.timer) return;
  }

  public stopPeriodicSync(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public cleanup(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('offline', this.handleOffline);
    }
    this.stopPeriodicSync();
    this.listeners.clear();
  }

  private notify(): void {
    void this.getStatus().then((status) => {
      this.listeners.forEach((listener) => listener(status));
    });
  }
}

export const syncEngine = new SyncEngine();

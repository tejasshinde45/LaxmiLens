import { APP_CONFIG } from '@/config/constants';
import { OutboxManager } from './OutboxManager';
import { SyncStatusDTO } from '@/application/dto/SyncDTO';

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
      window.addEventListener('online', () => {
        this.state = 'idle';
        this.notify();
        void this.sync();
      });

      window.addEventListener('offline', () => {
        this.state = 'offline';
        this.notify();
      });

      if (!navigator.onLine) {
        this.state = 'offline';
      }
    }
  }

  public subscribe(listener: SyncListener): () => void {
    this.listeners.add(listener);
    void this.getStatus().then((status) => listener(status));
    return () => {
      this.listeners.delete(listener);
    };
  }

  public async getStatus(): Promise<SyncStatusDTO> {
    const pendingCount = await this.outboxManager.getPendingCount();
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

    return {
      pendingOutboxCount: pendingCount,
      lastSyncedAt: this.lastSyncedAt,
      isSyncing: this.state === 'syncing',
      isOnline,
      lastError: this.lastError
    };
  }

  public async sync(): Promise<void> {
    if (this.state === 'syncing' || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      return;
    }

    this.state = 'syncing';
    this.lastError = null;
    this.notify();

    try {
      const pendingEntries = await this.outboxManager.getPendingEntries();

      for (const entry of pendingEntries) {
        if (entry.attempts >= APP_CONFIG.sync.maxRetries) {
          continue; // Dead-letter or wait for manual resolution
        }

        try {
          // Idempotent sync push will dispatch here to cloud repository in feature implementation
          if (entry.id !== undefined) {
            await this.outboxManager.markSuccess(entry.id);
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : 'Unknown sync push error';
          if (entry.id !== undefined) {
            await this.outboxManager.markFailure(entry.id, errMsg);
          }
        }
      }

      this.lastSyncedAt = new Date().toISOString();
      this.state = 'idle';
    } catch (err) {
      this.state = 'error';
      this.lastError = err instanceof Error ? err.message : 'Sync failed';
    } finally {
      this.notify();
    }
  }

  public startPeriodicSync(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.sync();
    }, APP_CONFIG.sync.outboxFlushIntervalMs);
  }

  public stopPeriodicSync(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private notify(): void {
    void this.getStatus().then((status) => {
      this.listeners.forEach((listener) => listener(status));
    });
  }
}

export const syncEngine = new SyncEngine();

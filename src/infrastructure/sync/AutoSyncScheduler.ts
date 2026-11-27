import { APP_CONFIG } from '@/config/constants';
import { BackupCacheInvalidator } from '@/application/ports/BackupStoragePort';
import { validateUserId } from '@/domain/value-objects/Identifiers';
import { OutboxManager } from './OutboxManager';
import { LocalWriteCommitNotifier } from './LocalWriteCommitNotifier';
import {
  ManualSyncCoordinator,
  SyncCoordinatorLifecycleEvent,
  SyncExecutionMode,
  UnifiedSyncResult
} from './ManualSyncCoordinator';
import { CrossTabSyncMessage } from './CrossTabSyncCoordinator';
import {
  classifySyncError,
  computeSyncBackoffDelayMs,
  SyncRetryConfig
} from './SyncRetryPolicy';
import {
  defaultSyncLifecycleAdapter,
  defaultSyncTimerProvider,
  SyncLifecycleAdapter,
  SyncTimerProvider
} from './SyncLifecycleAdapter';

export type AutoSyncStatus =
  | 'saved_locally'
  | 'synchronizing'
  | 'successfully_synchronized'
  | 'waiting_for_internet'
  | 'synchronization_failed';

export type AutoSyncTriggerReason =
  | 'session_ready'
  | 'local_write'
  | 'online'
  | 'foreground'
  | 'retry'
  | 'post_exclusive'
  | 'auth_refreshed';

export interface AutoSyncStateSnapshot {
  readonly userId: string | null;
  readonly status: AutoSyncStatus;
  readonly label: string;
  readonly isOnline: boolean;
  readonly isSyncing: boolean;
  readonly isSessionReady: boolean;
  readonly isExclusiveOperationInProgress: boolean;
  readonly pendingCount: number;
  readonly lastSyncedAt: string | null;
  readonly lastAttemptAt: string | null;
  readonly lastError: string | null;
  readonly lastResult: UnifiedSyncResult | null;
  readonly nextRetryAtMs: number | null;
  readonly authPaused: boolean;
  readonly updatedAt: string;
}

export const AUTO_SYNC_STATUS_LABELS: Readonly<Record<AutoSyncStatus, string>> = {
  saved_locally: 'Saved locally',
  synchronizing: 'Synchronizing',
  successfully_synchronized: 'Successfully synchronized',
  waiting_for_internet: 'Waiting for internet',
  synchronization_failed: 'Synchronization failed'
};

export interface AutoSyncSchedulerOptions {
  userId: string;
  sessionGeneration: number;
  coordinator: ManualSyncCoordinator;
  outboxManager: OutboxManager;
  sessionCheck?: () => boolean;
  commitNotifier?: LocalWriteCommitNotifier;
  lifecycleAdapter?: SyncLifecycleAdapter;
  timerProvider?: SyncTimerProvider;
  cacheInvalidator?: BackupCacheInvalidator;
  onSyncSuccessWithChanges?: (userId: string, result: UnifiedSyncResult) => void;
  debounceMs?: number;
  foregroundCooldownMs?: number;
  retryConfig?: SyncRetryConfig;
  randomFn?: () => number;
}

export function createIdleSyncState(
  userId: string | null = null,
  isOnline = true,
  nowMs = Date.now()
): AutoSyncStateSnapshot {
  const status: AutoSyncStatus = isOnline ? 'saved_locally' : 'waiting_for_internet';
  return {
    userId,
    status,
    label: AUTO_SYNC_STATUS_LABELS[status],
    isOnline,
    isSyncing: false,
    isSessionReady: false,
    isExclusiveOperationInProgress: false,
    pendingCount: 0,
    lastSyncedAt: null,
    lastAttemptAt: null,
    lastError: null,
    lastResult: null,
    nextRetryAtMs: null,
    authPaused: false,
    updatedAt: new Date(nowMs).toISOString()
  };
}

export function isResultFullySynchronized(result: UnifiedSyncResult): boolean {
  return (
    !result.authPaused &&
    !result.skippedAuthPaused &&
    !result.skippedLockContention &&
    result.failedCount === 0 &&
    result.stillPendingCount === 0 &&
    (result.skippedPausedCount ?? 0) === 0 &&
    (result.skippedBackoffCount ?? 0) === 0 &&
    (result.errors?.length ?? 0) === 0
  );
}

const DEFAULT_LOCAL_WRITE_DEBOUNCE_MS = 1_000;
const DEFAULT_FOREGROUND_COOLDOWN_MS = 30_000;

/**
 * User-scoped, event-driven background synchronization scheduler.
 *
 * Delegates all cloud pushes/pulls strictly to ManualSyncCoordinator while keeping
 * timers, DOM lifecycle events, cross-tab updates, backup/restore exclusion, and
 * honest status reporting cleanly coordinated without continuous polling.
 */
export class AutoSyncScheduler {
  public readonly userId: string;
  public readonly sessionGeneration: number;

  private readonly coordinator: ManualSyncCoordinator;
  private readonly outboxManager: OutboxManager;
  private readonly sessionCheck?: () => boolean;
  private readonly commitNotifier?: LocalWriteCommitNotifier;
  private readonly lifecycleAdapter: SyncLifecycleAdapter;
  private readonly timerProvider: SyncTimerProvider;
  private readonly cacheInvalidator?: BackupCacheInvalidator;
  private readonly onSyncSuccessWithChanges?: (userId: string, result: UnifiedSyncResult) => void;
  private readonly debounceMs: number;
  private readonly foregroundCooldownMs: number;
  private readonly retryConfig: SyncRetryConfig;
  private readonly randomFn?: () => number;

  private readonly stateListeners = new Set<(snapshot: AutoSyncStateSnapshot) => void>();
  private unsubscribeLifecycle: (() => void) | null = null;
  private unsubscribeCommits: (() => void) | null = null;
  private unsubscribeCoordinator: (() => void) | null = null;

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private postExclusiveTimer: ReturnType<typeof setTimeout> | null = null;

  private disposed = false;
  private started = false;
  private inFlightSyncPromise: Promise<UnifiedSyncResult | null> | null = null;
  private pendingFollowUpSync = false;
  private postRestoreHoldCount = 0;
  private pendingPostRestoreSync = false;
  private transientPullAttempts = 0;
  private lastSyncAttemptAtMs: number | null = null;

  private state: AutoSyncStateSnapshot;

  constructor(options: AutoSyncSchedulerOptions) {
    this.userId = validateUserId(options.userId);
    this.sessionGeneration = options.sessionGeneration;
    this.coordinator = options.coordinator;
    this.outboxManager = options.outboxManager;
    this.sessionCheck = options.sessionCheck;
    this.commitNotifier = options.commitNotifier;
    this.lifecycleAdapter = options.lifecycleAdapter ?? defaultSyncLifecycleAdapter;
    this.timerProvider = options.timerProvider ?? defaultSyncTimerProvider;
    this.cacheInvalidator = options.cacheInvalidator;
    this.onSyncSuccessWithChanges = options.onSyncSuccessWithChanges;
    this.debounceMs = Math.max(0, options.debounceMs ?? DEFAULT_LOCAL_WRITE_DEBOUNCE_MS);
    this.foregroundCooldownMs = Math.max(
      0,
      options.foregroundCooldownMs ?? DEFAULT_FOREGROUND_COOLDOWN_MS
    );
    this.retryConfig = options.retryConfig ?? APP_CONFIG.sync;
    this.randomFn = options.randomFn;

    const initialOnline = this.lifecycleAdapter.isOnline();
    this.state = createIdleSyncState(this.userId, initialOnline, this.timerProvider.nowMs());

    // Subscribe to coordinator lifecycle immediately so manual Sync Now and backup/restore locks
    // are reflected accurately in observable state even before initial background sync completes.
    this.unsubscribeCoordinator = this.coordinator.subscribeLifecycle((event) => {
      void this.handleCoordinatorLifecycleEvent(event);
    });
  }

  public isDisposed(): boolean {
    return this.disposed;
  }

  public isStarted(): boolean {
    return this.started;
  }

  public getState(): AutoSyncStateSnapshot {
    return this.state;
  }

  public subscribe(listener: (snapshot: AutoSyncStateSnapshot) => void): () => void {
    this.stateListeners.add(listener);
    listener(this.state);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  /**
   * Activates automatic triggers AFTER database initialization and LegacyDatabaseMigrator finish.
   * Safe and idempotent to call repeatedly for the same active session generation.
   */
  public start(): void {
    if (this.disposed || this.started || !this.isSessionValid()) {
      return;
    }

    this.started = true;
    this.unsubscribeLifecycle = this.lifecycleAdapter.subscribe({
      onOnline: () => this.handleOnline(),
      onOffline: () => this.handleOffline(),
      onForeground: () => this.handleForeground()
    });

    if (this.commitNotifier) {
      this.unsubscribeCommits = this.commitNotifier.subscribe(() => {
        this.notifyLocalWriteCommitted();
      });
    }

    const online = this.lifecycleAdapter.isOnline();
    const exclusiveActive = this.coordinator.isOperationInProgress();
    this.updateState({
      isSessionReady: true,
      isOnline: online,
      isExclusiveOperationInProgress: exclusiveActive,
      status: online ? 'saved_locally' : 'waiting_for_internet'
    });

    if (!online) {
      void this.refreshPendingCountSafely();
      return;
    }

    if (exclusiveActive) {
      this.pendingFollowUpSync = true;
      return;
    }

    void this.triggerSync('session_ready');
  }

  /**
   * Notifies the scheduler that a Dexie financial transaction has committed on disk.
   * Debounces rapid writes so related operations synchronize in a single pass.
   */
  public notifyLocalWriteCommitted(): void {
    if (this.disposed || !this.started || !this.isSessionValid()) {
      return;
    }

    const online = this.lifecycleAdapter.isOnline();
    const exclusiveActive = this.coordinator.isOperationInProgress();

    // Update optimistic state immediately so local writes never appear as "Successfully synchronized"
    const optimisticPending = Math.max(1, this.state.pendingCount);
    if (!this.inFlightSyncPromise) {
      this.updateState({
        isOnline: online,
        pendingCount: optimisticPending,
        nextRetryAtMs: null,
        status: online ? 'saved_locally' : 'waiting_for_internet'
      });
    } else {
      this.pendingFollowUpSync = true;
      this.updateState({
        isOnline: online,
        pendingCount: optimisticPending
      });
    }

    void this.refreshPendingCountSafely();

    if (!online) {
      this.clearDebounceTimer();
      this.clearRetryTimer();
      return;
    }

    if (exclusiveActive || this.postRestoreHoldCount > 0) {
      this.pendingFollowUpSync = true;
      if (this.postRestoreHoldCount > 0) {
        this.pendingPostRestoreSync = true;
      }
      this.clearDebounceTimer();
      this.clearRetryTimer();
      return;
    }

    this.clearRetryTimer();
    this.scheduleDebouncedSync('local_write');
  }

  /**
   * Handles authentication refresh/sign-in completion so auth-paused retries resume cleanly.
   */
  public notifyAuthRefreshed(): void {
    if (this.disposed || !this.isSessionValid()) {
      return;
    }

    this.transientPullAttempts = 0;
    this.updateState({ authPaused: false, lastError: null });

    if (!this.started || !this.lifecycleAdapter.isOnline()) {
      return;
    }

    if (this.postRestoreHoldCount > 0) {
      this.pendingPostRestoreSync = true;
      return;
    }

    if (this.coordinator.isOperationInProgress()) {
      this.pendingFollowUpSync = true;
      return;
    }

    void this.triggerSync('auth_refreshed');
  }

  /**
   * Handles verified cross-tab BroadcastChannel events from sibling tabs of the same user.
   */
  public async handleCrossTabMessage(message: CrossTabSyncMessage): Promise<void> {
    if (this.disposed || !this.isSessionValid()) {
      return;
    }
    if (message.userId !== this.userId) {
      return;
    }

    if (message.type === 'syncStarted') {
      this.updateState({
        isSyncing: true,
        status: 'synchronizing'
      });
      return;
    }

    if (message.type === 'syncCompleted') {
      const moved = (message.syncedCount ?? 0) + (message.pulledCount ?? 0);
      const hasFailures = (message.failedCount ?? 0) > 0;
      if (moved > 0) {
        await this.invalidateCachesSafely(!hasFailures);
      }

      const pendingCount = await this.getPendingCountSafely();
      if (this.disposed || !this.isSessionValid()) {
        return;
      }

      const nowIso = new Date(this.timerProvider.nowMs()).toISOString();
      const online = this.lifecycleAdapter.isOnline();

      if (!online) {
        this.updateState({
          isOnline: false,
          isSyncing: false,
          pendingCount,
          status: 'waiting_for_internet'
        });
        return;
      }

      if (hasFailures) {
        this.updateState({
          isOnline: true,
          isSyncing: false,
          pendingCount,
          lastAttemptAt: nowIso,
          status: 'synchronization_failed'
        });
        return;
      }

      if (pendingCount === 0) {
        this.clearRetryTimer();
        this.transientPullAttempts = 0;
        this.updateState({
          isOnline: true,
          isSyncing: false,
          pendingCount: 0,
          lastSyncedAt: nowIso,
          lastAttemptAt: nowIso,
          lastError: null,
          nextRetryAtMs: null,
          authPaused: false,
          status: 'successfully_synchronized'
        });
      } else {
        this.updateState({
          isOnline: true,
          isSyncing: false,
          pendingCount,
          lastAttemptAt: nowIso,
          status: 'saved_locally'
        });
      }
      return;
    }

    if (message.type === 'restoreCompleted') {
      await this.invalidateCachesSafely();
      const pendingCount = await this.getPendingCountSafely();
      if (this.disposed || !this.isSessionValid()) {
        return;
      }

      const online = this.lifecycleAdapter.isOnline();
      this.updateState({
        isOnline: online,
        isSyncing: false,
        pendingCount,
        status: online ? 'saved_locally' : 'waiting_for_internet'
      });

      if (this.postRestoreHoldCount > 0) {
        if (pendingCount > 0) {
          this.pendingPostRestoreSync = true;
        }
        return;
      }

      if (this.started && online && pendingCount > 0 && !this.coordinator.isOperationInProgress()) {
        this.scheduleDebouncedSync('post_exclusive');
      }
    }
  }

  /**
   * Returns true when restore completion UI is currently holding background sync.
   */
  public isPostRestoreSyncHeld(): boolean {
    return this.postRestoreHoldCount > 0;
  }

  /**
   * Acquires a restore confirmation hold so restored outbox entries remain saved locally
   * without starting automatic synchronization until the user dismisses confirmation.
   */
  public holdPostRestoreSync(): void {
    if (this.disposed || !this.isSessionValid()) {
      return;
    }
    this.postRestoreHoldCount += 1;
    this.pendingPostRestoreSync = true;
    this.clearPostExclusiveTimer();
    this.clearDebounceTimer();
  }

  /**
   * Releases a prior restore confirmation hold and schedules background synchronization
   * once pending restored entries are ready and confirmed.
   */
  public releasePostRestoreSync(): void {
    if (this.postRestoreHoldCount > 0) {
      this.postRestoreHoldCount -= 1;
    }
    if (this.disposed || !this.started || !this.isSessionValid() || this.postRestoreHoldCount > 0) {
      return;
    }
    void this.releasePostRestoreAndScheduleIfReady();
  }

  private async releasePostRestoreAndScheduleIfReady(): Promise<void> {
    const pendingCount = await this.getPendingCountSafely();
    if (
      this.disposed ||
      !this.started ||
      !this.isSessionValid() ||
      this.postRestoreHoldCount > 0
    ) {
      return;
    }

    const online = this.lifecycleAdapter.isOnline();
    if (pendingCount > 0 || this.pendingPostRestoreSync || this.pendingFollowUpSync) {
      this.updateState({
        pendingCount,
        isOnline: online,
        status: online ? 'saved_locally' : 'waiting_for_internet'
      });
    }

    const shouldSync = pendingCount > 0 || this.pendingFollowUpSync;
    this.pendingPostRestoreSync = false;

    if (shouldSync && online && !this.coordinator.isOperationInProgress()) {
      this.pendingFollowUpSync = false;
      this.clearPostExclusiveTimer();
      this.postExclusiveTimer = this.timerProvider.setTimeout(() => {
        this.postExclusiveTimer = null;
        void this.triggerSync('post_exclusive');
      }, this.debounceMs);
    }
  }

  /**
   * Explicitly retries previously failed or paused synchronization entries without
   * discarding any locally saved outbox records.
   */
  public async retryNow(): Promise<UnifiedSyncResult | null> {
    if (this.disposed || !this.isSessionValid()) {
      return null;
    }

    if (!this.lifecycleAdapter.isOnline()) {
      this.clearRetryTimer();
      this.updateState({
        isOnline: false,
        nextRetryAtMs: null,
        status: 'waiting_for_internet'
      });
      return null;
    }

    if (this.inFlightSyncPromise) {
      return this.inFlightSyncPromise;
    }

    if (this.coordinator.isOperationInProgress()) {
      this.pendingFollowUpSync = true;
      return null;
    }

    this.clearRetryTimer();
    this.transientPullAttempts = 0;
    this.lastSyncAttemptAtMs = this.timerProvider.nowMs();

    const runPromise = (async (): Promise<UnifiedSyncResult | null> => {
      try {
        return await this.coordinator.retryFailed();
      } catch (error) {
        if (!this.disposed && this.isSessionValid()) {
          await this.handleUnexpectedCoordinatorFailure(error);
        }
        return null;
      } finally {
        this.inFlightSyncPromise = null;
        if (
          !this.disposed &&
          this.started &&
          this.isSessionValid() &&
          this.pendingFollowUpSync &&
          this.postRestoreHoldCount === 0
        ) {
          this.pendingFollowUpSync = false;
          if (this.lifecycleAdapter.isOnline() && !this.coordinator.isOperationInProgress()) {
            this.scheduleDebouncedSync('local_write');
          }
        }
      }
    })();

    this.inFlightSyncPromise = runPromise;
    return runPromise;
  }

  /**
   * Immediately cancels all pending timers and unsubscribes all listeners.
   * Must be invoked on sign-out, user switch, or database closure.
   */
  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.started = false;
    this.pendingFollowUpSync = false;
    this.postRestoreHoldCount = 0;
    this.pendingPostRestoreSync = false;

    this.clearAllTimers();

    this.unsubscribeLifecycle?.();
    this.unsubscribeLifecycle = null;

    this.unsubscribeCommits?.();
    this.unsubscribeCommits = null;

    this.unsubscribeCoordinator?.();
    this.unsubscribeCoordinator = null;

    this.stateListeners.clear();
  }

  private isSessionValid(): boolean {
    if (this.disposed) {
      return false;
    }
    return this.sessionCheck ? this.sessionCheck() : true;
  }

  private scheduleDebouncedSync(reason: 'local_write' | 'post_exclusive'): void {
    this.clearDebounceTimer();
    this.debounceTimer = this.timerProvider.setTimeout(() => {
      this.debounceTimer = null;
      void this.triggerSync(reason);
    }, this.debounceMs);
  }

  private handleOnline(): void {
    if (this.disposed || !this.isSessionValid()) {
      return;
    }

    this.coordinator.notifyNetworkRecovered(this.userId);
    this.transientPullAttempts = 0;
    this.clearRetryTimer();

    this.updateState({
      isOnline: true,
      nextRetryAtMs: null,
      ...(this.state.status === 'waiting_for_internet'
        ? { status: 'saved_locally' as const }
        : {})
    });

    if (!this.started) {
      return;
    }

    if (this.coordinator.isOperationInProgress() || this.postRestoreHoldCount > 0) {
      this.pendingFollowUpSync = true;
      return;
    }

    if (this.coordinator.isAuthPaused(this.userId)) {
      return;
    }

    void this.triggerSync('online');
  }

  private handleOffline(): void {
    if (this.disposed) {
      return;
    }

    this.clearAllTimers();
    this.updateState({
      isOnline: false,
      nextRetryAtMs: null,
      status: 'waiting_for_internet'
    });
  }

  private handleForeground(): void {
    if (this.disposed || !this.started || !this.isSessionValid()) {
      return;
    }

    if (!this.lifecycleAdapter.isOnline()) {
      this.updateState({
        isOnline: false,
        status: 'waiting_for_internet'
      });
      return;
    }

    if (
      this.postRestoreHoldCount > 0 ||
      this.inFlightSyncPromise ||
      this.coordinator.isOperationInProgress() ||
      this.coordinator.isAuthPaused(this.userId)
    ) {
      return;
    }

    const nowMs = this.timerProvider.nowMs();
    if (
      this.lastSyncAttemptAtMs !== null &&
      nowMs - this.lastSyncAttemptAtMs < this.foregroundCooldownMs
    ) {
      return;
    }

    void this.triggerSync('foreground');
  }

  private triggerSync(reason: AutoSyncTriggerReason): Promise<UnifiedSyncResult | null> {
    if (this.disposed || !this.started || !this.isSessionValid()) {
      return Promise.resolve(null);
    }

    if (this.postRestoreHoldCount > 0) {
      this.pendingPostRestoreSync = true;
      return Promise.resolve(null);
    }

    if (!this.lifecycleAdapter.isOnline()) {
      this.clearAllTimers();
      this.updateState({
        isOnline: false,
        nextRetryAtMs: null,
        status: 'waiting_for_internet'
      });
      void this.refreshPendingCountSafely();
      return Promise.resolve(null);
    }

    if (this.coordinator.isAuthPaused(this.userId)) {
      this.clearRetryTimer();
      this.updateState({
        authPaused: true,
        nextRetryAtMs: null,
        status: 'synchronization_failed'
      });
      return Promise.resolve(null);
    }

    if (this.inFlightSyncPromise) {
      if (reason === 'local_write' || reason === 'online' || reason === 'post_exclusive') {
        this.pendingFollowUpSync = true;
      }
      return this.inFlightSyncPromise;
    }

    if (this.coordinator.isOperationInProgress()) {
      if (reason === 'local_write' || reason === 'online' || reason === 'retry' || reason === 'post_exclusive') {
        this.pendingFollowUpSync = true;
      }
      return Promise.resolve(null);
    }

    this.lastSyncAttemptAtMs = this.timerProvider.nowMs();

    const runPromise = (async (): Promise<UnifiedSyncResult | null> => {
      try {
        const result = await this.coordinator.run({
          mode: 'background',
          retryFailed: false
        });
        return result;
      } catch (error) {
        if (!this.disposed && this.isSessionValid()) {
          await this.handleUnexpectedCoordinatorFailure(error);
        }
        return null;
      } finally {
        this.inFlightSyncPromise = null;
        if (!this.disposed && this.started && this.isSessionValid() && this.pendingFollowUpSync) {
          this.pendingFollowUpSync = false;
          if (this.lifecycleAdapter.isOnline() && !this.coordinator.isOperationInProgress()) {
            this.scheduleDebouncedSync('local_write');
          }
        }
      }
    })();

    this.inFlightSyncPromise = runPromise;
    return runPromise;
  }

  private async handleCoordinatorLifecycleEvent(
    event: SyncCoordinatorLifecycleEvent
  ): Promise<void> {
    if (this.disposed || !this.isSessionValid()) {
      return;
    }

    if (event.type === 'exclusiveStarted') {
      this.clearDebounceTimer();
      this.clearRetryTimer();
      this.clearPostExclusiveTimer();
      this.updateState({
        isExclusiveOperationInProgress: true
      });
      return;
    }

    if (event.type === 'exclusiveEnded') {
      this.updateState({
        isExclusiveOperationInProgress: false
      });

      if (!this.started || !this.isSessionValid()) {
        return;
      }

      const pendingCount = await this.getPendingCountSafely();
      if (this.disposed || !this.isSessionValid()) {
        return;
      }

      const online = this.lifecycleAdapter.isOnline();
      if (event.mayHaveMutatedOutbox) {
        this.updateState({
          pendingCount,
          isOnline: online,
          status: online ? 'saved_locally' : 'waiting_for_internet'
        });
      }

      const shouldFollowUp =
        this.pendingFollowUpSync ||
        (event.mayHaveMutatedOutbox && event.succeeded && pendingCount > 0);

      if (shouldFollowUp && online && !this.coordinator.isOperationInProgress()) {
        this.pendingFollowUpSync = false;
        this.clearPostExclusiveTimer();
        this.postExclusiveTimer = this.timerProvider.setTimeout(() => {
          this.postExclusiveTimer = null;
          void this.triggerSync('post_exclusive');
        }, this.debounceMs);
      }
      return;
    }

    if (event.type === 'syncStarted') {
      if (event.userId !== this.userId) {
        return;
      }
      this.clearRetryTimer();
      this.lastSyncAttemptAtMs = this.timerProvider.nowMs();
      this.updateState({
        isOnline: this.lifecycleAdapter.isOnline(),
        isSyncing: true,
        status: 'synchronizing'
      });
      return;
    }

    if (event.type === 'syncFailed') {
      if (event.userId && event.userId !== this.userId) {
        return;
      }
      await this.handleUnexpectedCoordinatorFailure(event.error);
      return;
    }

    if (event.type === 'syncCompleted') {
      if (event.userId !== this.userId) {
        return;
      }
      await this.handleSyncCompleted(event.mode, event.result);
    }
  }

  private async handleSyncCompleted(
    _mode: SyncExecutionMode,
    result: UnifiedSyncResult
  ): Promise<void> {
    if (this.disposed || !this.isSessionValid()) {
      return;
    }

    const totalMoved = result.syncedCount + result.pulledCount;
    const hasFailures = result.failedCount > 0 || result.errors.length > 0;

    if (!result.skippedLockContention && (totalMoved > 0 || !hasFailures)) {
      if (totalMoved > 0) {
        await this.invalidateCachesSafely(!hasFailures);
      }
    }

    if (!result.authPaused && !hasFailures && totalMoved > 0) {
      try {
        this.onSyncSuccessWithChanges?.(this.userId, result);
      } catch {
        // Non-blocking secondary alert check
      }
    }

    if (this.disposed || !this.isSessionValid()) {
      return;
    }

    const nowMs = this.timerProvider.nowMs();
    const nowIso = new Date(nowMs).toISOString();
    this.lastSyncAttemptAtMs = nowMs;

    const online = this.lifecycleAdapter.isOnline();

    if (result.skippedLockContention) {
      // Another tab or exclusive operation holds the lock; remain honest without false errors or success.
      const pendingCount = result.stillPendingCount;
      this.updateState({
        isOnline: online,
        isSyncing: false,
        pendingCount,
        lastResult: result,
        status: !online ? 'waiting_for_internet' : 'saved_locally'
      });
      return;
    }

    if (!online) {
      this.clearRetryTimer();
      this.updateState({
        isOnline: false,
        isSyncing: false,
        pendingCount: result.stillPendingCount,
        lastAttemptAt: nowIso,
        lastResult: result,
        nextRetryAtMs: null,
        status: 'waiting_for_internet'
      });
      return;
    }

    if (result.authPaused || result.skippedAuthPaused) {
      this.clearRetryTimer();
      this.updateState({
        isOnline: true,
        isSyncing: false,
        pendingCount: result.stillPendingCount,
        lastAttemptAt: nowIso,
        lastResult: result,
        lastError: result.errors[0]?.error ?? 'Authentication required to resume synchronization.',
        nextRetryAtMs: null,
        authPaused: true,
        status: 'synchronization_failed'
      });
      return;
    }

    if (isResultFullySynchronized(result)) {
      this.clearRetryTimer();
      this.transientPullAttempts = 0;
      this.updateState({
        isOnline: true,
        isSyncing: false,
        pendingCount: 0,
        lastSyncedAt: nowIso,
        lastAttemptAt: nowIso,
        lastError: null,
        lastResult: result,
        nextRetryAtMs: null,
        authPaused: false,
        status: 'successfully_synchronized'
      });
      return;
    }

    // Honest partial / failure / conflict / deferred state
    const retrySummary = await this.coordinator.getRetryScheduleSummary(this.userId);
    if (this.disposed || !this.isSessionValid()) {
      return;
    }

    const nextRetryAtMs = this.scheduleRetryAfterOutcome(result, retrySummary.earliestRetryAtMs);

    const anyFailureOrConflict =
      result.failedCount > 0 ||
      result.errors.length > 0 ||
      retrySummary.hasPermanentOrExhaustedFailures;

    const firstErrorMessage =
      result.errors[0]?.error ??
      (retrySummary.hasPermanentOrExhaustedFailures
        ? 'Some local changes failed synchronization and remain saved locally.'
        : null);

    this.updateState({
      isOnline: this.lifecycleAdapter.isOnline(),
      isSyncing: false,
      pendingCount: result.stillPendingCount,
      lastAttemptAt: nowIso,
      lastResult: result,
      lastError: firstErrorMessage,
      nextRetryAtMs,
      authPaused: retrySummary.authPaused,
      status: !this.lifecycleAdapter.isOnline()
        ? 'waiting_for_internet'
        : anyFailureOrConflict
          ? 'synchronization_failed'
          : 'saved_locally'
    });
  }

  private async handleUnexpectedCoordinatorFailure(error: unknown): Promise<void> {
    if (this.disposed || !this.isSessionValid()) {
      return;
    }

    const classification = classifySyncError(error);
    const pendingCount = await this.getPendingCountSafely();
    if (this.disposed || !this.isSessionValid()) {
      return;
    }

    const nowMs = this.timerProvider.nowMs();
    const nowIso = new Date(nowMs).toISOString();
    const online = this.lifecycleAdapter.isOnline();
    const errorMsg = error instanceof Error ? error.message : String(error);

    this.clearRetryTimer();

    if (!online) {
      this.updateState({
        isOnline: false,
        isSyncing: false,
        pendingCount,
        lastAttemptAt: nowIso,
        lastError: errorMsg,
        nextRetryAtMs: null,
        status: 'waiting_for_internet'
      });
      return;
    }

    if (classification.disposition === 'auth') {
      this.updateState({
        isOnline: true,
        isSyncing: false,
        pendingCount,
        lastAttemptAt: nowIso,
        lastError: errorMsg,
        nextRetryAtMs: null,
        authPaused: true,
        status: 'synchronization_failed'
      });
      return;
    }

    let nextRetryAtMs: number | null = null;
    if (
      classification.disposition === 'transient' &&
      this.started &&
      this.transientPullAttempts < this.retryConfig.maxRetries
    ) {
      this.transientPullAttempts++;
      const delayMs = computeSyncBackoffDelayMs(
        this.transientPullAttempts,
        this.retryConfig,
        this.randomFn
      );
      nextRetryAtMs = nowMs + delayMs;
      this.scheduleRetryTimerAt(delayMs);
    }

    this.updateState({
      isOnline: true,
      isSyncing: false,
      pendingCount,
      lastAttemptAt: nowIso,
      lastError: errorMsg,
      nextRetryAtMs,
      status: 'synchronization_failed'
    });
  }

  private scheduleRetryAfterOutcome(
    result: UnifiedSyncResult,
    earliestOutboxRetryAtMs: number | null
  ): number | null {
    this.clearRetryTimer();

    if (!this.started || !this.lifecycleAdapter.isOnline() || this.coordinator.isAuthPaused(this.userId)) {
      return null;
    }

    const nowMs = this.timerProvider.nowMs();

    if (earliestOutboxRetryAtMs !== null) {
      const delayMs = Math.max(0, earliestOutboxRetryAtMs - nowMs);
      this.scheduleRetryTimerAt(delayMs);
      return earliestOutboxRetryAtMs;
    }

    const hasTransientNonOutboxError = result.errors.some((e) => e.retryable === true);
    if (
      hasTransientNonOutboxError &&
      this.transientPullAttempts < this.retryConfig.maxRetries
    ) {
      this.transientPullAttempts++;
      const delayMs = computeSyncBackoffDelayMs(
        this.transientPullAttempts,
        this.retryConfig,
        this.randomFn
      );
      this.scheduleRetryTimerAt(delayMs);
      return nowMs + delayMs;
    }

    return null;
  }

  private scheduleRetryTimerAt(delayMs: number): void {
    this.clearRetryTimer();
    const safeDelay = Math.max(0, Math.floor(delayMs));
    this.retryTimer = this.timerProvider.setTimeout(() => {
      this.retryTimer = null;
      void this.triggerSync('retry');
    }, safeDelay);
  }

  private async invalidateCachesSafely(includeNotifications = true): Promise<void> {
    if (!this.cacheInvalidator) {
      return;
    }
    try {
      await this.cacheInvalidator.invalidateUserCaches(this.userId, {
        includeNotifications
      });
    } catch {
      // Cache invalidation should never corrupt sync state transitions
    }
  }

  private async getPendingCountSafely(): Promise<number> {
    try {
      return await this.coordinator.getPendingCount(this.userId);
    } catch {
      try {
        return await this.outboxManager.getPendingCount(this.userId);
      } catch {
        return this.state.pendingCount;
      }
    }
  }

  private async refreshPendingCountSafely(): Promise<void> {
    const count = await this.getPendingCountSafely();
    if (!this.disposed && this.isSessionValid() && count !== this.state.pendingCount) {
      this.updateState({ pendingCount: count });
    }
  }

  private clearDebounceTimer(): void {
    if (this.debounceTimer !== null) {
      this.timerProvider.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private clearRetryTimer(): void {
    if (this.retryTimer !== null) {
      this.timerProvider.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private clearPostExclusiveTimer(): void {
    if (this.postExclusiveTimer !== null) {
      this.timerProvider.clearTimeout(this.postExclusiveTimer);
      this.postExclusiveTimer = null;
    }
  }

  private clearAllTimers(): void {
    this.clearDebounceTimer();
    this.clearRetryTimer();
    this.clearPostExclusiveTimer();
  }

  private updateState(patch: Partial<Omit<AutoSyncStateSnapshot, 'label' | 'updatedAt'>>): void {
    if (this.disposed) {
      return;
    }

    const nextStatus = patch.status ?? this.state.status;
    this.state = {
      ...this.state,
      ...patch,
      status: nextStatus,
      label: AUTO_SYNC_STATUS_LABELS[nextStatus],
      updatedAt: new Date(this.timerProvider.nowMs()).toISOString()
    };

    for (const listener of Array.from(this.stateListeners)) {
      try {
        listener(this.state);
      } catch (err) {
        console.error('AutoSyncScheduler subscriber failed:', err);
      }
    }
  }
}

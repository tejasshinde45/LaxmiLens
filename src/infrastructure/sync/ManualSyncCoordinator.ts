import { APP_CONFIG } from '@/config/constants';
import { validateUserId } from '@/domain/value-objects/Identifiers';
import { AccountSyncDispatcher } from './dispatchers/AccountSyncDispatcher';
import { TransactionSyncDispatcher } from './dispatchers/TransactionSyncDispatcher';
import { CategorySyncDispatcher } from './dispatchers/CategorySyncDispatcher';
import { BudgetSyncDispatcher } from './dispatchers/BudgetSyncDispatcher';
import { LenderSyncDispatcher } from './dispatchers/LenderSyncDispatcher';
import { BorrowingSyncDispatcher } from './dispatchers/BorrowingSyncDispatcher';
import { BorrowingRepaymentSyncDispatcher } from './dispatchers/BorrowingRepaymentSyncDispatcher';
import { BudgetReconciliationService } from './BudgetReconciliationService';
import { RecurringRuleSyncDispatcher } from './dispatchers/RecurringRuleSyncDispatcher';
import { RecurringOccurrenceSyncDispatcher } from './dispatchers/RecurringOccurrenceSyncDispatcher';
import { RecurringReconciliationService } from './RecurringReconciliationService';
import { NotificationSyncDispatcher } from './dispatchers/NotificationSyncDispatcher';
import { NotificationPreferenceSyncDispatcher } from './dispatchers/NotificationPreferenceSyncDispatcher';
import { NotificationReconciliationService } from './NotificationReconciliationService';
import { AccountReconciliationService } from './AccountReconciliationService';
import { CategoryReconciliationService } from './CategoryReconciliationService';
import { TransactionReconciliationService } from './TransactionReconciliationService';
import { BorrowingsReconciliationService } from './BorrowingsReconciliationService';
import { OutboxManager } from './OutboxManager';
import { AuthPort } from '@/application/ports/AuthPort';
import {
  BackupExclusiveOperation,
  BackupSyncActivityGuard,
  ExclusiveOperationOptions
} from '@/application/ports/BackupStoragePort';
import { BackupSyncConflictError } from '@/domain/errors/BackupErrors';
import { LocalOutboxRecord } from '../database/local/schema';
import {
  SyncAuthError,
  SyncInProgressError,
  SyncAccountDependencyError,
  SyncTransactionDependencyError,
  SyncLenderDependencyError,
  SyncBorrowingDependencyError,
  SyncUnresolvedCategoryError,
  SyncConflictError,
  SyncDatabaseError
} from './errors/SyncErrors';
import {
  classifySyncError,
  computeSyncBackoffDelayMs,
  evaluateOutboxEntryEligibility,
  OutboxEligibilityDecision,
  OutboxFailureRuntimeState,
  SyncFailureClass,
  SyncRetryConfig,
  SyncRetryDisposition
} from './SyncRetryPolicy';
import {
  BroadcastChannelFactory,
  CrossTabSyncCoordinator,
  CrossTabSyncMessage,
  WebLockProvider
} from './CrossTabSyncCoordinator';
import { SupabaseAccountRepository } from '../database/cloud/repositories/SupabaseAccountRepository';
import { SupabaseTransactionRepository } from '../database/cloud/repositories/SupabaseTransactionRepository';
import { SupabaseCategoryRepository } from '../database/cloud/repositories/SupabaseCategoryRepository';
import { SupabaseBudgetRepository } from '../database/cloud/repositories/SupabaseBudgetRepository';
import { SupabaseLenderRepository } from '../database/cloud/repositories/SupabaseLenderRepository';
import { SupabaseBorrowingRepository } from '../database/cloud/repositories/SupabaseBorrowingRepository';
import { SupabaseBorrowingRepaymentRepository } from '../database/cloud/repositories/SupabaseBorrowingRepaymentRepository';
import { SupabaseRecurringRuleRepository } from '../database/cloud/repositories/SupabaseRecurringRuleRepository';
import { SupabaseRecurringOccurrenceRepository } from '../database/cloud/repositories/SupabaseRecurringOccurrenceRepository';
import { SupabaseNotificationRepository } from '../database/cloud/repositories/SupabaseNotificationRepository';
import { SupabaseNotificationPreferenceRepository } from '../database/cloud/repositories/SupabaseNotificationPreferenceRepository';
import { CategoryMappingService } from './CategoryMappingService';
import { defaultAuthAdapter } from '../auth/SupabaseAuthAdapter';

export type SyncExecutionMode = 'manual' | 'background';

export type SyncCoordinatorLifecycleEvent =
  | { type: 'syncStarted'; mode: SyncExecutionMode; userId: string }
  | { type: 'syncCompleted'; mode: SyncExecutionMode; userId: string; result: UnifiedSyncResult }
  | { type: 'syncFailed'; mode: SyncExecutionMode; userId?: string; error: unknown }
  | { type: 'exclusiveStarted'; operation: BackupExclusiveOperation }
  | {
      type: 'exclusiveEnded';
      operation: BackupExclusiveOperation;
      succeeded: boolean;
      mayHaveMutatedOutbox: boolean;
    };

export interface SyncRetryScheduleSummary {
  readonly pendingCount: number;
  readonly eligibleNowCount: number;
  readonly earliestRetryAtMs: number | null;
  readonly hasPermanentOrExhaustedFailures: boolean;
  readonly authPaused: boolean;
}

export interface RunSyncOptions {
  limit?: number;
  pageSize?: number;
  mode?: SyncExecutionMode;
  retryFailed?: boolean;
}

export interface ManualSyncCoordinatorOptions {
  userId?: string;
  retryConfig?: SyncRetryConfig;
  sessionGeneration?: number;
  sessionCheck?: () => boolean;
  webLockProvider?: WebLockProvider | null;
  broadcastChannelFactory?: BroadcastChannelFactory | null;
  tabId?: string;
  onCrossTabEvent?: (message: CrossTabSyncMessage) => void;
  nowMs?: () => number;
  randomFn?: () => number;
  accountReconciler?: AccountReconciliationService;
  categoryReconciler?: CategoryReconciliationService;
  transactionReconciler?: TransactionReconciliationService;
  borrowingsReconciler?: BorrowingsReconciliationService;
}

export interface SyncErrorItem {
  entity: string;
  entityId: string;
  outboxId?: number;
  error: string;
  category: 'dependency' | 'category' | 'conflict' | 'auth' | 'database' | 'validation' | 'other';
  disposition?: SyncRetryDisposition;
  errorClass?: SyncFailureClass;
  retryable?: boolean;
}

export interface UnifiedSyncResult {
  // Global totals (100% backwards-compatible with ManualAccountSyncResult)
  totalPending: number;
  totalProcessed: number;
  syncedCount: number;
  failedCount: number;
  skippedCount: number;
  unsupportedCount: number;
  stillPendingCount: number;
  pulledCount: number;
  skippedPausedCount?: number;
  skippedBackoffCount?: number;
  skippedAuthPaused?: boolean;
  skippedLockContention?: boolean;
  pagesProcessed?: number;
  authPaused?: boolean;

  // Breakdown by entity
  accounts: {
    syncedCount: number;
    failedCount: number;
    skippedCount: number;
    pulledCount?: number;
    remappedCount?: number;
    conflictCount?: number;
  };
  categories: {
    syncedCount: number;
    failedCount: number;
    skippedCount: number;
    pulledCount?: number;
    mappedCount?: number;
    conflictCount?: number;
  };
  budgets: {
    syncedCount: number;
    failedCount: number;
    skippedCount: number;
    categoryBlockedCount: number;
    conflictCount: number;
    pulledCount: number;
  };
  transactions: {
    syncedCount: number;
    failedCount: number;
    skippedCount: number;
    dependencyBlockedCount: number;
    categoryBlockedCount: number;
    conflictCount: number;
    pulledCount?: number;
  };
  lenders: {
    syncedCount: number;
    failedCount: number;
    skippedCount: number;
    pulledCount?: number;
    conflictCount?: number;
  };
  borrowings: {
    syncedCount: number;
    failedCount: number;
    skippedCount: number;
    dependencyBlockedCount: number;
    pulledCount?: number;
    conflictCount?: number;
  };
  borrowing_repayments: {
    syncedCount: number;
    failedCount: number;
    skippedCount: number;
    dependencyBlockedCount: number;
    pulledCount?: number;
    conflictCount?: number;
  };
  recurring_rules?: {
    syncedCount: number;
    failedCount: number;
    skippedCount: number;
    dependencyBlockedCount: number;
    categoryBlockedCount: number;
  };
  recurring_occurrences?: {
    syncedCount: number;
    failedCount: number;
    skippedCount: number;
    dependencyBlockedCount: number;
  };
  notifications?: {
    syncedCount: number;
    failedCount: number;
    skippedCount: number;
    conflictCount: number;
    pulledCount: number;
  };
  notification_preferences?: {
    syncedCount: number;
    failedCount: number;
    skippedCount: number;
    conflictCount: number;
  };

  // Detailed errors
  errors: SyncErrorItem[];
}

const DEFAULT_SYNC_PAGE_SIZE = 100;
const MAX_SYNC_PAGES_PER_RUN = 1_000;

interface SyncRunRuntimeState {
  readonly userId: string;
  readonly mode: SyncExecutionMode;
  readonly respectRetryPolicy: boolean;
  authPaused: boolean;
}

/**
 * ManualSyncCoordinator
 *
 * Dedicated unified application-level coordinator for synchronization of pending
 * financial outbox entries in strict dependency order and bidirectional reconciliation:
 * Accounts -> Categories -> Budgets -> Transactions -> Lenders -> Borrowings (Inserts) -> Borrowing Repayments -> Borrowings (Updates) -> Budget Cloud Pull.
 *
 * Guarantees:
 * 1. Strict User Context: Requires authenticated user; rejects unauthenticated calls with SyncAuthError.
 * 2. Concurrency Safety: In-memory mutex + per-user Web Lock prevent concurrent sync or backup/restore operations across tabs.
 * 3. Strict Dependency Ordering:
 *    Accounts -> Categories -> Budgets -> Transactions -> Lenders -> Borrowings (Inserts) -> Borrowing Repayments -> Borrowings (Updates) -> Pull Reconciliation.
 * 4. Cross-Entity Dependency Failure Isolation:
 *    If an upstream entity (or a paused/failed entry) cannot synchronize, downstream dependent records are safely blocked and SKIPPED while remaining in the outbox.
 * 5. Cursor-Based Batch Pagination: Loads all pending outbox pages beyond 100 entries in FIFO id order without queue starvation.
 * 6. Retry & Error Classification: Applies bounded exponential backoff + jitter for transient failures, avoids tight retries on permanent errors, and pauses on auth failures until refresh.
 * 7. Dispatcher Acknowledgment: The coordinator never deletes outbox entries directly; dispatchers acknowledge solely after verified remote persistence.
 */
export class ManualSyncCoordinator implements BackupSyncActivityGuard {
  private isRunning = false;
  private exclusiveOperation: 'sync' | BackupExclusiveOperation | null = null;
  private readonly options: ManualSyncCoordinatorOptions;
  private readonly retryConfig: SyncRetryConfig;
  private readonly crossTabCoordinator: CrossTabSyncCoordinator;
  private readonly entryFailureState = new Map<string, OutboxFailureRuntimeState>();
  private readonly lifecycleListeners = new Set<(event: SyncCoordinatorLifecycleEvent) => void>();
  private authPausedUserId: string | null = null;
  private readonly accountReconciler?: AccountReconciliationService;
  private readonly categoryReconciler?: CategoryReconciliationService;
  private readonly transactionReconciler?: TransactionReconciliationService;
  private readonly borrowingsReconciler?: BorrowingsReconciliationService;

  constructor(
    private readonly accountDispatcher: AccountSyncDispatcher,
    private readonly transactionDispatcher: TransactionSyncDispatcher,
    private readonly outboxManager: OutboxManager,
    private readonly authPort: AuthPort,
    private readonly categoryDispatcher?: CategorySyncDispatcher,
    private readonly lenderDispatcher?: LenderSyncDispatcher,
    private readonly borrowingDispatcher?: BorrowingSyncDispatcher,
    private readonly borrowingRepaymentDispatcher?: BorrowingRepaymentSyncDispatcher,
    private readonly budgetDispatcher?: BudgetSyncDispatcher,
    private readonly budgetReconciler?: BudgetReconciliationService,
    private readonly recurringRuleDispatcher?: RecurringRuleSyncDispatcher,
    private readonly recurringOccurrenceDispatcher?: RecurringOccurrenceSyncDispatcher,
    private readonly recurringReconciler?: RecurringReconciliationService,
    private readonly notificationDispatcher?: NotificationSyncDispatcher,
    private readonly notificationPreferenceDispatcher?: NotificationPreferenceSyncDispatcher,
    private readonly notificationReconciler?: NotificationReconciliationService,
    options: ManualSyncCoordinatorOptions = {}
  ) {
    this.options = options;
    this.accountReconciler = options.accountReconciler;
    this.categoryReconciler = options.categoryReconciler;
    this.transactionReconciler = options.transactionReconciler;
    this.borrowingsReconciler = options.borrowingsReconciler;
    this.retryConfig = options.retryConfig ?? APP_CONFIG.sync;
    this.crossTabCoordinator = new CrossTabSyncCoordinator({
      lockProvider: options.webLockProvider,
      broadcastChannelFactory: options.broadcastChannelFactory,
      tabId: options.tabId
    });

    if (options.userId && options.onCrossTabEvent) {
      this.bindUserCrossTabChannel(options.userId);
    }
  }

  public isSyncRunning(): boolean {
    return this.isRunning;
  }

  public isOperationInProgress(): boolean {
    return this.isRunning || this.exclusiveOperation !== null;
  }

  public isAuthPaused(userId?: string): boolean {
    if (!this.authPausedUserId) {
      return false;
    }
    return userId ? this.authPausedUserId === userId : true;
  }

  /**
   * Returns in-memory retry/classification state recorded for a pending outbox entry.
   */
  public getEntryFailureState(
    entry: LocalOutboxRecord,
    userId: string = entry.userId
  ): OutboxFailureRuntimeState | undefined {
    return this.entryFailureState.get(this.getEntryStateKey(userId, entry));
  }

  /**
   * Resets remaining backoff timers for transient failures so synchronization
   * resumes promptly once network connectivity returns.
   */
  public notifyNetworkRecovered(userId?: string): void {
    const validatedPrefix = userId ? `${validateUserId(userId)}:` : null;
    for (const [key, state] of this.entryFailureState.entries()) {
      if (validatedPrefix && !key.startsWith(validatedPrefix)) {
        continue;
      }
      if (
        state.classification.disposition === 'transient' &&
        state.attempts < this.retryConfig.maxRetries
      ) {
        this.entryFailureState.set(key, {
          ...state,
          nextRetryAtMs: 0
        });
      }
    }
  }

  /**
   * Unpauses synchronization after authentication session refresh or sign-in.
   */
  public notifyAuthRefreshed(userId?: string): void {
    const validatedUserId = userId ? validateUserId(userId) : null;
    if (!validatedUserId || this.authPausedUserId === validatedUserId) {
      this.authPausedUserId = null;
    }

    const prefix = validatedUserId ? `${validatedUserId}:` : null;
    for (const [key, state] of this.entryFailureState.entries()) {
      if (prefix && !key.startsWith(prefix)) {
        continue;
      }
      if (state.classification.disposition === 'auth') {
        this.entryFailureState.delete(key);
      }
    }
  }

  /**
   * Explicitly retries all previously failed/paused entries without deleting or
   * recreating existing outbox records.
   */
  public async retryFailed(
    options: Omit<RunSyncOptions, 'retryFailed' | 'mode'> = {}
  ): Promise<UnifiedSyncResult> {
    this.authPausedUserId = null;
    this.entryFailureState.clear();
    return this.run({
      ...options,
      mode: 'manual',
      retryFailed: true
    });
  }

  /**
   * Subscribes to coordinator sync and exclusive-lock lifecycle transitions.
   */
  public subscribeLifecycle(listener: (event: SyncCoordinatorLifecycleEvent) => void): () => void {
    this.lifecycleListeners.add(listener);
    return () => {
      this.lifecycleListeners.delete(listener);
    };
  }

  private emitLifecycleEvent(event: SyncCoordinatorLifecycleEvent): void {
    for (const listener of Array.from(this.lifecycleListeners)) {
      try {
        listener(event);
      } catch (err) {
        console.error('ManualSyncCoordinator lifecycle listener failed:', err);
      }
    }
  }

  /**
   * Evaluates current pending outbox entries under Step 1 retry policy to expose
   * the earliest backoff retry timestamp for event-driven timer scheduling.
   */
  public async getRetryScheduleSummary(userId?: string): Promise<SyncRetryScheduleSummary> {
    const targetUserId = userId || (await this.authPort.getCurrentUser())?.id;
    if (!targetUserId) {
      return {
        pendingCount: 0,
        eligibleNowCount: 0,
        earliestRetryAtMs: null,
        hasPermanentOrExhaustedFailures: false,
        authPaused: false
      };
    }

    const validatedUserId = validateUserId(targetUserId);
    const pendingEntries = await this.getPendingEntries(validatedUserId);
    const authPaused = this.isAuthPaused(validatedUserId);
    const nowMs = this.getNowMs();

    let eligibleNowCount = 0;
    let earliestRetryAtMs: number | null = null;
    let hasPermanentOrExhaustedFailures = false;

    for (const entry of pendingEntries) {
      const decision = evaluateOutboxEntryEligibility({
        entry,
        runtimeState: this.entryFailureState.get(this.getEntryStateKey(validatedUserId, entry)),
        authPaused,
        respectRetryPolicy: true,
        config: this.retryConfig,
        nowMs
      });

      if (decision.eligible) {
        eligibleNowCount++;
      } else if (decision.reason === 'backoff_active' && decision.nextRetryAtMs !== undefined) {
        if (earliestRetryAtMs === null || decision.nextRetryAtMs < earliestRetryAtMs) {
          earliestRetryAtMs = decision.nextRetryAtMs;
        }
      } else if (
        decision.reason === 'permanent_failure' ||
        decision.reason === 'max_retries_exhausted'
      ) {
        hasPermanentOrExhaustedFailures = true;
      }
    }

    return {
      pendingCount: pendingEntries.length,
      eligibleNowCount,
      earliestRetryAtMs,
      hasPermanentOrExhaustedFailures,
      authPaused
    };
  }

  /**
   * Closes cross-tab coordination resources when tearing down user repositories.
   */
  public dispose(): void {
    this.lifecycleListeners.clear();
    this.crossTabCoordinator.dispose();
  }

  /**
   * Executes a backup or restore critical section under the same exclusive operation
   * mutex and per-user cross-tab Web Lock used by manual cloud sync, guaranteeing release in `finally`.
   */
  public async runExclusive<T>(
    operation: BackupExclusiveOperation,
    work: () => Promise<T>,
    options: ExclusiveOperationOptions = {}
  ): Promise<T> {
    if (this.isSyncRunning() || this.exclusiveOperation !== null) {
      throw new BackupSyncConflictError(
        this.isSyncRunning()
          ? 'Backup and restore operations cannot run while manual synchronization is in progress.'
          : 'Another backup or restore operation is already in progress.'
      );
    }

    const broadcastRestoreCompleted = options.broadcastRestoreCompleted ?? true;
    let succeeded = false;
    this.exclusiveOperation = operation;
    this.emitLifecycleEvent({ type: 'exclusiveStarted', operation });
    try {
      const currentUser = await this.authPort.getCurrentUser();
      if (!currentUser || !currentUser.id) {
        const result = await work();
        succeeded = true;
        return result;
      }

      let validatedUserId: string;
      try {
        validatedUserId = validateUserId(currentUser.id);
      } catch {
        const result = await work();
        succeeded = true;
        return result;
      }

      const result = await this.crossTabCoordinator.runWithExclusiveLock({
        userId: validatedUserId,
        ifAvailable: true,
        onContention: () => {
          throw new BackupSyncConflictError(
            'Backup and restore cannot start while another tab is running synchronization or backup/restore.'
          );
        },
        work: async () => {
          if (this.options.sessionCheck && !this.options.sessionCheck()) {
            throw new BackupSyncConflictError(
              'Backup and restore aborted because the active session changed.'
            );
          }

          const output = await work();

          if (operation === 'restore' && broadcastRestoreCompleted) {
            this.bindUserCrossTabChannel(validatedUserId);
            this.crossTabCoordinator.broadcast({
              type: 'restoreCompleted',
              userId: validatedUserId,
              sessionGeneration: this.options.sessionGeneration ?? 1
            });
          }

          return output;
        }
      });
      succeeded = true;
      return result;
    } finally {
      this.exclusiveOperation = null;
      this.emitLifecycleEvent({
        type: 'exclusiveEnded',
        operation,
        succeeded,
        mayHaveMutatedOutbox: operation === 'restore' && broadcastRestoreCompleted
      });
    }
  }

  private isCoordinatedEntity(entry: LocalOutboxRecord): boolean {
    if (entry.entity === 'accounts' || entry.entity === 'transactions') return true;
    if (entry.entity === 'categories' && this.categoryDispatcher) return true;
    if (entry.entity === 'budgets' && this.budgetDispatcher) return true;
    if (entry.entity === 'recurring_rules' && this.recurringRuleDispatcher) return true;
    if (entry.entity === 'recurring_occurrences' && this.recurringOccurrenceDispatcher) return true;
    if (entry.entity === 'notifications' && this.notificationDispatcher) return true;
    if (entry.entity === 'notification_preferences' && this.notificationPreferenceDispatcher) {
      return true;
    }
    if (entry.entity === 'lenders' && this.lenderDispatcher) return true;
    if (entry.entity === 'borrowings' && this.borrowingDispatcher) return true;
    if (entry.entity === 'borrowing_repayments' && this.borrowingRepaymentDispatcher) return true;
    return false;
  }

  /**
   * Retrieves pending outbox records for coordinated entities.
   * Scoped to the authenticated user; paginates all pages when limit is omitted.
   */
  public async getPendingEntries(userId?: string, limit?: number): Promise<LocalOutboxRecord[]> {
    const targetUserId = userId || (await this.authPort.getCurrentUser())?.id;
    if (!targetUserId) {
      return [];
    }
    const allPending =
      limit !== undefined
        ? await this.outboxManager.getPendingEntries(targetUserId, limit)
        : (await this.loadAllPendingEntries(targetUserId, DEFAULT_SYNC_PAGE_SIZE)).entries;

    return allPending.filter((entry) => this.isCoordinatedEntity(entry));
  }

  /**
   * Retrieves the count of pending outbox records for coordinated entities.
   * Scoped to the authenticated user.
   */
  public async getPendingCount(userId?: string): Promise<number> {
    const targetUserId = userId || (await this.authPort.getCurrentUser())?.id;
    if (!targetUserId) {
      return 0;
    }
    const entries = await this.getPendingEntries(targetUserId);
    return entries.length;
  }

  /**
   * Executes unified synchronization of pending outbox records across all pages.
   */
  public async run(limitOrOptions?: number | RunSyncOptions): Promise<UnifiedSyncResult> {
    const runOptions = this.normalizeRunOptions(limitOrOptions);

    if (this.isRunning || this.exclusiveOperation !== null) {
      if (runOptions.mode === 'background') {
        return this.createEmptyResult({ skippedLockContention: true });
      }
      throw new SyncInProgressError(
        this.exclusiveOperation && this.exclusiveOperation !== 'sync'
          ? 'Synchronization cannot start while a backup or restore operation is in progress.'
          : undefined
      );
    }

    this.isRunning = true;
    this.exclusiveOperation = 'sync';
    let resolvedUserId: string | undefined;
    let completedResult: UnifiedSyncResult | null = null;
    let caughtError: unknown = null;
    let hasCaughtError = false;

    try {
      if (this.options.sessionCheck && !this.options.sessionCheck()) {
        throw new SyncAuthError('Manual sync rejected: Database session is no longer active.');
      }

      // 1. Guard authenticated session
      const currentUser = await this.authPort.getCurrentUser();
      if (!currentUser || !currentUser.id) {
        throw new SyncAuthError('Manual sync rejected: User is not authenticated.');
      }
      const validatedUserId = validateUserId(currentUser.id);
      resolvedUserId = validatedUserId;

      if (this.options.sessionCheck && !this.options.sessionCheck()) {
        throw new SyncAuthError('Manual sync rejected: Active database session changed.');
      }

      if (runOptions.mode === 'background' && this.authPausedUserId === validatedUserId) {
        const stillPendingCount = await this.outboxManager.getPendingCount(validatedUserId);
        completedResult = this.createEmptyResult({
          stillPendingCount,
          skippedAuthPaused: true,
          authPaused: true
        });
        return completedResult;
      }

      completedResult = await this.crossTabCoordinator.runWithExclusiveLock({
        userId: validatedUserId,
        ifAvailable: true,
        onContention: async () => {
          if (runOptions.mode === 'background') {
            const stillPendingCount = await this.outboxManager.getPendingCount(validatedUserId);
            return this.createEmptyResult({
              stillPendingCount,
              skippedLockContention: true
            });
          }
          throw new SyncInProgressError(
            'Another tab is already running synchronization or backup/restore for this account.'
          );
        },
        work: async () => {
          if (this.options.sessionCheck && !this.options.sessionCheck()) {
            throw new SyncAuthError(
              'Manual sync rejected: Active database session changed while waiting for lock.'
            );
          }

          this.bindUserCrossTabChannel(validatedUserId);
          const sessionGeneration = this.options.sessionGeneration ?? 1;

          this.emitLifecycleEvent({
            type: 'syncStarted',
            mode: runOptions.mode,
            userId: validatedUserId
          });

          this.crossTabCoordinator.broadcast({
            type: 'syncStarted',
            userId: validatedUserId,
            sessionGeneration
          });

          const result = await this.executeSyncPipeline(validatedUserId, runOptions);

          this.crossTabCoordinator.broadcast({
            type: 'syncCompleted',
            userId: validatedUserId,
            sessionGeneration,
            syncedCount: result.syncedCount,
            pulledCount: result.pulledCount,
            failedCount: result.failedCount
          });

          return result;
        }
      });

      return completedResult;
    } catch (error) {
      hasCaughtError = true;
      caughtError = error;
      throw error;
    } finally {
      this.exclusiveOperation = null;
      this.isRunning = false;

      if (hasCaughtError) {
        this.emitLifecycleEvent({
          type: 'syncFailed',
          mode: runOptions.mode,
          userId: resolvedUserId,
          error: caughtError
        });
      } else if (completedResult && resolvedUserId) {
        this.emitLifecycleEvent({
          type: 'syncCompleted',
          mode: runOptions.mode,
          userId: resolvedUserId,
          result: completedResult
        });
      }
    }
  }

  private async executeSyncPipeline(
    userId: string,
    runOptions: Required<Pick<RunSyncOptions, 'mode' | 'pageSize' | 'retryFailed'>> & {
      limit?: number;
    }
  ): Promise<UnifiedSyncResult> {
    const result = this.createEmptyResult();
    const respectRetryPolicy = runOptions.mode === 'background' || runOptions.retryFailed === false;
    const runState: SyncRunRuntimeState = {
      userId,
      mode: runOptions.mode,
      respectRetryPolicy,
      authPaused: runOptions.mode === 'background' && this.authPausedUserId === userId
    };

    // Track pre-existing conflicts (e.g. unsafe Personal Borrowings identity divergence) so
    // outbox pushes for blocked accounts and their dependents are quarantined safely.
    const preBlockedAccountIds = new Set<string>();

    // -----------------------------------------------------------------------
    // STAGE 0: PRE-PUSH IDENTITY RESOLUTION
    // Resolve default category identity mappings and canonical Personal Borrowings
    // account UUID before loading outbox entries so dependent pushes use valid mappings.
    // -----------------------------------------------------------------------
    if (!runState.authPaused && this.categoryReconciler) {
      try {
        const catIdentity = await this.categoryReconciler.resolveDefaultCategoryIdentities(userId);
        result.pulledCount += catIdentity.pulledCount;
        result.categories.pulledCount =
          (result.categories.pulledCount ?? 0) + catIdentity.pulledCount;
        result.categories.mappedCount =
          (result.categories.mappedCount ?? 0) + catIdentity.mappedCount;
        result.categories.conflictCount =
          (result.categories.conflictCount ?? 0) + catIdentity.conflictCount;
        for (const conflict of catIdentity.conflicts) {
          this.appendConflictErrorIfUnique(
            result,
            'categories',
            conflict.categoryId,
            conflict.reason,
            () => {
              // Count already tracked in catIdentity.conflictCount above
            }
          );
        }
      } catch (error) {
        this.handleReconcilerFailure(result, result.categories, 'categories', error, runState);
      }
    }

    if (!runState.authPaused && this.accountReconciler) {
      try {
        const pbIdentity =
          await this.accountReconciler.reconcilePersonalBorrowingsIdentity(userId);
        result.pulledCount += pbIdentity.pulledCount;
        result.accounts.pulledCount =
          (result.accounts.pulledCount ?? 0) + pbIdentity.pulledCount;
        result.accounts.conflictCount =
          (result.accounts.conflictCount ?? 0) + pbIdentity.conflictCount;
        if (pbIdentity.remappedFromAccountId) {
          result.accounts.remappedCount = (result.accounts.remappedCount ?? 0) + 1;
        }
        for (const blockedId of pbIdentity.blockedAccountIds) {
          preBlockedAccountIds.add(blockedId);
        }
        for (const conflict of pbIdentity.conflicts) {
          this.appendConflictErrorIfUnique(result, 'accounts', conflict.accountId, conflict.reason);
        }
      } catch (error) {
        this.handleReconcilerFailure(result, result.accounts, 'accounts', error, runState);
      }
    }

    // 2. Fetch pending entries via cursor pagination ordered by id (FIFO outbox order)
    const { entries: pendingEntries, pagesProcessed } = await this.loadAllPendingEntries(
      userId,
      runOptions.pageSize,
      runOptions.limit
    );
    result.totalPending = pendingEntries.length;
    result.pagesProcessed = pagesProcessed;

    // Group entries preserving FIFO within each group
    const accountEntries: LocalOutboxRecord[] = [];
    const categoryEntries: LocalOutboxRecord[] = [];
    const budgetEntries: LocalOutboxRecord[] = [];
    const transactionEntries: LocalOutboxRecord[] = [];
    const recurringRuleInsertEntries: LocalOutboxRecord[] = [];
    const recurringRuleUpdateEntries: LocalOutboxRecord[] = [];
    const recurringRuleDeleteEntries: LocalOutboxRecord[] = [];
    const recurringOccurrenceEntries: LocalOutboxRecord[] = [];
    const lenderEntries: LocalOutboxRecord[] = [];
    const borrowingInsertEntries: LocalOutboxRecord[] = [];
    const borrowingUpdateEntries: LocalOutboxRecord[] = [];
    const repaymentEntries: LocalOutboxRecord[] = [];
    const notificationEntries: LocalOutboxRecord[] = [];
    const notificationPreferenceEntries: LocalOutboxRecord[] = [];
    const unsupportedEntries: LocalOutboxRecord[] = [];

    for (const entry of pendingEntries) {
      if (entry.entity === 'accounts') {
        accountEntries.push(entry);
      } else if (entry.entity === 'categories' && this.categoryDispatcher) {
        categoryEntries.push(entry);
      } else if (entry.entity === 'budgets' && this.budgetDispatcher) {
        budgetEntries.push(entry);
      } else if (entry.entity === 'transactions') {
        transactionEntries.push(entry);
      } else if (entry.entity === 'recurring_rules' && this.recurringRuleDispatcher) {
        if (entry.operation === 'INSERT') {
          recurringRuleInsertEntries.push(entry);
        } else if (entry.operation === 'UPDATE') {
          recurringRuleUpdateEntries.push(entry);
        } else {
          recurringRuleDeleteEntries.push(entry);
        }
      } else if (entry.entity === 'recurring_occurrences' && this.recurringOccurrenceDispatcher) {
        recurringOccurrenceEntries.push(entry);
      } else if (entry.entity === 'lenders' && this.lenderDispatcher) {
        lenderEntries.push(entry);
      } else if (entry.entity === 'borrowings' && this.borrowingDispatcher) {
        if (entry.operation === 'INSERT') {
          borrowingInsertEntries.push(entry);
        } else {
          borrowingUpdateEntries.push(entry);
        }
      } else if (entry.entity === 'borrowing_repayments' && this.borrowingRepaymentDispatcher) {
        repaymentEntries.push(entry);
      } else if (entry.entity === 'notifications' && this.notificationDispatcher) {
        notificationEntries.push(entry);
      } else if (
        entry.entity === 'notification_preferences' &&
        this.notificationPreferenceDispatcher
      ) {
        notificationPreferenceEntries.push(entry);
      } else {
        unsupportedEntries.push(entry);
      }
    }

    result.unsupportedCount = unsupportedEntries.length;

    // Tracking sets for cascading dependency failure isolation
    const failedAccountIds = new Set<string>(preBlockedAccountIds);
    const failedCategoryIds = new Set<string>();
    const failedBudgetIds = new Set<string>();
    const failedBudgetSlots = new Set<string>();
    const failedTransactionIds = new Set<string>();
    const failedRecurringRuleIds = new Set<string>();
    const failedRecurringOccurrenceIds = new Set<string>();
    const rulesWithFailedOccurrences = new Set<string>();
    const failedLenderIds = new Set<string>();
    const failedBorrowingIds = new Set<string>();
    const borrowingsWithFailedRepayments = new Set<string>();
    const failedNotificationIds = new Set<string>();
    const failedNotificationDedupeKeys = new Set<string>();
    let hasFailedPreference = false;

    // -----------------------------------------------------------------------
    // STAGE 1: ACCOUNTS
    // -----------------------------------------------------------------------
    for (const entry of accountEntries) {
      const accountId = entry.entityId;

      if (failedAccountIds.has(accountId)) {
        result.skippedCount++;
        result.accounts.skippedCount++;
        continue;
      }

      const eligibility = this.evaluateEntryForStage(entry, runState);
      if (!eligibility.eligible) {
        this.recordEligibilitySkip(result, eligibility, result.accounts);
        failedAccountIds.add(accountId);
        continue;
      }

      result.totalProcessed++;

      try {
        await this.accountDispatcher.dispatch(entry);
        this.clearEntryFailureState(userId, entry);
        result.syncedCount++;
        result.accounts.syncedCount++;
      } catch (error) {
        failedAccountIds.add(accountId);
        this.handleDispatchFailure(result, result.accounts, 'accounts', accountId, entry, error, runState);
      }
    }

    // -----------------------------------------------------------------------
    // STAGE 2: CATEGORIES (Accounts -> Categories -> Transactions)
    // -----------------------------------------------------------------------
    for (const entry of categoryEntries) {
      const categoryId = entry.entityId;

      if (failedCategoryIds.has(categoryId)) {
        result.skippedCount++;
        result.categories.skippedCount++;
        continue;
      }

      const eligibility = this.evaluateEntryForStage(entry, runState);
      if (!eligibility.eligible) {
        this.recordEligibilitySkip(result, eligibility, result.categories);
        failedCategoryIds.add(categoryId);
        continue;
      }

      result.totalProcessed++;

      try {
        if (!this.categoryDispatcher) {
          throw new Error('CategorySyncDispatcher is not configured.');
        }
        await this.categoryDispatcher.dispatch(entry);
        this.clearEntryFailureState(userId, entry);
        result.syncedCount++;
        result.categories.syncedCount++;
      } catch (error) {
        failedCategoryIds.add(categoryId);
        this.handleDispatchFailure(
          result,
          result.categories,
          'categories',
          categoryId,
          entry,
          error,
          runState
        );
      }
    }

    // -----------------------------------------------------------------------
    // STAGE 3: BUDGETS (depends on Categories; preserves FIFO per budget ID & slot)
    // -----------------------------------------------------------------------
    for (const entry of budgetEntries) {
      const budgetId = entry.entityId;
      const rawUserId = entry.payload?.user_id ?? entry.payload?.userId;
      const slotUserId =
        typeof rawUserId === 'string' && rawUserId.trim().length > 0
          ? rawUserId.trim()
          : userId;
      const rawCategory = entry.payload?.category_id ?? entry.payload?.categoryId;
      const rawPeriod = entry.payload?.period;
      const slotKey =
        typeof rawCategory === 'string' &&
        rawCategory.trim().length > 0 &&
        typeof rawPeriod === 'string' &&
        rawPeriod.trim().length > 0
          ? `${slotUserId}:${rawCategory.trim()}:${rawPeriod.trim()}`
          : null;

      // Enforce strict FIFO on same budgetId AND on deleted-then-recreated (user, category, period) slot
      if (failedBudgetIds.has(budgetId) || (slotKey !== null && failedBudgetSlots.has(slotKey))) {
        result.skippedCount++;
        result.budgets.skippedCount++;
        failedBudgetIds.add(budgetId);
        continue;
      }

      const eligibility = this.evaluateEntryForStage(entry, runState);
      if (!eligibility.eligible) {
        this.recordEligibilitySkip(result, eligibility, result.budgets);
        failedBudgetIds.add(budgetId);
        if (slotKey) {
          failedBudgetSlots.add(slotKey);
        }
        continue;
      }

      // Category dependency check: INSERT depends on upstream Category identity sync in Stage 2
      if (
        entry.operation === 'INSERT' &&
        typeof rawCategory === 'string' &&
        failedCategoryIds.has(rawCategory.trim())
      ) {
        result.failedCount++;
        result.budgets.failedCount++;
        result.budgets.categoryBlockedCount++;
        failedBudgetIds.add(budgetId);
        if (slotKey) {
          failedBudgetSlots.add(slotKey);
        }

        const errorMsg = `Cannot sync budget '${budgetId}': referenced category '${rawCategory}' failed synchronization.`;
        result.errors.push({
          entity: 'budgets',
          entityId: budgetId,
          outboxId: entry.id,
          error: errorMsg,
          category: 'category',
          disposition: 'permanent',
          errorClass: 'dependency',
          retryable: false
        });
        continue;
      }

      result.totalProcessed++;

      try {
        if (!this.budgetDispatcher) {
          throw new Error('BudgetSyncDispatcher is not configured.');
        }
        await this.budgetDispatcher.dispatch(entry);
        this.clearEntryFailureState(userId, entry);
        result.syncedCount++;
        result.budgets.syncedCount++;
      } catch (error) {
        failedBudgetIds.add(budgetId);
        if (slotKey) {
          failedBudgetSlots.add(slotKey);
        }

        if (error instanceof SyncUnresolvedCategoryError) {
          result.budgets.categoryBlockedCount++;
        } else if (error instanceof SyncConflictError) {
          result.budgets.conflictCount++;
        }

        this.handleDispatchFailure(result, result.budgets, 'budgets', budgetId, entry, error, runState);
      }
    }

    // -----------------------------------------------------------------------
    // STAGE 4: TRANSACTIONS
    // -----------------------------------------------------------------------
    for (const entry of transactionEntries) {
      const transactionId = entry.entityId;

      if (failedTransactionIds.has(transactionId)) {
        result.skippedCount++;
        result.transactions.skippedCount++;
        continue;
      }

      const eligibility = this.evaluateEntryForStage(entry, runState);
      if (!eligibility.eligible) {
        this.recordEligibilitySkip(result, eligibility, result.transactions);
        failedTransactionIds.add(transactionId);
        continue;
      }

      // Account dependency check: source or destination account failed in Stage 1
      const sourceAcc = entry.payload.account_id ?? entry.payload.accountId;
      const destAcc = entry.payload.destination_account_id ?? entry.payload.destinationAccountId;
      if (
        (sourceAcc && failedAccountIds.has(String(sourceAcc))) ||
        (destAcc && failedAccountIds.has(String(destAcc)))
      ) {
        result.failedCount++;
        result.transactions.failedCount++;
        result.transactions.dependencyBlockedCount++;
        failedTransactionIds.add(transactionId);

        const failedAccId = sourceAcc && failedAccountIds.has(String(sourceAcc)) ? sourceAcc : destAcc;
        const errorMsg = `Cannot sync transaction '${transactionId}': referenced account '${failedAccId}' failed synchronization.`;
        result.errors.push({
          entity: 'transactions',
          entityId: transactionId,
          outboxId: entry.id,
          error: errorMsg,
          category: 'dependency',
          disposition: 'permanent',
          errorClass: 'dependency',
          retryable: false
        });
        continue;
      }

      // Category dependency check: category failed in Stage 2
      const rawCategory = entry.payload.category_id ?? entry.payload.categoryId;
      if (
        rawCategory !== null &&
        rawCategory !== undefined &&
        failedCategoryIds.has(String(rawCategory))
      ) {
        result.failedCount++;
        result.transactions.failedCount++;
        result.transactions.categoryBlockedCount++;
        failedTransactionIds.add(transactionId);

        const errorMsg = `Cannot sync transaction '${transactionId}': referenced category '${rawCategory}' failed synchronization.`;
        result.errors.push({
          entity: 'transactions',
          entityId: transactionId,
          outboxId: entry.id,
          error: errorMsg,
          category: 'category',
          disposition: 'permanent',
          errorClass: 'dependency',
          retryable: false
        });
        continue;
      }

      result.totalProcessed++;

      try {
        await this.transactionDispatcher.dispatch(entry);
        this.clearEntryFailureState(userId, entry);
        result.syncedCount++;
        result.transactions.syncedCount++;
      } catch (error) {
        failedTransactionIds.add(transactionId);

        if (error instanceof SyncAccountDependencyError) {
          result.transactions.dependencyBlockedCount++;
        } else if (error instanceof SyncUnresolvedCategoryError) {
          result.transactions.categoryBlockedCount++;
        } else if (error instanceof SyncConflictError) {
          result.transactions.conflictCount++;
        }

        this.handleDispatchFailure(
          result,
          result.transactions,
          'transactions',
          transactionId,
          entry,
          error,
          runState
        );
      }
    }

    // -----------------------------------------------------------------------
    // STAGE 3B: RECURRING RULES (INSERTS -> UPDATES)
    // Must precede Stage 3C (Occurrences) so FK and active schedule invariants pass.
    // -----------------------------------------------------------------------
    for (const entry of [...recurringRuleInsertEntries, ...recurringRuleUpdateEntries]) {
      const ruleId = entry.entityId;
      if (failedRecurringRuleIds.has(ruleId)) {
        result.skippedCount++;
        result.recurring_rules!.skippedCount++;
        continue;
      }

      const eligibility = this.evaluateEntryForStage(entry, runState);
      if (!eligibility.eligible) {
        this.recordEligibilitySkip(result, eligibility, result.recurring_rules!);
        failedRecurringRuleIds.add(ruleId);
        continue;
      }

      const accId = entry.payload.account_id ?? entry.payload.accountId;
      if (accId && failedAccountIds.has(String(accId))) {
        result.failedCount++;
        result.recurring_rules!.failedCount++;
        result.recurring_rules!.dependencyBlockedCount++;
        failedRecurringRuleIds.add(ruleId);
        result.errors.push({
          entity: 'recurring_rules',
          entityId: ruleId,
          outboxId: entry.id,
          error: `Cannot sync recurring rule '${ruleId}': referenced account '${accId}' failed synchronization.`,
          category: 'dependency',
          disposition: 'permanent',
          errorClass: 'dependency',
          retryable: false
        });
        continue;
      }

      const catId = entry.payload.category_id ?? entry.payload.categoryId;
      if (catId && failedCategoryIds.has(String(catId))) {
        result.failedCount++;
        result.recurring_rules!.failedCount++;
        result.recurring_rules!.categoryBlockedCount++;
        failedRecurringRuleIds.add(ruleId);
        result.errors.push({
          entity: 'recurring_rules',
          entityId: ruleId,
          outboxId: entry.id,
          error: `Cannot sync recurring rule '${ruleId}': referenced category '${catId}' failed synchronization.`,
          category: 'category',
          disposition: 'permanent',
          errorClass: 'dependency',
          retryable: false
        });
        continue;
      }

      result.totalProcessed++;
      try {
        await this.recurringRuleDispatcher!.dispatch(entry);
        this.clearEntryFailureState(userId, entry);
        result.syncedCount++;
        result.recurring_rules!.syncedCount++;
      } catch (error) {
        failedRecurringRuleIds.add(ruleId);
        this.handleDispatchFailure(
          result,
          result.recurring_rules!,
          'recurring_rules',
          ruleId,
          entry,
          error,
          runState
        );
      }
    }

    // -----------------------------------------------------------------------
    // STAGE 3C: RECURRING OCCURRENCES (INSERTS & UPDATES)
    // Must follow Rule INSERTS/UPDATES and Transactions, and precede Rule DELETES
    // so offline create -> confirm -> delete sequences synchronize cleanly.
    // -----------------------------------------------------------------------
    for (const entry of recurringOccurrenceEntries) {
      const occId = entry.entityId;
      const ruleId = String(entry.payload.recurring_rule_id ?? entry.payload.recurringRuleId ?? '');

      if (failedRecurringOccurrenceIds.has(occId)) {
        result.skippedCount++;
        result.recurring_occurrences!.skippedCount++;
        if (ruleId) rulesWithFailedOccurrences.add(ruleId);
        continue;
      }

      const eligibility = this.evaluateEntryForStage(entry, runState);
      if (!eligibility.eligible) {
        this.recordEligibilitySkip(result, eligibility, result.recurring_occurrences!);
        failedRecurringOccurrenceIds.add(occId);
        if (ruleId) rulesWithFailedOccurrences.add(ruleId);
        continue;
      }

      if (ruleId && failedRecurringRuleIds.has(ruleId)) {
        result.failedCount++;
        result.recurring_occurrences!.failedCount++;
        result.recurring_occurrences!.dependencyBlockedCount++;
        failedRecurringOccurrenceIds.add(occId);
        rulesWithFailedOccurrences.add(ruleId);
        result.errors.push({
          entity: 'recurring_occurrences',
          entityId: occId,
          outboxId: entry.id,
          error: `Cannot sync occurrence '${occId}': recurring schedule '${ruleId}' failed synchronization.`,
          category: 'dependency',
          disposition: 'permanent',
          errorClass: 'dependency',
          retryable: false
        });
        continue;
      }

      const txId = entry.payload.transaction_id ?? entry.payload.transactionId;
      if (txId && failedTransactionIds.has(String(txId))) {
        result.failedCount++;
        result.recurring_occurrences!.failedCount++;
        result.recurring_occurrences!.dependencyBlockedCount++;
        failedRecurringOccurrenceIds.add(occId);
        if (ruleId) rulesWithFailedOccurrences.add(ruleId);
        result.errors.push({
          entity: 'recurring_occurrences',
          entityId: occId,
          outboxId: entry.id,
          error: `Cannot sync occurrence '${occId}': generated transaction '${txId}' failed synchronization.`,
          category: 'dependency',
          disposition: 'permanent',
          errorClass: 'dependency',
          retryable: false
        });
        continue;
      }

      result.totalProcessed++;
      try {
        await this.recurringOccurrenceDispatcher!.dispatch(entry);
        this.clearEntryFailureState(userId, entry);
        result.syncedCount++;
        result.recurring_occurrences!.syncedCount++;
      } catch (error) {
        failedRecurringOccurrenceIds.add(occId);
        if (ruleId) rulesWithFailedOccurrences.add(ruleId);
        this.handleDispatchFailure(
          result,
          result.recurring_occurrences!,
          'recurring_occurrences',
          occId,
          entry,
          error,
          runState
        );
      }
    }

    // -----------------------------------------------------------------------
    // STAGE 3D: RECURRING RULES (DELETES / TOMBSTONES)
    // Executed after Stage 3C so any pending occurrences settle before rule tombstone.
    // Also defers deletion if any occurrence for the rule failed in Stage 3C.
    // -----------------------------------------------------------------------
    for (const entry of recurringRuleDeleteEntries) {
      const ruleId = entry.entityId;
      if (failedRecurringRuleIds.has(ruleId) || rulesWithFailedOccurrences.has(ruleId)) {
        result.skippedCount++;
        result.recurring_rules!.skippedCount++;
        if (rulesWithFailedOccurrences.has(ruleId)) {
          result.recurring_rules!.dependencyBlockedCount++;
        }
        continue;
      }

      const eligibility = this.evaluateEntryForStage(entry, runState);
      if (!eligibility.eligible) {
        this.recordEligibilitySkip(result, eligibility, result.recurring_rules!);
        failedRecurringRuleIds.add(ruleId);
        continue;
      }

      result.totalProcessed++;
      try {
        await this.recurringRuleDispatcher!.dispatch(entry);
        this.clearEntryFailureState(userId, entry);
        result.syncedCount++;
        result.recurring_rules!.syncedCount++;
      } catch (error) {
        failedRecurringRuleIds.add(ruleId);
        this.handleDispatchFailure(
          result,
          result.recurring_rules!,
          'recurring_rules',
          ruleId,
          entry,
          error,
          runState
        );
      }
    }

    // -----------------------------------------------------------------------
    // STAGE 4: LENDERS
    // -----------------------------------------------------------------------
    for (const entry of lenderEntries) {
      const lenderId = entry.entityId;

      if (failedLenderIds.has(lenderId)) {
        result.skippedCount++;
        result.lenders.skippedCount++;
        continue;
      }

      const eligibility = this.evaluateEntryForStage(entry, runState);
      if (!eligibility.eligible) {
        this.recordEligibilitySkip(result, eligibility, result.lenders);
        failedLenderIds.add(lenderId);
        continue;
      }

      result.totalProcessed++;

      try {
        if (!this.lenderDispatcher) {
          throw new Error('LenderSyncDispatcher is not configured.');
        }
        await this.lenderDispatcher.dispatch(entry);
        this.clearEntryFailureState(userId, entry);
        result.syncedCount++;
        result.lenders.syncedCount++;
      } catch (error) {
        failedLenderIds.add(lenderId);
        this.handleDispatchFailure(result, result.lenders, 'lenders', lenderId, entry, error, runState);
      }
    }

    // -----------------------------------------------------------------------
    // STAGE 5: BORROWINGS (INSERTS)
    // Must precede Repayments (Stage 6) so foreign keys on borrowing_id are satisfied
    // -----------------------------------------------------------------------
    for (const entry of borrowingInsertEntries) {
      const borrowingId = entry.entityId;

      if (failedBorrowingIds.has(borrowingId)) {
        result.skippedCount++;
        result.borrowings.skippedCount++;
        continue;
      }

      const eligibility = this.evaluateEntryForStage(entry, runState);
      if (!eligibility.eligible) {
        this.recordEligibilitySkip(result, eligibility, result.borrowings);
        failedBorrowingIds.add(borrowingId);
        continue;
      }

      // Dependency validation against upstream failures
      const lenderId = String(entry.payload.lender_id ?? entry.payload.lenderId ?? '');
      const receivingAccountId = String(
        entry.payload.receiving_account_id ?? entry.payload.receivingAccountId ?? ''
      );
      const transactionId = String(
        entry.payload.transaction_id ?? entry.payload.transactionId ?? ''
      );

      if (lenderId && failedLenderIds.has(lenderId)) {
        result.failedCount++;
        result.borrowings.failedCount++;
        result.borrowings.dependencyBlockedCount++;
        failedBorrowingIds.add(borrowingId);

        result.errors.push({
          entity: 'borrowings',
          entityId: borrowingId,
          outboxId: entry.id,
          error: `Cannot sync borrowing '${borrowingId}': referenced lender '${lenderId}' failed synchronization.`,
          category: 'dependency',
          disposition: 'permanent',
          errorClass: 'dependency',
          retryable: false
        });
        continue;
      }

      if (receivingAccountId && failedAccountIds.has(receivingAccountId)) {
        result.failedCount++;
        result.borrowings.failedCount++;
        result.borrowings.dependencyBlockedCount++;
        failedBorrowingIds.add(borrowingId);

        result.errors.push({
          entity: 'borrowings',
          entityId: borrowingId,
          outboxId: entry.id,
          error: `Cannot sync borrowing '${borrowingId}': referenced receiving account '${receivingAccountId}' failed synchronization.`,
          category: 'dependency',
          disposition: 'permanent',
          errorClass: 'dependency',
          retryable: false
        });
        continue;
      }

      if (transactionId && failedTransactionIds.has(transactionId)) {
        result.failedCount++;
        result.borrowings.failedCount++;
        result.borrowings.dependencyBlockedCount++;
        failedBorrowingIds.add(borrowingId);

        result.errors.push({
          entity: 'borrowings',
          entityId: borrowingId,
          outboxId: entry.id,
          error: `Cannot sync borrowing '${borrowingId}': referenced transfer transaction '${transactionId}' failed synchronization.`,
          category: 'dependency',
          disposition: 'permanent',
          errorClass: 'dependency',
          retryable: false
        });
        continue;
      }

      result.totalProcessed++;

      try {
        if (!this.borrowingDispatcher) {
          throw new Error('BorrowingSyncDispatcher is not configured.');
        }
        await this.borrowingDispatcher.dispatch(entry);
        this.clearEntryFailureState(userId, entry);
        result.syncedCount++;
        result.borrowings.syncedCount++;
      } catch (error) {
        failedBorrowingIds.add(borrowingId);

        if (
          error instanceof SyncAccountDependencyError ||
          error instanceof SyncLenderDependencyError ||
          error instanceof SyncTransactionDependencyError
        ) {
          result.borrowings.dependencyBlockedCount++;
        }

        this.handleDispatchFailure(
          result,
          result.borrowings,
          'borrowings',
          borrowingId,
          entry,
          error,
          runState
        );
      }
    }

    // -----------------------------------------------------------------------
    // STAGE 6: BORROWING REPAYMENTS
    // -----------------------------------------------------------------------
    for (const entry of repaymentEntries) {
      const repaymentId = entry.entityId;

      // Dependency validation against upstream failures
      const borrowingId = String(entry.payload.borrowing_id ?? entry.payload.borrowingId ?? '');
      const lenderId = String(entry.payload.lender_id ?? entry.payload.lenderId ?? '');
      const paymentAccountId = String(
        entry.payload.payment_account_id ?? entry.payload.paymentAccountId ?? ''
      );
      const transactionId = String(
        entry.payload.transaction_id ?? entry.payload.transactionId ?? ''
      );

      const eligibility = this.evaluateEntryForStage(entry, runState);
      if (!eligibility.eligible) {
        this.recordEligibilitySkip(result, eligibility, result.borrowing_repayments);
        if (borrowingId) borrowingsWithFailedRepayments.add(borrowingId);
        continue;
      }

      if (borrowingId && failedBorrowingIds.has(borrowingId)) {
        result.failedCount++;
        result.borrowing_repayments.failedCount++;
        result.borrowing_repayments.dependencyBlockedCount++;
        borrowingsWithFailedRepayments.add(borrowingId);

        result.errors.push({
          entity: 'borrowing_repayments',
          entityId: repaymentId,
          outboxId: entry.id,
          error: `Cannot sync repayment '${repaymentId}': referenced borrowing '${borrowingId}' failed synchronization.`,
          category: 'dependency',
          disposition: 'permanent',
          errorClass: 'dependency',
          retryable: false
        });
        continue;
      }

      if (lenderId && failedLenderIds.has(lenderId)) {
        result.failedCount++;
        result.borrowing_repayments.failedCount++;
        result.borrowing_repayments.dependencyBlockedCount++;
        if (borrowingId) borrowingsWithFailedRepayments.add(borrowingId);

        result.errors.push({
          entity: 'borrowing_repayments',
          entityId: repaymentId,
          outboxId: entry.id,
          error: `Cannot sync repayment '${repaymentId}': referenced lender '${lenderId}' failed synchronization.`,
          category: 'dependency',
          disposition: 'permanent',
          errorClass: 'dependency',
          retryable: false
        });
        continue;
      }

      if (paymentAccountId && failedAccountIds.has(paymentAccountId)) {
        result.failedCount++;
        result.borrowing_repayments.failedCount++;
        result.borrowing_repayments.dependencyBlockedCount++;
        if (borrowingId) borrowingsWithFailedRepayments.add(borrowingId);

        result.errors.push({
          entity: 'borrowing_repayments',
          entityId: repaymentId,
          outboxId: entry.id,
          error: `Cannot sync repayment '${repaymentId}': referenced payment account '${paymentAccountId}' failed synchronization.`,
          category: 'dependency',
          disposition: 'permanent',
          errorClass: 'dependency',
          retryable: false
        });
        continue;
      }

      if (transactionId && failedTransactionIds.has(transactionId)) {
        result.failedCount++;
        result.borrowing_repayments.failedCount++;
        result.borrowing_repayments.dependencyBlockedCount++;
        if (borrowingId) borrowingsWithFailedRepayments.add(borrowingId);

        result.errors.push({
          entity: 'borrowing_repayments',
          entityId: repaymentId,
          outboxId: entry.id,
          error: `Cannot sync repayment '${repaymentId}': referenced transfer transaction '${transactionId}' failed synchronization.`,
          category: 'dependency',
          disposition: 'permanent',
          errorClass: 'dependency',
          retryable: false
        });
        continue;
      }

      result.totalProcessed++;

      try {
        if (!this.borrowingRepaymentDispatcher) {
          throw new Error('BorrowingRepaymentSyncDispatcher is not configured.');
        }
        await this.borrowingRepaymentDispatcher.dispatch(entry);
        this.clearEntryFailureState(userId, entry);
        result.syncedCount++;
        result.borrowing_repayments.syncedCount++;
      } catch (error) {
        if (borrowingId) borrowingsWithFailedRepayments.add(borrowingId);

        if (
          error instanceof SyncAccountDependencyError ||
          error instanceof SyncLenderDependencyError ||
          error instanceof SyncBorrowingDependencyError ||
          error instanceof SyncTransactionDependencyError
        ) {
          result.borrowing_repayments.dependencyBlockedCount++;
        }

        this.handleDispatchFailure(
          result,
          result.borrowing_repayments,
          'borrowing_repayments',
          repaymentId,
          entry,
          error,
          runState
        );
      }
    }

    // -----------------------------------------------------------------------
    // STAGE 7: BORROWINGS (UPDATES)
    // Must follow Repayments (Stage 6) so cloud settled repayments are present
    // before evaluating any borrowing status validation triggers
    // -----------------------------------------------------------------------
    for (const entry of borrowingUpdateEntries) {
      const borrowingId = entry.entityId;

      if (failedBorrowingIds.has(borrowingId) || borrowingsWithFailedRepayments.has(borrowingId)) {
        result.skippedCount++;
        result.borrowings.skippedCount++;
        if (borrowingsWithFailedRepayments.has(borrowingId)) {
          result.borrowings.dependencyBlockedCount++;
        }
        failedBorrowingIds.add(borrowingId);
        continue;
      }

      const eligibility = this.evaluateEntryForStage(entry, runState);
      if (!eligibility.eligible) {
        this.recordEligibilitySkip(result, eligibility, result.borrowings);
        failedBorrowingIds.add(borrowingId);
        continue;
      }

      // Dependency validation against upstream failures
      const lenderId = String(entry.payload.lender_id ?? entry.payload.lenderId ?? '');
      const receivingAccountId = String(
        entry.payload.receiving_account_id ?? entry.payload.receivingAccountId ?? ''
      );
      const transactionId = String(
        entry.payload.transaction_id ?? entry.payload.transactionId ?? ''
      );

      if (lenderId && failedLenderIds.has(lenderId)) {
        result.failedCount++;
        result.borrowings.failedCount++;
        result.borrowings.dependencyBlockedCount++;
        failedBorrowingIds.add(borrowingId);

        result.errors.push({
          entity: 'borrowings',
          entityId: borrowingId,
          outboxId: entry.id,
          error: `Cannot sync borrowing '${borrowingId}': referenced lender '${lenderId}' failed synchronization.`,
          category: 'dependency',
          disposition: 'permanent',
          errorClass: 'dependency',
          retryable: false
        });
        continue;
      }

      if (receivingAccountId && failedAccountIds.has(receivingAccountId)) {
        result.failedCount++;
        result.borrowings.failedCount++;
        result.borrowings.dependencyBlockedCount++;
        failedBorrowingIds.add(borrowingId);

        result.errors.push({
          entity: 'borrowings',
          entityId: borrowingId,
          outboxId: entry.id,
          error: `Cannot sync borrowing '${borrowingId}': referenced receiving account '${receivingAccountId}' failed synchronization.`,
          category: 'dependency',
          disposition: 'permanent',
          errorClass: 'dependency',
          retryable: false
        });
        continue;
      }

      if (transactionId && failedTransactionIds.has(transactionId)) {
        result.failedCount++;
        result.borrowings.failedCount++;
        result.borrowings.dependencyBlockedCount++;
        failedBorrowingIds.add(borrowingId);

        result.errors.push({
          entity: 'borrowings',
          entityId: borrowingId,
          outboxId: entry.id,
          error: `Cannot sync borrowing '${borrowingId}': referenced transfer transaction '${transactionId}' failed synchronization.`,
          category: 'dependency',
          disposition: 'permanent',
          errorClass: 'dependency',
          retryable: false
        });
        continue;
      }

      result.totalProcessed++;

      try {
        if (!this.borrowingDispatcher) {
          throw new Error('BorrowingSyncDispatcher is not configured.');
        }
        await this.borrowingDispatcher.dispatch(entry);
        this.clearEntryFailureState(userId, entry);
        result.syncedCount++;
        result.borrowings.syncedCount++;
      } catch (error) {
        failedBorrowingIds.add(borrowingId);

        if (
          error instanceof SyncAccountDependencyError ||
          error instanceof SyncLenderDependencyError ||
          error instanceof SyncTransactionDependencyError
        ) {
          result.borrowings.dependencyBlockedCount++;
        }

        this.handleDispatchFailure(
          result,
          result.borrowings,
          'borrowings',
          borrowingId,
          entry,
          error,
          runState
        );
      }
    }

    // -----------------------------------------------------------------------
    // STAGE 8A: NOTIFICATIONS (FIFO per notification ID & dedupe_key slot)
    // Isolated from financial push stages so alert failures never block ledger sync.
    // -----------------------------------------------------------------------
    for (const entry of notificationEntries) {
      const notificationId = entry.entityId;
      const rawDedupe = entry.payload?.dedupe_key ?? entry.payload?.dedupeKey;
      const dedupeKey =
        typeof rawDedupe === 'string' && rawDedupe.trim().length > 0
          ? rawDedupe.trim()
          : null;

      if (
        failedNotificationIds.has(notificationId) ||
        (dedupeKey !== null && failedNotificationDedupeKeys.has(dedupeKey))
      ) {
        result.skippedCount++;
        result.notifications!.skippedCount++;
        failedNotificationIds.add(notificationId);
        continue;
      }

      const eligibility = this.evaluateEntryForStage(entry, runState);
      if (!eligibility.eligible) {
        this.recordEligibilitySkip(result, eligibility, result.notifications!);
        failedNotificationIds.add(notificationId);
        if (dedupeKey) {
          failedNotificationDedupeKeys.add(dedupeKey);
        }
        continue;
      }

      result.totalProcessed++;
      try {
        await this.notificationDispatcher!.dispatch(entry);
        this.clearEntryFailureState(userId, entry);
        result.syncedCount++;
        result.notifications!.syncedCount++;
      } catch (error) {
        failedNotificationIds.add(notificationId);
        if (dedupeKey) {
          failedNotificationDedupeKeys.add(dedupeKey);
        }
        if (error instanceof SyncConflictError) {
          result.notifications!.conflictCount++;
        }
        this.handleDispatchFailure(
          result,
          result.notifications!,
          'notifications',
          notificationId,
          entry,
          error,
          runState
        );
      }
    }

    // -----------------------------------------------------------------------
    // STAGE 8B: NOTIFICATION PREFERENCES (FIFO per user)
    // -----------------------------------------------------------------------
    for (const entry of notificationPreferenceEntries) {
      if (hasFailedPreference) {
        result.skippedCount++;
        result.notification_preferences!.skippedCount++;
        continue;
      }

      const eligibility = this.evaluateEntryForStage(entry, runState);
      if (!eligibility.eligible) {
        this.recordEligibilitySkip(result, eligibility, result.notification_preferences!);
        hasFailedPreference = true;
        continue;
      }

      result.totalProcessed++;
      try {
        await this.notificationPreferenceDispatcher!.dispatch(entry);
        this.clearEntryFailureState(userId, entry);
        result.syncedCount++;
        result.notification_preferences!.syncedCount++;
      } catch (error) {
        hasFailedPreference = true;
        if (error instanceof SyncConflictError) {
          result.notification_preferences!.conflictCount++;
        }
        this.handleDispatchFailure(
          result,
          result.notification_preferences!,
          'notification_preferences',
          entry.entityId,
          entry,
          error,
          runState
        );
      }
    }

    // -----------------------------------------------------------------------
    // STAGE 9A: CORE LEDGER CLOUD PULL & LOCAL RECONCILIATION
    // Pulls in relational dependency order:
    // Categories -> Accounts -> Transactions -> Borrowings (Lenders -> Borrowings -> Repayments)
    // -----------------------------------------------------------------------
    if (!runState.authPaused && this.categoryReconciler) {
      try {
        const categoryPull = await this.categoryReconciler.pullAndReconcile(userId);
        result.pulledCount += categoryPull.pulledCount;
        result.categories.pulledCount =
          (result.categories.pulledCount ?? 0) + categoryPull.pulledCount;
        result.categories.mappedCount =
          (result.categories.mappedCount ?? 0) + categoryPull.mappedCount;

        for (const conflict of categoryPull.conflicts) {
          this.appendConflictErrorIfUnique(
            result,
            'categories',
            conflict.categoryId,
            conflict.reason,
            () => {
              result.categories.conflictCount = (result.categories.conflictCount ?? 0) + 1;
            }
          );
        }
      } catch (error) {
        this.handleReconcilerFailure(result, result.categories, 'categories', error, runState);
      }
    }

    if (!runState.authPaused && this.accountReconciler) {
      try {
        const accountPull = await this.accountReconciler.pullAndReconcile(userId);
        result.pulledCount += accountPull.pulledCount;
        result.accounts.pulledCount =
          (result.accounts.pulledCount ?? 0) + accountPull.pulledCount;
        if (accountPull.remappedFromAccountId) {
          result.accounts.remappedCount = (result.accounts.remappedCount ?? 0) + 1;
        }

        for (const conflict of accountPull.conflicts) {
          this.appendConflictErrorIfUnique(
            result,
            'accounts',
            conflict.accountId,
            conflict.reason,
            () => {
              result.accounts.conflictCount = (result.accounts.conflictCount ?? 0) + 1;
            }
          );
        }
      } catch (error) {
        this.handleReconcilerFailure(result, result.accounts, 'accounts', error, runState);
      }
    }

    if (!runState.authPaused && this.transactionReconciler) {
      try {
        const txPull = await this.transactionReconciler.pullAndReconcile(userId);
        result.pulledCount += txPull.pulledCount;
        result.transactions.pulledCount =
          (result.transactions.pulledCount ?? 0) + txPull.pulledCount;
        result.transactions.conflictCount += txPull.conflictCount;

        for (const conflict of txPull.conflicts) {
          this.appendConflictErrorIfUnique(
            result,
            'transactions',
            conflict.transactionId,
            conflict.reason
          );
        }
      } catch (error) {
        this.handleReconcilerFailure(result, result.transactions, 'transactions', error, runState);
      }
    }

    if (!runState.authPaused && this.borrowingsReconciler) {
      try {
        const borrowingsPull = await this.borrowingsReconciler.pullAndReconcile(userId);
        result.pulledCount += borrowingsPull.pulledCount;
        result.lenders.pulledCount =
          (result.lenders.pulledCount ?? 0) + borrowingsPull.lenders.pulledCount;
        result.lenders.conflictCount =
          (result.lenders.conflictCount ?? 0) + borrowingsPull.lenders.conflictCount;
        result.borrowings.pulledCount =
          (result.borrowings.pulledCount ?? 0) + borrowingsPull.borrowings.pulledCount;
        result.borrowings.conflictCount =
          (result.borrowings.conflictCount ?? 0) + borrowingsPull.borrowings.conflictCount;
        result.borrowing_repayments.pulledCount =
          (result.borrowing_repayments.pulledCount ?? 0) + borrowingsPull.repayments.pulledCount;
        result.borrowing_repayments.conflictCount =
          (result.borrowing_repayments.conflictCount ?? 0) +
          borrowingsPull.repayments.conflictCount;

        for (const conflict of borrowingsPull.conflicts) {
          this.appendConflictErrorIfUnique(
            result,
            conflict.entity,
            conflict.entityId,
            conflict.reason
          );
        }
      } catch (error) {
        this.handleReconcilerFailure(result, result.borrowings, 'borrowings', error, runState);
      }
    }

    // -----------------------------------------------------------------------
    // STAGE 9: BUDGET CLOUD PULL & LOCAL RECONCILIATION
    // -----------------------------------------------------------------------
    if (!runState.authPaused && this.budgetReconciler) {
      try {
        const pullResult = await this.budgetReconciler.pullAndReconcile(userId);
        result.pulledCount += pullResult.pulledCount;
        result.budgets.pulledCount += pullResult.pulledCount;
        result.budgets.conflictCount += pullResult.conflictCount;

        for (const conflict of pullResult.conflicts) {
          result.errors.push({
            entity: 'budgets',
            entityId: conflict.budgetId,
            error: conflict.reason,
            category: 'conflict',
            disposition: 'permanent',
            errorClass: 'conflict',
            retryable: false
          });
        }
      } catch (error) {
        this.handleReconcilerFailure(result, result.budgets, 'budgets', error, runState);
      }
    }

    // -----------------------------------------------------------------------
    // STAGE 10: RECURRING SCHEDULES & OCCURRENCES PULL RECONCILIATION
    // -----------------------------------------------------------------------
    if (!runState.authPaused && this.recurringReconciler) {
      try {
        const recurringPull = await this.recurringReconciler.pullAndReconcile(userId);
        result.pulledCount += recurringPull.pulledCount;
        for (const conflict of recurringPull.conflicts) {
          result.errors.push({
            entity: conflict.entity,
            entityId: conflict.entityId,
            error: conflict.reason,
            category: 'conflict',
            disposition: 'permanent',
            errorClass: 'conflict',
            retryable: false
          });
        }
      } catch (error) {
        this.handleReconcilerFailure(
          result,
          result.recurring_rules!,
          'recurring_rules',
          error,
          runState
        );
      }
    }

    // -----------------------------------------------------------------------
    // STAGE 11: NOTIFICATIONS & PREFERENCES PULL RECONCILIATION
    // -----------------------------------------------------------------------
    if (!runState.authPaused && this.notificationReconciler) {
      try {
        const notifPull = await this.notificationReconciler.pullAndReconcile(userId);
        result.pulledCount += notifPull.pulledCount;
        result.notifications!.pulledCount += notifPull.pulledCount;
        result.notifications!.conflictCount += notifPull.conflictCount;

        for (const conflict of notifPull.conflicts) {
          result.errors.push({
            entity: conflict.entity,
            entityId: conflict.entityId,
            error: conflict.reason,
            category: 'conflict',
            disposition: 'permanent',
            errorClass: 'conflict',
            retryable: false
          });
        }
      } catch (error) {
        this.handleReconcilerFailure(
          result,
          result.notifications!,
          'notifications',
          error,
          runState
        );
      }
    }

    // In manual mode, a clean pass with no auth errors confirms active authentication
    if (runOptions.mode === 'manual' && !runState.authPaused && this.authPausedUserId === userId) {
      this.authPausedUserId = null;
    }

    result.authPaused = runState.authPaused || this.authPausedUserId === userId;

    // Update remaining still pending count scoped to authenticated user
    result.stillPendingCount = await this.outboxManager.getPendingCount(userId);

    return result;
  }

  private normalizeRunOptions(limitOrOptions?: number | RunSyncOptions): Required<
    Pick<RunSyncOptions, 'mode' | 'pageSize' | 'retryFailed'>
  > & { limit?: number } {
    if (typeof limitOrOptions === 'number') {
      return {
        mode: 'manual',
        pageSize: DEFAULT_SYNC_PAGE_SIZE,
        retryFailed: true,
        limit: limitOrOptions
      };
    }

    const opts = limitOrOptions ?? {};
    const mode: SyncExecutionMode = opts.mode ?? 'manual';
    const rawPageSize = opts.pageSize ?? DEFAULT_SYNC_PAGE_SIZE;
    const pageSize =
      Number.isFinite(rawPageSize) && rawPageSize > 0
        ? Math.max(1, Math.min(500, Math.floor(rawPageSize)))
        : DEFAULT_SYNC_PAGE_SIZE;

    return {
      mode,
      pageSize,
      retryFailed: opts.retryFailed ?? mode === 'manual',
      ...(opts.limit !== undefined ? { limit: opts.limit } : {})
    };
  }

  private createEmptyResult(overrides: Partial<UnifiedSyncResult> = {}): UnifiedSyncResult {
    return {
      totalPending: 0,
      totalProcessed: 0,
      syncedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      unsupportedCount: 0,
      stillPendingCount: 0,
      pulledCount: 0,
      skippedPausedCount: 0,
      skippedBackoffCount: 0,
      skippedAuthPaused: false,
      skippedLockContention: false,
      pagesProcessed: 0,
      authPaused: false,
      accounts: {
        syncedCount: 0,
        failedCount: 0,
        skippedCount: 0,
        pulledCount: 0,
        remappedCount: 0,
        conflictCount: 0
      },
      categories: {
        syncedCount: 0,
        failedCount: 0,
        skippedCount: 0,
        pulledCount: 0,
        mappedCount: 0,
        conflictCount: 0
      },
      budgets: {
        syncedCount: 0,
        failedCount: 0,
        skippedCount: 0,
        categoryBlockedCount: 0,
        conflictCount: 0,
        pulledCount: 0
      },
      transactions: {
        syncedCount: 0,
        failedCount: 0,
        skippedCount: 0,
        dependencyBlockedCount: 0,
        categoryBlockedCount: 0,
        conflictCount: 0,
        pulledCount: 0
      },
      lenders: { syncedCount: 0, failedCount: 0, skippedCount: 0, pulledCount: 0, conflictCount: 0 },
      borrowings: {
        syncedCount: 0,
        failedCount: 0,
        skippedCount: 0,
        dependencyBlockedCount: 0,
        pulledCount: 0,
        conflictCount: 0
      },
      borrowing_repayments: {
        syncedCount: 0,
        failedCount: 0,
        skippedCount: 0,
        dependencyBlockedCount: 0,
        pulledCount: 0,
        conflictCount: 0
      },
      recurring_rules: {
        syncedCount: 0,
        failedCount: 0,
        skippedCount: 0,
        dependencyBlockedCount: 0,
        categoryBlockedCount: 0
      },
      recurring_occurrences: {
        syncedCount: 0,
        failedCount: 0,
        skippedCount: 0,
        dependencyBlockedCount: 0
      },
      notifications: {
        syncedCount: 0,
        failedCount: 0,
        skippedCount: 0,
        conflictCount: 0,
        pulledCount: 0
      },
      notification_preferences: {
        syncedCount: 0,
        failedCount: 0,
        skippedCount: 0,
        conflictCount: 0
      },
      errors: [],
      ...overrides
    };
  }

  private async loadAllPendingEntries(
    userId: string,
    pageSize: number = DEFAULT_SYNC_PAGE_SIZE,
    maxEntries?: number
  ): Promise<{ entries: LocalOutboxRecord[]; pagesProcessed: number }> {
    const safePageSize = Math.max(1, Math.min(500, Math.floor(pageSize)));
    const boundedMax =
      maxEntries !== undefined && Number.isFinite(maxEntries) && maxEntries > 0
        ? Math.floor(maxEntries)
        : undefined;
    const collected: LocalOutboxRecord[] = [];
    const seenIds = new Set<number>();
    let pagesProcessed = 0;
    let afterId: number | undefined;

    while (true) {
      const remainingBudget =
        boundedMax !== undefined ? Math.max(0, boundedMax - collected.length) : safePageSize;
      if (remainingBudget === 0) {
        break;
      }

      const fetchLimit =
        boundedMax !== undefined ? Math.min(safePageSize, remainingBudget) : safePageSize;

      let page: LocalOutboxRecord[];
      if (pagesProcessed === 0) {
        page = await this.outboxManager.getPendingEntries(userId, fetchLimit);
      } else if (
        typeof this.outboxManager.getPendingEntriesPage === 'function' &&
        afterId !== undefined
      ) {
        page = await this.outboxManager.getPendingEntriesPage(userId, fetchLimit, afterId);
      } else {
        break;
      }

      pagesProcessed++;
      if (!Array.isArray(page) || page.length === 0) {
        break;
      }

      let addedCount = 0;
      let highestId = afterId ?? -1;
      let canAdvanceCursor = true;

      for (const entry of page) {
        if (typeof entry.id === 'number' && Number.isFinite(entry.id)) {
          if (seenIds.has(entry.id)) {
            continue;
          }
          seenIds.add(entry.id);
          if (entry.id > highestId) {
            highestId = entry.id;
          }
        } else {
          canAdvanceCursor = false;
        }

        collected.push(entry);
        addedCount++;
        if (boundedMax !== undefined && collected.length >= boundedMax) {
          break;
        }
      }

      if (boundedMax !== undefined && collected.length >= boundedMax) {
        break;
      }

      if (
        page.length < fetchLimit ||
        !canAdvanceCursor ||
        addedCount === 0 ||
        typeof this.outboxManager.getPendingEntriesPage !== 'function' ||
        (afterId !== undefined && highestId <= afterId)
      ) {
        break;
      }

      afterId = highestId;

      if (pagesProcessed >= MAX_SYNC_PAGES_PER_RUN) {
        break;
      }
    }

    return { entries: collected, pagesProcessed };
  }

  private getNowMs(): number {
    return this.options.nowMs ? this.options.nowMs() : Date.now();
  }

  private getEntryStateKey(userId: string, entry: LocalOutboxRecord): string {
    if (typeof entry.id === 'number' && Number.isFinite(entry.id)) {
      return `${userId}:${entry.id}`;
    }
    return `${userId}:${entry.entity}:${entry.entityId}:${entry.operation}:${entry.idempotencyKey}`;
  }

  private clearEntryFailureState(userId: string, entry: LocalOutboxRecord): void {
    this.entryFailureState.delete(this.getEntryStateKey(userId, entry));
  }

  private evaluateEntryForStage(
    entry: LocalOutboxRecord,
    runState: SyncRunRuntimeState
  ): OutboxEligibilityDecision {
    if (runState.authPaused) {
      return { eligible: false, reason: 'auth_paused' };
    }

    return evaluateOutboxEntryEligibility({
      entry,
      runtimeState: this.entryFailureState.get(this.getEntryStateKey(runState.userId, entry)),
      authPaused: runState.authPaused,
      respectRetryPolicy: runState.respectRetryPolicy,
      config: this.retryConfig,
      nowMs: this.getNowMs()
    });
  }

  private recordEligibilitySkip(
    result: UnifiedSyncResult,
    eligibility: OutboxEligibilityDecision,
    bucket: { skippedCount: number }
  ): void {
    result.skippedCount++;
    bucket.skippedCount++;

    if (eligibility.reason === 'backoff_active') {
      result.skippedBackoffCount = (result.skippedBackoffCount ?? 0) + 1;
    } else if (
      eligibility.reason === 'permanent_failure' ||
      eligibility.reason === 'max_retries_exhausted' ||
      eligibility.reason === 'auth_paused'
    ) {
      result.skippedPausedCount = (result.skippedPausedCount ?? 0) + 1;
    }

    if (eligibility.reason === 'auth_paused') {
      result.skippedAuthPaused = true;
      result.authPaused = true;
    }
  }

  private handleDispatchFailure(
    result: UnifiedSyncResult,
    bucket: { failedCount: number },
    entity: string,
    entityId: string,
    entry: LocalOutboxRecord,
    error: unknown,
    runState: SyncRunRuntimeState
  ): void {
    result.failedCount++;
    bucket.failedCount++;

    const errorMsg = error instanceof Error ? error.message : String(error);
    const category = this.classifyError(error);
    const classification = classifySyncError(error);
    const key = this.getEntryStateKey(runState.userId, entry);
    const prev = this.entryFailureState.get(key);
    const attempts = Math.max(prev?.attempts ?? 0, entry.attempts ?? 0) + 1;

    let nextRetryAtMs = Number.POSITIVE_INFINITY;
    if (classification.disposition === 'transient') {
      nextRetryAtMs =
        this.getNowMs() +
        computeSyncBackoffDelayMs(attempts, this.retryConfig, this.options.randomFn);
    } else if (classification.disposition === 'auth') {
      runState.authPaused = true;
      this.authPausedUserId = runState.userId;
      result.authPaused = true;
    }

    this.entryFailureState.set(key, {
      classification,
      attempts,
      nextRetryAtMs
    });

    result.errors.push({
      entity,
      entityId,
      outboxId: entry.id,
      error: errorMsg,
      category,
      disposition: classification.disposition,
      errorClass: classification.errorClass,
      retryable: classification.retryable
    });
  }

  private appendConflictErrorIfUnique(
    result: UnifiedSyncResult,
    entity: string,
    entityId: string,
    reason: string,
    onAdded?: () => void
  ): void {
    const exists = result.errors.some(
      (item) =>
        item.category === 'conflict' &&
        item.entity === entity &&
        item.entityId === entityId &&
        item.error === reason
    );
    if (exists) {
      return;
    }
    onAdded?.();
    result.errors.push({
      entity,
      entityId,
      error: reason,
      category: 'conflict',
      disposition: 'permanent',
      errorClass: 'conflict',
      retryable: false
    });
  }

  private handleReconcilerFailure(
    result: UnifiedSyncResult,
    bucket: { failedCount: number },
    entity: string,
    error: unknown,
    runState: SyncRunRuntimeState
  ): void {
    result.failedCount++;
    bucket.failedCount++;

    const classification = classifySyncError(error);
    if (classification.disposition === 'auth') {
      runState.authPaused = true;
      this.authPausedUserId = runState.userId;
      result.authPaused = true;
    }

    result.errors.push({
      entity,
      entityId: 'reconcile',
      error: error instanceof Error ? error.message : String(error),
      category: this.classifyError(error),
      disposition: classification.disposition,
      errorClass: classification.errorClass,
      retryable: classification.retryable
    });
  }

  private bindUserCrossTabChannel(userId: string): void {
    this.crossTabCoordinator.bindUserChannel({
      userId,
      isSessionValid: (expectedUserId) => {
        if (this.options.userId && this.options.userId !== expectedUserId) {
          return false;
        }
        return this.options.sessionCheck ? this.options.sessionCheck() : true;
      },
      onMessage: (message) => {
        this.options.onCrossTabEvent?.(message);
      }
    });
  }

  private classifyError(
    error: unknown
  ): 'dependency' | 'category' | 'conflict' | 'auth' | 'database' | 'validation' | 'other' {
    if (
      error instanceof SyncAccountDependencyError ||
      error instanceof SyncTransactionDependencyError ||
      error instanceof SyncLenderDependencyError ||
      error instanceof SyncBorrowingDependencyError
    ) {
      return 'dependency';
    }
    if (error instanceof SyncUnresolvedCategoryError) return 'category';
    if (error instanceof SyncConflictError) return 'conflict';
    if (error instanceof SyncAuthError) return 'auth';
    if (error instanceof SyncDatabaseError) return 'database';

    const classified = classifySyncError(error);
    return classified.errorCategory;
  }
}

// Default singleton instances wired to canonical repositories and outbox manager
const defaultSupabaseAccountRepo = new SupabaseAccountRepository();
const defaultSupabaseCategoryRepo = new SupabaseCategoryRepository();
const defaultSupabaseBudgetRepo = new SupabaseBudgetRepository(
  undefined,
  defaultSupabaseCategoryRepo
);
const defaultSupabaseTransactionRepo = new SupabaseTransactionRepository(
  undefined,
  defaultSupabaseAccountRepo,
  defaultSupabaseCategoryRepo
);
const defaultSupabaseLenderRepo = new SupabaseLenderRepository();
const defaultSupabaseBorrowingRepo = new SupabaseBorrowingRepository(
  undefined,
  defaultSupabaseLenderRepo,
  defaultSupabaseAccountRepo,
  defaultSupabaseTransactionRepo
);
const defaultSupabaseBorrowingRepaymentRepo = new SupabaseBorrowingRepaymentRepository(
  undefined,
  defaultSupabaseBorrowingRepo,
  defaultSupabaseLenderRepo,
  defaultSupabaseAccountRepo,
  defaultSupabaseTransactionRepo
);

const defaultOutboxManager = new OutboxManager();
const defaultCategoryMappingService = new CategoryMappingService(
  undefined,
  defaultSupabaseCategoryRepo
);

const defaultAccountDispatcher = new AccountSyncDispatcher(
  defaultSupabaseAccountRepo,
  defaultAuthAdapter,
  defaultOutboxManager
);

const defaultCategoryDispatcher = new CategorySyncDispatcher(
  defaultSupabaseCategoryRepo,
  defaultAuthAdapter,
  defaultOutboxManager,
  defaultCategoryMappingService
);

const defaultBudgetDispatcher = new BudgetSyncDispatcher(
  defaultSupabaseBudgetRepo,
  defaultAuthAdapter,
  defaultOutboxManager,
  defaultCategoryMappingService
);

const defaultTransactionDispatcher = new TransactionSyncDispatcher(
  defaultSupabaseTransactionRepo,
  defaultAuthAdapter,
  defaultOutboxManager,
  defaultCategoryMappingService
);

const defaultLenderDispatcher = new LenderSyncDispatcher(
  defaultSupabaseLenderRepo,
  defaultAuthAdapter,
  defaultOutboxManager
);

const defaultBorrowingDispatcher = new BorrowingSyncDispatcher(
  defaultSupabaseBorrowingRepo,
  defaultAuthAdapter,
  defaultOutboxManager
);

const defaultBorrowingRepaymentDispatcher = new BorrowingRepaymentSyncDispatcher(
  defaultSupabaseBorrowingRepaymentRepo,
  defaultAuthAdapter,
  defaultOutboxManager
);

const defaultSupabaseRecurringRuleRepo = new SupabaseRecurringRuleRepository(
  undefined,
  defaultSupabaseAccountRepo,
  defaultSupabaseCategoryRepo
);
const defaultSupabaseRecurringOccurrenceRepo = new SupabaseRecurringOccurrenceRepository(
  undefined,
  defaultSupabaseRecurringRuleRepo,
  defaultSupabaseTransactionRepo
);
const defaultRecurringRuleDispatcher = new RecurringRuleSyncDispatcher(
  defaultSupabaseRecurringRuleRepo,
  defaultAuthAdapter,
  defaultOutboxManager,
  defaultCategoryMappingService
);
const defaultRecurringOccurrenceDispatcher = new RecurringOccurrenceSyncDispatcher(
  defaultSupabaseRecurringOccurrenceRepo,
  defaultAuthAdapter,
  defaultOutboxManager
);
const defaultSupabaseNotificationRepo = new SupabaseNotificationRepository();
const defaultSupabaseNotificationPreferenceRepo = new SupabaseNotificationPreferenceRepository();
const defaultNotificationDispatcher = new NotificationSyncDispatcher(
  defaultSupabaseNotificationRepo,
  defaultAuthAdapter,
  defaultOutboxManager
);
const defaultNotificationPreferenceDispatcher = new NotificationPreferenceSyncDispatcher(
  defaultSupabaseNotificationPreferenceRepo,
  defaultAuthAdapter,
  defaultOutboxManager
);

export const defaultManualSyncCoordinator = new ManualSyncCoordinator(
  defaultAccountDispatcher,
  defaultTransactionDispatcher,
  defaultOutboxManager,
  defaultAuthAdapter,
  defaultCategoryDispatcher,
  defaultLenderDispatcher,
  defaultBorrowingDispatcher,
  defaultBorrowingRepaymentDispatcher,
  defaultBudgetDispatcher,
  undefined,
  defaultRecurringRuleDispatcher,
  defaultRecurringOccurrenceDispatcher,
  undefined,
  defaultNotificationDispatcher,
  defaultNotificationPreferenceDispatcher
);

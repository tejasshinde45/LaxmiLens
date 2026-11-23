import { AccountSyncDispatcher } from './dispatchers/AccountSyncDispatcher';
import { TransactionSyncDispatcher } from './dispatchers/TransactionSyncDispatcher';
import { CategorySyncDispatcher } from './dispatchers/CategorySyncDispatcher';
import { OutboxManager } from './OutboxManager';
import { AuthPort } from '@/application/ports/AuthPort';
import { LocalOutboxRecord } from '../database/local/schema';
import {
  SyncAuthError,
  SyncInProgressError,
  SyncAccountDependencyError,
  SyncUnresolvedCategoryError,
  SyncConflictError,
  SyncDatabaseError
} from './errors/SyncErrors';
import { SupabaseAccountRepository } from '../database/cloud/repositories/SupabaseAccountRepository';
import { SupabaseTransactionRepository } from '../database/cloud/repositories/SupabaseTransactionRepository';
import { SupabaseCategoryRepository } from '../database/cloud/repositories/SupabaseCategoryRepository';
import { CategoryMappingService } from './CategoryMappingService';
import { defaultAuthAdapter } from '../auth/SupabaseAuthAdapter';

export interface SyncErrorItem {
  entity: string;
  entityId: string;
  outboxId?: number;
  error: string;
  category: 'dependency' | 'category' | 'conflict' | 'auth' | 'database' | 'validation' | 'other';
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

  // Breakdown by entity
  accounts: {
    syncedCount: number;
    failedCount: number;
    skippedCount: number;
  };
  categories: {
    syncedCount: number;
    failedCount: number;
    skippedCount: number;
  };
  transactions: {
    syncedCount: number;
    failedCount: number;
    skippedCount: number;
    dependencyBlockedCount: number;
    categoryBlockedCount: number;
    conflictCount: number;
  };

  // Detailed errors
  errors: SyncErrorItem[];
}

/**
 * ManualSyncCoordinator
 *
 * Dedicated unified application-level coordinator for manual synchronization of
 * 'accounts', 'categories', and 'transactions' outbox entries.
 *
 * Guarantees:
 * 1. Strict User Context: Requires authenticated user; rejects unauthenticated calls with SyncAuthError.
 * 2. Concurrency Safety: Mutex prevents concurrent manual clicks from starting competing global sync jobs.
 * 3. Accounts-Before-Categories-Before-Transactions Ordering: In every batch, all eligible account events
 *    are dispatched first, then category events, then transaction events.
 * 4. Cross-Entity Dependency Safety: Transactions referencing newly synced accounts and categories succeed;
 *    transactions referencing failed or un-synced accounts/categories safely fail and remain in the outbox.
 * 5. Strict Sequential Processing: Outbox entries are processed one-by-one in FIFO insertion order.
 * 6. Per-Entity Failure Isolation: If an earlier event for an entity fails, subsequent events for that SAME
 *    entity ID are skipped during this run to preserve version progression (v1 -> v2 -> v3).
 * 7. Multi-Entity Progression: Other independent accounts, categories, and transactions continue processing.
 * 8. Non-Destructive to Unsupported Entities: Unsupported entities remain untouched in the outbox.
 * 9. Dispatcher Acknowledgment: The coordinator never deletes entries directly; outbox records are
 *    acknowledged (deleted) solely by dispatchers after verified remote persistence.
 * 10. Zero Background/Timer Activity: No timers, listeners, or automatic triggers.
 */
export class ManualSyncCoordinator {
  private isRunning = false;

  constructor(
    private readonly accountDispatcher: AccountSyncDispatcher,
    private readonly transactionDispatcher: TransactionSyncDispatcher,
    private readonly outboxManager: OutboxManager,
    private readonly authPort: AuthPort,
    private readonly categoryDispatcher?: CategorySyncDispatcher
  ) {}

  public isSyncRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Retrieves pending outbox records for coordinated entities ('accounts', 'categories', 'transactions').
   * Scoped to the authenticated user.
   */
  public async getPendingEntries(userId?: string, limit = 100): Promise<LocalOutboxRecord[]> {
    const targetUserId = userId || (await this.authPort.getCurrentUser())?.id;
    if (!targetUserId) {
      return [];
    }
    const allPending = await this.outboxManager.getPendingEntries(targetUserId, limit);
    return allPending.filter((entry) => {
      if (entry.entity === 'accounts' || entry.entity === 'transactions') return true;
      if (entry.entity === 'categories' && this.categoryDispatcher) return true;
      return false;
    });
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
    const entries = await this.getPendingEntries(targetUserId, 500);
    return entries.length;
  }

  /**
   * Executes unified manual synchronization of pending account and transaction outbox records.
   */
  public async run(limit = 100): Promise<UnifiedSyncResult> {
    if (this.isRunning) {
      throw new SyncInProgressError();
    }

    this.isRunning = true;

    try {
      // 1. Guard authenticated session
      const currentUser = await this.authPort.getCurrentUser();
      if (!currentUser || !currentUser.id) {
        throw new SyncAuthError('Manual sync rejected: User is not authenticated.');
      }

      const result: UnifiedSyncResult = {
        totalPending: 0,
        totalProcessed: 0,
        syncedCount: 0,
        failedCount: 0,
        skippedCount: 0,
        unsupportedCount: 0,
        stillPendingCount: 0,
        accounts: {
          syncedCount: 0,
          failedCount: 0,
          skippedCount: 0
        },
        categories: {
          syncedCount: 0,
          failedCount: 0,
          skippedCount: 0
        },
        transactions: {
          syncedCount: 0,
          failedCount: 0,
          skippedCount: 0,
          dependencyBlockedCount: 0,
          categoryBlockedCount: 0,
          conflictCount: 0
        },
        errors: []
      };

      // 2. Fetch pending entries ordered by id (FIFO outbox order) scoped to authenticated user
      const pendingEntries = await this.outboxManager.getPendingEntries(currentUser.id, limit);
      result.totalPending = pendingEntries.length;

      // Group entries preserving FIFO within each group
      const accountEntries: LocalOutboxRecord[] = [];
      const categoryEntries: LocalOutboxRecord[] = [];
      const transactionEntries: LocalOutboxRecord[] = [];
      const unsupportedEntries: LocalOutboxRecord[] = [];

      for (const entry of pendingEntries) {
        if (entry.entity === 'accounts') {
          accountEntries.push(entry);
        } else if (entry.entity === 'categories' && this.categoryDispatcher) {
          categoryEntries.push(entry);
        } else if (entry.entity === 'transactions') {
          transactionEntries.push(entry);
        } else {
          unsupportedEntries.push(entry);
        }
      }

      result.unsupportedCount = unsupportedEntries.length;

      // 3. Process account events first
      const failedAccountIds = new Set<string>();

      for (const entry of accountEntries) {
        const accountId = entry.entityId;

        // Skip subsequent entries for an account that already encountered a failure
        if (failedAccountIds.has(accountId)) {
          result.skippedCount++;
          result.accounts.skippedCount++;
          continue;
        }

        result.totalProcessed++;

        try {
          await this.accountDispatcher.dispatch(entry);
          result.syncedCount++;
          result.accounts.syncedCount++;
        } catch (error) {
          result.failedCount++;
          result.accounts.failedCount++;
          failedAccountIds.add(accountId);

          const errorMsg = error instanceof Error ? error.message : String(error);
          result.errors.push({
            entity: 'accounts',
            entityId: accountId,
            outboxId: entry.id,
            error: errorMsg,
            category: this.classifyError(error)
          });
        }
      }

      // 4. Process category events second (Accounts -> Categories -> Transactions)
      const failedCategoryIds = new Set<string>();

      for (const entry of categoryEntries) {
        const categoryId = entry.entityId;

        // Skip subsequent entries for a category that already encountered a failure
        if (failedCategoryIds.has(categoryId)) {
          result.skippedCount++;
          result.categories.skippedCount++;
          continue;
        }

        result.totalProcessed++;

        try {
          if (!this.categoryDispatcher) {
            throw new Error('CategorySyncDispatcher is not configured.');
          }
          await this.categoryDispatcher.dispatch(entry);
          result.syncedCount++;
          result.categories.syncedCount++;
        } catch (error) {
          result.failedCount++;
          result.categories.failedCount++;
          failedCategoryIds.add(categoryId);

          const errorMsg = error instanceof Error ? error.message : String(error);
          result.errors.push({
            entity: 'categories',
            entityId: categoryId,
            outboxId: entry.id,
            error: errorMsg,
            category: this.classifyError(error)
          });
        }
      }

      // 5. Process transaction events (only after account and category events have completed)
      const failedTransactionIds = new Set<string>();

      for (const entry of transactionEntries) {
        const transactionId = entry.entityId;

        // Skip subsequent entries for a transaction that already encountered a failure
        if (failedTransactionIds.has(transactionId)) {
          result.skippedCount++;
          result.transactions.skippedCount++;
          continue;
        }

        // Check if transaction references a category that failed synchronization in step 4
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
            category: 'category'
          });
          continue;
        }

        result.totalProcessed++;

        try {
          await this.transactionDispatcher.dispatch(entry);
          result.syncedCount++;
          result.transactions.syncedCount++;
        } catch (error) {
          result.failedCount++;
          result.transactions.failedCount++;
          failedTransactionIds.add(transactionId);

          const errorMsg = error instanceof Error ? error.message : String(error);
          const category = this.classifyError(error);

          if (error instanceof SyncAccountDependencyError) {
            result.transactions.dependencyBlockedCount++;
          } else if (error instanceof SyncUnresolvedCategoryError) {
            result.transactions.categoryBlockedCount++;
          } else if (error instanceof SyncConflictError) {
            result.transactions.conflictCount++;
          }

          result.errors.push({
            entity: 'transactions',
            entityId: transactionId,
            outboxId: entry.id,
            error: errorMsg,
            category
          });
        }
      }

      // 6. Update remaining still pending count scoped to authenticated user
      result.stillPendingCount = await this.outboxManager.getPendingCount(currentUser.id);

      return result;
    } finally {
      this.isRunning = false;
    }
  }

  private classifyError(
    error: unknown
  ): 'dependency' | 'category' | 'conflict' | 'auth' | 'database' | 'validation' | 'other' {
    if (error instanceof SyncAccountDependencyError) return 'dependency';
    if (error instanceof SyncUnresolvedCategoryError) return 'category';
    if (error instanceof SyncConflictError) return 'conflict';
    if (error instanceof SyncAuthError) return 'auth';
    if (error instanceof SyncDatabaseError) return 'database';
    const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (msg.includes('validation') || msg.includes('invalid') || msg.includes('payload')) {
      return 'validation';
    }
    return 'other';
  }
}

// Default singleton instances wired to canonical repositories and outbox manager
const defaultSupabaseAccountRepo = new SupabaseAccountRepository();
const defaultSupabaseCategoryRepo = new SupabaseCategoryRepository();
const defaultSupabaseTransactionRepo = new SupabaseTransactionRepository(
  undefined,
  defaultSupabaseAccountRepo,
  defaultSupabaseCategoryRepo
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

const defaultTransactionDispatcher = new TransactionSyncDispatcher(
  defaultSupabaseTransactionRepo,
  defaultAuthAdapter,
  defaultOutboxManager,
  defaultCategoryMappingService
);

export const defaultManualSyncCoordinator = new ManualSyncCoordinator(
  defaultAccountDispatcher,
  defaultTransactionDispatcher,
  defaultOutboxManager,
  defaultAuthAdapter,
  defaultCategoryDispatcher
);

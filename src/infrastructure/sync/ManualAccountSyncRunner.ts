import { AccountSyncDispatcher } from './dispatchers/AccountSyncDispatcher';
import { OutboxManager } from './OutboxManager';
import { AuthPort } from '@/application/ports/AuthPort';
import { SyncAuthError, SyncInProgressError } from './errors/SyncErrors';
import { LocalOutboxRecord } from '../database/local/schema';
import { SupabaseAccountRepository } from '../database/cloud/repositories/SupabaseAccountRepository';
import { defaultAuthAdapter } from '../auth/SupabaseAuthAdapter';

export interface ManualAccountSyncResult {
  totalPending: number;
  totalProcessed: number;
  syncedCount: number;
  failedCount: number;
  skippedCount: number;
  unsupportedCount: number;
  errors: Array<{ entityId: string; outboxId?: number; error: string }>;
}

/**
 * ManualAccountSyncRunner
 *
 * Dedicated application-level runner for controlled manual account synchronization.
 *
 * Guarantees:
 * 1. Strict User Context: Requires authenticated user; rejects unauthenticated calls with SyncAuthError.
 * 2. Concurrency Safety: Mutex prevents concurrent manual clicks from running overlapping sync jobs.
 * 3. Strict Sequential Processing: Outbox entries are processed one-by-one in FIFO insertion order
 *    (Promise.all is never used).
 * 4. Per-Account Failure Isolation: If an entry fails for an account, all subsequent entries for that
 *    SAME account are skipped to preserve version progression (v1 -> v2 -> v3).
 * 5. Multi-Account Progression: Other independent accounts continue processing if unblocked.
 * 6. Non-Destructive to Other Entities: Unsupported entities ('transactions', 'categories', etc.)
 *    remain untouched in the outbox.
 * 7. Dispatcher Acknowledgment: The runner never deletes entries directly; outbox records are
 *    acknowledged (deleted) solely by AccountSyncDispatcher after verified remote persistence.
 * 8. Zero Background/Timer Activity: No timers, listeners, or automatic triggers.
 */
export class ManualAccountSyncRunner {
  private isRunning = false;

  constructor(
    private readonly dispatcher: AccountSyncDispatcher,
    private readonly outboxManager: OutboxManager,
    private readonly authPort: AuthPort
  ) {}

  public isSyncRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Retrieves pending outbox records specifically for the 'accounts' entity.
   * Scoped to the authenticated user.
   */
  public async getPendingAccountEntries(userId?: string, limit = 100): Promise<LocalOutboxRecord[]> {
    const targetUserId = userId || (await this.authPort.getCurrentUser())?.id;
    if (!targetUserId) {
      return [];
    }
    const allPending = await this.outboxManager.getPendingEntries(targetUserId, limit);
    return allPending.filter((entry) => entry.entity === 'accounts');
  }

  /**
   * Retrieves the count of pending outbox records for accounts.
   * Scoped to the authenticated user.
   */
  public async getPendingAccountCount(userId?: string): Promise<number> {
    const targetUserId = userId || (await this.authPort.getCurrentUser())?.id;
    if (!targetUserId) {
      return 0;
    }
    const accountEntries = await this.getPendingAccountEntries(targetUserId, 500);
    return accountEntries.length;
  }

  /**
   * Executes manual synchronization of pending account outbox records.
   */
  public async run(limit = 50): Promise<ManualAccountSyncResult> {
    if (this.isRunning) {
      throw new SyncInProgressError();
    }

    this.isRunning = true;

    try {
      // 1. Guard authenticated session
      const currentUser = await this.authPort.getCurrentUser();
      if (!currentUser || !currentUser.id) {
        throw new SyncAuthError('Manual account sync rejected: User is not authenticated.');
      }

      const result: ManualAccountSyncResult = {
        totalPending: 0,
        totalProcessed: 0,
        syncedCount: 0,
        failedCount: 0,
        skippedCount: 0,
        unsupportedCount: 0,
        errors: []
      };

      // 2. Fetch pending entries ordered by id (FIFO outbox order) scoped to authenticated user
      const pendingEntries = await this.outboxManager.getPendingEntries(currentUser.id, limit);
      result.totalPending = pendingEntries.length;

      // Track account IDs that failed during this execution run
      const failedAccountIds = new Set<string>();

      // 3. Process entries sequentially
      for (const entry of pendingEntries) {
        // Unsupported entities must remain untouched in outbox
        if (entry.entity !== 'accounts') {
          result.unsupportedCount++;
          continue;
        }

        const accountId = entry.entityId;

        // Skip subsequent entries for an account that already encountered a failure
        if (failedAccountIds.has(accountId)) {
          result.skippedCount++;
          continue;
        }

        result.totalProcessed++;

        try {
          // Dispatch entry through AccountSyncDispatcher
          await this.dispatcher.dispatch(entry);
          result.syncedCount++;
        } catch (error) {
          result.failedCount++;
          failedAccountIds.add(accountId);

          const errorMsg = error instanceof Error ? error.message : String(error);
          result.errors.push({
            entityId: accountId,
            outboxId: entry.id,
            error: errorMsg
          });
          // Do not delete entry here. The dispatcher has recorded failure metadata in outbox.
          // Other accounts continue processing sequentially.
        }
      }

      return result;
    } finally {
      this.isRunning = false;
    }
  }
}

// Default singleton instances
const defaultSupabaseAccountRepo = new SupabaseAccountRepository();
const defaultOutboxManager = new OutboxManager();
const defaultAccountDispatcher = new AccountSyncDispatcher(
  defaultSupabaseAccountRepo,
  defaultAuthAdapter,
  defaultOutboxManager
);

export const defaultManualAccountSyncRunner = new ManualAccountSyncRunner(
  defaultAccountDispatcher,
  defaultOutboxManager,
  defaultAuthAdapter
);

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
import { OutboxManager } from './OutboxManager';
import { AuthPort } from '@/application/ports/AuthPort';
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
import { SupabaseAccountRepository } from '../database/cloud/repositories/SupabaseAccountRepository';
import { SupabaseTransactionRepository } from '../database/cloud/repositories/SupabaseTransactionRepository';
import { SupabaseCategoryRepository } from '../database/cloud/repositories/SupabaseCategoryRepository';
import { SupabaseBudgetRepository } from '../database/cloud/repositories/SupabaseBudgetRepository';
import { SupabaseLenderRepository } from '../database/cloud/repositories/SupabaseLenderRepository';
import { SupabaseBorrowingRepository } from '../database/cloud/repositories/SupabaseBorrowingRepository';
import { SupabaseBorrowingRepaymentRepository } from '../database/cloud/repositories/SupabaseBorrowingRepaymentRepository';
import { SupabaseRecurringRuleRepository } from '../database/cloud/repositories/SupabaseRecurringRuleRepository';
import { SupabaseRecurringOccurrenceRepository } from '../database/cloud/repositories/SupabaseRecurringOccurrenceRepository';
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
  pulledCount: number;

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
  };
  lenders: {
    syncedCount: number;
    failedCount: number;
    skippedCount: number;
  };
  borrowings: {
    syncedCount: number;
    failedCount: number;
    skippedCount: number;
    dependencyBlockedCount: number;
  };
  borrowing_repayments: {
    syncedCount: number;
    failedCount: number;
    skippedCount: number;
    dependencyBlockedCount: number;
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

  // Detailed errors
  errors: SyncErrorItem[];
}

/**
 * ManualSyncCoordinator
 *
 * Dedicated unified application-level coordinator for manual synchronization of
 * financial outbox entries in strict dependency order and bidirectional budget reconciliation:
 * Accounts -> Categories -> Budgets -> Transactions -> Lenders -> Borrowings (Inserts) -> Borrowing Repayments -> Borrowings (Updates) -> Budget Cloud Pull.
 *
 * Guarantees:
 * 1. Strict User Context: Requires authenticated user; rejects unauthenticated calls with SyncAuthError.
 * 2. Concurrency Safety: Mutex prevents concurrent manual clicks from starting competing global sync jobs.
 * 3. Strict Dependency Ordering:
 *    Accounts -> Categories -> Budgets -> Transactions -> Lenders -> Borrowings (Inserts) -> Borrowing Repayments -> Borrowings (Updates) -> Budget Pull Reconciliation.
 * 4. Cross-Entity Dependency Failure Isolation:
 *    If an upstream entity (e.g. Account, Category, Transaction, Lender, Borrowing) fails synchronization,
 *    all downstream dependent records are safely blocked and SKIPPED. They remain in the outbox
 *    with their pending state completely preserved (never deleted or acknowledged).
 * 5. Strict Sequential Processing: Outbox entries within each entity group are processed in FIFO order.
 * 6. Per-Entity Failure Isolation: If an earlier event for an entity fails, subsequent events for that SAME
 *    entity ID (or same Budget slot `(userId, categoryId, period)`) are skipped during this run to preserve version progression (v1 -> v2 -> v3).
 * 7. Multi-Entity Progression: Other independent accounts, categories, budgets, transactions, lenders, borrowings,
 *    and repayments continue processing uninhibited.
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
    private readonly categoryDispatcher?: CategorySyncDispatcher,
    private readonly lenderDispatcher?: LenderSyncDispatcher,
    private readonly borrowingDispatcher?: BorrowingSyncDispatcher,
    private readonly borrowingRepaymentDispatcher?: BorrowingRepaymentSyncDispatcher,
    private readonly budgetDispatcher?: BudgetSyncDispatcher,
    private readonly budgetReconciler?: BudgetReconciliationService,
    private readonly recurringRuleDispatcher?: RecurringRuleSyncDispatcher,
    private readonly recurringOccurrenceDispatcher?: RecurringOccurrenceSyncDispatcher,
    private readonly recurringReconciler?: RecurringReconciliationService
  ) {}

  public isSyncRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Retrieves pending outbox records for coordinated entities.
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
      if (entry.entity === 'budgets' && this.budgetDispatcher) return true;
      if (entry.entity === 'recurring_rules' && this.recurringRuleDispatcher) return true;
      if (entry.entity === 'recurring_occurrences' && this.recurringOccurrenceDispatcher) return true;
      if (entry.entity === 'lenders' && this.lenderDispatcher) return true;
      if (entry.entity === 'borrowings' && this.borrowingDispatcher) return true;
      if (entry.entity === 'borrowing_repayments' && this.borrowingRepaymentDispatcher) return true;
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
   * Executes unified manual synchronization of pending outbox records.
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
        pulledCount: 0,
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
          conflictCount: 0
        },
        lenders: {
          syncedCount: 0,
          failedCount: 0,
          skippedCount: 0
        },
        borrowings: {
          syncedCount: 0,
          failedCount: 0,
          skippedCount: 0,
          dependencyBlockedCount: 0
        },
        borrowing_repayments: {
          syncedCount: 0,
          failedCount: 0,
          skippedCount: 0,
          dependencyBlockedCount: 0
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
        errors: []
      };

      // 2. Fetch pending entries ordered by id (FIFO outbox order) scoped to authenticated user
      const pendingEntries = await this.outboxManager.getPendingEntries(currentUser.id, limit);
      result.totalPending = pendingEntries.length;

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
        } else {
          unsupportedEntries.push(entry);
        }
      }

      result.unsupportedCount = unsupportedEntries.length;

      // Tracking sets for cascading dependency failure isolation
      const failedAccountIds = new Set<string>();
      const failedCategoryIds = new Set<string>();
      const failedBudgetIds = new Set<string>();
      const failedBudgetSlots = new Set<string>();
      const failedTransactionIds = new Set<string>();
      const failedRecurringRuleIds = new Set<string>();
      const failedRecurringOccurrenceIds = new Set<string>();
      const rulesWithFailedOccurrences = new Set<string>();
      const failedLenderIds = new Set<string>();
      const failedBorrowingIds = new Set<string>();

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

      // -----------------------------------------------------------------------
      // STAGE 3: BUDGETS (depends on Categories; preserves FIFO per budget ID & slot)
      // -----------------------------------------------------------------------
      for (const entry of budgetEntries) {
        const budgetId = entry.entityId;
        const rawUserId = entry.payload?.user_id ?? entry.payload?.userId;
        const slotUserId =
          typeof rawUserId === 'string' && rawUserId.trim().length > 0
            ? rawUserId.trim()
            : currentUser.id;
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
            category: 'category'
          });
          continue;
        }

        result.totalProcessed++;

        try {
          if (!this.budgetDispatcher) {
            throw new Error('BudgetSyncDispatcher is not configured.');
          }
          await this.budgetDispatcher.dispatch(entry);
          result.syncedCount++;
          result.budgets.syncedCount++;
        } catch (error) {
          result.failedCount++;
          result.budgets.failedCount++;
          failedBudgetIds.add(budgetId);
          if (slotKey) {
            failedBudgetSlots.add(slotKey);
          }

          const errorMsg = error instanceof Error ? error.message : String(error);
          const category = this.classifyError(error);

          if (error instanceof SyncUnresolvedCategoryError) {
            result.budgets.categoryBlockedCount++;
          } else if (error instanceof SyncConflictError) {
            result.budgets.conflictCount++;
          }

          result.errors.push({
            entity: 'budgets',
            entityId: budgetId,
            outboxId: entry.id,
            error: errorMsg,
            category
          });
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
            category: 'dependency'
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
            category: 'dependency'
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
            category: 'category'
          });
          continue;
        }

        result.totalProcessed++;
        try {
          await this.recurringRuleDispatcher!.dispatch(entry);
          result.syncedCount++;
          result.recurring_rules!.syncedCount++;
        } catch (error) {
          result.failedCount++;
          result.recurring_rules!.failedCount++;
          failedRecurringRuleIds.add(ruleId);
          result.errors.push({
            entity: 'recurring_rules',
            entityId: ruleId,
            outboxId: entry.id,
            error: error instanceof Error ? error.message : String(error),
            category: this.classifyError(error)
          });
        }
      }

      // -----------------------------------------------------------------------
      // STAGE 3C: RECURRING OCCURRENCES (INSERTS & UPDATES)
      // Must follow Rule INSERTS/UPDATES and Transactions, and precede Rule DELETES
      // so offline create -> confirm -> delete sequences synchronize cleanly.
      // -----------------------------------------------------------------------
      for (const entry of recurringOccurrenceEntries) {
        const occId = entry.entityId;
        if (failedRecurringOccurrenceIds.has(occId)) {
          result.skippedCount++;
          result.recurring_occurrences!.skippedCount++;
          continue;
        }

        const ruleId = String(entry.payload.recurring_rule_id ?? entry.payload.recurringRuleId ?? '');
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
            category: 'dependency'
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
            category: 'dependency'
          });
          continue;
        }

        result.totalProcessed++;
        try {
          await this.recurringOccurrenceDispatcher!.dispatch(entry);
          result.syncedCount++;
          result.recurring_occurrences!.syncedCount++;
        } catch (error) {
          result.failedCount++;
          result.recurring_occurrences!.failedCount++;
          failedRecurringOccurrenceIds.add(occId);
          if (ruleId) rulesWithFailedOccurrences.add(ruleId);
          result.errors.push({
            entity: 'recurring_occurrences',
            entityId: occId,
            outboxId: entry.id,
            error: error instanceof Error ? error.message : String(error),
            category: this.classifyError(error)
          });
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

        result.totalProcessed++;
        try {
          await this.recurringRuleDispatcher!.dispatch(entry);
          result.syncedCount++;
          result.recurring_rules!.syncedCount++;
        } catch (error) {
          result.failedCount++;
          result.recurring_rules!.failedCount++;
          failedRecurringRuleIds.add(ruleId);
          result.errors.push({
            entity: 'recurring_rules',
            entityId: ruleId,
            outboxId: entry.id,
            error: error instanceof Error ? error.message : String(error),
            category: this.classifyError(error)
          });
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

        result.totalProcessed++;

        try {
          if (!this.lenderDispatcher) {
            throw new Error('LenderSyncDispatcher is not configured.');
          }
          await this.lenderDispatcher.dispatch(entry);
          result.syncedCount++;
          result.lenders.syncedCount++;
        } catch (error) {
          result.failedCount++;
          result.lenders.failedCount++;
          failedLenderIds.add(lenderId);

          const errorMsg = error instanceof Error ? error.message : String(error);
          result.errors.push({
            entity: 'lenders',
            entityId: lenderId,
            outboxId: entry.id,
            error: errorMsg,
            category: this.classifyError(error)
          });
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
            category: 'dependency'
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
            category: 'dependency'
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
            category: 'dependency'
          });
          continue;
        }

        result.totalProcessed++;

        try {
          if (!this.borrowingDispatcher) {
            throw new Error('BorrowingSyncDispatcher is not configured.');
          }
          await this.borrowingDispatcher.dispatch(entry);
          result.syncedCount++;
          result.borrowings.syncedCount++;
        } catch (error) {
          result.failedCount++;
          result.borrowings.failedCount++;
          failedBorrowingIds.add(borrowingId);

          const errorMsg = error instanceof Error ? error.message : String(error);
          const category = this.classifyError(error);

          if (
            error instanceof SyncAccountDependencyError ||
            error instanceof SyncLenderDependencyError ||
            error instanceof SyncTransactionDependencyError
          ) {
            result.borrowings.dependencyBlockedCount++;
          }

          result.errors.push({
            entity: 'borrowings',
            entityId: borrowingId,
            outboxId: entry.id,
            error: errorMsg,
            category
          });
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

        if (borrowingId && failedBorrowingIds.has(borrowingId)) {
          result.failedCount++;
          result.borrowing_repayments.failedCount++;
          result.borrowing_repayments.dependencyBlockedCount++;

          result.errors.push({
            entity: 'borrowing_repayments',
            entityId: repaymentId,
            outboxId: entry.id,
            error: `Cannot sync repayment '${repaymentId}': referenced borrowing '${borrowingId}' failed synchronization.`,
            category: 'dependency'
          });
          continue;
        }

        if (lenderId && failedLenderIds.has(lenderId)) {
          result.failedCount++;
          result.borrowing_repayments.failedCount++;
          result.borrowing_repayments.dependencyBlockedCount++;

          result.errors.push({
            entity: 'borrowing_repayments',
            entityId: repaymentId,
            outboxId: entry.id,
            error: `Cannot sync repayment '${repaymentId}': referenced lender '${lenderId}' failed synchronization.`,
            category: 'dependency'
          });
          continue;
        }

        if (paymentAccountId && failedAccountIds.has(paymentAccountId)) {
          result.failedCount++;
          result.borrowing_repayments.failedCount++;
          result.borrowing_repayments.dependencyBlockedCount++;

          result.errors.push({
            entity: 'borrowing_repayments',
            entityId: repaymentId,
            outboxId: entry.id,
            error: `Cannot sync repayment '${repaymentId}': referenced payment account '${paymentAccountId}' failed synchronization.`,
            category: 'dependency'
          });
          continue;
        }

        if (transactionId && failedTransactionIds.has(transactionId)) {
          result.failedCount++;
          result.borrowing_repayments.failedCount++;
          result.borrowing_repayments.dependencyBlockedCount++;

          result.errors.push({
            entity: 'borrowing_repayments',
            entityId: repaymentId,
            outboxId: entry.id,
            error: `Cannot sync repayment '${repaymentId}': referenced transfer transaction '${transactionId}' failed synchronization.`,
            category: 'dependency'
          });
          continue;
        }

        result.totalProcessed++;

        try {
          if (!this.borrowingRepaymentDispatcher) {
            throw new Error('BorrowingRepaymentSyncDispatcher is not configured.');
          }
          await this.borrowingRepaymentDispatcher.dispatch(entry);
          result.syncedCount++;
          result.borrowing_repayments.syncedCount++;
        } catch (error) {
          result.failedCount++;
          result.borrowing_repayments.failedCount++;

          const errorMsg = error instanceof Error ? error.message : String(error);
          const category = this.classifyError(error);

          if (
            error instanceof SyncAccountDependencyError ||
            error instanceof SyncLenderDependencyError ||
            error instanceof SyncBorrowingDependencyError ||
            error instanceof SyncTransactionDependencyError
          ) {
            result.borrowing_repayments.dependencyBlockedCount++;
          }

          result.errors.push({
            entity: 'borrowing_repayments',
            entityId: repaymentId,
            outboxId: entry.id,
            error: errorMsg,
            category
          });
        }
      }

      // -----------------------------------------------------------------------
      // STAGE 7: BORROWINGS (UPDATES)
      // Must follow Repayments (Stage 6) so cloud settled repayments are present
      // before evaluating any borrowing status validation triggers
      // -----------------------------------------------------------------------
      for (const entry of borrowingUpdateEntries) {
        const borrowingId = entry.entityId;

        if (failedBorrowingIds.has(borrowingId)) {
          result.skippedCount++;
          result.borrowings.skippedCount++;
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
            category: 'dependency'
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
            category: 'dependency'
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
            category: 'dependency'
          });
          continue;
        }

        result.totalProcessed++;

        try {
          if (!this.borrowingDispatcher) {
            throw new Error('BorrowingSyncDispatcher is not configured.');
          }
          await this.borrowingDispatcher.dispatch(entry);
          result.syncedCount++;
          result.borrowings.syncedCount++;
        } catch (error) {
          result.failedCount++;
          result.borrowings.failedCount++;
          failedBorrowingIds.add(borrowingId);

          const errorMsg = error instanceof Error ? error.message : String(error);
          const category = this.classifyError(error);

          if (
            error instanceof SyncAccountDependencyError ||
            error instanceof SyncLenderDependencyError ||
            error instanceof SyncTransactionDependencyError
          ) {
            result.borrowings.dependencyBlockedCount++;
          }

          result.errors.push({
            entity: 'borrowings',
            entityId: borrowingId,
            outboxId: entry.id,
            error: errorMsg,
            category
          });
        }
      }

      // -----------------------------------------------------------------------
      // STAGE 9: BUDGET CLOUD PULL & LOCAL RECONCILIATION
      // -----------------------------------------------------------------------
      if (this.budgetReconciler) {
        try {
          const pullResult = await this.budgetReconciler.pullAndReconcile(currentUser.id);
          result.pulledCount += pullResult.pulledCount;
          result.budgets.pulledCount += pullResult.pulledCount;
          result.budgets.conflictCount += pullResult.conflictCount;

          for (const conflict of pullResult.conflicts) {
            result.errors.push({
              entity: 'budgets',
              entityId: conflict.budgetId,
              error: conflict.reason,
              category: 'conflict'
            });
          }
        } catch (error) {
          result.failedCount++;
          result.budgets.failedCount++;
          const errorMsg = error instanceof Error ? error.message : String(error);
          result.errors.push({
            entity: 'budgets',
            entityId: 'reconcile',
            error: errorMsg,
            category: this.classifyError(error)
          });
        }
      }

      // -----------------------------------------------------------------------
      // STAGE 10: RECURRING SCHEDULES & OCCURRENCES PULL RECONCILIATION
      // -----------------------------------------------------------------------
      if (this.recurringReconciler) {
        try {
          const recurringPull = await this.recurringReconciler.pullAndReconcile(currentUser.id);
          result.pulledCount += recurringPull.pulledCount;
          for (const conflict of recurringPull.conflicts) {
            result.errors.push({
              entity: conflict.entity,
              entityId: conflict.entityId,
              error: conflict.reason,
              category: 'conflict'
            });
          }
        } catch (error) {
          result.failedCount++;
          result.recurring_rules!.failedCount++;
          result.errors.push({
            entity: 'recurring_rules',
            entityId: 'reconcile',
            error: error instanceof Error ? error.message : String(error),
            category: this.classifyError(error)
          });
        }
      }

      // 7. Update remaining still pending count scoped to authenticated user
      result.stillPendingCount = await this.outboxManager.getPendingCount(currentUser.id);

      return result;
    } finally {
      this.isRunning = false;
    }
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
  defaultRecurringOccurrenceDispatcher
);

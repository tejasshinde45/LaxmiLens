import {
  AccountDeletionDependencies,
  AccountDeletionDependencyInspector
} from '@/application/ports/AccountDeletionPort';
import { validateUserId } from '@/domain/value-objects/Identifiers';
import { db, LaxmiLensDB } from '../DexieDatabase';
import {
  LocalBorrowingRecord,
  LocalBorrowingRepaymentRecord,
  LocalOutboxRecord,
  LocalRecurringOccurrenceRecord,
  LocalRecurringRuleRecord,
  LocalTransactionRecord
} from '../schema';

const ACCOUNT_REFERENCE_OUTBOX_FIELDS = [
  'account_id',
  'accountId',
  'destination_account_id',
  'destinationAccountId',
  'target_account_id',
  'targetAccountId',
  'receiving_account_id',
  'receivingAccountId',
  'payment_account_id',
  'paymentAccountId'
] as const;

export class DexieAccountDeletionInspector implements AccountDeletionDependencyInspector {
  constructor(private readonly database: LaxmiLensDB = db) {}

  public async inspect(
    accountId: string,
    userId: string
  ): Promise<AccountDeletionDependencies> {
    const validatedUserId = validateUserId(userId);

    const [
      transactions,
      recurringRules,
      recurringOccurrences,
      borrowings,
      repayments,
      outboxEntries
    ] = await Promise.all([
      this.database.transactions
        .where('userId')
        .equals(validatedUserId)
        .toArray() as Promise<LocalTransactionRecord[]>,
      this.database.recurringRules
        .where('userId')
        .equals(validatedUserId)
        .toArray() as Promise<LocalRecurringRuleRecord[]>,
      this.database.recurringOccurrences
        .where('userId')
        .equals(validatedUserId)
        .toArray() as Promise<LocalRecurringOccurrenceRecord[]>,
      this.database.borrowings
        .where('userId')
        .equals(validatedUserId)
        .toArray() as Promise<LocalBorrowingRecord[]>,
      this.database.borrowingRepayments
        .where('userId')
        .equals(validatedUserId)
        .toArray() as Promise<LocalBorrowingRepaymentRecord[]>,
      this.database.syncOutbox
        .where('userId')
        .equals(validatedUserId)
        .toArray() as Promise<LocalOutboxRecord[]>
    ]);

    let activeTransactionCount = 0;
    let transferCount = 0;
    let softDeletedTransactionCount = 0;
    const matchedTransactionIds = new Set<string>();

    for (const tx of transactions) {
      const touchesAccount =
        tx.accountId === accountId ||
        tx.destinationAccountId === accountId ||
        tx.targetAccountId === accountId;
      if (!touchesAccount) continue;

      matchedTransactionIds.add(tx.id);
      const isDeleted = tx.deletedAt !== null || tx.isDeleted === true;
      if (isDeleted) {
        softDeletedTransactionCount++;
      } else if (
        tx.type === 'transfer' ||
        tx.destinationAccountId === accountId ||
        tx.targetAccountId === accountId
      ) {
        transferCount++;
      } else {
        activeTransactionCount++;
      }
    }

    let activeRecurringRuleCount = 0;
    let deletedRecurringRuleCount = 0;
    const matchedRuleIds = new Set<string>();

    for (const rule of recurringRules) {
      if (rule.accountId !== accountId && rule.targetAccountId !== accountId) {
        continue;
      }
      matchedRuleIds.add(rule.id);
      if (rule.deletedAt) {
        deletedRecurringRuleCount++;
      } else {
        activeRecurringRuleCount++;
      }
    }

    let recurringOccurrenceCount = 0;
    for (const occ of recurringOccurrences) {
      if (
        matchedRuleIds.has(occ.recurringRuleId) ||
        (occ.transactionId && matchedTransactionIds.has(occ.transactionId))
      ) {
        recurringOccurrenceCount++;
      }
    }

    const matchedBorrowingIds = new Set(
      borrowings
        .filter((b) => b.receivingAccountId === accountId)
        .map((b) => b.id)
    );
    const borrowingCount = matchedBorrowingIds.size;

    const matchedRepaymentIds = new Set(
      repayments
        .filter((r) => r.paymentAccountId === accountId)
        .map((r) => r.id)
    );
    const repaymentCount = matchedRepaymentIds.size;

    let pendingAccountOutboxCount = 0;
    let pendingDependentOutboxCount = 0;

    for (const entry of outboxEntries) {
      if (entry.entity === 'accounts' && entry.entityId === accountId) {
        pendingAccountOutboxCount++;
        continue;
      }

      const payload = entry.payload || {};
      const refsAccount = ACCOUNT_REFERENCE_OUTBOX_FIELDS.some(
        (field) => payload[field] === accountId
      );
      const ruleRef = payload.recurring_rule_id ?? payload.recurringRuleId;
      const refsMatchedRule = typeof ruleRef === 'string' && matchedRuleIds.has(ruleRef);
      const txRef = payload.transaction_id ?? payload.transactionId;
      const refsMatchedTx = typeof txRef === 'string' && matchedTransactionIds.has(txRef);
      const refsMatchedEntityId =
        (entry.entity === 'transactions' && matchedTransactionIds.has(entry.entityId)) ||
        (entry.entity === 'recurring_rules' && matchedRuleIds.has(entry.entityId)) ||
        (entry.entity === 'borrowings' && matchedBorrowingIds.has(entry.entityId)) ||
        (entry.entity === 'borrowing_repayments' && matchedRepaymentIds.has(entry.entityId));

      if (refsAccount || refsMatchedRule || refsMatchedTx || refsMatchedEntityId) {
        pendingDependentOutboxCount++;
      }
    }

    return {
      activeTransactionCount,
      transferCount,
      softDeletedTransactionCount,
      activeRecurringRuleCount,
      deletedRecurringRuleCount,
      recurringOccurrenceCount,
      borrowingCount,
      repaymentCount,
      pendingAccountOutboxCount,
      pendingDependentOutboxCount
    };
  }
}

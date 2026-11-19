import Dexie, { type Table } from 'dexie';
import { APP_CONFIG } from '@/config/constants';
import {
  LocalProfileRecord,
  LocalAccountRecord,
  LocalTransactionRecord,
  LocalCategoryRecord,
  LocalBudgetRecord,
  LocalRecurringRuleRecord,
  LocalOutboxRecord,
  LocalSyncMetadataRecord
} from './schema';

export class LaxmiLensDB extends Dexie {
  public profiles!: Table<LocalProfileRecord, string>;
  public accounts!: Table<LocalAccountRecord, string>;
  public transactions!: Table<LocalTransactionRecord, string>;
  public categories!: Table<LocalCategoryRecord, string>;
  public budgets!: Table<LocalBudgetRecord, string>;
  public recurringRules!: Table<LocalRecurringRuleRecord, string>;
  public syncOutbox!: Table<LocalOutboxRecord, number>;
  public syncMetadata!: Table<LocalSyncMetadataRecord, string>;

  constructor() {
    super(APP_CONFIG.database.name);

    // Initial Schema Version 1
    this.version(1).stores({
      accounts: 'id, type, status, version, createdAt',
      transactions: 'id, type, accountId, targetAccountId, categoryId, date, status, idempotencyKey, version, isDeleted, [accountId+date]',
      categories: 'id, type, parentId, isSystem, version',
      budgets: 'id, categoryId, period, [categoryId+period], version',
      recurringRules: 'id, frequency, isActive, nextDueDate, version',
      syncOutbox: '++id, entity, entityId, operation, idempotencyKey, attempts, createdAt',
      syncMetadata: 'key, updatedAt'
    });

    // Version 2: Core Financial Foundation (Milestone 3)
    this.version(2)
      .stores({
        profiles: 'id, email, currency',
        accounts: 'id, userId, accountType, isArchived, version, createdAt',
        transactions:
          'id, userId, type, accountId, destinationAccountId, categoryId, transactionDate, deletedAt, idempotencyKey, version, [accountId+transactionDate], [userId+transactionDate]',
        categories: 'id, userId, type, isArchived, isDefault, version',
        budgets: 'id, categoryId, period, [categoryId+period], version',
        recurringRules: 'id, frequency, isActive, nextDueDate, version',
        syncOutbox: '++id, entity, entityId, operation, idempotencyKey, attempts, createdAt',
        syncMetadata: 'key, updatedAt'
      })
      .upgrade((tx) => {
        // Upgrade existing local data without data loss
        return Promise.all([
          tx
            .table('accounts')
            .toCollection()
            .modify((acc: LocalAccountRecord) => {
              acc.userId = acc.userId || 'local-user';
              acc.accountType =
                acc.accountType || (acc.type as LocalAccountRecord['accountType']) || 'other';
              acc.openingBalancePaise =
                acc.openingBalancePaise ?? acc.openingBalanceInPaise ?? 0;
              acc.isArchived = acc.isArchived ?? (acc.status === 'archived');
            }),
          tx
            .table('categories')
            .toCollection()
            .modify((cat: LocalCategoryRecord) => {
              cat.userId = cat.userId || 'local-user';
              cat.isDefault = cat.isDefault ?? cat.isSystem ?? false;
              cat.isArchived = cat.isArchived ?? false;
            }),
          tx
            .table('transactions')
            .toCollection()
            .modify((t: LocalTransactionRecord) => {
              t.userId = t.userId || 'local-user';
              t.amountPaise = t.amountPaise ?? t.amountInPaise ?? 0;
              t.title = t.title || t.description || 'Transaction';
              t.note = t.note ?? t.notes;
              t.transactionDate = t.transactionDate || t.date || new Date().toISOString();
              t.destinationAccountId = t.destinationAccountId || t.targetAccountId;
              t.deletedAt = t.deletedAt ?? (t.isDeleted ? new Date().toISOString() : null);
            })
        ]);
      });
  }
}

// Singleton local database instance
export const db = new LaxmiLensDB();

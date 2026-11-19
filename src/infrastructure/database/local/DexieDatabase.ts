import Dexie, { type Table } from 'dexie';
import { APP_CONFIG } from '@/config/constants';
import {
  LocalAccountRecord,
  LocalTransactionRecord,
  LocalCategoryRecord,
  LocalBudgetRecord,
  LocalRecurringRuleRecord,
  LocalOutboxRecord,
  LocalSyncMetadataRecord
} from './schema';

export class LaxmiLensDB extends Dexie {
  public accounts!: Table<LocalAccountRecord, string>;
  public transactions!: Table<LocalTransactionRecord, string>;
  public categories!: Table<LocalCategoryRecord, string>;
  public budgets!: Table<LocalBudgetRecord, string>;
  public recurringRules!: Table<LocalRecurringRuleRecord, string>;
  public syncOutbox!: Table<LocalOutboxRecord, number>;
  public syncMetadata!: Table<LocalSyncMetadataRecord, string>;

  constructor() {
    super(APP_CONFIG.database.name);

    this.version(1).stores({
      accounts: 'id, type, status, version, createdAt',
      transactions: 'id, type, accountId, targetAccountId, categoryId, date, status, idempotencyKey, version, isDeleted, [accountId+date]',
      categories: 'id, type, parentId, isSystem, version',
      budgets: 'id, categoryId, period, [categoryId+period], version',
      recurringRules: 'id, frequency, isActive, nextDueDate, version',
      syncOutbox: '++id, entity, entityId, operation, idempotencyKey, attempts, createdAt',
      syncMetadata: 'key, updatedAt'
    });
  }
}

// Singleton local database instance
export const db = new LaxmiLensDB();

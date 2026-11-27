import Dexie from 'dexie';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LaxmiLensDB } from '@/infrastructure/database/local/DexieDatabase';
import {
  LocalAccountRecord,
  LocalBorrowingRecord,
  LocalBorrowingRepaymentRecord,
  LocalBudgetRecord,
  LocalCategoryRecord,
  LocalLenderRecord,
  LocalNotificationPreferenceRecord,
  LocalNotificationRecord,
  LocalOutboxRecord,
  LocalRecurringOccurrenceRecord,
  LocalRecurringRuleRecord,
  LocalSyncMetadataRecord,
  LocalTransactionRecord
} from '@/infrastructure/database/local/schema';
import { AuthPort, AuthUser } from '@/application/ports/AuthPort';
import { OutboxManager } from '@/infrastructure/sync/OutboxManager';
import { CategoryMappingService } from '@/infrastructure/sync/CategoryMappingService';
import { CategoryReconciliationService } from '@/infrastructure/sync/CategoryReconciliationService';
import { AccountReconciliationService } from '@/infrastructure/sync/AccountReconciliationService';
import { TransactionReconciliationService } from '@/infrastructure/sync/TransactionReconciliationService';
import { BorrowingsReconciliationService } from '@/infrastructure/sync/BorrowingsReconciliationService';
import { BudgetReconciliationService } from '@/infrastructure/sync/BudgetReconciliationService';
import { RecurringReconciliationService } from '@/infrastructure/sync/RecurringReconciliationService';
import { NotificationReconciliationService } from '@/infrastructure/sync/NotificationReconciliationService';
import { ManualSyncCoordinator } from '@/infrastructure/sync/ManualSyncCoordinator';
import { AccountSyncDispatcher } from '@/infrastructure/sync/dispatchers/AccountSyncDispatcher';
import { CategorySyncDispatcher } from '@/infrastructure/sync/dispatchers/CategorySyncDispatcher';
import { BudgetSyncDispatcher } from '@/infrastructure/sync/dispatchers/BudgetSyncDispatcher';
import { TransactionSyncDispatcher } from '@/infrastructure/sync/dispatchers/TransactionSyncDispatcher';
import { LenderSyncDispatcher } from '@/infrastructure/sync/dispatchers/LenderSyncDispatcher';
import { BorrowingSyncDispatcher } from '@/infrastructure/sync/dispatchers/BorrowingSyncDispatcher';
import { BorrowingRepaymentSyncDispatcher } from '@/infrastructure/sync/dispatchers/BorrowingRepaymentSyncDispatcher';
import { RecurringRuleSyncDispatcher } from '@/infrastructure/sync/dispatchers/RecurringRuleSyncDispatcher';
import { RecurringOccurrenceSyncDispatcher } from '@/infrastructure/sync/dispatchers/RecurringOccurrenceSyncDispatcher';
import { NotificationSyncDispatcher } from '@/infrastructure/sync/dispatchers/NotificationSyncDispatcher';
import { NotificationPreferenceSyncDispatcher } from '@/infrastructure/sync/dispatchers/NotificationPreferenceSyncDispatcher';
import { DexieCategoryRepository } from '@/infrastructure/database/local/repositories/DexieCategoryRepository';
import { CloudAccountRow } from '@/infrastructure/database/cloud/mappers/AccountMapper';
import { CloudCategoryRow } from '@/infrastructure/database/cloud/mappers/CategoryMapper';
import { CloudTransactionRow } from '@/infrastructure/database/cloud/mappers/TransactionMapper';
import { CloudLenderRow } from '@/infrastructure/database/cloud/mappers/LenderMapper';
import { CloudBorrowingRow } from '@/infrastructure/database/cloud/mappers/BorrowingMapper';
import { CloudBorrowingRepaymentRow } from '@/infrastructure/database/cloud/mappers/BorrowingRepaymentMapper';
import { CloudBudgetRow } from '@/infrastructure/database/cloud/mappers/BudgetMapper';
import { CloudRecurringRuleRow } from '@/infrastructure/database/cloud/mappers/RecurringRuleMapper';
import { CloudRecurringOccurrenceRow } from '@/infrastructure/database/cloud/mappers/RecurringOccurrenceMapper';
import {
  CloudNotificationPreferenceRow,
  CloudNotificationRow
} from '@/infrastructure/database/cloud/mappers/NotificationMapper';
import { ISupabaseAccountRepository } from '@/infrastructure/database/cloud/repositories/SupabaseAccountRepository';
import { ISupabaseCategoryRepository } from '@/infrastructure/database/cloud/repositories/SupabaseCategoryRepository';
import {
  ISupabaseTransactionRepository,
  TransactionPageOptions,
  TransactionQueryOptions
} from '@/infrastructure/database/cloud/repositories/SupabaseTransactionRepository';
import { ISupabaseLenderRepository } from '@/infrastructure/database/cloud/repositories/SupabaseLenderRepository';
import { ISupabaseBorrowingRepository } from '@/infrastructure/database/cloud/repositories/SupabaseBorrowingRepository';
import { ISupabaseBorrowingRepaymentRepository } from '@/infrastructure/database/cloud/repositories/SupabaseBorrowingRepaymentRepository';
import { ISupabaseBudgetRepository } from '@/infrastructure/database/cloud/repositories/SupabaseBudgetRepository';
import { ISupabaseRecurringRuleRepository } from '@/infrastructure/database/cloud/repositories/SupabaseRecurringRuleRepository';
import { ISupabaseRecurringOccurrenceRepository } from '@/infrastructure/database/cloud/repositories/SupabaseRecurringOccurrenceRepository';
import { ISupabaseNotificationRepository } from '@/infrastructure/database/cloud/repositories/SupabaseNotificationRepository';
import { ISupabaseNotificationPreferenceRepository } from '@/infrastructure/database/cloud/repositories/SupabaseNotificationPreferenceRepository';
import { SyncAuthError } from '@/infrastructure/sync/errors/SyncErrors';

interface InMemoryLedgerStores {
  accounts: Map<string, LocalAccountRecord>;
  categories: Map<string, LocalCategoryRecord>;
  transactions: Map<string, LocalTransactionRecord>;
  budgets: Map<string, LocalBudgetRecord>;
  recurringRules: Map<string, LocalRecurringRuleRecord>;
  recurringOccurrences: Map<string, LocalRecurringOccurrenceRecord>;
  lenders: Map<string, LocalLenderRecord>;
  borrowings: Map<string, LocalBorrowingRecord>;
  borrowingRepayments: Map<string, LocalBorrowingRepaymentRecord>;
  notifications: Map<string, LocalNotificationRecord>;
  notificationPreferences: Map<string, LocalNotificationPreferenceRecord>;
  syncOutbox: Map<number, LocalOutboxRecord>;
  syncMetadata: Map<string, LocalSyncMetadataRecord>;
}

function createInMemoryLedgerDb() {
  const stores: InMemoryLedgerStores = {
    accounts: new Map(),
    categories: new Map(),
    transactions: new Map(),
    budgets: new Map(),
    recurringRules: new Map(),
    recurringOccurrences: new Map(),
    lenders: new Map(),
    borrowings: new Map(),
    borrowingRepayments: new Map(),
    notifications: new Map(),
    notificationPreferences: new Map(),
    syncOutbox: new Map(),
    syncMetadata: new Map()
  };

  let nextOutboxId = 1;

  function makeTable<T extends object, K extends string | number>(
    map: Map<K, T>,
    keyField: keyof T,
    autoIncrement = false
  ) {
    const getAll = () => Array.from(map.values()).map((r) => ({ ...r }));

    return {
      get: vi.fn(async (key: K) => {
        const found = map.get(key);
        return found ? { ...found } : undefined;
      }),
      put: vi.fn(async (record: T) => {
        let key = record[keyField] as unknown as K | undefined;
        if (autoIncrement && (key === undefined || key === null)) {
          key = nextOutboxId++ as unknown as K;
          (record as Record<string, unknown>)[keyField as string] = key;
        } else if (autoIncrement && typeof key === 'number' && key >= nextOutboxId) {
          nextOutboxId = key + 1;
        }
        map.set(key as K, { ...record });
        return key as K;
      }),
      add: vi.fn(async (record: T) => {
        let key = record[keyField] as unknown as K | undefined;
        if (autoIncrement && (key === undefined || key === null)) {
          key = nextOutboxId++ as unknown as K;
          (record as Record<string, unknown>)[keyField as string] = key;
        } else if (autoIncrement && typeof key === 'number' && key >= nextOutboxId) {
          nextOutboxId = key + 1;
        }
        map.set(key as K, { ...record });
        return key as K;
      }),
      update: vi.fn(async (key: K, patch: Partial<T>) => {
        const existing = map.get(key);
        if (!existing) return 0;
        map.set(key, { ...existing, ...patch });
        return 1;
      }),
      bulkPut: vi.fn(async (records: T[]) => {
        for (const r of records) {
          let key = r[keyField] as unknown as K | undefined;
          if (autoIncrement && (key === undefined || key === null)) {
            key = nextOutboxId++ as unknown as K;
          }
          map.set(key as K, { ...r });
        }
      }),
      delete: vi.fn(async (key: K) => {
        map.delete(key);
      }),
      bulkDelete: vi.fn(async (keys: K[]) => {
        for (const k of keys) map.delete(k);
      }),
      clear: vi.fn(async () => {
        map.clear();
      }),
      toArray: vi.fn(async () => getAll()),
      count: vi.fn(async () => map.size),
      filter: vi.fn((pred: (item: T) => boolean) => ({
        toArray: vi.fn(async () => getAll().filter(pred)),
        first: vi.fn(async () => getAll().find(pred))
      })),
      where: vi.fn((index: string) => ({
        equals: (val: unknown) => {
          const matchFn = (r: T): boolean => {
            const rec = r as Record<string, unknown>;
            if (index === 'userId') return rec.userId === val;
            if (index === '[userId+id]' && Array.isArray(val)) {
              return rec.userId === val[0] && rec.id === val[1];
            }
            if (index === '[userId+type]' && Array.isArray(val)) {
              return rec.userId === val[0] && rec.type === val[1];
            }
            if (index === '[userId+accountId]' && Array.isArray(val)) {
              return rec.userId === val[0] && rec.accountId === val[1];
            }
            return rec[index] === val;
          };
          const matched = () => getAll().filter(matchFn);
          return {
            toArray: vi.fn(async () => matched()),
            first: vi.fn(async () => matched()[0]),
            count: vi.fn(async () => matched().length)
          };
        },
        between: (
          lower: [string, unknown],
          upper: [string, unknown],
          includeLower = true,
          includeUpper = true
        ) => {
          const targetUserId = lower[0];
          const minVal = lower[1] === Dexie.minKey ? -Infinity : Number(lower[1]);
          const maxVal = upper[1] === Dexie.maxKey ? Infinity : Number(upper[1]);
          const matched = () =>
            getAll()
              .filter((r) => {
                const rec = r as Record<string, unknown>;
                if (rec.userId !== targetUserId) return false;
                const idVal = Number(rec.id ?? 0);
                const ge = includeLower ? idVal >= minVal : idVal > minVal;
                const le = includeUpper ? idVal <= maxVal : idVal < maxVal;
                return ge && le;
              })
              .sort((a, b) => Number((a as Record<string, unknown>).id) - Number((b as Record<string, unknown>).id));
          return {
            limit: (limitNum: number) => ({
              toArray: vi.fn(async () => matched().slice(0, limitNum))
            }),
            toArray: vi.fn(async () => matched())
          };
        }
      }))
    };
  }

  const dbObj = {
    isOpen: vi.fn(() => true),
    accounts: makeTable<LocalAccountRecord, string>(stores.accounts, 'id'),
    categories: makeTable<LocalCategoryRecord, string>(stores.categories, 'id'),
    transactions: makeTable<LocalTransactionRecord, string>(stores.transactions, 'id'),
    budgets: makeTable<LocalBudgetRecord, string>(stores.budgets, 'id'),
    recurringRules: makeTable<LocalRecurringRuleRecord, string>(stores.recurringRules, 'id'),
    recurringOccurrences: makeTable<LocalRecurringOccurrenceRecord, string>(
      stores.recurringOccurrences,
      'id'
    ),
    lenders: makeTable<LocalLenderRecord, string>(stores.lenders, 'id'),
    borrowings: makeTable<LocalBorrowingRecord, string>(stores.borrowings, 'id'),
    borrowingRepayments: makeTable<LocalBorrowingRepaymentRecord, string>(
      stores.borrowingRepayments,
      'id'
    ),
    notifications: makeTable<LocalNotificationRecord, string>(stores.notifications, 'id'),
    notificationPreferences: makeTable<LocalNotificationPreferenceRecord, string>(
      stores.notificationPreferences,
      'userId'
    ),
    syncOutbox: makeTable<LocalOutboxRecord, number>(stores.syncOutbox, 'id', true),
    syncMetadata: makeTable<LocalSyncMetadataRecord, string>(stores.syncMetadata, 'key'),
    transaction: vi.fn(async (...args: unknown[]) => {
      const fn = args[args.length - 1] as () => Promise<unknown>;
      return fn();
    })
  };

  return {
    db: dbObj as unknown as LaxmiLensDB,
    stores
  };
}

interface CloudMockStores {
  accounts: Map<string, CloudAccountRow>;
  categories: Map<string, CloudCategoryRow>;
  transactions: Map<string, CloudTransactionRow>;
  lenders: Map<string, CloudLenderRow>;
  borrowings: Map<string, CloudBorrowingRow>;
  repayments: Map<string, CloudBorrowingRepaymentRow>;
  budgets: Map<string, CloudBudgetRow>;
  recurringRules: Map<string, CloudRecurringRuleRow>;
  recurringOccurrences: Map<string, CloudRecurringOccurrenceRow>;
  notifications: Map<string, CloudNotificationRow>;
  notificationPreferences: Map<string, CloudNotificationPreferenceRow>;
}

function createMockCloudRepos(cloud: CloudMockStores) {
  const accountRepo: ISupabaseAccountRepository = {
    insert: vi.fn(async (row: CloudAccountRow) => {
      if (row.system_tag === 'personal_borrowings') {
        const existingPB = Array.from(cloud.accounts.values()).find(
          (a) => a.user_id === row.user_id && a.system_tag === 'personal_borrowings'
        );
        if (existingPB) {
          return { ...existingPB };
        }
      }
      cloud.accounts.set(row.id, { ...row });
      return { ...row };
    }),
    updatePartial: vi.fn(async (id, userId, patch, expectedVersion) => {
      const existing = cloud.accounts.get(id);
      if (!existing || existing.user_id !== userId) throw new Error('Account not found');
      const updated = { ...existing, ...patch, version: expectedVersion + 1 };
      cloud.accounts.set(id, updated);
      return { ...updated };
    }),
    findById: vi.fn(async (id) => {
      const found = cloud.accounts.get(id);
      return found ? { ...found } : null;
    }),
    findAll: vi.fn(async (userId: string) =>
      Array.from(cloud.accounts.values())
        .filter((r) => r.user_id === userId)
        .map((r) => ({ ...r }))
    ),
    findPage: vi.fn(async (userId: string, opts = {}) => {
      const offset = opts.offset ?? 0;
      const limit = opts.limit ?? 500;
      const all = Array.from(cloud.accounts.values()).filter((r) => r.user_id === userId);
      const rows = all.slice(offset, offset + limit).map((r) => ({ ...r }));
      return {
        rows,
        hasMore: offset + rows.length < all.length,
        nextOffset: offset + rows.length
      };
    })
  };

  const categoryRepo: ISupabaseCategoryRepository = {
    insert: vi.fn(async (row: CloudCategoryRow) => {
      cloud.categories.set(row.id, { ...row });
      return { ...row };
    }),
    updatePartial: vi.fn(async (id, userId, patch, expectedVersion) => {
      const existing = cloud.categories.get(id);
      if (!existing || existing.user_id !== userId) throw new Error('Category not found');
      const updated = { ...existing, ...patch, version: expectedVersion + 1 };
      cloud.categories.set(id, updated);
      return { ...updated };
    }),
    findById: vi.fn(async (id) => {
      const found = cloud.categories.get(id);
      return found ? { ...found } : null;
    }),
    findDefaultMatch: vi.fn(async (userId, type, name) => {
      const normalized = name.trim().toLowerCase();
      return (
        Array.from(cloud.categories.values()).find(
          (c) =>
            c.user_id === userId &&
            c.is_default &&
            c.type === type &&
            c.name.trim().toLowerCase() === normalized
        ) ?? null
      );
    }),
    findAll: vi.fn(async (userId: string) =>
      Array.from(cloud.categories.values())
        .filter((r) => r.user_id === userId)
        .map((r) => ({ ...r }))
    )
  };

  const transactionRepo: ISupabaseTransactionRepository = {
    insert: vi.fn(async (row: CloudTransactionRow) => {
      const persisted: CloudTransactionRow = {
        ...row,
        created_at: row.created_at ?? new Date().toISOString(),
        updated_at: row.updated_at ?? new Date().toISOString()
      };
      cloud.transactions.set(row.id, persisted);
      return { ...persisted };
    }),
    updatePartial: vi.fn(async (id, userId, patch, expectedVersion) => {
      const existing = cloud.transactions.get(id);
      if (!existing || existing.user_id !== userId) throw new Error('Tx not found');
      const updated = { ...existing, ...patch, version: expectedVersion + 1 };
      cloud.transactions.set(id, updated);
      return { ...updated };
    }),
    softDelete: vi.fn(async (id, userId, deletedAt, expectedVersion, targetVersion) => {
      const existing = cloud.transactions.get(id);
      if (!existing || existing.user_id !== userId) throw new Error('Tx not found');
      const updated = {
        ...existing,
        deleted_at: deletedAt,
        version: targetVersion ?? expectedVersion + 1
      };
      cloud.transactions.set(id, updated);
      return { ...updated };
    }),
    findById: vi.fn(async (id, userId) => {
      const found = cloud.transactions.get(id);
      return found && found.user_id === userId ? { ...found } : null;
    }),
    findByIdempotencyKey: vi.fn(async (key, userId) => {
      return (
        Array.from(cloud.transactions.values()).find(
          (t) => t.user_id === userId && t.idempotency_key === key
        ) ?? null
      );
    }),
    findPage: vi.fn(async (userId: string, opts: TransactionPageOptions = {}) => {
      const offset = opts.offset ?? 0;
      const limit = opts.limit ?? 500;
      const includeDeleted = opts.includeDeleted ?? true;
      const ordered = Array.from(cloud.transactions.values())
        .filter((r) => r.user_id === userId && (includeDeleted || r.deleted_at === null))
        .sort(
          (a, b) =>
            (a.created_at ?? '').localeCompare(b.created_at ?? '') || a.id.localeCompare(b.id)
        );
      const rows = ordered.slice(offset, offset + limit).map((r) => ({ ...r }));
      return {
        rows,
        hasMore: offset + rows.length < ordered.length,
        nextOffset: offset + rows.length
      };
    }),
    findAll: vi.fn(async (userId: string, opts: TransactionQueryOptions = {}) => {
      const includeDeleted = opts.includeDeleted ?? true;
      return Array.from(cloud.transactions.values())
        .filter((r) => r.user_id === userId && (includeDeleted || r.deleted_at === null))
        .sort(
          (a, b) =>
            (a.created_at ?? '').localeCompare(b.created_at ?? '') || a.id.localeCompare(b.id)
        )
        .map((r) => ({ ...r }));
    })
  };

  const lenderRepo: ISupabaseLenderRepository = {
    insert: vi.fn(async (row) => {
      cloud.lenders.set(row.id, { ...row });
      return { ...row };
    }),
    updatePartial: vi.fn(async (id, userId, patch) => {
      const existing = cloud.lenders.get(id);
      if (!existing || existing.user_id !== userId) throw new Error('Lender not found');
      const updated = { ...existing, ...patch };
      cloud.lenders.set(id, updated);
      return { ...updated };
    }),
    findById: vi.fn(async (id, userId) => {
      const found = cloud.lenders.get(id);
      return found && found.user_id === userId ? { ...found } : null;
    }),
    findAll: vi.fn(async (userId: string) =>
      Array.from(cloud.lenders.values())
        .filter((r) => r.user_id === userId)
        .map((r) => ({ ...r }))
    )
  };

  const borrowingRepo: ISupabaseBorrowingRepository = {
    insert: vi.fn(async (row) => {
      cloud.borrowings.set(row.id, { ...row });
      return { ...row };
    }),
    updatePartial: vi.fn(async (id, userId, patch) => {
      const existing = cloud.borrowings.get(id);
      if (!existing || existing.user_id !== userId) throw new Error('Borrowing not found');
      const updated = { ...existing, ...patch };
      cloud.borrowings.set(id, updated);
      return { ...updated };
    }),
    findById: vi.fn(async (id, userId) => {
      const found = cloud.borrowings.get(id);
      return found && found.user_id === userId ? { ...found } : null;
    }),
    findByTransactionId: vi.fn(async (txId, userId) => {
      return (
        Array.from(cloud.borrowings.values()).find(
          (b) => b.user_id === userId && b.transaction_id === txId
        ) ?? null
      );
    }),
    findAll: vi.fn(async (userId: string) =>
      Array.from(cloud.borrowings.values())
        .filter((r) => r.user_id === userId)
        .map((r) => ({ ...r }))
    )
  };

  const repaymentRepo: ISupabaseBorrowingRepaymentRepository = {
    insert: vi.fn(async (row) => {
      cloud.repayments.set(row.id, { ...row });
      return { ...row };
    }),
    findById: vi.fn(async (id, userId) => {
      const found = cloud.repayments.get(id);
      return found && found.user_id === userId ? { ...found } : null;
    }),
    findByTransactionId: vi.fn(async (txId, userId) => {
      return (
        Array.from(cloud.repayments.values()).find(
          (r) => r.user_id === userId && r.transaction_id === txId
        ) ?? null
      );
    }),
    findAll: vi.fn(async (userId: string) =>
      Array.from(cloud.repayments.values())
        .filter((r) => r.user_id === userId)
        .map((r) => ({ ...r }))
    )
  };

  const budgetRepo: ISupabaseBudgetRepository = {
    insert: vi.fn(async (row) => {
      cloud.budgets.set(row.id, { ...row });
      return { ...row };
    }),
    updatePartial: vi.fn(async (id, userId, patch, expectedVersion) => {
      const existing = cloud.budgets.get(id);
      if (!existing || existing.user_id !== userId) throw new Error('Budget not found');
      const updated = { ...existing, ...patch, version: expectedVersion + 1 };
      cloud.budgets.set(id, updated);
      return { ...updated };
    }),
    softDelete: vi.fn(async (id, userId, deletedAt, expectedVersion) => {
      const existing = cloud.budgets.get(id);
      if (!existing || existing.user_id !== userId) throw new Error('Budget not found');
      const updated = { ...existing, deleted_at: deletedAt, version: expectedVersion + 1 };
      cloud.budgets.set(id, updated);
      return { ...updated };
    }),
    findById: vi.fn(async (id, userId) => {
      const found = cloud.budgets.get(id);
      return found && found.user_id === userId ? { ...found } : null;
    }),
    findActiveByCategoryAndPeriod: vi.fn(async (userId, catId, period) => {
      return (
        Array.from(cloud.budgets.values()).find(
          (b) =>
            b.user_id === userId &&
            b.category_id === catId &&
            b.period === period &&
            b.deleted_at === null
        ) ?? null
      );
    }),
    findAll: vi.fn(async (userId: string) =>
      Array.from(cloud.budgets.values())
        .filter((r) => r.user_id === userId)
        .map((r) => ({ ...r }))
    )
  };

  const recurringRuleRepo: ISupabaseRecurringRuleRepository = {
    insert: vi.fn(async (row) => {
      cloud.recurringRules.set(row.id, { ...row });
      return { ...row };
    }),
    updatePartial: vi.fn(async (id, userId, patch, expectedVersion) => {
      const existing = cloud.recurringRules.get(id);
      if (!existing || existing.user_id !== userId) throw new Error('Rule not found');
      const updated = { ...existing, ...patch, version: expectedVersion + 1 };
      cloud.recurringRules.set(id, updated);
      return { ...updated };
    }),
    softDelete: vi.fn(async (id, userId, deletedAt, expectedVersion) => {
      const existing = cloud.recurringRules.get(id);
      if (!existing || existing.user_id !== userId) throw new Error('Rule not found');
      const updated = { ...existing, deleted_at: deletedAt, version: expectedVersion + 1 };
      cloud.recurringRules.set(id, updated);
      return { ...updated };
    }),
    findById: vi.fn(async (id, userId) => {
      const found = cloud.recurringRules.get(id);
      return found && found.user_id === userId ? { ...found } : null;
    }),
    findAll: vi.fn(async (userId: string) =>
      Array.from(cloud.recurringRules.values())
        .filter((r) => r.user_id === userId)
        .map((r) => ({ ...r }))
    )
  };

  const recurringOccurrenceRepo: ISupabaseRecurringOccurrenceRepository = {
    insert: vi.fn(async (row) => {
      cloud.recurringOccurrences.set(row.id, { ...row });
      return { ...row };
    }),
    updatePartial: vi.fn(async (id, userId, patch, expectedVersion) => {
      const existing = cloud.recurringOccurrences.get(id);
      if (!existing || existing.user_id !== userId) throw new Error('Occurrence not found');
      const updated = { ...existing, ...patch, version: expectedVersion + 1 };
      cloud.recurringOccurrences.set(id, updated);
      return { ...updated };
    }),
    findById: vi.fn(async (id, userId) => {
      const found = cloud.recurringOccurrences.get(id);
      return found && found.user_id === userId ? { ...found } : null;
    }),
    findAll: vi.fn(async (userId: string) =>
      Array.from(cloud.recurringOccurrences.values())
        .filter((r) => r.user_id === userId)
        .map((r) => ({ ...r }))
    )
  };

  const notificationRepo: ISupabaseNotificationRepository = {
    insert: vi.fn(async (row) => {
      cloud.notifications.set(row.id, { ...row });
      return { ...row };
    }),
    updatePartial: vi.fn(async (id, userId, patch, expectedVersion) => {
      const existing = cloud.notifications.get(id);
      if (!existing || existing.user_id !== userId) throw new Error('Notif not found');
      const updated = { ...existing, ...patch, version: expectedVersion + 1 };
      cloud.notifications.set(id, updated);
      return { ...updated };
    }),
    softDelete: vi.fn(async (id, userId, deletedAt, expectedVersion) => {
      const existing = cloud.notifications.get(id);
      if (!existing || existing.user_id !== userId) throw new Error('Notif not found');
      const updated = { ...existing, deleted_at: deletedAt, version: expectedVersion + 1 };
      cloud.notifications.set(id, updated);
      return { ...updated };
    }),
    findById: vi.fn(async (id, userId) => {
      const found = cloud.notifications.get(id);
      return found && found.user_id === userId ? { ...found } : null;
    }),
    findAll: vi.fn(async (userId: string) =>
      Array.from(cloud.notifications.values())
        .filter((r) => r.user_id === userId)
        .map((r) => ({ ...r }))
    )
  };

  const notificationPreferenceRepo: ISupabaseNotificationPreferenceRepository = {
    upsert: vi.fn(async (row) => {
      cloud.notificationPreferences.set(row.user_id, { ...row });
      return { ...row };
    }),
    updatePartial: vi.fn(async (userId, patch, expectedVersion) => {
      const existing = cloud.notificationPreferences.get(userId);
      if (!existing) throw new Error('Pref not found');
      const updated = { ...existing, ...patch, version: expectedVersion + 1 };
      cloud.notificationPreferences.set(userId, updated);
      return { ...updated };
    }),
    findByUserId: vi.fn(async (userId) => {
      const found = cloud.notificationPreferences.get(userId);
      return found ? { ...found } : null;
    })
  };

  return {
    accountRepo,
    categoryRepo,
    transactionRepo,
    lenderRepo,
    borrowingRepo,
    repaymentRepo,
    budgetRepo,
    recurringRuleRepo,
    recurringOccurrenceRepo,
    notificationRepo,
    notificationPreferenceRepo
  };
}

function buildCoordinatorHarness(
  userId: string,
  cloud: CloudMockStores,
  txPageSize = 500
) {
  const { db, stores } = createInMemoryLedgerDb();
  const outboxManager = new OutboxManager(db);
  const categoryRepoLocal = new DexieCategoryRepository(db);
  const cloudRepos = createMockCloudRepos(cloud);

  const authUser: AuthUser = { id: userId, email: 'tester@laxmilens.app' };
  const authPort: AuthPort = {
    getCurrentUser: vi.fn().mockResolvedValue(authUser),
    signInWithEmail: vi.fn(),
    signUpWithEmail: vi.fn(),
    signOut: vi.fn(),
    onAuthStateChange: vi.fn()
  };

  const categoryMappingService = new CategoryMappingService(
    db,
    cloudRepos.categoryRepo,
    categoryRepoLocal
  );

  const categoryReconciler = new CategoryReconciliationService(
    db,
    cloudRepos.categoryRepo,
    authPort,
    categoryMappingService
  );
  const accountReconciler = new AccountReconciliationService(
    db,
    cloudRepos.accountRepo,
    authPort
  );
  const transactionReconciler = new TransactionReconciliationService(
    db,
    cloudRepos.transactionRepo,
    authPort,
    categoryMappingService,
    txPageSize
  );
  const borrowingsReconciler = new BorrowingsReconciliationService(
    db,
    cloudRepos.lenderRepo,
    cloudRepos.borrowingRepo,
    cloudRepos.repaymentRepo,
    authPort
  );
  const budgetReconciler = new BudgetReconciliationService(
    db,
    cloudRepos.budgetRepo,
    authPort,
    categoryMappingService
  );
  const recurringReconciler = new RecurringReconciliationService(
    db,
    cloudRepos.recurringRuleRepo,
    cloudRepos.recurringOccurrenceRepo,
    authPort,
    categoryMappingService
  );
  const notificationReconciler = new NotificationReconciliationService(
    db,
    cloudRepos.notificationRepo,
    cloudRepos.notificationPreferenceRepo,
    authPort
  );

  const accountDispatcher = new AccountSyncDispatcher(cloudRepos.accountRepo, authPort, outboxManager);
  const categoryDispatcher = new CategorySyncDispatcher(
    cloudRepos.categoryRepo,
    authPort,
    outboxManager,
    categoryMappingService
  );
  const budgetDispatcher = new BudgetSyncDispatcher(
    cloudRepos.budgetRepo,
    authPort,
    outboxManager,
    categoryMappingService
  );
  const transactionDispatcher = new TransactionSyncDispatcher(
    cloudRepos.transactionRepo,
    authPort,
    outboxManager,
    categoryMappingService
  );
  const lenderDispatcher = new LenderSyncDispatcher(cloudRepos.lenderRepo, authPort, outboxManager);
  const borrowingDispatcher = new BorrowingSyncDispatcher(
    cloudRepos.borrowingRepo,
    authPort,
    outboxManager
  );
  const borrowingRepaymentDispatcher = new BorrowingRepaymentSyncDispatcher(
    cloudRepos.repaymentRepo,
    authPort,
    outboxManager
  );
  const recurringRuleDispatcher = new RecurringRuleSyncDispatcher(
    cloudRepos.recurringRuleRepo,
    authPort,
    outboxManager,
    categoryMappingService
  );
  const recurringOccurrenceDispatcher = new RecurringOccurrenceSyncDispatcher(
    cloudRepos.recurringOccurrenceRepo,
    authPort,
    outboxManager
  );
  const notificationDispatcher = new NotificationSyncDispatcher(
    cloudRepos.notificationRepo,
    authPort,
    outboxManager
  );
  const notificationPreferenceDispatcher = new NotificationPreferenceSyncDispatcher(
    cloudRepos.notificationPreferenceRepo,
    authPort,
    outboxManager
  );

  const coordinator = new ManualSyncCoordinator(
    accountDispatcher,
    transactionDispatcher,
    outboxManager,
    authPort,
    categoryDispatcher,
    lenderDispatcher,
    borrowingDispatcher,
    borrowingRepaymentDispatcher,
    budgetDispatcher,
    budgetReconciler,
    recurringRuleDispatcher,
    recurringOccurrenceDispatcher,
    recurringReconciler,
    notificationDispatcher,
    notificationPreferenceDispatcher,
    notificationReconciler,
    {
      userId,
      accountReconciler,
      categoryReconciler,
      transactionReconciler,
      borrowingsReconciler
    }
  );

  return {
    db,
    stores,
    outboxManager,
    authPort,
    categoryRepoLocal,
    categoryMappingService,
    cloudRepos,
    categoryReconciler,
    accountReconciler,
    transactionReconciler,
    borrowingsReconciler,
    budgetReconciler,
    recurringReconciler,
    notificationReconciler,
    coordinator
  };
}

describe('Step 2: Cross-Device Identity & Core Ledger Reconciliation', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const otherUserId = '22222222-2222-4222-8222-222222222222';
  const iso1 = '2026-11-20T10:00:00.000Z';
  const iso2 = '2026-11-22T14:30:00.000Z';

  let cloud: CloudMockStores;

  beforeEach(() => {
    cloud = {
      accounts: new Map(),
      categories: new Map(),
      transactions: new Map(),
      lenders: new Map(),
      borrowings: new Map(),
      repayments: new Map(),
      budgets: new Map(),
      recurringRules: new Map(),
      recurringOccurrences: new Map(),
      notifications: new Map(),
      notificationPreferences: new Map()
    };
  });

  it('1. reconciles default category UUIDs between devices and maps transaction, budget, and recurring references symmetrically', async () => {
    const localFoodCatId = 'aaaa0001-1111-4111-8111-111111111111';
    const cloudFoodCatId = 'bbbb0001-2222-4222-8222-222222222222';
    const bankAccId = 'cccc0001-1111-4111-8111-111111111111';
    const localTxId = 'dddd0001-1111-4111-8111-111111111111';
    const cloudTxId = 'dddd0002-2222-4222-8222-222222222222';
    const localBudgetId = 'eeee0001-1111-4111-8111-111111111111';
    const localRuleId = 'ffff0001-1111-4111-8111-111111111111';

    cloud.accounts.set(bankAccId, {
      id: bankAccId,
      user_id: userId,
      name: 'Main Bank',
      account_type: 'bank',
      opening_balance_paise: 100000,
      currency: 'INR',
      system_tag: null,
      is_archived: false,
      version: 1,
      created_at: iso1,
      updated_at: iso1
    });

    // Device B previously created Food & Dining in cloud with cloudFoodCatId
    cloud.categories.set(cloudFoodCatId, {
      id: cloudFoodCatId,
      user_id: userId,
      name: 'Food & Dining',
      type: 'expense',
      is_default: true,
      is_archived: false,
      version: 1,
      created_at: iso1,
      updated_at: iso1
    });

    // Cloud transaction from Device B using cloudFoodCatId
    cloud.transactions.set(cloudTxId, {
      id: cloudTxId,
      user_id: userId,
      type: 'expense',
      amount_paise: 25000,
      currency: 'INR',
      account_id: bankAccId,
      destination_account_id: null,
      category_id: cloudFoodCatId,
      title: 'Device B Lunch',
      note: null,
      transaction_date: iso1,
      deleted_at: null,
      version: 1,
      device_id: 'device-b',
      idempotency_key: 'idemp-b-lunch',
      created_at: iso1,
      updated_at: iso1
    });

    const harness = buildCoordinatorHarness(userId, cloud);

    // Device A locally seeded Food & Dining under localFoodCatId and authored tx, budget, recurring rule
    await harness.db.categories.put({
      id: localFoodCatId,
      userId,
      name: ' food & dining ',
      type: 'expense',
      isDefault: true,
      isSystem: true,
      isArchived: false,
      version: 1,
      createdAt: iso1,
      updatedAt: iso1
    });

    await harness.outboxManager.enqueue({
      userId,
      entity: 'categories',
      entityId: localFoodCatId,
      operation: 'INSERT',
      payload: {
        id: localFoodCatId,
        user_id: userId,
        name: 'Food & Dining',
        type: 'expense',
        is_default: true,
        is_archived: false,
        version: 1,
        created_at: iso1,
        updated_at: iso1
      },
      idempotencyKey: `cat_${localFoodCatId}`
    });

    await harness.outboxManager.enqueue({
      userId,
      entity: 'transactions',
      entityId: localTxId,
      operation: 'INSERT',
      payload: {
        id: localTxId,
        user_id: userId,
        type: 'expense',
        amount_paise: 45000,
        currency: 'INR',
        account_id: bankAccId,
        destination_account_id: null,
        category_id: localFoodCatId,
        title: 'Device A Dinner',
        transaction_date: iso2,
        deleted_at: null,
        version: 1,
        device_id: 'device-a',
        idempotency_key: 'idemp-a-dinner',
        created_at: iso2,
        updated_at: iso2
      },
      idempotencyKey: 'idemp-a-dinner'
    });

    await harness.outboxManager.enqueue({
      userId,
      entity: 'budgets',
      entityId: localBudgetId,
      operation: 'INSERT',
      payload: {
        id: localBudgetId,
        user_id: userId,
        category_id: localFoodCatId,
        period: '2026-11',
        limit_paise: 500000,
        version: 1,
        deleted_at: null,
        created_at: iso1,
        updated_at: iso1
      },
      idempotencyKey: `budget_${localBudgetId}`
    });

    await harness.outboxManager.enqueue({
      userId,
      entity: 'recurring_rules',
      entityId: localRuleId,
      operation: 'INSERT',
      payload: {
        id: localRuleId,
        user_id: userId,
        title: 'Weekly Tiffin',
        type: 'expense',
        amount_paise: 120000,
        currency: 'INR',
        account_id: bankAccId,
        category_id: localFoodCatId,
        frequency: 'weekly',
        interval: 1,
        anchor_day_of_month: 1,
        start_date: '2026-11-01',
        end_date: null,
        next_due_date: '2026-11-08',
        last_generated_date: null,
        status: 'active',
        requires_user_confirmation: true,
        version: 1,
        deleted_at: null,
        created_at: iso1,
        updated_at: iso1
      },
      idempotencyKey: `rule_${localRuleId}`
    });

    const result = await harness.coordinator.run();

    expect(result.errors).toEqual([]);
    expect(result.failedCount).toBe(0);
    expect(result.stillPendingCount).toBe(0);
    expect(result.categories.mappedCount).toBeGreaterThanOrEqual(1);

    // No duplicate Food & Dining created in cloud
    expect(Array.from(cloud.categories.keys())).toEqual([cloudFoodCatId]);

    // Forward and reverse metadata persisted accurately
    const fwd = await harness.db.syncMetadata.get(`cat_map:${userId}:${localFoodCatId}`);
    const rev = await harness.db.syncMetadata.get(`cat_rev:${userId}:${cloudFoodCatId}`);
    expect(fwd?.value).toBe(cloudFoodCatId);
    expect(rev?.value).toBe(localFoodCatId);

    // Pushed dependent entities resolved category_id to cloudFoodCatId
    expect(cloud.transactions.get(localTxId)?.category_id).toBe(cloudFoodCatId);
    expect(cloud.budgets.get(localBudgetId)?.category_id).toBe(cloudFoodCatId);
    expect(cloud.recurringRules.get(localRuleId)?.category_id).toBe(cloudFoodCatId);

    // Pulled transaction from Device B resolved categoryId to Device A's localFoodCatId
    const pulledTx = await harness.db.transactions.get(cloudTxId);
    expect(pulledTx?.categoryId).toBe(localFoodCatId);

    // Local DB did not create a duplicate Food & Dining category row
    const localCats = await harness.db.categories.where('userId').equals(userId).toArray();
    expect(localCats).toHaveLength(1);
    expect(localCats[0].id).toBe(localFoodCatId);
  });

  it('2. keeps custom categories with matching display names distinct unless UUID matches', async () => {
    const localCustomId = 'aaaa1001-1111-4111-8111-111111111111';
    const cloudCustomId = 'bbbb1001-2222-4222-8222-222222222222';

    cloud.categories.set(cloudCustomId, {
      id: cloudCustomId,
      user_id: userId,
      name: 'Travel',
      type: 'expense',
      is_default: false,
      is_archived: false,
      version: 1,
      created_at: iso1,
      updated_at: iso1
    });

    const harness = buildCoordinatorHarness(userId, cloud);
    await harness.db.categories.put({
      id: localCustomId,
      userId,
      name: 'Travel',
      type: 'expense',
      isDefault: false,
      isSystem: false,
      isArchived: false,
      version: 1,
      createdAt: iso1,
      updatedAt: iso1
    });

    const pullResult = await harness.categoryReconciler.pullAndReconcile(userId);
    expect(pullResult.mappedCount).toBe(0);
    expect(pullResult.pulledCount).toBe(1);

    const fwd = await harness.db.syncMetadata.get(`cat_map:${userId}:${localCustomId}`);
    const rev = await harness.db.syncMetadata.get(`cat_rev:${userId}:${cloudCustomId}`);
    expect(fwd).toBeUndefined();
    expect(rev).toBeUndefined();

    const localCats = await harness.db.categories.where('userId').equals(userId).toArray();
    expect(localCats.map((c) => c.id).sort()).toEqual([localCustomId, cloudCustomId].sort());
  });

  it('3. prevents seedDefaults from recreating duplicate defaults when cloud defaults already exist', async () => {
    const cloudFoodId = 'bbbb2001-2222-4222-8222-222222222222';
    const cloudSalaryId = 'bbbb2002-2222-4222-8222-222222222222';

    cloud.categories.set(cloudFoodId, {
      id: cloudFoodId,
      user_id: userId,
      name: 'Food & Dining',
      type: 'expense',
      is_default: true,
      is_archived: false,
      version: 1,
      created_at: iso1,
      updated_at: iso1
    });
    cloud.categories.set(cloudSalaryId, {
      id: cloudSalaryId,
      user_id: userId,
      name: 'Salary',
      type: 'income',
      is_default: true,
      is_archived: false,
      version: 1,
      created_at: iso1,
      updated_at: iso1
    });

    const harness = buildCoordinatorHarness(userId, cloud);

    // Simulates useCategories initial load when local categories are empty while online
    await harness.categoryReconciler.pullAndReconcile(userId);

    const existingBeforeSeed = await harness.categoryRepoLocal.findByUserId(userId);
    expect(existingBeforeSeed.map((c) => c.id).sort()).toEqual([cloudFoodId, cloudSalaryId].sort());

    // Calling seedDefaults after cloud pull must not duplicate Food & Dining or Salary
    await harness.categoryRepoLocal.seedDefaults(userId);
    const afterSeed = await harness.categoryRepoLocal.findByUserId(userId);
    const foodEntries = afterSeed.filter(
      (c) => c.type === 'expense' && c.name.trim().toLowerCase() === 'food & dining'
    );
    const salaryEntries = afterSeed.filter(
      (c) => c.type === 'income' && c.name.trim().toLowerCase() === 'salary'
    );
    expect(foodEntries).toHaveLength(1);
    expect(foodEntries[0].id).toBe(cloudFoodId);
    expect(salaryEntries).toHaveLength(1);
    expect(salaryEntries[0].id).toBe(cloudSalaryId);
  });

  it('4. adopts canonical cloud personal_borrowings UUID without losing local transactions, borrowings, or idempotency keys', async () => {
    const oldPBId = 'aaaa3001-1111-4111-8111-111111111111';
    const canonicalPBId = 'bbbb3001-2222-4222-8222-222222222222';
    const bankAccId = 'bbbb3002-2222-4222-8222-222222222222';
    const lenderId = 'cccc3001-1111-4111-8111-111111111111';
    const borrowingId = 'dddd3001-1111-4111-8111-111111111111';
    const borrowTxId = 'eeee3001-1111-4111-8111-111111111111';
    const ruleId = 'ffff3001-1111-4111-8111-111111111111';
    const idempKey = 'borrow-idemp-unique-1';

    cloud.accounts.set(canonicalPBId, {
      id: canonicalPBId,
      user_id: userId,
      name: 'Personal Borrowings',
      account_type: 'other',
      opening_balance_paise: 0,
      currency: 'INR',
      system_tag: 'personal_borrowings',
      is_archived: false,
      version: 1,
      created_at: iso1,
      updated_at: iso1
    });

    cloud.accounts.set(bankAccId, {
      id: bankAccId,
      user_id: userId,
      name: 'Salary Bank',
      account_type: 'bank',
      opening_balance_paise: 100000,
      currency: 'INR',
      system_tag: null,
      is_archived: false,
      version: 1,
      created_at: iso1,
      updated_at: iso1
    });

    const harness = buildCoordinatorHarness(userId, cloud);

    await harness.db.accounts.put({
      id: oldPBId,
      userId,
      name: 'Personal Borrowings',
      type: 'other',
      accountType: 'other',
      openingBalancePaise: 0,
      openingBalanceInPaise: 0,
      currency: 'INR',
      systemTag: 'personal_borrowings',
      status: 'active',
      isArchived: false,
      version: 1,
      createdAt: iso1,
      updatedAt: iso1
    });

    await harness.db.lenders.put({
      id: lenderId,
      userId,
      name: 'Ramesh',
      isArchived: false,
      createdAt: iso1,
      updatedAt: iso1
    });

    await harness.db.transactions.put({
      id: borrowTxId,
      userId,
      type: 'income',
      amountPaise: 50000,
      amountInPaise: 50000,
      currency: 'INR',
      accountId: oldPBId,
      title: 'Borrowed from Ramesh',
      transactionDate: iso1,
      date: iso1,
      deletedAt: null,
      isDeleted: false,
      version: 1,
      idempotencyKey: idempKey,
      createdAt: iso1,
      updatedAt: iso1
    });

    await harness.db.borrowings.put({
      id: borrowingId,
      userId,
      lenderId,
      amountPaise: 50000,
      borrowingDate: iso1,
      receivingAccountId: bankAccId,
      transactionId: borrowTxId,
      status: 'active',
      createdAt: iso1,
      updatedAt: iso1
    });

    await harness.db.recurringRules.put({
      id: ruleId,
      userId,
      title: 'Monthly Debt Reminder',
      type: 'expense',
      amountPaise: 10000,
      accountId: oldPBId,
      frequency: 'monthly',
      interval: 1,
      anchorDayOfMonth: 1,
      startDate: '2026-11-01',
      endDate: null,
      nextDueDate: '2026-12-01',
      lastGeneratedDate: null,
      status: 'active',
      requiresUserConfirmation: true,
      version: 1,
      createdAt: iso1,
      updatedAt: iso1,
      deletedAt: null
    });

    await harness.outboxManager.enqueue({
      userId,
      entity: 'accounts',
      entityId: oldPBId,
      operation: 'INSERT',
      payload: {
        id: oldPBId,
        user_id: userId,
        name: 'Personal Borrowings',
        account_type: 'other',
        opening_balance_paise: 0,
        currency: 'INR',
        system_tag: 'personal_borrowings',
        is_archived: false,
        version: 1,
        created_at: iso1,
        updated_at: iso1
      },
      idempotencyKey: `acc_${oldPBId}`
    });

    await harness.outboxManager.enqueue({
      userId,
      entity: 'lenders',
      entityId: lenderId,
      operation: 'INSERT',
      payload: {
        id: lenderId,
        user_id: userId,
        name: 'Ramesh',
        phone: null,
        email: null,
        notes: null,
        is_archived: false,
        created_at: iso1,
        updated_at: iso1
      },
      idempotencyKey: `lender_${lenderId}`
    });

    await harness.outboxManager.enqueue({
      userId,
      entity: 'transactions',
      entityId: borrowTxId,
      operation: 'INSERT',
      payload: {
        id: borrowTxId,
        user_id: userId,
        type: 'income',
        amount_paise: 50000,
        currency: 'INR',
        account_id: oldPBId,
        destination_account_id: null,
        category_id: null,
        title: 'Borrowed from Ramesh',
        transaction_date: iso1,
        deleted_at: null,
        version: 1,
        device_id: 'dev-a',
        idempotency_key: idempKey,
        created_at: iso1,
        updated_at: iso1
      },
      idempotencyKey: idempKey
    });

    await harness.outboxManager.enqueue({
      userId,
      entity: 'borrowings',
      entityId: borrowingId,
      operation: 'INSERT',
      payload: {
        id: borrowingId,
        user_id: userId,
        lender_id: lenderId,
        amount_paise: 50000,
        borrowing_date: iso1,
        due_date: null,
        receiving_account_id: bankAccId,
        transaction_id: borrowTxId,
        status: 'active',
        notes: null,
        created_at: iso1,
        updated_at: iso1
      },
      idempotencyKey: `bor_${borrowingId}`
    });

    await harness.outboxManager.enqueue({
      userId,
      entity: 'recurring_rules',
      entityId: ruleId,
      operation: 'INSERT',
      payload: {
        id: ruleId,
        user_id: userId,
        title: 'Monthly Debt Reminder',
        type: 'expense',
        amount_paise: 10000,
        account_id: oldPBId,
        category_id: null,
        frequency: 'monthly',
        interval: 1,
        anchor_day_of_month: 1,
        start_date: '2026-11-01',
        end_date: null,
        next_due_date: '2026-12-01',
        last_generated_date: null,
        status: 'active',
        requires_user_confirmation: true,
        version: 1,
        created_at: iso1,
        updated_at: iso1
      },
      idempotencyKey: `rule_${ruleId}`
    });

    const result = await harness.coordinator.run();

    expect(result.errors).toEqual([]);
    expect(result.failedCount).toBe(0);
    expect(result.stillPendingCount).toBe(0);
    expect(result.accounts.remappedCount).toBeGreaterThanOrEqual(1);

    // Only one personal_borrowings account in cloud and locally, with canonical UUID
    const localPBAccounts = (await harness.db.accounts.where('userId').equals(userId).toArray()).filter(
      (a) => a.systemTag === 'personal_borrowings'
    );
    expect(localPBAccounts).toHaveLength(1);
    expect(localPBAccounts[0].id).toBe(canonicalPBId);
    expect(
      Array.from(cloud.accounts.values()).filter((a) => a.system_tag === 'personal_borrowings')
    ).toHaveLength(1);

    // Transaction ID and idempotency key preserved, remapped to canonicalPBId
    const localTx = await harness.db.transactions.get(borrowTxId);
    expect(localTx?.accountId).toBe(canonicalPBId);
    expect(localTx?.idempotencyKey).toBe(idempKey);
    expect(cloud.transactions.get(borrowTxId)?.account_id).toBe(canonicalPBId);
    expect(cloud.transactions.get(borrowTxId)?.idempotency_key).toBe(idempKey);

    // Borrowing intact and linked recurring rule remapped cleanly to canonicalPBId
    expect(cloud.borrowings.get(borrowingId)?.receiving_account_id).toBe(bankAccId);
    expect((await harness.db.recurringRules.get(ruleId))?.accountId).toBe(canonicalPBId);
    expect(cloud.recurringRules.get(ruleId)?.account_id).toBe(canonicalPBId);
  });

  it('5. halts and reports explicit conflict without mutating records when personal_borrowings remapping is unsafe', async () => {
    const oldPBId = 'aaaa4001-1111-4111-8111-111111111111';
    const canonicalPBId = 'bbbb4001-2222-4222-8222-222222222222';
    const txId = 'cccc4001-1111-4111-8111-111111111111';

    cloud.accounts.set(canonicalPBId, {
      id: canonicalPBId,
      user_id: userId,
      name: 'Personal Borrowings',
      account_type: 'other',
      opening_balance_paise: 0,
      currency: 'INR',
      system_tag: 'personal_borrowings',
      is_archived: false,
      version: 1,
      created_at: iso1,
      updated_at: iso1
    });

    const harness = buildCoordinatorHarness(userId, cloud);

    // Unsafe condition: local PB has version > 1 (edited) and linked tx also synced/edited (version 2)
    await harness.db.accounts.put({
      id: oldPBId,
      userId,
      name: 'Edited Borrowings Name',
      type: 'other',
      accountType: 'other',
      openingBalancePaise: 0,
      openingBalanceInPaise: 0,
      currency: 'INR',
      systemTag: 'personal_borrowings',
      status: 'active',
      isArchived: false,
      version: 2,
      createdAt: iso1,
      updatedAt: iso2
    });

    await harness.db.transactions.put({
      id: txId,
      userId,
      type: 'income',
      amountPaise: 75000,
      amountInPaise: 75000,
      currency: 'INR',
      accountId: oldPBId,
      title: 'Already Synced Old PB Tx',
      transactionDate: iso1,
      date: iso1,
      deletedAt: null,
      isDeleted: false,
      version: 2,
      idempotencyKey: 'tx-unsafe-1',
      createdAt: iso1,
      updatedAt: iso2
    });

    await harness.outboxManager.enqueue({
      userId,
      entity: 'accounts',
      entityId: oldPBId,
      operation: 'UPDATE',
      payload: {
        id: oldPBId,
        user_id: userId,
        name: 'Edited Borrowings Name',
        version: 2
      },
      idempotencyKey: `acc_upd_${oldPBId}`
    });

    const result = await harness.coordinator.run();

    expect(result.accounts.conflictCount).toBe(1);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entity: 'accounts',
          entityId: oldPBId,
          category: 'conflict',
          disposition: 'permanent'
        })
      ])
    );

    // Blocked local account outbox remains queued and financial records are untouched
    expect(result.stillPendingCount).toBe(1);
    expect((await harness.db.accounts.get(oldPBId))?.name).toBe('Edited Borrowings Name');
    expect((await harness.db.transactions.get(txId))?.accountId).toBe(oldPBId);
    expect(cloud.accounts.has(oldPBId)).toBe(false);
  });

  it('6. fresh Device B login pulls accounts, categories, transactions, lenders, borrowings, repayments in dependency order with 0 outbox writes', async () => {
    const bankAccId = 'aaaa5001-1111-4111-8111-111111111111';
    const catId = 'bbbb5001-1111-4111-8111-111111111111';
    const txBorrowId = 'cccc5001-1111-4111-8111-111111111111';
    const txRepayId = 'cccc5002-1111-4111-8111-111111111111';
    const lenderId = 'dddd5001-1111-4111-8111-111111111111';
    const borrowingId = 'eeee5001-1111-4111-8111-111111111111';
    const repaymentId = 'ffff5001-1111-4111-8111-111111111111';

    cloud.accounts.set(bankAccId, {
      id: bankAccId,
      user_id: userId,
      name: 'HDFC Checking',
      account_type: 'bank',
      opening_balance_paise: 500000,
      currency: 'INR',
      system_tag: null,
      is_archived: false,
      version: 1,
      created_at: iso1,
      updated_at: iso1
    });
    cloud.categories.set(catId, {
      id: catId,
      user_id: userId,
      name: 'Groceries',
      type: 'expense',
      is_default: true,
      is_archived: false,
      version: 1,
      created_at: iso1,
      updated_at: iso1
    });
    cloud.transactions.set(txBorrowId, {
      id: txBorrowId,
      user_id: userId,
      type: 'income',
      amount_paise: 100000,
      currency: 'INR',
      account_id: bankAccId,
      destination_account_id: null,
      category_id: catId,
      title: 'Loan In',
      note: null,
      transaction_date: iso1,
      deleted_at: null,
      version: 1,
      device_id: 'dev-a',
      idempotency_key: 'k-loan-in',
      created_at: iso1,
      updated_at: iso1
    });
    cloud.transactions.set(txRepayId, {
      id: txRepayId,
      user_id: userId,
      type: 'expense',
      amount_paise: 100000,
      currency: 'INR',
      account_id: bankAccId,
      destination_account_id: null,
      category_id: null,
      title: 'Loan Repay',
      note: null,
      transaction_date: iso2,
      deleted_at: null,
      version: 1,
      device_id: 'dev-a',
      idempotency_key: 'k-loan-out',
      created_at: iso2,
      updated_at: iso2
    });
    cloud.lenders.set(lenderId, {
      id: lenderId,
      user_id: userId,
      name: 'Suresh',
      phone: null,
      email: null,
      notes: null,
      is_archived: false,
      created_at: iso1,
      updated_at: iso1
    });
    cloud.borrowings.set(borrowingId, {
      id: borrowingId,
      user_id: userId,
      lender_id: lenderId,
      amount_paise: 100000,
      borrowing_date: iso1,
      due_date: null,
      receiving_account_id: bankAccId,
      transaction_id: txBorrowId,
      status: 'repaid',
      notes: null,
      created_at: iso1,
      updated_at: iso2
    });
    cloud.repayments.set(repaymentId, {
      id: repaymentId,
      user_id: userId,
      borrowing_id: borrowingId,
      lender_id: lenderId,
      amount_paise: 100000,
      repayment_date: iso2,
      payment_account_id: bankAccId,
      transaction_id: txRepayId,
      notes: 'Settled',
      created_at: iso2,
      updated_at: iso2
    });

    const harness = buildCoordinatorHarness(userId, cloud);
    const callOrder: string[] = [];

    const origCatPull = harness.categoryReconciler.pullAndReconcile.bind(harness.categoryReconciler);
    const origAccPull = harness.accountReconciler.pullAndReconcile.bind(harness.accountReconciler);
    const origTxPull = harness.transactionReconciler.pullAndReconcile.bind(harness.transactionReconciler);
    const origBorPull = harness.borrowingsReconciler.pullAndReconcile.bind(harness.borrowingsReconciler);
    const origBudPull = harness.budgetReconciler.pullAndReconcile.bind(harness.budgetReconciler);
    const origRecPull = harness.recurringReconciler.pullAndReconcile.bind(harness.recurringReconciler);
    const origNotifPull = harness.notificationReconciler.pullAndReconcile.bind(
      harness.notificationReconciler
    );

    vi.spyOn(harness.categoryReconciler, 'pullAndReconcile').mockImplementation(async (uid) => {
      callOrder.push('categories');
      return origCatPull(uid);
    });
    vi.spyOn(harness.accountReconciler, 'pullAndReconcile').mockImplementation(async (uid) => {
      callOrder.push('accounts');
      return origAccPull(uid);
    });
    vi.spyOn(harness.transactionReconciler, 'pullAndReconcile').mockImplementation(async (uid) => {
      callOrder.push('transactions');
      return origTxPull(uid);
    });
    vi.spyOn(harness.borrowingsReconciler, 'pullAndReconcile').mockImplementation(async (uid) => {
      callOrder.push('borrowings');
      return origBorPull(uid);
    });
    vi.spyOn(harness.budgetReconciler, 'pullAndReconcile').mockImplementation(async (uid) => {
      callOrder.push('budgets');
      return origBudPull(uid);
    });
    vi.spyOn(harness.recurringReconciler, 'pullAndReconcile').mockImplementation(async (uid) => {
      callOrder.push('recurring');
      return origRecPull(uid);
    });
    vi.spyOn(harness.notificationReconciler, 'pullAndReconcile').mockImplementation(async (uid) => {
      callOrder.push('notifications');
      return origNotifPull(uid);
    });

    const result = await harness.coordinator.run();

    expect(callOrder).toEqual([
      'categories',
      'accounts',
      'transactions',
      'borrowings',
      'budgets',
      'recurring',
      'notifications'
    ]);
    expect(result.pulledCount).toBe(7);
    expect(result.categories.pulledCount).toBe(1);
    expect(result.accounts.pulledCount).toBe(1);
    expect(result.transactions.pulledCount).toBe(2);
    expect(result.lenders.pulledCount).toBe(1);
    expect(result.borrowings.pulledCount).toBe(1);
    expect(result.borrowing_repayments.pulledCount).toBe(1);
    expect(result.stillPendingCount).toBe(0);
    expect(await harness.db.syncOutbox.toArray()).toHaveLength(0);

    expect((await harness.db.borrowings.get(borrowingId))?.status).toBe('repaid');
    expect((await harness.db.borrowingRepayments.get(repaymentId))?.amountPaise).toBe(100000);
  });

  it('7. paginates multi-page cloud transactions beyond a single page without truncation', async () => {
    const bankAccId = 'aaaa6001-1111-4111-8111-111111111111';
    for (let i = 1; i <= 5; i++) {
      const txId = `cccc600${i}-1111-4111-8111-111111111111`;
      cloud.transactions.set(txId, {
        id: txId,
        user_id: userId,
        type: 'expense',
        amount_paise: i * 1000,
        currency: 'INR',
        account_id: bankAccId,
        destination_account_id: null,
        category_id: null,
        title: `Paged Tx ${i}`,
        note: null,
        transaction_date: `2026-11-0${i}T10:00:00.000Z`,
        deleted_at: null,
        version: 1,
        device_id: 'dev-a',
        idempotency_key: `k-page-${i}`,
        created_at: `2026-11-0${i}T10:00:00.000Z`,
        updated_at: `2026-11-0${i}T10:00:00.000Z`
      });
    }

    const harness = buildCoordinatorHarness(userId, cloud, 2);
    const pullResult = await harness.transactionReconciler.pullAndReconcile(userId);

    expect(pullResult.pagesFetched).toBe(3);
    expect(pullResult.pulledCount).toBe(5);
    expect(pullResult.insertedCount).toBe(5);
    expect(await harness.db.transactions.where('userId').equals(userId).toArray()).toHaveLength(5);
  });

  it('8. pulls cloud soft-delete tombstones cleanly while protecting local higher-version tombstones', async () => {
    const accId = 'aaaa7001-1111-4111-8111-111111111111';
    const cleanTxId = 'bbbb7001-1111-4111-8111-111111111111';
    const localHigherTxId = 'bbbb7002-1111-4111-8111-111111111111';

    cloud.transactions.set(cleanTxId, {
      id: cleanTxId,
      user_id: userId,
      type: 'expense',
      amount_paise: 10000,
      currency: 'INR',
      account_id: accId,
      destination_account_id: null,
      category_id: null,
      title: 'Deleted On Device B',
      note: null,
      transaction_date: iso1,
      deleted_at: iso2,
      version: 2,
      device_id: 'dev-b',
      idempotency_key: 'k-tomb-1',
      created_at: iso1,
      updated_at: iso2
    });

    cloud.transactions.set(localHigherTxId, {
      id: localHigherTxId,
      user_id: userId,
      type: 'expense',
      amount_paise: 20000,
      currency: 'INR',
      account_id: accId,
      destination_account_id: null,
      category_id: null,
      title: 'Older Cloud Live Row',
      note: null,
      transaction_date: iso1,
      deleted_at: null,
      version: 1,
      device_id: 'dev-a',
      idempotency_key: 'k-tomb-2',
      created_at: iso1,
      updated_at: iso1
    });

    const harness = buildCoordinatorHarness(userId, cloud);
    await harness.db.transactions.put({
      id: cleanTxId,
      userId,
      type: 'expense',
      amountPaise: 10000,
      amountInPaise: 10000,
      currency: 'INR',
      accountId: accId,
      title: 'Deleted On Device B',
      transactionDate: iso1,
      date: iso1,
      deletedAt: null,
      isDeleted: false,
      version: 1,
      idempotencyKey: 'k-tomb-1',
      createdAt: iso1,
      updatedAt: iso1
    });

    await harness.db.transactions.put({
      id: localHigherTxId,
      userId,
      type: 'expense',
      amountPaise: 20000,
      amountInPaise: 20000,
      currency: 'INR',
      accountId: accId,
      title: 'Locally Tombstoned',
      transactionDate: iso1,
      date: iso1,
      deletedAt: iso2,
      isDeleted: true,
      version: 2,
      idempotencyKey: 'k-tomb-2',
      createdAt: iso1,
      updatedAt: iso2
    });

    const pullResult = await harness.transactionReconciler.pullAndReconcile(userId);
    expect(pullResult.deletedCount).toBe(1);

    const updatedTomb = await harness.db.transactions.get(cleanTxId);
    expect(updatedTomb?.deletedAt).toBe(iso2);
    expect(updatedTomb?.isDeleted).toBe(true);
    expect(updatedTomb?.version).toBe(2);

    const preservedTomb = await harness.db.transactions.get(localHigherTxId);
    expect(preservedTomb?.deletedAt).toBe(iso2);
    expect(preservedTomb?.isDeleted).toBe(true);
    expect(preservedTomb?.version).toBe(2);
  });

  it('9. preserves archived status on pulled accounts and categories without resurrecting them', async () => {
    const accId = 'aaaa8001-1111-4111-8111-111111111111';
    const catId = 'bbbb8001-1111-4111-8111-111111111111';

    cloud.accounts.set(accId, {
      id: accId,
      user_id: userId,
      name: 'Old Card',
      account_type: 'credit_card',
      opening_balance_paise: 0,
      currency: 'INR',
      system_tag: null,
      is_archived: true,
      version: 2,
      created_at: iso1,
      updated_at: iso2
    });

    cloud.categories.set(catId, {
      id: catId,
      user_id: userId,
      name: 'Legacy Tag',
      type: 'expense',
      is_default: false,
      is_archived: true,
      version: 2,
      created_at: iso1,
      updated_at: iso2
    });

    const harness = buildCoordinatorHarness(userId, cloud);
    await harness.db.accounts.put({
      id: accId,
      userId,
      name: 'Old Card',
      type: 'credit_card',
      accountType: 'credit_card',
      openingBalancePaise: 0,
      openingBalanceInPaise: 0,
      currency: 'INR',
      systemTag: null,
      status: 'active',
      isArchived: false,
      version: 1,
      createdAt: iso1,
      updatedAt: iso1
    });
    await harness.db.categories.put({
      id: catId,
      userId,
      name: 'Legacy Tag',
      type: 'expense',
      isDefault: false,
      isSystem: false,
      isArchived: false,
      version: 1,
      createdAt: iso1,
      updatedAt: iso1
    });

    await harness.coordinator.run();

    const localAcc = await harness.db.accounts.get(accId);
    expect(localAcc?.isArchived).toBe(true);
    expect(localAcc?.status).toBe('archived');
    expect((await harness.db.categories.get(catId))?.isArchived).toBe(true);
  });

  it('10. pulls repaid borrowing & repayment history cleanly and protects irreversible repaid status locally', async () => {
    const lenderId = 'aaaa9001-1111-4111-8111-111111111111';
    const borRepaidId = 'bbbb9001-1111-4111-8111-111111111111';
    const borProtectedId = 'bbbb9002-1111-4111-8111-111111111111';
    const repId = 'cccc9001-1111-4111-8111-111111111111';
    const accId = 'dddd9001-1111-4111-8111-111111111111';
    const tx1Id = 'eeee9001-1111-4111-8111-111111111111';
    const tx2Id = 'eeee9002-1111-4111-8111-111111111111';
    const tx3Id = 'eeee9003-1111-4111-8111-111111111111';

    cloud.lenders.set(lenderId, {
      id: lenderId,
      user_id: userId,
      name: 'Anita',
      phone: null,
      email: null,
      notes: null,
      is_archived: false,
      created_at: iso1,
      updated_at: iso1
    });
    cloud.borrowings.set(borRepaidId, {
      id: borRepaidId,
      user_id: userId,
      lender_id: lenderId,
      amount_paise: 30000,
      borrowing_date: iso1,
      due_date: null,
      receiving_account_id: accId,
      transaction_id: tx1Id,
      status: 'repaid',
      notes: 'Done',
      created_at: iso1,
      updated_at: iso2
    });
    cloud.borrowings.set(borProtectedId, {
      id: borProtectedId,
      user_id: userId,
      lender_id: lenderId,
      amount_paise: 40000,
      borrowing_date: iso1,
      due_date: null,
      receiving_account_id: accId,
      transaction_id: tx2Id,
      status: 'active',
      notes: null,
      created_at: iso1,
      updated_at: iso1
    });
    cloud.repayments.set(repId, {
      id: repId,
      user_id: userId,
      borrowing_id: borRepaidId,
      lender_id: lenderId,
      amount_paise: 30000,
      repayment_date: iso2,
      payment_account_id: accId,
      transaction_id: tx3Id,
      notes: null,
      created_at: iso2,
      updated_at: iso2
    });

    const harness = buildCoordinatorHarness(userId, cloud);
    await harness.db.borrowings.put({
      id: borRepaidId,
      userId,
      lenderId,
      amountPaise: 30000,
      borrowingDate: iso1,
      receivingAccountId: accId,
      transactionId: tx1Id,
      status: 'active',
      createdAt: iso1,
      updatedAt: iso1
    });
    await harness.db.borrowings.put({
      id: borProtectedId,
      userId,
      lenderId,
      amountPaise: 40000,
      borrowingDate: iso1,
      receivingAccountId: accId,
      transactionId: tx2Id,
      status: 'repaid',
      createdAt: iso1,
      updatedAt: iso2
    });

    const pullResult = await harness.borrowingsReconciler.pullAndReconcile(userId);
    expect(pullResult.borrowings.updatedCount).toBe(1);
    expect(pullResult.borrowings.conflictCount).toBe(1);
    expect(pullResult.repayments.insertedCount).toBe(1);

    // Cloud 'repaid' updated local 'active'
    expect((await harness.db.borrowings.get(borRepaidId))?.status).toBe('repaid');
    // Local 'repaid' was never reopened to 'active'
    expect((await harness.db.borrowings.get(borProtectedId))?.status).toBe('repaid');
  });

  it('11. never overwrites pending local outbox edits across any core ledger entity during pull', async () => {
    const accId = 'aaaa9101-1111-4111-8111-111111111111';
    const catId = 'bbbb9101-1111-4111-8111-111111111111';
    const txId = 'cccc9101-1111-4111-8111-111111111111';
    const lenderId = 'dddd9101-1111-4111-8111-111111111111';
    const borId = 'eeee9101-1111-4111-8111-111111111111';
    const repId = 'ffff9101-1111-4111-8111-111111111111';

    cloud.accounts.set(accId, {
      id: accId,
      user_id: userId,
      name: 'Cloud Old Name',
      account_type: 'bank',
      opening_balance_paise: 100,
      currency: 'INR',
      system_tag: null,
      is_archived: false,
      version: 5,
      created_at: iso1,
      updated_at: iso2
    });
    cloud.categories.set(catId, {
      id: catId,
      user_id: userId,
      name: 'Cloud Cat',
      type: 'expense',
      is_default: false,
      is_archived: false,
      version: 5,
      created_at: iso1,
      updated_at: iso2
    });
    cloud.transactions.set(txId, {
      id: txId,
      user_id: userId,
      type: 'expense',
      amount_paise: 999,
      currency: 'INR',
      account_id: accId,
      destination_account_id: null,
      category_id: catId,
      title: 'Cloud Tx Title',
      note: null,
      transaction_date: iso1,
      deleted_at: null,
      version: 5,
      device_id: 'dev-b',
      idempotency_key: 'pending-tx-key',
      created_at: iso1,
      updated_at: iso2
    });
    cloud.lenders.set(lenderId, {
      id: lenderId,
      user_id: userId,
      name: 'Cloud Lender',
      phone: null,
      email: null,
      notes: null,
      is_archived: false,
      created_at: iso1,
      updated_at: iso2
    });
    cloud.borrowings.set(borId, {
      id: borId,
      user_id: userId,
      lender_id: lenderId,
      amount_paise: 5000,
      borrowing_date: iso1,
      due_date: null,
      receiving_account_id: accId,
      transaction_id: txId,
      status: 'active',
      notes: 'Cloud Note',
      created_at: iso1,
      updated_at: iso2
    });
    cloud.repayments.set(repId, {
      id: repId,
      user_id: userId,
      borrowing_id: borId,
      lender_id: lenderId,
      amount_paise: 5000,
      repayment_date: iso2,
      payment_account_id: accId,
      transaction_id: txId,
      notes: 'Cloud Repay',
      created_at: iso1,
      updated_at: iso2
    });

    const harness = buildCoordinatorHarness(userId, cloud);

    await harness.db.accounts.put({
      id: accId,
      userId,
      name: 'Local Dirty Name',
      type: 'bank',
      accountType: 'bank',
      openingBalancePaise: 100,
      openingBalanceInPaise: 100,
      currency: 'INR',
      systemTag: null,
      status: 'active',
      isArchived: false,
      version: 2,
      createdAt: iso1,
      updatedAt: iso2
    });
    await harness.db.categories.put({
      id: catId,
      userId,
      name: 'Local Dirty Cat',
      type: 'expense',
      isDefault: false,
      isSystem: false,
      isArchived: false,
      version: 2,
      createdAt: iso1,
      updatedAt: iso2
    });
    await harness.db.transactions.put({
      id: txId,
      userId,
      type: 'expense',
      amountPaise: 111,
      amountInPaise: 111,
      currency: 'INR',
      accountId: accId,
      categoryId: catId,
      title: 'Local Dirty Tx',
      transactionDate: iso1,
      date: iso1,
      deletedAt: null,
      isDeleted: false,
      version: 2,
      idempotencyKey: 'pending-tx-key',
      createdAt: iso1,
      updatedAt: iso2
    });
    await harness.db.lenders.put({
      id: lenderId,
      userId,
      name: 'Local Dirty Lender',
      isArchived: false,
      createdAt: iso1,
      updatedAt: iso2
    });
    await harness.db.borrowings.put({
      id: borId,
      userId,
      lenderId,
      amountPaise: 5000,
      borrowingDate: iso1,
      receivingAccountId: accId,
      transactionId: txId,
      status: 'repaid',
      notes: 'Local Dirty Note',
      createdAt: iso1,
      updatedAt: iso2
    });
    await harness.db.borrowingRepayments.put({
      id: repId,
      userId,
      borrowingId: borId,
      lenderId,
      amountPaise: 5000,
      repaymentDate: iso2,
      paymentAccountId: accId,
      transactionId: txId,
      notes: 'Local Dirty Repay',
      createdAt: iso1,
      updatedAt: iso2
    });

    await harness.outboxManager.enqueue({
      userId,
      entity: 'accounts',
      entityId: accId,
      operation: 'UPDATE',
      payload: { id: accId, user_id: userId, name: 'Local Dirty Name', version: 2 },
      idempotencyKey: 'p-acc'
    });
    await harness.outboxManager.enqueue({
      userId,
      entity: 'categories',
      entityId: catId,
      operation: 'UPDATE',
      payload: { id: catId, user_id: userId, name: 'Local Dirty Cat', version: 2 },
      idempotencyKey: 'p-cat'
    });
    await harness.outboxManager.enqueue({
      userId,
      entity: 'transactions',
      entityId: txId,
      operation: 'UPDATE',
      payload: { id: txId, user_id: userId, title: 'Local Dirty Tx', version: 2 },
      idempotencyKey: 'pending-tx-key'
    });
    await harness.outboxManager.enqueue({
      userId,
      entity: 'lenders',
      entityId: lenderId,
      operation: 'UPDATE',
      payload: { id: lenderId, user_id: userId, name: 'Local Dirty Lender' },
      idempotencyKey: 'p-lender'
    });
    await harness.outboxManager.enqueue({
      userId,
      entity: 'borrowings',
      entityId: borId,
      operation: 'UPDATE',
      payload: { id: borId, user_id: userId, notes: 'Local Dirty Note' },
      idempotencyKey: 'p-bor'
    });
    await harness.outboxManager.enqueue({
      userId,
      entity: 'borrowing_repayments',
      entityId: repId,
      operation: 'INSERT',
      payload: { id: repId, user_id: userId, transaction_id: txId, borrowing_id: borId },
      idempotencyKey: 'p-rep'
    });

    const catRes = await harness.categoryReconciler.pullAndReconcile(userId);
    const accRes = await harness.accountReconciler.pullAndReconcile(userId);
    const txRes = await harness.transactionReconciler.pullAndReconcile(userId);
    const borRes = await harness.borrowingsReconciler.pullAndReconcile(userId);

    expect(catRes.skippedPendingCount).toBe(1);
    expect(accRes.skippedPendingCount).toBe(1);
    expect(txRes.skippedPendingCount).toBe(1);
    expect(borRes.lenders.skippedPendingCount).toBe(1);
    expect(borRes.borrowings.skippedPendingCount).toBe(1);
    expect(borRes.repayments.skippedPendingCount).toBe(1);

    expect((await harness.db.accounts.get(accId))?.name).toBe('Local Dirty Name');
    expect((await harness.db.categories.get(catId))?.name).toBe('Local Dirty Cat');
    expect((await harness.db.transactions.get(txId))?.title).toBe('Local Dirty Tx');
    expect((await harness.db.lenders.get(lenderId))?.name).toBe('Local Dirty Lender');
    expect((await harness.db.borrowings.get(borId))?.notes).toBe('Local Dirty Note');
    expect((await harness.db.borrowingRepayments.get(repId))?.notes).toBe('Local Dirty Repay');
  });

  it('12. enforces cross-user isolation by rejecting mismatched user_id rows on pull', async () => {
    const foreignCatId = 'aaaa9201-1111-4111-8111-111111111111';
    const harness = buildCoordinatorHarness(userId, cloud);

    vi.spyOn(harness.cloudRepos.categoryRepo, 'findAll').mockResolvedValueOnce([
      {
        id: foreignCatId,
        user_id: otherUserId,
        name: 'Foreign Cat',
        type: 'expense',
        is_default: false,
        is_archived: false,
        version: 1,
        created_at: iso1,
        updated_at: iso1
      }
    ]);

    await expect(harness.categoryReconciler.pullAndReconcile(userId)).rejects.toThrow(SyncAuthError);
    expect(await harness.db.categories.toArray()).toHaveLength(0);

    vi.spyOn(harness.cloudRepos.accountRepo, 'findAll').mockResolvedValueOnce([
      {
        id: 'bbbb9201-1111-4111-8111-111111111111',
        user_id: otherUserId,
        name: 'Foreign Acc',
        account_type: 'bank',
        opening_balance_paise: 0,
        currency: 'INR',
        system_tag: null,
        is_archived: false,
        version: 1,
        created_at: iso1,
        updated_at: iso1
      }
    ]);
    await expect(harness.accountReconciler.pullAndReconcile(userId)).rejects.toThrow(SyncAuthError);

    vi.spyOn(
      harness.cloudRepos.transactionRepo as Required<ISupabaseTransactionRepository>,
      'findPage'
    ).mockResolvedValueOnce({
      rows: [
        {
          id: 'cccc9201-1111-4111-8111-111111111111',
          user_id: otherUserId,
          type: 'expense',
          amount_paise: 100,
          currency: 'INR',
          account_id: 'dddd9201-1111-4111-8111-111111111111',
          destination_account_id: null,
          category_id: null,
          title: 'Foreign Tx',
          note: null,
          transaction_date: iso1,
          deleted_at: null,
          version: 1,
          device_id: 'dev-x',
          idempotency_key: 'k-foreign',
          created_at: iso1,
          updated_at: iso1
        }
      ],
      hasMore: false,
      nextOffset: 1
    });
    await expect(harness.transactionReconciler.pullAndReconcile(userId)).rejects.toThrow(SyncAuthError);

    vi.spyOn(harness.cloudRepos.lenderRepo, 'findAll').mockResolvedValueOnce([
      {
        id: 'eeee9201-1111-4111-8111-111111111111',
        user_id: otherUserId,
        name: 'Foreign Lender',
        phone: null,
        email: null,
        notes: null,
        is_archived: false,
        created_at: iso1,
        updated_at: iso1
      }
    ]);
    await expect(harness.borrowingsReconciler.pullAndReconcile(userId)).rejects.toThrow(SyncAuthError);
  });

  it('13. repeated ManualSyncCoordinator runs remain idempotent without duplicates or outbox amplification', async () => {
    const accId = 'aaaa9301-1111-4111-8111-111111111111';
    const catId = 'bbbb9301-1111-4111-8111-111111111111';
    const txId = 'cccc9301-1111-4111-8111-111111111111';
    const lenderId = 'dddd9301-1111-4111-8111-111111111111';
    const borId = 'eeee9301-1111-4111-8111-111111111111';
    const repId = 'ffff9301-1111-4111-8111-111111111111';

    cloud.accounts.set(accId, {
      id: accId,
      user_id: userId,
      name: 'Personal Borrowings',
      account_type: 'other',
      opening_balance_paise: 0,
      currency: 'INR',
      system_tag: 'personal_borrowings',
      is_archived: false,
      version: 1,
      created_at: iso1,
      updated_at: iso1
    });
    cloud.categories.set(catId, {
      id: catId,
      user_id: userId,
      name: 'Utilities',
      type: 'expense',
      is_default: true,
      is_archived: false,
      version: 1,
      created_at: iso1,
      updated_at: iso1
    });
    cloud.transactions.set(txId, {
      id: txId,
      user_id: userId,
      type: 'expense',
      amount_paise: 25000,
      currency: 'INR',
      account_id: accId,
      destination_account_id: null,
      category_id: catId,
      title: 'Electricity',
      note: null,
      transaction_date: iso1,
      deleted_at: null,
      version: 1,
      device_id: 'dev-b',
      idempotency_key: 'k-idemp-repeat-1',
      created_at: iso1,
      updated_at: iso1
    });
    cloud.lenders.set(lenderId, {
      id: lenderId,
      user_id: userId,
      name: 'Vikram',
      phone: null,
      email: null,
      notes: null,
      is_archived: false,
      created_at: iso1,
      updated_at: iso1
    });
    cloud.borrowings.set(borId, {
      id: borId,
      user_id: userId,
      lender_id: lenderId,
      amount_paise: 25000,
      borrowing_date: iso1,
      due_date: null,
      receiving_account_id: accId,
      transaction_id: txId,
      status: 'active',
      notes: null,
      created_at: iso1,
      updated_at: iso1
    });
    cloud.repayments.set(repId, {
      id: repId,
      user_id: userId,
      borrowing_id: borId,
      lender_id: lenderId,
      amount_paise: 10000,
      repayment_date: iso2,
      payment_account_id: accId,
      transaction_id: txId,
      notes: null,
      created_at: iso2,
      updated_at: iso2
    });

    const harness = buildCoordinatorHarness(userId, cloud);

    const run1 = await harness.coordinator.run();
    expect(run1.pulledCount).toBe(6);
    expect(run1.stillPendingCount).toBe(0);

    const run2 = await harness.coordinator.run();
    expect(run2.pulledCount).toBe(0);
    expect(run2.syncedCount).toBe(0);
    expect(run2.failedCount).toBe(0);
    expect(run2.stillPendingCount).toBe(0);
    expect(run2.errors).toHaveLength(0);

    expect(await harness.db.accounts.toArray()).toHaveLength(1);
    expect(await harness.db.categories.toArray()).toHaveLength(1);
    expect(await harness.db.transactions.toArray()).toHaveLength(1);
    expect(await harness.db.lenders.toArray()).toHaveLength(1);
    expect(await harness.db.borrowings.toArray()).toHaveLength(1);
    expect(await harness.db.borrowingRepayments.toArray()).toHaveLength(1);
    expect(await harness.db.syncOutbox.toArray()).toHaveLength(0);
  });
});

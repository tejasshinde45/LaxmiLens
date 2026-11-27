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
import { DexieAccountRepository } from '@/infrastructure/database/local/repositories/DexieAccountRepository';
import { DexieAccountDeletionInspector } from '@/infrastructure/database/local/repositories/DexieAccountDeletionInspector';
import { DexieCategoryRepository } from '@/infrastructure/database/local/repositories/DexieCategoryRepository';
import { DeleteAccountUseCase } from '@/application/use-cases/accounts/DeleteAccountUseCase';
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
import {
  ISupabaseAccountRepository,
  SupabaseAccountRepository
} from '@/infrastructure/database/cloud/repositories/SupabaseAccountRepository';
import { ISupabaseCategoryRepository } from '@/infrastructure/database/cloud/repositories/SupabaseCategoryRepository';
import {
  ISupabaseTransactionRepository,
  SupabaseTransactionRepository
} from '@/infrastructure/database/cloud/repositories/SupabaseTransactionRepository';
import { ISupabaseLenderRepository } from '@/infrastructure/database/cloud/repositories/SupabaseLenderRepository';
import {
  ISupabaseBorrowingRepository,
  SupabaseBorrowingRepository
} from '@/infrastructure/database/cloud/repositories/SupabaseBorrowingRepository';
import {
  ISupabaseBorrowingRepaymentRepository,
  SupabaseBorrowingRepaymentRepository
} from '@/infrastructure/database/cloud/repositories/SupabaseBorrowingRepaymentRepository';
import { ISupabaseBudgetRepository } from '@/infrastructure/database/cloud/repositories/SupabaseBudgetRepository';
import {
  ISupabaseRecurringRuleRepository,
  SupabaseRecurringRuleRepository
} from '@/infrastructure/database/cloud/repositories/SupabaseRecurringRuleRepository';
import { ISupabaseRecurringOccurrenceRepository } from '@/infrastructure/database/cloud/repositories/SupabaseRecurringOccurrenceRepository';
import { ISupabaseNotificationRepository } from '@/infrastructure/database/cloud/repositories/SupabaseNotificationRepository';
import { ISupabaseNotificationPreferenceRepository } from '@/infrastructure/database/cloud/repositories/SupabaseNotificationPreferenceRepository';
import {
  SyncAccountDependencyError,
  SyncConflictError
} from '@/infrastructure/sync/errors/SyncErrors';

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

function createInMemoryDeviceDb() {
  const accounts = new Map<string, LocalAccountRecord>();
  const categories = new Map<string, LocalCategoryRecord>();
  const transactions = new Map<string, LocalTransactionRecord>();
  const budgets = new Map<string, LocalBudgetRecord>();
  const recurringRules = new Map<string, LocalRecurringRuleRecord>();
  const recurringOccurrences = new Map<string, LocalRecurringOccurrenceRecord>();
  const lenders = new Map<string, LocalLenderRecord>();
  const borrowings = new Map<string, LocalBorrowingRecord>();
  const borrowingRepayments = new Map<string, LocalBorrowingRepaymentRecord>();
  const notifications = new Map<string, LocalNotificationRecord>();
  const notificationPreferences = new Map<string, LocalNotificationPreferenceRecord>();
  const syncOutbox = new Map<number, LocalOutboxRecord>();
  const syncMetadata = new Map<string, LocalSyncMetadataRecord>();
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
      toArray: vi.fn(async () => getAll()),
      filter: vi.fn((pred: (item: T) => boolean) => ({
        toArray: vi.fn(async () => getAll().filter(pred)),
        first: vi.fn(async () => getAll().find(pred))
      })),
      where: vi.fn((index: string) => ({
        equals: (val: unknown) => {
          const matchFn = (r: T): boolean => {
            const rec = r as Record<string, unknown>;
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
        }
      }))
    };
  }

  const dbObj = {
    isOpen: vi.fn(() => true),
    accounts: makeTable<LocalAccountRecord, string>(accounts, 'id'),
    categories: makeTable<LocalCategoryRecord, string>(categories, 'id'),
    transactions: makeTable<LocalTransactionRecord, string>(transactions, 'id'),
    budgets: makeTable<LocalBudgetRecord, string>(budgets, 'id'),
    recurringRules: makeTable<LocalRecurringRuleRecord, string>(recurringRules, 'id'),
    recurringOccurrences: makeTable<LocalRecurringOccurrenceRecord, string>(
      recurringOccurrences,
      'id'
    ),
    lenders: makeTable<LocalLenderRecord, string>(lenders, 'id'),
    borrowings: makeTable<LocalBorrowingRecord, string>(borrowings, 'id'),
    borrowingRepayments: makeTable<LocalBorrowingRepaymentRecord, string>(
      borrowingRepayments,
      'id'
    ),
    notifications: makeTable<LocalNotificationRecord, string>(notifications, 'id'),
    notificationPreferences: makeTable<LocalNotificationPreferenceRecord, string>(
      notificationPreferences,
      'userId'
    ),
    syncOutbox: makeTable<LocalOutboxRecord, number>(syncOutbox, 'id', true),
    syncMetadata: makeTable<LocalSyncMetadataRecord, string>(syncMetadata, 'key'),
    transaction: vi.fn(async (...args: unknown[]) => {
      const fn = args[args.length - 1] as () => Promise<unknown>;
      return fn();
    })
  };

  return dbObj as unknown as LaxmiLensDB;
}

function createCloudStores(): CloudMockStores {
  return {
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
}

function createCloudRepos(cloud: CloudMockStores) {
  const accountRepo: ISupabaseAccountRepository = {
    insert: vi.fn(async (row: CloudAccountRow) => {
      if (row.deleted_at != null) {
        throw new SyncConflictError(`Cannot insert deleted account '${row.id}'.`);
      }
      const existing = cloud.accounts.get(row.id);
      if (existing) {
        if (existing.deleted_at != null) {
          throw new SyncConflictError(
            `Account ID '${row.id}' was permanently deleted in cloud and cannot be recreated.`,
            existing
          );
        }
        return { ...existing };
      }
      cloud.accounts.set(row.id, { ...row });
      return { ...row };
    }),
    updatePartial: vi.fn(async (id, userId, patch, expectedVersion) => {
      const existing = cloud.accounts.get(id);
      if (!existing || existing.user_id !== userId) {
        throw new SyncConflictError(`Account '${id}' not found.`);
      }
      if (existing.deleted_at != null) {
        throw new SyncConflictError(
          `Cannot update account '${id}': account was permanently deleted in cloud.`,
          existing
        );
      }
      if (existing.version !== expectedVersion) {
        throw new SyncConflictError(`Version conflict updating '${id}'.`, existing);
      }
      const updated = { ...existing, ...patch, version: expectedVersion + 1 };
      cloud.accounts.set(id, updated);
      return { ...updated };
    }),
    safeDelete: vi.fn(async (id, userId, expectedVersion, deletedAt) => {
      const existing = cloud.accounts.get(id);
      if (!existing) return;
      if (existing.user_id !== userId) {
        throw new SyncConflictError(`Account '${id}' belongs to another user.`);
      }
      if (existing.deleted_at != null) {
        return;
      }
      if (existing.version !== expectedVersion) {
        throw new SyncConflictError(`Version conflict deleting account '${id}'.`, existing);
      }

      const hasTx = Array.from(cloud.transactions.values()).some(
        (tx) =>
          tx.user_id === userId &&
          (tx.account_id === id || tx.destination_account_id === id)
      );
      const hasRule = Array.from(cloud.recurringRules.values()).some(
        (r) => r.user_id === userId && r.account_id === id
      );
      const hasBorrowing = Array.from(cloud.borrowings.values()).some(
        (b) => b.user_id === userId && b.receiving_account_id === id
      );
      const hasRepayment = Array.from(cloud.repayments.values()).some(
        (r) => r.user_id === userId && r.payment_account_id === id
      );
      if (hasTx || hasRule || hasBorrowing || hasRepayment) {
        throw new SyncAccountDependencyError(`Account '${id}' has dependencies in cloud.`, id);
      }

      const tombstoneAt = deletedAt ?? new Date().toISOString();
      cloud.accounts.set(id, {
        ...existing,
        deleted_at: tombstoneAt,
        updated_at: tombstoneAt,
        version: expectedVersion + 1
      });
    }),
    findById: vi.fn(async (id) => {
      const found = cloud.accounts.get(id);
      return found ? { ...found } : null;
    }),
    findAll: vi.fn(async (userId, options = {}) =>
      Array.from(cloud.accounts.values())
        .filter((r) => r.user_id === userId && (options.includeDeleted || r.deleted_at == null))
        .map((r) => ({ ...r }))
    ),
    findPage: vi.fn(async (userId, options = {}) => {
      const offset = options.offset ?? 0;
      const limit = options.limit ?? 500;
      const all = Array.from(cloud.accounts.values()).filter((r) => r.user_id === userId);
      const page = all.slice(offset, offset + limit).map((r) => ({ ...r }));
      const rows = options.includeDeleted ? page : page.filter((r) => r.deleted_at == null);
      return {
        rows,
        hasMore: offset + page.length < all.length,
        nextOffset: offset + page.length
      };
    })
  };

  const categoryRepo: ISupabaseCategoryRepository = {
    insert: vi.fn(async (row) => {
      cloud.categories.set(row.id, { ...row });
      return { ...row };
    }),
    updatePartial: vi.fn(async (id, userId, patch, expectedVersion) => {
      const existing = cloud.categories.get(id)!;
      const updated = { ...existing, ...patch, version: expectedVersion + 1 };
      cloud.categories.set(id, updated);
      return { ...updated };
    }),
    findById: vi.fn(async (id) => {
      const found = cloud.categories.get(id);
      return found ? { ...found } : null;
    }),
    findDefaultMatch: vi.fn(async () => null),
    findAll: vi.fn(async (userId) =>
      Array.from(cloud.categories.values())
        .filter((r) => r.user_id === userId)
        .map((r) => ({ ...r }))
    )
  };

  const transactionRepo: ISupabaseTransactionRepository = {
    insert: vi.fn(async (row) => {
      const src = cloud.accounts.get(row.account_id);
      if (!src || src.user_id !== row.user_id || src.deleted_at != null) {
        throw new SyncAccountDependencyError(`Account '${row.account_id}' missing or deleted.`, row.account_id);
      }
      if (row.destination_account_id) {
        const dst = cloud.accounts.get(row.destination_account_id);
        if (!dst || dst.user_id !== row.user_id || dst.deleted_at != null) {
          throw new SyncAccountDependencyError(
            `Destination account '${row.destination_account_id}' missing or deleted.`,
            row.destination_account_id
          );
        }
      }
      cloud.transactions.set(row.id, { ...row });
      return { ...row };
    }),
    updatePartial: vi.fn(async (id, _userId, patch, expectedVersion) => {
      const existing = cloud.transactions.get(id)!;
      const updated = { ...existing, ...patch, version: expectedVersion + 1 };
      cloud.transactions.set(id, updated);
      return { ...updated };
    }),
    softDelete: vi.fn(async (id, _userId, deletedAt, expectedVersion) => {
      const existing = cloud.transactions.get(id)!;
      const updated = { ...existing, deleted_at: deletedAt, version: expectedVersion + 1 };
      cloud.transactions.set(id, updated);
      return { ...updated };
    }),
    findById: vi.fn(async (id) => {
      const found = cloud.transactions.get(id);
      return found ? { ...found } : null;
    }),
    findPage: vi.fn(async (userId) => ({
      rows: Array.from(cloud.transactions.values()).filter((r) => r.user_id === userId),
      hasMore: false,
      nextOffset: 0
    })),
    findAll: vi.fn(async (userId) =>
      Array.from(cloud.transactions.values())
        .filter((r) => r.user_id === userId)
        .map((r) => ({ ...r }))
    )
  };

  const lenderRepo: ISupabaseLenderRepository = {
    insert: vi.fn(async (row) => {
      cloud.lenders.set(row.id, { ...row });
      return { ...row };
    }),
    updatePartial: vi.fn(async (id, _userId, patch) => {
      const existing = cloud.lenders.get(id)!;
      const updated = { ...existing, ...patch };
      cloud.lenders.set(id, updated);
      return { ...updated };
    }),
    findById: vi.fn(async (id) => {
      const found = cloud.lenders.get(id);
      return found ? { ...found } : null;
    }),
    findAll: vi.fn(async (userId) =>
      Array.from(cloud.lenders.values())
        .filter((r) => r.user_id === userId)
        .map((r) => ({ ...r }))
    )
  };

  const borrowingRepo: ISupabaseBorrowingRepository = {
    insert: vi.fn(async (row) => {
      const acc = cloud.accounts.get(row.receiving_account_id);
      if (!acc || acc.user_id !== row.user_id || acc.deleted_at != null) {
        throw new SyncAccountDependencyError(
          `Receiving account '${row.receiving_account_id}' missing or deleted.`,
          row.receiving_account_id
        );
      }
      cloud.borrowings.set(row.id, { ...row });
      return { ...row };
    }),
    updatePartial: vi.fn(async (id, _userId, patch) => {
      const existing = cloud.borrowings.get(id)!;
      const updated = { ...existing, ...patch };
      cloud.borrowings.set(id, updated);
      return { ...updated };
    }),
    findById: vi.fn(async (id) => {
      const found = cloud.borrowings.get(id);
      return found ? { ...found } : null;
    }),
    findByTransactionId: vi.fn(async () => null),
    findAll: vi.fn(async (userId) =>
      Array.from(cloud.borrowings.values())
        .filter((r) => r.user_id === userId)
        .map((r) => ({ ...r }))
    )
  };

  const repaymentRepo: ISupabaseBorrowingRepaymentRepository = {
    insert: vi.fn(async (row) => {
      const acc = cloud.accounts.get(row.payment_account_id);
      if (!acc || acc.user_id !== row.user_id || acc.deleted_at != null) {
        throw new SyncAccountDependencyError(
          `Payment account '${row.payment_account_id}' missing or deleted.`,
          row.payment_account_id
        );
      }
      cloud.repayments.set(row.id, { ...row });
      return { ...row };
    }),
    updatePartial: vi.fn(async (id, _userId, patch) => {
      const existing = cloud.repayments.get(id)!;
      const updated = { ...existing, ...patch };
      cloud.repayments.set(id, updated);
      return { ...updated };
    }),
    findById: vi.fn(async (id) => {
      const found = cloud.repayments.get(id);
      return found ? { ...found } : null;
    }),
    findAll: vi.fn(async (userId) =>
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
    updatePartial: vi.fn(async (id, _userId, patch, expectedVersion) => {
      const existing = cloud.budgets.get(id)!;
      const updated = { ...existing, ...patch, version: expectedVersion + 1 };
      cloud.budgets.set(id, updated);
      return { ...updated };
    }),
    softDelete: vi.fn(async (id, _userId, deletedAt, expectedVersion) => {
      const existing = cloud.budgets.get(id)!;
      const updated = { ...existing, deleted_at: deletedAt, version: expectedVersion + 1 };
      cloud.budgets.set(id, updated);
      return { ...updated };
    }),
    findById: vi.fn(async () => null),
    findAll: vi.fn(async () => [])
  };

  const recurringRuleRepo: ISupabaseRecurringRuleRepository = {
    insert: vi.fn(async (row) => {
      const acc = cloud.accounts.get(row.account_id);
      if (!acc || acc.user_id !== row.user_id || acc.deleted_at != null) {
        throw new SyncAccountDependencyError(`Account '${row.account_id}' missing or deleted.`, row.account_id);
      }
      cloud.recurringRules.set(row.id, { ...row });
      return { ...row };
    }),
    updatePartial: vi.fn(async (id, _userId, patch, expectedVersion) => {
      const existing = cloud.recurringRules.get(id)!;
      const updated = { ...existing, ...patch, version: expectedVersion + 1 };
      cloud.recurringRules.set(id, updated);
      return { ...updated };
    }),
    softDelete: vi.fn(async (id, _userId, deletedAt, expectedVersion) => {
      const existing = cloud.recurringRules.get(id)!;
      const updated = { ...existing, deleted_at: deletedAt, version: expectedVersion + 1 };
      cloud.recurringRules.set(id, updated);
      return { ...updated };
    }),
    findById: vi.fn(async (id) => {
      const found = cloud.recurringRules.get(id);
      return found ? { ...found } : null;
    }),
    findAll: vi.fn(async (userId) =>
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
    updatePartial: vi.fn(async (id, _userId, patch, expectedVersion) => {
      const existing = cloud.recurringOccurrences.get(id)!;
      const updated = { ...existing, ...patch, version: expectedVersion + 1 };
      cloud.recurringOccurrences.set(id, updated);
      return { ...updated };
    }),
    softDelete: vi.fn(async (id, _userId, deletedAt, expectedVersion) => {
      const existing = cloud.recurringOccurrences.get(id)!;
      const updated = { ...existing, deleted_at: deletedAt, version: expectedVersion + 1 };
      cloud.recurringOccurrences.set(id, updated);
      return { ...updated };
    }),
    findById: vi.fn(async () => null),
    findAll: vi.fn(async (userId) =>
      Array.from(cloud.recurringOccurrences.values())
        .filter((r) => r.user_id === userId)
        .map((r) => ({ ...r }))
    )
  };

  const notificationRepo: ISupabaseNotificationRepository = {
    upsert: vi.fn(async (row) => {
      cloud.notifications.set(row.id, { ...row });
      return { ...row };
    }),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
    softDelete: vi.fn(),
    findById: vi.fn(async () => null),
    findAll: vi.fn(async () => [])
  };

  const notificationPreferenceRepo: ISupabaseNotificationPreferenceRepository = {
    upsert: vi.fn(async (row) => {
      cloud.notificationPreferences.set(row.user_id, { ...row });
      return { ...row };
    }),
    updatePartial: vi.fn(),
    findByUserId: vi.fn(async () => null)
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

function buildDeviceHarness(userId: string, cloud: CloudMockStores) {
  const db = createInMemoryDeviceDb();
  const outboxManager = new OutboxManager(db);
  const localAccountRepo = new DexieAccountRepository(db);
  const inspector = new DexieAccountDeletionInspector(db);
  const categoryRepoLocal = new DexieCategoryRepository(db);
  const cloudRepos = createCloudRepos(cloud);

  const authUser: AuthUser = { id: userId, email: 'sync@laxmilens.app' };
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
    500
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

  const coordinator = new ManualSyncCoordinator(
    new AccountSyncDispatcher(cloudRepos.accountRepo, authPort, outboxManager),
    new TransactionSyncDispatcher(
      cloudRepos.transactionRepo,
      authPort,
      outboxManager,
      categoryMappingService
    ),
    outboxManager,
    authPort,
    new CategorySyncDispatcher(cloudRepos.categoryRepo, authPort, outboxManager, categoryMappingService),
    new LenderSyncDispatcher(cloudRepos.lenderRepo, authPort, outboxManager),
    new BorrowingSyncDispatcher(cloudRepos.borrowingRepo, authPort, outboxManager),
    new BorrowingRepaymentSyncDispatcher(cloudRepos.repaymentRepo, authPort, outboxManager),
    new BudgetSyncDispatcher(cloudRepos.budgetRepo, authPort, outboxManager, categoryMappingService),
    budgetReconciler,
    new RecurringRuleSyncDispatcher(
      cloudRepos.recurringRuleRepo,
      authPort,
      outboxManager,
      categoryMappingService
    ),
    new RecurringOccurrenceSyncDispatcher(
      cloudRepos.recurringOccurrenceRepo,
      authPort,
      outboxManager
    ),
    recurringReconciler,
    new NotificationSyncDispatcher(cloudRepos.notificationRepo, authPort, outboxManager),
    new NotificationPreferenceSyncDispatcher(
      cloudRepos.notificationPreferenceRepo,
      authPort,
      outboxManager
    ),
    notificationReconciler,
    {
      userId,
      accountReconciler,
      categoryReconciler,
      transactionReconciler,
      borrowingsReconciler
    }
  );

  const deleteAccountUseCase = new DeleteAccountUseCase(localAccountRepo, inspector, {
    enqueue: (entry) => outboxManager.enqueue(entry)
  });

  return {
    db,
    outboxManager,
    cloudRepos,
    accountReconciler,
    coordinator,
    deleteAccountUseCase
  };
}

describe('Cross-Device Account Deletion Propagation', () => {
  const USER_ID = '11111111-1111-4111-8111-111111111111';
  const ACC_DELETE = '22222222-2222-4222-8222-222222222201';
  const ACC_KEEP = '22222222-2222-4222-8222-222222222202';
  const ACC_NEW = '22222222-2222-4222-8222-222222222203';
  const ACC_PB = '22222222-2222-4222-8222-222222222204';
  const CAT_EXPENSE = '33333333-3333-4333-8333-333333333301';
  const TX_KEEP = '44444444-4444-4444-8444-444444444401';
  const TX_PENDING = '44444444-4444-4444-8444-444444444402';
  const RULE_KEEP = '55555555-5555-4555-8555-555555555501';
  const RULE_DEP = '55555555-5555-4555-8555-555555555502';
  const LENDER_1 = '66666666-6666-4666-8666-666666666601';
  const BOR_KEEP = '77777777-7777-4777-8777-777777777701';
  const BOR_DEP = '77777777-7777-4777-8777-777777777702';
  const REP_DEP = '88888888-8888-4888-8888-888888888801';

  const ISO_1 = '2026-10-01T10:00:00.000Z';
  const ISO_2 = '2026-10-02T10:00:00.000Z';
  const ISO_3 = '2026-10-03T10:00:00.000Z';

  let cloud: CloudMockStores;

  function seedBaseCloudState() {
    cloud.categories.set(CAT_EXPENSE, {
      id: CAT_EXPENSE,
      user_id: USER_ID,
      name: 'Groceries',
      type: 'expense',
      is_default: false,
      is_archived: false,
      version: 1,
      created_at: ISO_1,
      updated_at: ISO_1
    });

    cloud.accounts.set(ACC_DELETE, {
      id: ACC_DELETE,
      user_id: USER_ID,
      name: 'Temporary Bank',
      account_type: 'bank',
      opening_balance_paise: 0,
      currency: 'INR',
      institution_name: null,
      color: null,
      icon: null,
      notes: null,
      system_tag: null,
      is_archived: false,
      version: 1,
      deleted_at: null,
      created_at: ISO_1,
      updated_at: ISO_1
    });

    cloud.accounts.set(ACC_KEEP, {
      id: ACC_KEEP,
      user_id: USER_ID,
      name: 'Primary Wallet',
      account_type: 'cash',
      opening_balance_paise: 100000,
      currency: 'INR',
      institution_name: null,
      color: null,
      icon: null,
      notes: null,
      system_tag: null,
      is_archived: false,
      version: 1,
      deleted_at: null,
      created_at: ISO_1,
      updated_at: ISO_1
    });

    cloud.accounts.set(ACC_PB, {
      id: ACC_PB,
      user_id: USER_ID,
      name: 'Personal Borrowings',
      account_type: 'other',
      opening_balance_paise: 0,
      currency: 'INR',
      institution_name: null,
      color: null,
      icon: null,
      notes: null,
      system_tag: 'personal_borrowings',
      is_archived: false,
      version: 1,
      deleted_at: null,
      created_at: ISO_1,
      updated_at: ISO_1
    });

    cloud.transactions.set(TX_KEEP, {
      id: TX_KEEP,
      user_id: USER_ID,
      type: 'expense',
      amount_paise: 5000,
      currency: 'INR',
      account_id: ACC_KEEP,
      destination_account_id: null,
      category_id: CAT_EXPENSE,
      title: 'Coffee',
      note: null,
      transaction_date: ISO_1,
      deleted_at: null,
      version: 1,
      device_id: null,
      idempotency_key: 'idem-tx-keep',
      created_at: ISO_1,
      updated_at: ISO_1
    });

    cloud.recurringRules.set(RULE_KEEP, {
      id: RULE_KEEP,
      user_id: USER_ID,
      title: 'Monthly Rent',
      description: null,
      type: 'expense',
      amount_paise: 1500000,
      account_id: ACC_KEEP,
      category_id: CAT_EXPENSE,
      frequency: 'monthly',
      interval: 1,
      anchor_day_of_month: 1,
      start_date: '2026-01-01',
      end_date: null,
      next_due_date: '2026-12-01',
      last_generated_date: null,
      status: 'active',
      requires_user_confirmation: true,
      version: 1,
      created_at: ISO_1,
      updated_at: ISO_1,
      deleted_at: null
    });

    cloud.lenders.set(LENDER_1, {
      id: LENDER_1,
      user_id: USER_ID,
      name: 'Ravi',
      phone: null,
      notes: null,
      created_at: ISO_1,
      updated_at: ISO_1
    });

    cloud.borrowings.set(BOR_KEEP, {
      id: BOR_KEEP,
      user_id: USER_ID,
      lender_id: LENDER_1,
      amount_paise: 250000,
      borrowing_date: ISO_1,
      due_date: null,
      receiving_account_id: ACC_KEEP,
      transaction_id: TX_KEEP,
      status: 'active',
      notes: null,
      created_at: ISO_1,
      updated_at: ISO_1
    });
  }

  beforeEach(() => {
    cloud = createCloudStores();
    seedBaseCloudState();
  });

  it('1. propagates permanent deletion from Device A to Device B while leaving unrelated accounts and financial records intact', async () => {
    const deviceA = buildDeviceHarness(USER_ID, cloud);
    const deviceB = buildDeviceHarness(USER_ID, cloud);

    // Initial sync populates both devices identically
    await deviceA.coordinator.sync();
    await deviceB.coordinator.sync();

    expect(await deviceA.db.accounts.get(ACC_DELETE)).toBeDefined();
    expect(await deviceB.db.accounts.get(ACC_DELETE)).toBeDefined();

    // Device A permanently deletes ACC_DELETE and syncs tombstone to Supabase
    await deviceA.deleteAccountUseCase.execute(ACC_DELETE, USER_ID);
    expect(await deviceA.db.accounts.get(ACC_DELETE)).toBeUndefined();

    const pushSummaryA = await deviceA.coordinator.sync();
    expect(pushSummaryA.pushedCount).toBe(1);

    // Cloud retains immutable deletion tombstone (hidden from normal queries)
    const tombstone = cloud.accounts.get(ACC_DELETE);
    expect(tombstone?.deleted_at).toBeTruthy();
    expect(tombstone?.version).toBe(2);
    expect((await deviceA.cloudRepos.accountRepo.findAll(USER_ID)).map((a) => a.id)).not.toContain(
      ACC_DELETE
    );
    expect(
      (await deviceA.cloudRepos.accountRepo.findAll(USER_ID, { includeDeleted: true })).map(
        (a) => a.id
      )
    ).toContain(ACC_DELETE);

    // Device A's subsequent sync does not recreate ACC_DELETE
    await deviceA.coordinator.sync();
    expect(await deviceA.db.accounts.get(ACC_DELETE)).toBeUndefined();

    // Device B refreshes / syncs and removes stale ACC_DELETE locally
    await deviceB.coordinator.sync();

    expect(await deviceB.db.accounts.get(ACC_DELETE)).toBeUndefined();
    expect(await deviceB.db.accounts.get(ACC_KEEP)).toBeDefined();
    expect(await deviceB.db.accounts.get(ACC_PB)).toBeDefined();
    expect(await deviceB.db.transactions.get(TX_KEEP)).toBeDefined();
    expect(await deviceB.db.recurringRules.get(RULE_KEEP)).toBeDefined();
    expect(await deviceB.db.borrowings.get(BOR_KEEP)).toBeDefined();
    expect(await deviceB.outboxManager.getPendingEntries(USER_ID)).toHaveLength(0);
  });

  it('2. keeps repeated pulls idempotent and never recreates deleted accounts on existing or new devices', async () => {
    const deviceB = buildDeviceHarness(USER_ID, cloud);
    const deviceC = buildDeviceHarness(USER_ID, cloud);

    // Device B initially has ACC_DELETE and ACC_KEEP locally
    await deviceB.coordinator.sync();
    expect(await deviceB.db.accounts.get(ACC_DELETE)).toBeDefined();

    // Cloud transitions ACC_DELETE to tombstoned v2
    const cloudAcc = cloud.accounts.get(ACC_DELETE)!;
    cloud.accounts.set(ACC_DELETE, {
      ...cloudAcc,
      deleted_at: ISO_2,
      updated_at: ISO_2,
      version: 2
    });

    const firstPull = await deviceB.accountReconciler.pullAndReconcile(USER_ID);
    expect(firstPull.deletedCount).toBe(1);
    expect(firstPull.pulledCount).toBe(1);
    expect(firstPull.conflictCount).toBe(0);
    expect(await deviceB.db.accounts.get(ACC_DELETE)).toBeUndefined();

    // Repeated pulls on Device B are strict no-ops
    const secondPull = await deviceB.accountReconciler.pullAndReconcile(USER_ID);
    expect(secondPull.deletedCount).toBe(0);
    expect(secondPull.insertedCount).toBe(0);
    expect(secondPull.updatedCount).toBe(0);
    expect(secondPull.pulledCount).toBe(0);
    expect(await deviceB.db.accounts.get(ACC_DELETE)).toBeUndefined();
    expect(await deviceB.db.accounts.get(ACC_KEEP)).toBeDefined();

    // Fresh Device C syncing after deletion never creates ACC_DELETE locally
    await deviceC.coordinator.sync();
    expect(await deviceC.db.accounts.get(ACC_DELETE)).toBeUndefined();
    expect(await deviceC.db.accounts.get(ACC_KEEP)).toBeDefined();
    expect(await deviceC.db.accounts.get(ACC_PB)).toBeDefined();
  });

  it('3. protects accounts with pending local edits from deletion on pull and blocks overwriting tombstoned accounts', async () => {
    const deviceA = buildDeviceHarness(USER_ID, cloud);
    const deviceB = buildDeviceHarness(USER_ID, cloud);

    await deviceA.coordinator.sync();
    await deviceB.coordinator.sync();

    // Device A deletes ACC_DELETE and syncs tombstone
    await deviceA.deleteAccountUseCase.execute(ACC_DELETE, USER_ID);
    await deviceA.coordinator.sync();

    // Device B edited ACC_DELETE locally while offline and queued an UPDATE outbox entry
    const localB = (await deviceB.db.accounts.get(ACC_DELETE))!;
    await deviceB.db.accounts.put({
      ...localB,
      name: 'Offline Edited Account',
      version: 2,
      updatedAt: ISO_3
    });
    await deviceB.outboxManager.enqueue({
      userId: USER_ID,
      entity: 'accounts',
      entityId: ACC_DELETE,
      operation: 'UPDATE',
      payload: {
        id: ACC_DELETE,
        user_id: USER_ID,
        name: 'Offline Edited Account',
        account_type: 'bank',
        opening_balance_paise: 0,
        is_archived: false,
        version: 2,
        updated_at: ISO_3
      },
      idempotencyKey: 'idem-offline-edit-acc'
    });

    // Pull reconciliation skips pending local account mutation
    const pullRes = await deviceB.accountReconciler.pullAndReconcile(USER_ID);
    expect(pullRes.skippedPendingCount).toBe(1);
    expect(pullRes.deletedCount).toBe(0);
    expect((await deviceB.db.accounts.get(ACC_DELETE))?.name).toBe('Offline Edited Account');
    expect(await deviceB.outboxManager.getPendingEntries(USER_ID)).toHaveLength(1);

    // Full sync rejects overwriting cloud tombstone instead of recreating or erasing local data silently
    await expect(deviceB.coordinator.sync()).rejects.toThrow(SyncConflictError);
    expect(cloud.accounts.get(ACC_DELETE)?.deleted_at).toBeTruthy();
    expect((await deviceB.db.accounts.get(ACC_DELETE))?.name).toBe('Offline Edited Account');
  });

  it('4. protects local referencing records, pending dependent outbox writes, system accounts, and newer local versions without cascading', async () => {
    const deviceB = buildDeviceHarness(USER_ID, cloud);
    await deviceB.coordinator.sync();

    // Cloud deletes ACC_DELETE
    cloud.accounts.set(ACC_DELETE, {
      ...cloud.accounts.get(ACC_DELETE)!,
      deleted_at: ISO_2,
      updated_at: ISO_2,
      version: 2
    });

    // Case 4a: Pending local transaction outbox entry referencing ACC_DELETE protects account from silent deletion
    await deviceB.db.transactions.put({
      id: TX_PENDING,
      userId: USER_ID,
      type: 'expense',
      amountPaise: 1200,
      currency: 'INR',
      accountId: ACC_DELETE,
      account_id: ACC_DELETE,
      categoryId: CAT_EXPENSE,
      title: 'Offline Expense on Deleted Account',
      transactionDate: ISO_3,
      deletedAt: null,
      version: 1,
      idempotencyKey: 'idem-tx-pending',
      createdAt: ISO_3,
      updatedAt: ISO_3
    });
    await deviceB.outboxManager.enqueue({
      userId: USER_ID,
      entity: 'transactions',
      entityId: TX_PENDING,
      operation: 'INSERT',
      payload: {
        id: TX_PENDING,
        user_id: USER_ID,
        account_id: ACC_DELETE
      },
      idempotencyKey: 'idem-tx-pending-outbox'
    });

    const pendingRefRes = await deviceB.accountReconciler.pullAndReconcile(USER_ID);
    expect(pendingRefRes.skippedPendingCount).toBe(1);
    expect(pendingRefRes.deletedCount).toBe(0);
    expect(await deviceB.db.accounts.get(ACC_DELETE)).toBeDefined();
    expect(await deviceB.db.transactions.get(TX_PENDING)).toBeDefined();

    // Clear outbox and convert TX_PENDING to a local soft-deleted tombstone: local audit tombstone still prevents account removal
    await deviceB.db.syncOutbox.clear();
    await deviceB.db.transactions.put({
      ...(await deviceB.db.transactions.get(TX_PENDING))!,
      deletedAt: ISO_3,
      version: 2
    });
    const localTxRefRes = await deviceB.accountReconciler.pullAndReconcile(USER_ID);
    expect(localTxRefRes.conflictCount).toBe(1);
    expect(localTxRefRes.deletedCount).toBe(0);
    expect(await deviceB.db.accounts.get(ACC_DELETE)).toBeDefined();
    expect(await deviceB.db.transactions.get(TX_PENDING)).toBeDefined();

    // Remove TX_PENDING and verify local recurring rule / borrowing / repayment also block without cascade delete
    await deviceB.db.transactions.delete(TX_PENDING);
    await deviceB.db.recurringRules.put({
      id: RULE_DEP,
      userId: USER_ID,
      title: 'SIP',
      type: 'expense',
      amountPaise: 50000,
      accountId: ACC_DELETE,
      frequency: 'monthly',
      interval: 1,
      anchorDayOfMonth: 5,
      startDate: '2026-01-05',
      nextDueDate: '2026-12-05',
      status: 'active',
      requiresUserConfirmation: false,
      version: 1,
      createdAt: ISO_1,
      updatedAt: ISO_1,
      deletedAt: null
    });
    const ruleRefRes = await deviceB.accountReconciler.pullAndReconcile(USER_ID);
    expect(ruleRefRes.conflictCount).toBe(1);
    expect(ruleRefRes.deletedCount).toBe(0);
    expect(await deviceB.db.recurringRules.get(RULE_DEP)).toBeDefined();

    await deviceB.db.recurringRules.delete(RULE_DEP);
    await deviceB.db.borrowings.put({
      id: BOR_DEP,
      userId: USER_ID,
      lenderId: LENDER_1,
      amountPaise: 50000,
      borrowingDate: ISO_1,
      receivingAccountId: ACC_DELETE,
      receiving_account_id: ACC_DELETE,
      transactionId: TX_KEEP,
      status: 'active',
      version: 1,
      createdAt: ISO_1,
      updatedAt: ISO_1
    });
    expect((await deviceB.accountReconciler.pullAndReconcile(USER_ID)).deletedCount).toBe(0);
    expect(await deviceB.db.borrowings.get(BOR_DEP)).toBeDefined();

    await deviceB.db.borrowings.delete(BOR_DEP);
    await deviceB.db.borrowingRepayments.put({
      id: REP_DEP,
      userId: USER_ID,
      lenderId: LENDER_1,
      borrowingId: BOR_KEEP,
      amountPaise: 10000,
      repaymentDate: ISO_2,
      paymentAccountId: ACC_DELETE,
      payment_account_id: ACC_DELETE,
      transactionId: TX_KEEP,
      version: 1,
      createdAt: ISO_2,
      updatedAt: ISO_2
    });
    expect((await deviceB.accountReconciler.pullAndReconcile(USER_ID)).deletedCount).toBe(0);
    expect(await deviceB.db.borrowingRepayments.get(REP_DEP)).toBeDefined();
    await deviceB.db.borrowingRepayments.delete(REP_DEP);

    // Case 4c: Older cloud tombstone (v2) vs newer local account (v3) triggers version conflict and preserves local account
    await deviceB.db.accounts.put({
      ...(await deviceB.db.accounts.get(ACC_DELETE))!,
      version: 3
    });
    const versionConflictRes = await deviceB.accountReconciler.pullAndReconcile(USER_ID);
    expect(versionConflictRes.conflictCount).toBe(1);
    expect(versionConflictRes.deletedCount).toBe(0);
    expect(await deviceB.db.accounts.get(ACC_DELETE)).toBeDefined();
  });

  it('5. supports offline reconnect reconciliation and enforces cloud tombstone guards across SupabaseAccountRepository and dependent repositories', async () => {
    // 5a. End-to-end offline reconnect: Device A deletes ACC_DELETE and creates ACC_NEW while offline; Device B syncs on reconnect
    const deviceA = buildDeviceHarness(USER_ID, cloud);
    const deviceB = buildDeviceHarness(USER_ID, cloud);
    await deviceA.coordinator.sync();
    await deviceB.coordinator.sync();

    await deviceA.deleteAccountUseCase.execute(ACC_DELETE, USER_ID);
    await deviceA.db.accounts.put({
      id: ACC_NEW,
      userId: USER_ID,
      name: 'Offline New Savings',
      accountType: 'savings',
      openingBalancePaise: 25000,
      currency: 'INR',
      isArchived: false,
      version: 1,
      createdAt: ISO_3,
      updatedAt: ISO_3
    });
    await deviceA.outboxManager.enqueue({
      userId: USER_ID,
      entity: 'accounts',
      entityId: ACC_NEW,
      operation: 'INSERT',
      payload: {
        id: ACC_NEW,
        user_id: USER_ID,
        name: 'Offline New Savings',
        account_type: 'savings',
        opening_balance_paise: 25000,
        currency: 'INR',
        is_archived: false,
        version: 1
      },
      idempotencyKey: 'idem-acc-new'
    });

    // Reconnect Device A -> pushes tombstone & ACC_NEW, then Device B reconnects -> deletes ACC_DELETE & inserts ACC_NEW
    await deviceA.coordinator.sync();
    await deviceB.coordinator.sync();

    expect(await deviceB.db.accounts.get(ACC_DELETE)).toBeUndefined();
    expect((await deviceB.db.accounts.get(ACC_NEW))?.name).toBe('Offline New Savings');
    expect(await deviceB.db.accounts.get(ACC_KEEP)).toBeDefined();

    // 5b. Verify real SupabaseAccountRepository tombstone fallback, includeDeleted filter, and recreate/update rejection
    let rowInPg: CloudAccountRow = {
      id: ACC_DELETE,
      user_id: USER_ID,
      name: 'Temporary Bank',
      account_type: 'bank',
      opening_balance_paise: 0,
      currency: 'INR',
      institution_name: null,
      color: null,
      icon: null,
      notes: null,
      system_tag: null,
      is_archived: false,
      version: 1,
      deleted_at: null,
      created_at: ISO_1,
      updated_at: ISO_1
    };

    const emptyDepQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null })
    };

    const mockSupabaseClient = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: 'PGRST202', message: 'Could not find the function public.safe_delete_account' }
      }),
      from: vi.fn((table: string) => {
        if (table !== 'accounts') {
          return emptyDepQuery;
        }
        return {
          select: vi.fn().mockImplementation(() => ({
            eq: vi.fn().mockImplementation(() => ({
              maybeSingle: vi.fn(async () => ({ data: { ...rowInPg }, error: null })),
              order: vi.fn().mockImplementation(() => ({
                order: vi.fn().mockImplementation(() =>
                  Promise.resolve({ data: [{ ...rowInPg }], error: null })
                ),
                then: (resolve: (val: unknown) => unknown) =>
                  Promise.resolve({ data: [{ ...rowInPg }], error: null }).then(resolve)
              }))
            }))
          })),
          update: vi.fn((patch: Partial<CloudAccountRow>) => ({
            eq: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn(async () => {
              if (rowInPg.deleted_at != null) {
                return { data: null, error: null };
              }
              rowInPg = { ...rowInPg, ...patch };
              return { data: { ...rowInPg }, error: null };
            })
          })),
          insert: vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            single: vi.fn(async () => ({
              data: null,
              error: { code: '23505', message: 'duplicate key value violates unique constraint' }
            }))
          }))
        };
      })
    } as unknown as ConstructorParameters<typeof SupabaseAccountRepository>[0];

    const realAccountRepo = new SupabaseAccountRepository(mockSupabaseClient);

    // Fallback safeDelete sets deleted_at + increments version and stays idempotent on retry
    await realAccountRepo.safeDelete(ACC_DELETE, USER_ID, 1, ISO_2);
    expect(rowInPg.deleted_at).toBe(ISO_2);
    expect(rowInPg.version).toBe(2);
    await realAccountRepo.safeDelete(ACC_DELETE, USER_ID, 1, ISO_2);

    // Active findAll hides tombstones while includeDeleted: true returns them for reconciliation
    expect(await realAccountRepo.findAll(USER_ID)).toHaveLength(0);
    expect(await realAccountRepo.findAll(USER_ID, { includeDeleted: true })).toHaveLength(1);

    // Recreate and updatePartial are blocked on tombstoned accounts
    await expect(
      realAccountRepo.insert({ ...rowInPg, deleted_at: null, version: 1 })
    ).rejects.toThrow(SyncConflictError);
    await expect(
      realAccountRepo.updatePartial(ACC_DELETE, USER_ID, { name: 'Resurrected' }, 2)
    ).rejects.toThrow(SyncConflictError);

    // 5c. Dependent repositories reject offline transactions, rules, borrowings, and repayments referencing a tombstoned account
    const tombstonedAccountLookup: ISupabaseAccountRepository = {
      insert: vi.fn(),
      updatePartial: vi.fn(),
      findById: vi.fn(async () => ({ ...rowInPg })),
      findAll: vi.fn(async () => [])
    };
    const nopCategoryRepo: ISupabaseCategoryRepository = {
      insert: vi.fn(),
      updatePartial: vi.fn(),
      findById: vi.fn(async () => cloud.categories.get(CAT_EXPENSE)!),
      findDefaultMatch: vi.fn(async () => null),
      findAll: vi.fn(async () => [])
    };
    const stubTxRepo: ISupabaseTransactionRepository = {
      insert: vi.fn(),
      updatePartial: vi.fn(),
      softDelete: vi.fn(),
      findById: vi.fn(async () => ({ ...cloud.transactions.get(TX_KEEP)! })),
      findPage: vi.fn(async () => ({ rows: [], hasMore: false, nextOffset: 0 })),
      findAll: vi.fn(async () => [])
    };
    const stubLenderRepo: ISupabaseLenderRepository = {
      insert: vi.fn(),
      updatePartial: vi.fn(),
      findById: vi.fn(async () => ({ ...cloud.lenders.get(LENDER_1)! })),
      findAll: vi.fn(async () => [])
    };
    const stubBorrowingRepo: ISupabaseBorrowingRepository = {
      insert: vi.fn(),
      updatePartial: vi.fn(),
      findById: vi.fn(async () => ({ ...cloud.borrowings.get(BOR_KEEP)! })),
      findByTransactionId: vi.fn(async () => null),
      findAll: vi.fn(async () => [])
    };

    const dummyClient = {} as ConstructorParameters<typeof SupabaseTransactionRepository>[0];
    const txRepo = new SupabaseTransactionRepository(
      dummyClient,
      tombstonedAccountLookup,
      nopCategoryRepo
    );
    const ruleRepo = new SupabaseRecurringRuleRepository(
      dummyClient,
      tombstonedAccountLookup,
      nopCategoryRepo
    );
    const borRepo = new SupabaseBorrowingRepository(
      dummyClient,
      stubLenderRepo,
      tombstonedAccountLookup,
      stubTxRepo
    );
    const repRepo = new SupabaseBorrowingRepaymentRepository(
      dummyClient,
      stubBorrowingRepo,
      stubLenderRepo,
      tombstonedAccountLookup,
      stubTxRepo
    );

    await expect(
      txRepo.insert({
        ...cloud.transactions.get(TX_KEEP)!,
        id: TX_PENDING,
        account_id: ACC_DELETE,
        idempotency_key: 'idem-stale-tx'
      })
    ).rejects.toThrow(SyncAccountDependencyError);

    await expect(
      ruleRepo.insert({
        ...cloud.recurringRules.get(RULE_KEEP)!,
        id: RULE_DEP,
        account_id: ACC_DELETE
      })
    ).rejects.toThrow(SyncAccountDependencyError);

    await expect(
      borRepo.insert({
        ...cloud.borrowings.get(BOR_KEEP)!,
        id: BOR_DEP,
        receiving_account_id: ACC_DELETE
      })
    ).rejects.toThrow(SyncAccountDependencyError);

    await expect(
      repRepo.insert({
        id: REP_DEP,
        user_id: USER_ID,
        borrowing_id: BOR_KEEP,
        lender_id: LENDER_1,
        amount_paise: 5000,
        repayment_date: ISO_2,
        payment_account_id: ACC_DELETE,
        transaction_id: TX_KEEP,
        notes: null
      })
    ).rejects.toThrow(SyncAccountDependencyError);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ManualSyncCoordinator } from '@/infrastructure/sync/ManualSyncCoordinator';
import { AccountSyncDispatcher } from '@/infrastructure/sync/dispatchers/AccountSyncDispatcher';
import { CategorySyncDispatcher } from '@/infrastructure/sync/dispatchers/CategorySyncDispatcher';
import { TransactionSyncDispatcher } from '@/infrastructure/sync/dispatchers/TransactionSyncDispatcher';
import { CategoryMappingService } from '@/infrastructure/sync/CategoryMappingService';
import { ISupabaseAccountRepository } from '@/infrastructure/database/cloud/repositories/SupabaseAccountRepository';
import { ISupabaseCategoryRepository } from '@/infrastructure/database/cloud/repositories/SupabaseCategoryRepository';
import { ISupabaseTransactionRepository } from '@/infrastructure/database/cloud/repositories/SupabaseTransactionRepository';
import { OutboxManager } from '@/infrastructure/sync/OutboxManager';
import { AuthPort } from '@/application/ports/AuthPort';
import { LocalOutboxRecord } from '@/infrastructure/database/local/schema';
import { Category } from '@/domain/entities/Category';
import { createCategoryId, createUserId } from '@/domain/value-objects/Identifiers';
import { SyncUnresolvedCategoryError } from '@/infrastructure/sync/errors/SyncErrors';

describe('Categorized Transaction Cloud Synchronization (Phase 2D.7.5)', () => {
  const validUserId = '11111111-1111-4111-8111-111111111111';
  const validAccId = '22222222-2222-4222-8222-222222222222';
  const localCatId = '33333333-3333-4333-8333-333333333333';
  const cloudCatId = '44444444-4444-4444-8444-444444444444';
  const validTxId = '55555555-5555-4555-8555-555555555555';
  const validIso = '2026-03-01T10:00:00.000Z';

  let mockAccountRepo: ISupabaseAccountRepository;
  let mockCategoryRepo: ISupabaseCategoryRepository;
  let mockTransactionRepo: ISupabaseTransactionRepository;
  let mockLocalCategoryRepo: any;
  let mockAuth: AuthPort;
  let mockOutboxManager: OutboxManager;
  let mappingService: CategoryMappingService;

  let accountDispatcher: AccountSyncDispatcher;
  let categoryDispatcher: CategorySyncDispatcher;
  let transactionDispatcher: TransactionSyncDispatcher;
  let coordinator: ManualSyncCoordinator;

  let outboxEntries: LocalOutboxRecord[] = [];
  const dispatchOrder: string[] = [];

  beforeEach(() => {
    dispatchOrder.length = 0;
    outboxEntries = [];

    mockAccountRepo = {
      insert: vi.fn().mockImplementation(async (acc) => {
        dispatchOrder.push(`account:${acc.id}`);
        return acc;
      }),
      updatePartial: vi.fn(),
      findById: vi.fn(),
      findAll: vi.fn()
    };

    mockCategoryRepo = {
      insert: vi.fn().mockImplementation(async (cat) => {
        dispatchOrder.push(`category:${cat.id}`);
        return cat;
      }),
      updatePartial: vi.fn().mockImplementation(async (id, _u, patch) => {
        dispatchOrder.push(`category_update:${id}`);
        return { id, ...patch };
      }),
      findById: vi.fn().mockImplementation(async (id) => {
        if (id === cloudCatId) {
          return {
            id: cloudCatId,
            user_id: validUserId,
            name: 'Groceries',
            type: 'expense',
            is_default: true,
            is_archived: false,
            version: 1
          };
        }
        return null;
      }),
      findAll: vi.fn().mockResolvedValue([]),
      findByNameAndType: vi.fn().mockResolvedValue(null)
    };

    mockTransactionRepo = {
      insert: vi.fn().mockImplementation(async (tx) => {
        dispatchOrder.push(`transaction:${tx.id}`);
        return tx;
      }),
      updatePartial: vi.fn().mockImplementation(async (id, _u, patch) => {
        dispatchOrder.push(`transaction_update:${id}`);
        return { id, ...patch };
      }),
      softDelete: vi.fn(),
      findById: vi.fn(),
      findByIdempotencyKey: vi.fn()
    };

    mockLocalCategoryRepo = {
      findById: vi.fn().mockImplementation(async (id: string) => {
        if (id === localCatId) {
          return new Category({
            id: createCategoryId(localCatId),
            userId: createUserId(validUserId),
            name: 'Groceries',
            type: 'expense',
            icon: 'ShoppingCart',
            color: '#D9827C',
            isDefault: true,
            isArchived: false,
            version: 1
          });
        }
        return null;
      }),
      findByUserId: vi.fn().mockResolvedValue([]),
      findAll: vi.fn().mockResolvedValue([]),
      save: vi.fn(),
      saveBatch: vi.fn(),
      archive: vi.fn(),
      seedDefaults: vi.fn()
    };

    mockAuth = {
      getCurrentUser: vi.fn().mockResolvedValue({
        id: validUserId,
        email: 'test@example.com'
      }),
      getSession: vi.fn(),
      signInWithPassword: vi.fn(),
      signUpWithPassword: vi.fn(),
      signInWithOAuth: vi.fn(),
      signOut: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      updatePassword: vi.fn(),
      onAuthStateChange: vi.fn().mockReturnValue(() => {})
    };

    mockOutboxManager = {
      getPendingEntries: vi.fn().mockImplementation(async () => [...outboxEntries]),
      getPendingCount: vi.fn().mockImplementation(async () => outboxEntries.length),
      markSuccess: vi.fn().mockImplementation(async (id: number) => {
        outboxEntries = outboxEntries.filter((e) => e.id !== id);
      }),
      markFailure: vi.fn().mockResolvedValue(undefined)
    } as unknown as OutboxManager;

    mappingService = new CategoryMappingService(
      undefined,
      mockCategoryRepo,
      mockLocalCategoryRepo
    );

    accountDispatcher = new AccountSyncDispatcher(
      mockAccountRepo,
      mockAuth,
      mockOutboxManager
    );

    categoryDispatcher = new CategorySyncDispatcher(
      mockCategoryRepo,
      mockAuth,
      mockOutboxManager,
      mappingService
    );

    transactionDispatcher = new TransactionSyncDispatcher(
      mockTransactionRepo,
      mockAuth,
      mockOutboxManager,
      mappingService
    );

    coordinator = new ManualSyncCoordinator(
      accountDispatcher,
      transactionDispatcher,
      mockOutboxManager,
      mockAuth,
      categoryDispatcher
    );
  });

  describe('1. Execution Ordering: Accounts → Categories → Transactions', () => {
    it('enforces strict sequential dispatch order in every manual sync batch', async () => {
      outboxEntries = [
        // Intentionally mixed order in outbox
        {
          id: 1,
          entity: 'transactions',
          entityId: validTxId,
          operation: 'INSERT',
          payload: {
            id: validTxId,
            user_id: validUserId,
            type: 'expense',
            amount_paise: 25000,
            account_id: validAccId,
            category_id: localCatId,
            title: 'Groceries',
            transaction_date: validIso,
            idempotency_key: 'k-tx',
            version: 1
          },
          idempotencyKey: 'k-tx',
          attempts: 0,
          createdAt: validIso
        },
        {
          id: 2,
          entity: 'accounts',
          entityId: validAccId,
          operation: 'INSERT',
          payload: {
            id: validAccId,
            user_id: validUserId,
            name: 'SBI Bank',
            account_type: 'bank',
            opening_balance_paise: 100000,
            currency: 'INR',
            version: 1
          },
          idempotencyKey: 'k-acc',
          attempts: 0,
          createdAt: validIso
        },
        {
          id: 3,
          entity: 'categories',
          entityId: localCatId,
          operation: 'INSERT',
          payload: {
            id: localCatId,
            user_id: validUserId,
            name: 'Groceries',
            type: 'expense',
            version: 1
          },
          idempotencyKey: 'k-cat',
          attempts: 0,
          createdAt: validIso
        }
      ];

      const result = await coordinator.run();

      expect(result.syncedCount).toBe(3);
      expect(result.failedCount).toBe(0);
      expect(result.accounts.syncedCount).toBe(1);
      expect(result.categories.syncedCount).toBe(1);
      expect(result.transactions.syncedCount).toBe(1);

      // Verify order: Accounts first, Categories second, Transactions third
      expect(dispatchOrder).toEqual([
        `account:${validAccId}`,
        `category:${localCatId}`,
        `transaction:${validTxId}`
      ]);
      expect(outboxEntries).toHaveLength(0);
    });
  });

  describe('2. Categorized Transaction resolution and identity reconciliation', () => {
    it('resolves local category ID to verified cloud UUID and persists transaction to cloud', async () => {
      // Pre-populate cloud with matching default category with a different cloud UUID
      mockCategoryRepo.findAll = vi.fn().mockResolvedValue([
        {
          id: cloudCatId,
          user_id: validUserId,
          name: 'Groceries',
          type: 'expense',
          is_default: true,
          is_archived: false,
          version: 1
        }
      ]);

      outboxEntries = [
        {
          id: 10,
          entity: 'transactions',
          entityId: validTxId,
          operation: 'INSERT',
          payload: {
            id: validTxId,
            user_id: validUserId,
            type: 'expense',
            amount_paise: 50000,
            account_id: validAccId,
            category_id: localCatId, // Local UUID
            title: 'Weekly Groceries',
            transaction_date: validIso,
            idempotency_key: 'k-tx-10',
            version: 1
          },
          idempotencyKey: 'k-tx-10',
          attempts: 0,
          createdAt: validIso
        }
      ];

      const result = await coordinator.run();

      expect(result.syncedCount).toBe(1);
      expect(result.failedCount).toBe(0);
      expect(result.transactions.syncedCount).toBe(1);

      // Verify transaction was inserted with the RESOLVED cloud category UUID
      expect(mockTransactionRepo.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          id: validTxId,
          category_id: cloudCatId // Resolved from mapping
        })
      );

      // Verify mapping is now cached durably
      const mapped = await mappingService.getMapping(localCatId, validUserId);
      expect(mapped).toBe(cloudCatId);
      expect(outboxEntries).toHaveLength(0);
    });
  });

  describe('3. Category failure leaves dependent transactions pending in outbox', () => {
    it('blocks dependent transaction when category sync fails and preserves transaction in outbox', async () => {
      // Category sync fails
      mockCategoryRepo.insert = vi.fn().mockRejectedValue(new Error('Cloud category insert failed'));

      outboxEntries = [
        {
          id: 20,
          entity: 'categories',
          entityId: localCatId,
          operation: 'INSERT',
          payload: {
            id: localCatId,
            user_id: validUserId,
            name: 'Groceries',
            type: 'expense',
            version: 1
          },
          idempotencyKey: 'k-cat-20',
          attempts: 0,
          createdAt: validIso
        },
        {
          id: 21,
          entity: 'transactions',
          entityId: validTxId,
          operation: 'INSERT',
          payload: {
            id: validTxId,
            user_id: validUserId,
            type: 'expense',
            amount_paise: 30000,
            account_id: validAccId,
            category_id: localCatId,
            title: 'Groceries',
            transaction_date: validIso,
            idempotency_key: 'k-tx-21',
            version: 1
          },
          idempotencyKey: 'k-tx-21',
          attempts: 0,
          createdAt: validIso
        }
      ];

      const result = await coordinator.run();

      expect(result.categories.failedCount).toBe(1);
      expect(result.transactions.failedCount).toBe(1);
      expect(result.transactions.categoryBlockedCount).toBe(1);
      expect(mockTransactionRepo.insert).not.toHaveBeenCalled();

      // Both entries remain saved locally in outbox
      expect(outboxEntries).toHaveLength(2);
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0].entity).toBe('categories');
      expect(result.errors[1].entity).toBe('transactions');
      expect(result.errors[1].category).toBe('category');
    });
  });

  describe('4. Unresolved category rejection preserves SyncUnresolvedCategoryError', () => {
    it('rejects transaction referencing nonexistent category and keeps transaction in outbox', async () => {
      mockLocalCategoryRepo.findById = vi.fn().mockResolvedValue(null);
      mockCategoryRepo.findById = vi.fn().mockResolvedValue(null);
      mockCategoryRepo.findAll = vi.fn().mockResolvedValue([]);

      const unknownCatId = '99999999-9999-4999-8999-999999999999';

      outboxEntries = [
        {
          id: 30,
          entity: 'transactions',
          entityId: validTxId,
          operation: 'INSERT',
          payload: {
            id: validTxId,
            user_id: validUserId,
            type: 'expense',
            amount_paise: 15000,
            account_id: validAccId,
            category_id: unknownCatId,
            title: 'Unknown purchase',
            transaction_date: validIso,
            idempotency_key: 'k-tx-30',
            version: 1
          },
          idempotencyKey: 'k-tx-30',
          attempts: 0,
          createdAt: validIso
        }
      ];

      const result = await coordinator.run();

      expect(result.failedCount).toBe(1);
      expect(result.transactions.categoryBlockedCount).toBe(1);
      expect(mockTransactionRepo.insert).not.toHaveBeenCalled();
      expect(outboxEntries).toHaveLength(1); // Preserved in outbox
    });
  });

  describe('5. Uncategorized transactions and transfers sync smoothly', () => {
    it('syncs transfers without requiring or resolving category references', async () => {
      const destAccId = '66666666-6666-4666-8666-666666666666';

      outboxEntries = [
        {
          id: 40,
          entity: 'transactions',
          entityId: validTxId,
          operation: 'INSERT',
          payload: {
            id: validTxId,
            user_id: validUserId,
            type: 'transfer',
            amount_paise: 50000,
            account_id: validAccId,
            destination_account_id: destAccId,
            title: 'Fund Transfer',
            transaction_date: validIso,
            idempotency_key: 'k-transfer',
            version: 1
          },
          idempotencyKey: 'k-transfer',
          attempts: 0,
          createdAt: validIso
        }
      ];

      const result = await coordinator.run();

      expect(result.syncedCount).toBe(1);
      expect(result.failedCount).toBe(0);
      expect(result.transactions.syncedCount).toBe(1);
      expect(mockTransactionRepo.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'transfer',
          category_id: null
        })
      );
      expect(outboxEntries).toHaveLength(0);
    });
  });
});

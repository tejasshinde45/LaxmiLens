import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BudgetSyncDispatcher } from '@/infrastructure/sync/dispatchers/BudgetSyncDispatcher';
import { AccountSyncDispatcher } from '@/infrastructure/sync/dispatchers/AccountSyncDispatcher';
import { CategorySyncDispatcher } from '@/infrastructure/sync/dispatchers/CategorySyncDispatcher';
import { TransactionSyncDispatcher } from '@/infrastructure/sync/dispatchers/TransactionSyncDispatcher';
import { ManualSyncCoordinator } from '@/infrastructure/sync/ManualSyncCoordinator';
import { BudgetReconciliationService } from '@/infrastructure/sync/BudgetReconciliationService';
import { CategoryMappingService, ICategoryResolver } from '@/infrastructure/sync/CategoryMappingService';
import { OutboxManager } from '@/infrastructure/sync/OutboxManager';
import { AuthPort, AuthUser } from '@/application/ports/AuthPort';
import { ISupabaseBudgetRepository } from '@/infrastructure/database/cloud/repositories/SupabaseBudgetRepository';
import { ISupabaseCategoryRepository } from '@/infrastructure/database/cloud/repositories/SupabaseCategoryRepository';
import { CloudBudgetRow } from '@/infrastructure/database/cloud/mappers/BudgetMapper';
import {
  LocalBudgetRecord,
  LocalOutboxRecord,
  LocalSyncMetadataRecord
} from '@/infrastructure/database/local/schema';
import { LaxmiLensDB } from '@/infrastructure/database/local/DexieDatabase';
import {
  SyncAuthError,
  SyncConflictError,
  SyncInProgressError,
  SyncUnresolvedCategoryError
} from '@/infrastructure/sync/errors/SyncErrors';

describe('Budget Synchronization: Dispatcher, Coordinator & Bidirectional Reconciliation', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const otherUserId = '22222222-2222-4222-8222-222222222222';
  const localCatId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  const cloudCatId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
  const cat2Id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2';
  const budget1Id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
  const budget2Id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2';
  const budget3Id = 'ffffffff-ffff-4fff-8fff-fffffffffff3';
  const iso1 = '2026-04-01T10:00:00.000Z';
  const iso2 = '2026-04-02T12:00:00.000Z';

  const authUser: AuthUser = { id: userId, email: 'budgeter@laxmilens.app' };
  let mockAuth: AuthPort;
  let mockCloudBudgetRepo: ISupabaseBudgetRepository;
  let mockOutboxManager: OutboxManager;
  let mockCategoryResolver: ICategoryResolver;

  beforeEach(() => {
    mockAuth = {
      getCurrentUser: vi.fn().mockResolvedValue(authUser),
      signInWithEmail: vi.fn(),
      signUpWithEmail: vi.fn(),
      signOut: vi.fn(),
      onAuthStateChange: vi.fn()
    };

    mockCloudBudgetRepo = {
      insert: vi.fn(),
      updatePartial: vi.fn(),
      softDelete: vi.fn(),
      findById: vi.fn(),
      findAll: vi.fn().mockResolvedValue([]),
      findActiveByCategoryAndPeriod: vi.fn()
    };

    mockOutboxManager = {
      enqueue: vi.fn(),
      getPendingEntries: vi.fn().mockResolvedValue([]),
      getPendingCount: vi.fn().mockResolvedValue(0),
      markSuccess: vi.fn().mockResolvedValue(undefined),
      markFailure: vi.fn().mockResolvedValue(undefined)
    } as unknown as OutboxManager;

    mockCategoryResolver = {
      resolveCategory: vi.fn().mockImplementation(async (catId: string) => {
        if (catId === localCatId) return cloudCatId;
        if (catId === cat2Id) return cat2Id;
        return null;
      }),
      resolveLocalCategory: vi.fn().mockImplementation(async (cId: string) => {
        if (cId === cloudCatId) return localCatId;
        if (cId === cat2Id) return cat2Id;
        return null;
      })
    };
  });

  function createInMemoryBudgetDb() {
    const budgetsMap = new Map<string, LocalBudgetRecord>();
    const outboxList: LocalOutboxRecord[] = [];
    const metadataMap = new Map<string, LocalSyncMetadataRecord>();

    const db = {
      isOpen: vi.fn(() => true),
      budgets: {
        put: vi.fn(async (rec: LocalBudgetRecord) => {
          budgetsMap.set(rec.id, { ...rec });
          return rec.id;
        }),
        delete: vi.fn(async (id: string) => {
          budgetsMap.delete(id);
        }),
        get: vi.fn(async (id: string) => budgetsMap.get(id)),
        where: vi.fn((idx: string) => ({
          equals: (val: string) => ({
            toArray: vi.fn(async () =>
              idx === 'userId'
                ? Array.from(budgetsMap.values()).filter((b) => b.userId === val)
                : []
            )
          })
        }))
      },
      syncOutbox: {
        where: vi.fn((idx: string) => ({
          equals: (val: string) => ({
            toArray: vi.fn(async () =>
              idx === 'userId' ? outboxList.filter((o) => o.userId === val) : []
            )
          })
        }))
      },
      syncMetadata: {
        get: vi.fn(async (key: string) => metadataMap.get(key)),
        put: vi.fn(async (rec: LocalSyncMetadataRecord) => {
          metadataMap.set(rec.key, { ...rec });
          return rec.key;
        })
      },
      transaction: vi.fn(async (_mode: string, _tables: unknown, cb: () => Promise<void>) => {
        return await cb();
      })
    };

    return { db: db as unknown as LaxmiLensDB, budgetsMap, outboxList, metadataMap };
  }

  describe('BudgetSyncDispatcher', () => {
    it('dispatches INSERT, resolves local category ID to cloud UUID, and acknowledges outbox', async () => {
      const dispatcher = new BudgetSyncDispatcher(
        mockCloudBudgetRepo,
        mockAuth,
        mockOutboxManager,
        mockCategoryResolver
      );

      const cloudResult: CloudBudgetRow = {
        id: budget1Id,
        user_id: userId,
        category_id: cloudCatId,
        period: '2026-04',
        limit_paise: 1000000,
        version: 1,
        created_at: iso1,
        updated_at: iso1,
        deleted_at: null
      };
      vi.mocked(mockCloudBudgetRepo.insert).mockResolvedValue(cloudResult);

      await dispatcher.dispatch({
        id: 1,
        userId,
        entity: 'budgets',
        entityId: budget1Id,
        operation: 'INSERT',
        payload: {
          id: budget1Id,
          user_id: userId,
          category_id: localCatId,
          period: '2026-04',
          limit_paise: 1000000,
          version: 1,
          created_at: iso1,
          updated_at: iso1
        },
        idempotencyKey: 'key-1',
        createdAt: iso1,
        retryCount: 0
      });

      expect(mockCloudBudgetRepo.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          id: budget1Id,
          user_id: userId,
          category_id: cloudCatId,
          period: '2026-04',
          limit_paise: 1000000,
          deleted_at: null
        })
      );
      expect(mockOutboxManager.markSuccess).toHaveBeenCalledWith(1);
      expect(mockOutboxManager.markFailure).not.toHaveBeenCalled();
    });

    it('retains outbox entry on unresolved category or conflict errors without calling markSuccess', async () => {
      const dispatcher = new BudgetSyncDispatcher(
        mockCloudBudgetRepo,
        mockAuth,
        mockOutboxManager,
        mockCategoryResolver
      );

      await expect(
        dispatcher.dispatch({
          id: 2,
          userId,
          entity: 'budgets',
          entityId: budget1Id,
          operation: 'INSERT',
          payload: {
            id: budget1Id,
            user_id: userId,
            category_id: '99999999-9999-4999-8999-999999999999',
            period: '2026-04',
            limit_paise: 500000,
            version: 1
          },
          idempotencyKey: 'key-2',
          createdAt: iso1,
          retryCount: 0
        })
      ).rejects.toThrow(SyncUnresolvedCategoryError);

      expect(mockOutboxManager.markFailure).toHaveBeenCalledWith(2, expect.stringMatching(/resolved/i));
      expect(mockOutboxManager.markSuccess).not.toHaveBeenCalled();

      vi.mocked(mockCloudBudgetRepo.updatePartial).mockRejectedValueOnce(
        new SyncConflictError('Version conflict')
      );

      await expect(
        dispatcher.dispatch({
          id: 3,
          userId,
          entity: 'budgets',
          entityId: budget1Id,
          operation: 'UPDATE',
          payload: {
            id: budget1Id,
            user_id: userId,
            limit_paise: 700000,
            expected_version: 1,
            version: 2
          },
          idempotencyKey: 'key-3',
          createdAt: iso2,
          retryCount: 0
        })
      ).rejects.toThrow(SyncConflictError);

      expect(mockOutboxManager.markFailure).toHaveBeenCalledWith(3, 'Version conflict');
    });

    it('routes DELETE exclusively to softDelete tombstone endpoint and rejects concurrent same-ID dispatches', async () => {
      const dispatcher = new BudgetSyncDispatcher(
        mockCloudBudgetRepo,
        mockAuth,
        mockOutboxManager,
        mockCategoryResolver
      );

      let resolveSoftDelete!: (v: CloudBudgetRow) => void;
      vi.mocked(mockCloudBudgetRepo.softDelete).mockReturnValueOnce(
        new Promise<CloudBudgetRow>((res) => {
          resolveSoftDelete = res;
        })
      );

      const entry: LocalOutboxRecord = {
        id: 4,
        userId,
        entity: 'budgets',
        entityId: budget1Id,
        operation: 'DELETE',
        payload: {
          id: budget1Id,
          user_id: userId,
          category_id: localCatId,
          period: '2026-04',
          expected_version: 1,
          version: 2,
          deleted_at: iso2
        },
        idempotencyKey: 'key-4',
        createdAt: iso2,
        retryCount: 0
      };

      const firstPromise = dispatcher.dispatch(entry);
      await expect(dispatcher.dispatch(entry)).rejects.toThrow(SyncInProgressError);

      resolveSoftDelete({
        id: budget1Id,
        user_id: userId,
        category_id: cloudCatId,
        period: '2026-04',
        limit_paise: 1000000,
        version: 2,
        created_at: iso1,
        updated_at: iso2,
        deleted_at: iso2
      });

      await firstPromise;
      expect(mockCloudBudgetRepo.softDelete).toHaveBeenCalledWith(
        budget1Id,
        userId,
        iso2,
        1,
        2
      );
      expect(mockOutboxManager.markSuccess).toHaveBeenCalledWith(4);
    });

    it('rejects cross-tenant payload user_id mismatch', async () => {
      const dispatcher = new BudgetSyncDispatcher(
        mockCloudBudgetRepo,
        mockAuth,
        mockOutboxManager,
        mockCategoryResolver
      );

      await expect(
        dispatcher.dispatch({
          id: 5,
          userId,
          entity: 'budgets',
          entityId: budget1Id,
          operation: 'INSERT',
          payload: {
            id: budget1Id,
            user_id: otherUserId,
            category_id: localCatId,
            period: '2026-04',
            limit_paise: 500000,
            version: 1
          },
          idempotencyKey: 'key-5',
          createdAt: iso1,
          retryCount: 0
        })
      ).rejects.toThrow(SyncAuthError);
    });
  });

  describe('ManualSyncCoordinator Budgets Integration', () => {
    function buildCoordinator(opts?: {
      omitBudgetDispatcher?: boolean;
      reconciler?: BudgetReconciliationService;
      catDispatch?: (entry: LocalOutboxRecord) => Promise<void>;
      budgetDispatch?: (entry: LocalOutboxRecord) => Promise<void>;
    }) {
      const accountDispatcher = {
        dispatch: vi.fn().mockResolvedValue(undefined)
      } as unknown as AccountSyncDispatcher;
      const transactionDispatcher = {
        dispatch: vi.fn().mockResolvedValue(undefined)
      } as unknown as TransactionSyncDispatcher;
      const categoryDispatcher = {
        dispatch: vi.fn(opts?.catDispatch ?? (async () => undefined))
      } as unknown as CategorySyncDispatcher;
      const budgetDispatcher = opts?.omitBudgetDispatcher
        ? undefined
        : ({
            dispatch: vi.fn(opts?.budgetDispatch ?? (async () => undefined))
          } as unknown as BudgetSyncDispatcher);

      const coordinator = new ManualSyncCoordinator(
        accountDispatcher,
        transactionDispatcher,
        mockOutboxManager,
        mockAuth,
        categoryDispatcher,
        undefined,
        undefined,
        undefined,
        budgetDispatcher,
        opts?.reconciler
      );

      return { coordinator, accountDispatcher, categoryDispatcher, transactionDispatcher, budgetDispatcher };
    }

    it('treats budgets as unsupported when budgetDispatcher is not registered', async () => {
      vi.mocked(mockOutboxManager.getPendingEntries).mockResolvedValue([
        {
          id: 1,
          userId,
          entity: 'budgets',
          entityId: budget1Id,
          operation: 'INSERT',
          payload: { id: budget1Id, user_id: userId },
          idempotencyKey: 'k1',
          createdAt: iso1,
          retryCount: 0
        }
      ]);

      const { coordinator } = buildCoordinator({ omitBudgetDispatcher: true });
      const res = await coordinator.run();

      expect(res.unsupportedCount).toBe(1);
      expect(res.totalProcessed).toBe(0);
    });

    it('executes Categories before Budgets and blocks Budgets when referenced Category fails', async () => {
      const order: string[] = [];

      vi.mocked(mockOutboxManager.getPendingEntries).mockResolvedValue([
        {
          id: 1,
          userId,
          entity: 'budgets',
          entityId: budget1Id,
          operation: 'INSERT',
          payload: {
            id: budget1Id,
            user_id: userId,
            category_id: localCatId,
            period: '2026-04',
            limit_paise: 100000,
            version: 1
          },
          idempotencyKey: 'b1',
          createdAt: iso1,
          retryCount: 0
        },
        {
          id: 2,
          userId,
          entity: 'categories',
          entityId: localCatId,
          operation: 'INSERT',
          payload: { id: localCatId, user_id: userId, name: 'Food', type: 'expense' },
          idempotencyKey: 'c1',
          createdAt: iso1,
          retryCount: 0
        },
        {
          id: 3,
          userId,
          entity: 'budgets',
          entityId: budget2Id,
          operation: 'INSERT',
          payload: {
            id: budget2Id,
            user_id: userId,
            category_id: cat2Id,
            period: '2026-04',
            limit_paise: 200000,
            version: 1
          },
          idempotencyKey: 'b2',
          createdAt: iso1,
          retryCount: 0
        }
      ]);

      const { coordinator } = buildCoordinator({
        catDispatch: async (entry) => {
          order.push(`cat:${entry.entityId}`);
          throw new Error('Category cloud failure');
        },
        budgetDispatch: async (entry) => {
          order.push(`budget:${entry.entityId}`);
        }
      });

      const res = await coordinator.run();

      expect(order).toEqual([`cat:${localCatId}`, `budget:${budget2Id}`]);
      expect(res.categories.failedCount).toBe(1);
      expect(res.budgets.categoryBlockedCount).toBe(1);
      expect(res.budgets.failedCount).toBe(1);
      expect(res.budgets.syncedCount).toBe(1);
      expect(res.errors.some((e) => e.entity === 'budgets' && e.category === 'category')).toBe(true);
    });

    it('enforces FIFO order across DELETE B1 then INSERT B2 for the same (userId, categoryId, period) slot and skips B2 if DELETE B1 fails', async () => {
      const dispatchOrder: string[] = [];

      const entries: LocalOutboxRecord[] = [
        {
          id: 10,
          userId,
          entity: 'budgets',
          entityId: budget1Id,
          operation: 'DELETE',
          payload: {
            id: budget1Id,
            user_id: userId,
            category_id: localCatId,
            period: '2026-04',
            expected_version: 1,
            version: 2,
            deleted_at: iso2
          },
          idempotencyKey: 'del-b1',
          createdAt: iso2,
          retryCount: 0
        },
        {
          id: 11,
          userId,
          entity: 'budgets',
          entityId: budget2Id,
          operation: 'INSERT',
          payload: {
            id: budget2Id,
            user_id: userId,
            category_id: localCatId,
            period: '2026-04',
            limit_paise: 900000,
            version: 1
          },
          idempotencyKey: 'ins-b2',
          createdAt: iso2,
          retryCount: 0
        },
        {
          id: 12,
          userId,
          entity: 'budgets',
          entityId: budget3Id,
          operation: 'INSERT',
          payload: {
            id: budget3Id,
            user_id: userId,
            category_id: cat2Id,
            period: '2026-04',
            limit_paise: 500000,
            version: 1
          },
          idempotencyKey: 'ins-b3',
          createdAt: iso2,
          retryCount: 0
        }
      ];

      // Case 1: DELETE succeeds -> INSERT replacement B2 executes after DELETE
      vi.mocked(mockOutboxManager.getPendingEntries).mockResolvedValueOnce(entries);
      const { coordinator: happyCoordinator } = buildCoordinator({
        budgetDispatch: async (entry) => {
          dispatchOrder.push(`${entry.operation}:${entry.entityId}`);
        }
      });

      const happyRes = await happyCoordinator.run();
      expect(dispatchOrder).toEqual([
        `DELETE:${budget1Id}`,
        `INSERT:${budget2Id}`,
        `INSERT:${budget3Id}`
      ]);
      expect(happyRes.budgets.syncedCount).toBe(3);

      // Case 2: DELETE B1 fails -> replacement INSERT B2 for same slot is skipped; independent B3 proceeds
      dispatchOrder.length = 0;
      vi.mocked(mockOutboxManager.getPendingEntries).mockResolvedValueOnce(entries);
      const { coordinator: failCoordinator } = buildCoordinator({
        budgetDispatch: async (entry) => {
          dispatchOrder.push(`${entry.operation}:${entry.entityId}`);
          if (entry.entityId === budget1Id) {
            throw new Error('Transient tombstone failure');
          }
        }
      });

      const failRes = await failCoordinator.run();
      expect(dispatchOrder).toEqual([`DELETE:${budget1Id}`, `INSERT:${budget3Id}`]);
      expect(failRes.budgets.failedCount).toBe(1);
      expect(failRes.budgets.skippedCount).toBe(1);
      expect(failRes.budgets.syncedCount).toBe(1);
    });

    it('invokes bidirectional budget pull reconciliation inside run() and aggregates pulledCount', async () => {
      const { db, budgetsMap } = createInMemoryBudgetDb();
      const cloudRow: CloudBudgetRow = {
        id: budget1Id,
        user_id: userId,
        category_id: cloudCatId,
        period: '2026-04',
        limit_paise: 1500000,
        version: 1,
        created_at: iso1,
        updated_at: iso1,
        deleted_at: null
      };
      vi.mocked(mockCloudBudgetRepo.findAll).mockResolvedValue([cloudRow]);

      const reconciler = new BudgetReconciliationService(
        db,
        mockCloudBudgetRepo,
        mockAuth,
        mockCategoryResolver
      );

      const { coordinator } = buildCoordinator({ reconciler });
      const res = await coordinator.run();

      expect(res.pulledCount).toBe(1);
      expect(res.budgets.pulledCount).toBe(1);
      expect(budgetsMap.get(budget1Id)).toMatchObject({
        id: budget1Id,
        categoryId: localCatId,
        limitPaise: 1500000,
        version: 1
      });
    });
  });

  describe('BudgetReconciliationService & CategoryMappingService Reverse Lookup', () => {
    it('maintains bidirectional forward and reverse category mappings cleanly', async () => {
      const { db } = createInMemoryBudgetDb();
      const mockSupaCatRepo = {
        findById: vi.fn().mockResolvedValue(null),
        findByNameAndType: vi.fn().mockResolvedValue(null)
      } as unknown as ISupabaseCategoryRepository;

      const mappingService = new CategoryMappingService(db, mockSupaCatRepo);
      await mappingService.setMapping(localCatId, cloudCatId, userId);

      const resolvedCloud = await mappingService.resolveCategory(localCatId, userId);
      const resolvedLocal = await mappingService.resolveLocalCategory(cloudCatId, userId);

      expect(resolvedCloud).toBe(cloudCatId);
      expect(resolvedLocal).toBe(localCatId);
    });

    it('protects pending local mutations (by ID or slot) and preserves conflicts without silently overwriting', async () => {
      const { db, budgetsMap, outboxList } = createInMemoryBudgetDb();

      // Budget 1 has a pending local UPDATE (must be skipped by pull)
      budgetsMap.set(budget1Id, {
        id: budget1Id,
        userId,
        categoryId: localCatId,
        period: '2026-04',
        limitPaise: 2000000,
        version: 2,
        createdAt: iso1,
        updatedAt: iso2
      });
      outboxList.push({
        id: 1,
        userId,
        entity: 'budgets',
        entityId: budget1Id,
        operation: 'UPDATE',
        payload: { id: budget1Id, user_id: userId, limit_paise: 2000000, version: 2 },
        idempotencyKey: 'pending-u1',
        createdAt: iso2,
        retryCount: 0
      });

      // Budget 2 has NO pending outbox entry, local version 2 vs divergent cloud version 2 -> conflict
      budgetsMap.set(budget2Id, {
        id: budget2Id,
        userId,
        categoryId: cat2Id,
        period: '2026-05',
        limitPaise: 900000,
        version: 2,
        createdAt: iso1,
        updatedAt: iso2
      });

      vi.mocked(mockCloudBudgetRepo.findAll).mockResolvedValue([
        {
          id: budget1Id,
          user_id: userId,
          category_id: cloudCatId,
          period: '2026-04',
          limit_paise: 1200000,
          version: 3,
          created_at: iso1,
          updated_at: iso2,
          deleted_at: null
        },
        {
          id: budget2Id,
          user_id: userId,
          category_id: cat2Id,
          period: '2026-05',
          limit_paise: 750000, // Divergent at same version 2
          version: 2,
          created_at: iso1,
          updated_at: iso2,
          deleted_at: null
        }
      ]);

      const reconciler = new BudgetReconciliationService(
        db,
        mockCloudBudgetRepo,
        mockAuth,
        mockCategoryResolver
      );

      const res = await reconciler.pullAndReconcile(userId);
      expect(res.skippedPendingCount).toBe(1);
      expect(res.conflictCount).toBe(1);
      expect(budgetsMap.get(budget1Id)?.limitPaise).toBe(2000000);
      expect(budgetsMap.get(budget2Id)?.limitPaise).toBe(900000);
    });

    it('processes remote tombstones before active replacement rows when deleted-then-recreated on same slot', async () => {
      const { db, budgetsMap } = createInMemoryBudgetDb();

      // Local device still has old active budget1Id for (localCatId, 2026-04)
      budgetsMap.set(budget1Id, {
        id: budget1Id,
        userId,
        categoryId: localCatId,
        period: '2026-04',
        limitPaise: 1000000,
        version: 1,
        createdAt: iso1,
        updatedAt: iso1
      });

      // Cloud returns NEW replacement active budget2Id BEFORE old tombstone budget1Id
      vi.mocked(mockCloudBudgetRepo.findAll).mockResolvedValue([
        {
          id: budget2Id,
          user_id: userId,
          category_id: cloudCatId,
          period: '2026-04',
          limit_paise: 1400000,
          version: 1,
          created_at: iso2,
          updated_at: iso2,
          deleted_at: null
        },
        {
          id: budget1Id,
          user_id: userId,
          category_id: cloudCatId,
          period: '2026-04',
          limit_paise: 1000000,
          version: 2,
          created_at: iso1,
          updated_at: iso2,
          deleted_at: iso2
        }
      ]);

      const reconciler = new BudgetReconciliationService(
        db,
        mockCloudBudgetRepo,
        mockAuth,
        mockCategoryResolver
      );

      const res = await reconciler.pullAndReconcile(userId);
      expect(res.deletedCount).toBe(1);
      expect(res.insertedCount).toBe(1);
      expect(res.conflictCount).toBe(0);
      expect(budgetsMap.has(budget1Id)).toBe(false);
      expect(budgetsMap.get(budget2Id)).toMatchObject({
        id: budget2Id,
        categoryId: localCatId,
        limitPaise: 1400000
      });
    });

    it('rejects cloud rows belonging to another user during pull reconciliation', async () => {
      const { db } = createInMemoryBudgetDb();
      vi.mocked(mockCloudBudgetRepo.findAll).mockResolvedValue([
        {
          id: budget1Id,
          user_id: otherUserId,
          category_id: cloudCatId,
          period: '2026-04',
          limit_paise: 1000000,
          version: 1,
          created_at: iso1,
          updated_at: iso1,
          deleted_at: null
        }
      ]);

      const reconciler = new BudgetReconciliationService(
        db,
        mockCloudBudgetRepo,
        mockAuth,
        mockCategoryResolver
      );

      await expect(reconciler.pullAndReconcile(userId)).rejects.toThrow(SyncAuthError);
    });
  });
});

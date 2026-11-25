import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DexieBudgetRepository } from '@/infrastructure/database/local/repositories/DexieBudgetRepository';
import { Budget } from '@/domain/entities/Budget';
import {
  LocalBudgetRecord,
  LocalCategoryRecord
} from '@/infrastructure/database/local/schema';
import {
  createBudgetId,
  createCategoryId,
  createUserId
} from '@/domain/value-objects/Identifiers';
import {
  UnauthorizedEntityAccessError,
  InvalidUserIdError
} from '@/domain/errors/DomainErrors';
import {
  BudgetNotFoundError,
  DuplicateBudgetError,
  InvalidBudgetLimitError
} from '@/domain/errors/BudgetErrors';
import { LaxmiLensDB, upgradeBudgetsToVersion6 } from '@/infrastructure/database/local/DexieDatabase';

class MockLaxmiLensDB {
  public budgetsStorage = new Map<string, LocalBudgetRecord>();
  private txTail: Promise<void> = Promise.resolve();
  public activeRwTransactions = 0;
  public observedTxStatesDuringOps: Array<{ op: string; inRwTx: boolean }> = [];

  public transaction = vi.fn(
    async <T>(_mode: string, _tables: unknown, scope: () => Promise<T>): Promise<T> => {
      const previous = this.txTail;
      let releaseLock!: () => void;
      this.txTail = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });

      await previous;
      this.activeRwTransactions++;
      try {
        return await scope();
      } finally {
        this.activeRwTransactions--;
        releaseLock();
      }
    }
  );

  public budgets = {
    get: vi.fn(async (id: string) => {
      this.observedTxStatesDuringOps.push({ op: 'get', inRwTx: this.activeRwTransactions > 0 });
      await Promise.resolve();
      return this.budgetsStorage.get(id) || null;
    }),
    put: vi.fn(async (record: LocalBudgetRecord) => {
      this.observedTxStatesDuringOps.push({ op: 'put', inRwTx: this.activeRwTransactions > 0 });
      await Promise.resolve();
      this.budgetsStorage.set(record.id, { ...record });
      return record.id;
    }),
    delete: vi.fn(async (id: string) => {
      this.budgetsStorage.delete(id);
    }),
    toArray: vi.fn(async () => Array.from(this.budgetsStorage.values())),
    where: vi.fn((index: string) => {
      if (index === 'userId') {
        return {
          equals: (val: string) => ({
            toArray: vi.fn(async () =>
              Array.from(this.budgetsStorage.values()).filter((b) => b.userId === val)
            )
          })
        };
      }
      if (index === '[userId+id]') {
        return {
          equals: ([uId, id]: [string, string]) => ({
            first: vi.fn(async () => {
              const item = this.budgetsStorage.get(id);
              return item && item.userId === uId ? item : null;
            })
          })
        };
      }
      if (index === '[userId+period]') {
        return {
          equals: ([uId, period]: [string, string]) => ({
            toArray: vi.fn(async () =>
              Array.from(this.budgetsStorage.values()).filter(
                (b) => b.userId === uId && b.period === period
              )
            )
          })
        };
      }
      if (index === '[userId+categoryId+period]') {
        return {
          equals: ([uId, catId, period]: [string, string, string]) => ({
            first: vi.fn(async () => {
              this.observedTxStatesDuringOps.push({
                op: 'where:first',
                inRwTx: this.activeRwTransactions > 0
              });
              await Promise.resolve();
              const match = Array.from(this.budgetsStorage.values()).find(
                (b) => b.userId === uId && b.categoryId === catId && b.period === period
              );
              return match || null;
            }),
            toArray: vi.fn(async () => {
              this.observedTxStatesDuringOps.push({
                op: 'where:toArray',
                inRwTx: this.activeRwTransactions > 0
              });
              await Promise.resolve();
              return Array.from(this.budgetsStorage.values()).filter(
                (b) => b.userId === uId && b.categoryId === catId && b.period === period
              );
            })
          })
        };
      }
      return {
        equals: () => ({
          first: vi.fn(async () => null),
          toArray: vi.fn(async () => [])
        })
      };
    })
  };
}

describe('DexieBudgetRepository', () => {
  const userIdA = createUserId('11111111-1111-4111-8111-111111111111');
  const userIdB = createUserId('22222222-2222-4222-8222-222222222222');
  const categoryIdA = createCategoryId('33333333-3333-4333-8333-333333333333');
  const categoryIdB = createCategoryId('44444444-4444-4444-8444-444444444444');
  const budgetId1 = createBudgetId('55555555-5555-4555-8555-555555555555');
  const budgetId2 = createBudgetId('66666666-6666-4666-8666-666666666666');

  let mockDb: MockLaxmiLensDB;
  let budgetRepo: DexieBudgetRepository;

  beforeEach(() => {
    mockDb = new MockLaxmiLensDB();
    budgetRepo = new DexieBudgetRepository(mockDb as any);
  });

  describe('findById', () => {
    it('returns domain Budget when record exists for the given user', async () => {
      mockDb.budgetsStorage.set(budgetId1, {
        id: budgetId1,
        userId: userIdA,
        categoryId: categoryIdA,
        period: '2026-03',
        limitPaise: 500000,
        version: 1,
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z'
      });

      const result = await budgetRepo.findById(budgetId1, userIdA);
      expect(result).not.toBeNull();
      expect(result?.id).toBe(budgetId1);
      expect(result?.userId).toBe(userIdA);
      expect(result?.categoryId).toBe(categoryIdA);
      expect(result?.period).toBe('2026-03');
      expect(result?.limitPaise).toBe(500000);
    });

    it('returns null when budget ID does not exist', async () => {
      const result = await budgetRepo.findById(budgetId1, userIdA);
      expect(result).toBeNull();
    });

    it('throws UnauthorizedEntityAccessError when budget belongs to a different user', async () => {
      mockDb.budgetsStorage.set(budgetId1, {
        id: budgetId1,
        userId: userIdB, // belongs to user B
        categoryId: categoryIdA,
        period: '2026-03',
        limitPaise: 500000,
        version: 1,
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z'
      });

      await expect(budgetRepo.findById(budgetId1, userIdA)).rejects.toThrow(
        UnauthorizedEntityAccessError
      );
    });

    it('throws InvalidUserIdError when non-UUID userId is provided', async () => {
      await expect(budgetRepo.findById(budgetId1, 'invalid-user' as any)).rejects.toThrow(
        InvalidUserIdError
      );
    });
  });

  describe('findByPeriod', () => {
    it('returns only budgets matching period and userId', async () => {
      // User A - 2026-03
      mockDb.budgetsStorage.set(budgetId1, {
        id: budgetId1,
        userId: userIdA,
        categoryId: categoryIdA,
        period: '2026-03',
        limitPaise: 300000,
        version: 1,
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z'
      });
      // User A - 2026-04 (different period)
      mockDb.budgetsStorage.set(budgetId2, {
        id: budgetId2,
        userId: userIdA,
        categoryId: categoryIdB,
        period: '2026-04',
        limitPaise: 400000,
        version: 1,
        createdAt: '2026-04-01T00:00:00.000Z',
        updatedAt: '2026-04-01T00:00:00.000Z'
      });
      // User B - 2026-03 (same period, different user)
      const budgetIdB = createBudgetId('77777777-7777-4777-8777-777777777777');
      mockDb.budgetsStorage.set(budgetIdB, {
        id: budgetIdB,
        userId: userIdB,
        categoryId: categoryIdA,
        period: '2026-03',
        limitPaise: 900000,
        version: 1,
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z'
      });

      const results = await budgetRepo.findByPeriod('2026-03', userIdA);
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(budgetId1);
      expect(results[0].userId).toBe(userIdA);
      expect(results[0].limitPaise).toBe(300000);
    });

    it('returns empty array when no budgets match period', async () => {
      const results = await budgetRepo.findByPeriod('2026-12', userIdA);
      expect(results).toEqual([]);
    });
  });

  describe('findByCategoryAndPeriod', () => {
    it('returns budget matching category, period, and user', async () => {
      mockDb.budgetsStorage.set(budgetId1, {
        id: budgetId1,
        userId: userIdA,
        categoryId: categoryIdA,
        period: '2026-03',
        limitPaise: 250000,
        version: 1,
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z'
      });

      const result = await budgetRepo.findByCategoryAndPeriod(categoryIdA, '2026-03', userIdA);
      expect(result).not.toBeNull();
      expect(result?.id).toBe(budgetId1);
      expect(result?.categoryId).toBe(categoryIdA);
      expect(result?.period).toBe('2026-03');
    });

    it('returns null when category does not match', async () => {
      mockDb.budgetsStorage.set(budgetId1, {
        id: budgetId1,
        userId: userIdA,
        categoryId: categoryIdA,
        period: '2026-03',
        limitPaise: 250000,
        version: 1,
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z'
      });

      const result = await budgetRepo.findByCategoryAndPeriod(categoryIdB, '2026-03', userIdA);
      expect(result).toBeNull();
    });

    it('returns null when category and period match another user but not requested user', async () => {
      mockDb.budgetsStorage.set(budgetId1, {
        id: budgetId1,
        userId: userIdB, // Owned by User B
        categoryId: categoryIdA,
        period: '2026-03',
        limitPaise: 250000,
        version: 1,
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z'
      });

      const result = await budgetRepo.findByCategoryAndPeriod(categoryIdA, '2026-03', userIdA);
      expect(result).toBeNull();
    });
  });

  describe('save', () => {
    it('persists a new budget successfully', async () => {
      const budget = new Budget({
        id: budgetId1,
        userId: userIdA,
        categoryId: categoryIdA,
        period: '2026-03',
        limitPaise: 750000
      });

      await budgetRepo.save(budget);

      const stored = mockDb.budgetsStorage.get(budgetId1);
      expect(stored).toBeDefined();
      expect(stored?.id).toBe(budgetId1);
      expect(stored?.userId).toBe(userIdA);
      expect(stored?.categoryId).toBe(categoryIdA);
      expect(stored?.period).toBe('2026-03');
      expect(stored?.limitPaise).toBe(750000);
      expect(stored?.version).toBe(1);
    });

    it('updates an existing budget with same ID and user', async () => {
      const initial = new Budget({
        id: budgetId1,
        userId: userIdA,
        categoryId: categoryIdA,
        period: '2026-03',
        limitPaise: 500000,
        version: 1
      });
      await budgetRepo.save(initial);

      const updated = new Budget({
        id: budgetId1,
        userId: userIdA,
        categoryId: categoryIdA,
        period: '2026-03',
        limitPaise: 600000,
        version: 2
      });
      await budgetRepo.save(updated);

      const stored = mockDb.budgetsStorage.get(budgetId1);
      expect(stored?.limitPaise).toBe(600000);
      expect(stored?.version).toBe(2);
    });

    it('rejects cross-user overwrite if ID already exists under another user', async () => {
      mockDb.budgetsStorage.set(budgetId1, {
        id: budgetId1,
        userId: userIdB, // Owned by User B
        categoryId: categoryIdA,
        period: '2026-03',
        limitPaise: 500000,
        version: 1,
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z'
      });

      // User A attempts to overwrite budgetId1
      const maliciousBudget = new Budget({
        id: budgetId1,
        userId: userIdA,
        categoryId: categoryIdA,
        period: '2026-03',
        limitPaise: 800000
      });

      await expect(budgetRepo.save(maliciousBudget)).rejects.toThrow(
        UnauthorizedEntityAccessError
      );
      // Ensure record was not overwritten
      expect(mockDb.budgetsStorage.get(budgetId1)?.userId).toBe(userIdB);
    });

    it('throws DuplicateBudgetError if budget already exists for same (userId, categoryId, period) with different ID', async () => {
      const budgetExisting = new Budget({
        id: budgetId1,
        userId: userIdA,
        categoryId: categoryIdA,
        period: '2026-03',
        limitPaise: 500000
      });
      await budgetRepo.save(budgetExisting);

      // Attempt to save another budget for the same user, category, and period with a different ID
      const duplicateBudget = new Budget({
        id: budgetId2,
        userId: userIdA,
        categoryId: categoryIdA,
        period: '2026-03',
        limitPaise: 900000
      });

      await expect(budgetRepo.save(duplicateBudget)).rejects.toThrow(DuplicateBudgetError);
    });

    it('allows different users to have budgets for the same category and period', async () => {
      const budgetUserA = new Budget({
        id: budgetId1,
        userId: userIdA,
        categoryId: categoryIdA,
        period: '2026-03',
        limitPaise: 500000
      });
      await budgetRepo.save(budgetUserA);

      const budgetUserB = new Budget({
        id: budgetId2,
        userId: userIdB,
        categoryId: categoryIdA,
        period: '2026-03',
        limitPaise: 700000
      });

      // Should succeed because userId differs
      await expect(budgetRepo.save(budgetUserB)).resolves.not.toThrow();
      expect(mockDb.budgetsStorage.get(budgetId1)?.userId).toBe(userIdA);
      expect(mockDb.budgetsStorage.get(budgetId2)?.userId).toBe(userIdB);
    });

    it('executes existing check, duplicate check, and put within the same Dexie rw transaction', async () => {
      const budget = new Budget({
        id: budgetId1,
        userId: userIdA,
        categoryId: categoryIdA,
        period: '2026-03',
        limitPaise: 500000
      });

      mockDb.observedTxStatesDuringOps = [];
      await budgetRepo.save(budget);

      expect(mockDb.transaction).toHaveBeenCalledTimes(1);
      const [mode, tables] = mockDb.transaction.mock.calls[0];
      expect(mode).toBe('rw');
      expect(tables).toEqual([mockDb.budgets]);

      expect(mockDb.observedTxStatesDuringOps).toEqual([
        { op: 'get', inRwTx: true },
        { op: 'where:toArray', inRwTx: true },
        { op: 'put', inRwTx: true }
      ]);
      expect(mockDb.activeRwTransactions).toBe(0);
    });

    it('prevents concurrent saves from creating two budgets for the same (userId, categoryId, period)', async () => {
      const budget1 = new Budget({
        id: budgetId1,
        userId: userIdA,
        categoryId: categoryIdA,
        period: '2026-03',
        limitPaise: 500000
      });
      const budget2 = new Budget({
        id: budgetId2,
        userId: userIdA,
        categoryId: categoryIdA,
        period: '2026-03',
        limitPaise: 650000
      });

      const results = await Promise.allSettled([
        budgetRepo.save(budget1),
        budgetRepo.save(budget2)
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected'
      );

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(DuplicateBudgetError);
      expect(mockDb.budgetsStorage.size).toBe(1);
      expect(mockDb.budgetsStorage.get(budgetId1)?.limitPaise).toBe(500000);
    });

    it('detects duplicate conflict via full index array scan even if budget id is listed first', async () => {
      // Simulate two pre-existing records under same (userId, categoryId, period)
      mockDb.budgetsStorage.set(budgetId1, {
        id: budgetId1,
        userId: userIdA,
        categoryId: categoryIdA,
        period: '2026-03',
        limitPaise: 500000,
        version: 1,
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z'
      });
      mockDb.budgetsStorage.set(budgetId2, {
        id: budgetId2,
        userId: userIdA,
        categoryId: categoryIdA,
        period: '2026-03',
        limitPaise: 600000,
        version: 1,
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z'
      });

      const updateBudget1 = new Budget({
        id: budgetId1,
        userId: userIdA,
        categoryId: categoryIdA,
        period: '2026-03',
        limitPaise: 700000,
        version: 2
      });

      await expect(budgetRepo.save(updateBudget1)).rejects.toThrow(DuplicateBudgetError);
      expect(mockDb.budgetsStorage.get(budgetId1)?.limitPaise).toBe(500000);
    });

    it('rejects overwriting a quarantined record sharing the same budget ID', async () => {
      mockDb.budgetsStorage.set(budgetId1, {
        id: budgetId1,
        userId: 'quarantine-conflicting-ownership',
        categoryId: categoryIdA,
        period: '2026-03',
        limitPaise: 500000,
        version: 1,
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z'
      });

      const candidate = new Budget({
        id: budgetId1,
        userId: userIdA,
        categoryId: categoryIdA,
        period: '2026-03',
        limitPaise: 800000
      });

      await expect(budgetRepo.save(candidate)).rejects.toThrow(UnauthorizedEntityAccessError);
      expect(mockDb.budgetsStorage.get(budgetId1)?.userId).toBe(
        'quarantine-conflicting-ownership'
      );
    });
  });

  describe('delete', () => {
    it('deletes existing budget when owned by user', async () => {
      mockDb.budgetsStorage.set(budgetId1, {
        id: budgetId1,
        userId: userIdA,
        categoryId: categoryIdA,
        period: '2026-03',
        limitPaise: 500000,
        version: 1,
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z'
      });

      await budgetRepo.delete(budgetId1, userIdA);
      expect(mockDb.budgetsStorage.has(budgetId1)).toBe(false);
    });

    it('throws BudgetNotFoundError when budget ID does not exist', async () => {
      await expect(budgetRepo.delete(budgetId1, userIdA)).rejects.toThrow(BudgetNotFoundError);
    });

    it('throws UnauthorizedEntityAccessError when attempting to delete another user budget', async () => {
      mockDb.budgetsStorage.set(budgetId1, {
        id: budgetId1,
        userId: userIdB, // Owned by User B
        categoryId: categoryIdA,
        period: '2026-03',
        limitPaise: 500000,
        version: 1,
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z'
      });

      await expect(budgetRepo.delete(budgetId1, userIdA)).rejects.toThrow(
        UnauthorizedEntityAccessError
      );
      // Ensure record was not deleted
      expect(mockDb.budgetsStorage.has(budgetId1)).toBe(true);
    });
  });

  describe('Dexie Schema Version 6 Upgrade & Legacy Migration', () => {
    // Extract the upgrade function from LaxmiLensDB Version 6 definition
    const testDbInstance = new LaxmiLensDB('test_upgrade_db');
    const version6 = (testDbInstance as any)._versions.find((v: any) => v._cfg.version === 6);
    const registeredUpgradeFn = version6?._cfg?.contentUpgrade;

    it('has Version 6 registered in LaxmiLensDB with compound indexes and upgrade handler', () => {
      expect(version6).toBeDefined();
      expect(registeredUpgradeFn).toBe(upgradeBudgetsToVersion6);
      const stores = version6._cfg.storesSource;
      expect(stores.budgets).toContain('[userId+id]');
      expect(stores.budgets).toContain('[userId+period]');
      expect(stores.budgets).toContain('[userId+categoryId+period]');
    });

    it('migrates valid legacy budget records by resolving ownership from referenced category', async () => {
      const legacyBudgets = [
        {
          id: budgetId1,
          categoryId: categoryIdA,
          period: '2026-01',
          limitInPaise: 350000
        }
      ];

      const categories = [
        {
          id: categoryIdA,
          userId: userIdA,
          name: 'Groceries'
        }
      ];

      const mockTx = {
        table: vi.fn((tableName: string) => {
          if (tableName === 'categories') {
            return {
              toArray: vi.fn(async () => categories)
            };
          }
          if (tableName === 'budgets') {
            return {
              toCollection: () => ({
                modify: async (cb: (b: any) => void) => {
                  for (const b of legacyBudgets) {
                    cb(b);
                  }
                }
              })
            };
          }
          return {};
        })
      };

      await upgradeBudgetsToVersion6(mockTx);

      const migrated = legacyBudgets[0] as any;
      expect(migrated.userId).toBe(userIdA);
      expect(migrated.limitPaise).toBe(350000);
      expect(migrated.limitInPaise).toBeUndefined();
      expect(migrated.version).toBe(1);
      expect(migrated.createdAt).toBeDefined();
      expect(migrated.updatedAt).toBeDefined();
    });

    it('quarantines legacy budget with quarantine-unresolved-ownership if category has missing or non-UUID userId', async () => {
      const legacyBudgets = [
        {
          id: budgetId1,
          categoryId: categoryIdA,
          period: '2026-01',
          limitInPaise: 450000
        }
      ];

      const categories = [
        {
          id: categoryIdA,
          userId: 'local-user', // Legacy non-UUID
          name: 'Legacy Category'
        }
      ];

      const mockTx = {
        table: vi.fn((tableName: string) => {
          if (tableName === 'categories') {
            return {
              toArray: vi.fn(async () => categories)
            };
          }
          if (tableName === 'budgets') {
            return {
              toCollection: () => ({
                modify: async (cb: (b: any) => void) => {
                  for (const b of legacyBudgets) {
                    cb(b);
                  }
                }
              })
            };
          }
          return {};
        })
      };

      await upgradeBudgetsToVersion6(mockTx);

      const migrated = legacyBudgets[0] as any;
      // Strictly fail-closed: preserved but quarantined without guessing or fabricating 'local-user'
      expect(migrated.userId).toBe('quarantine-unresolved-ownership');
      expect(migrated.limitPaise).toBe(450000);
    });

    it('quarantines legacy budget with quarantine-invalid-data if limit is 0, negative, or invalid without fabricating 0', async () => {
      const legacyBudgets = [
        {
          id: budgetId1,
          categoryId: categoryIdA,
          period: '2026-01',
          limitInPaise: 0 // Invalid 0 limit
        },
        {
          id: budgetId2,
          categoryId: categoryIdA,
          period: '2026-02',
          limitInPaise: -500 // Negative limit
        }
      ];

      const categories = [
        {
          id: categoryIdA,
          userId: userIdA,
          name: 'Groceries'
        }
      ];

      const mockTx = {
        table: vi.fn((tableName: string) => {
          if (tableName === 'categories') {
            return {
              toArray: vi.fn(async () => categories)
            };
          }
          if (tableName === 'budgets') {
            return {
              toCollection: () => ({
                modify: async (cb: (b: any) => void) => {
                  for (const b of legacyBudgets) {
                    cb(b);
                  }
                }
              })
            };
          }
          return {};
        })
      };

      await upgradeBudgetsToVersion6(mockTx);

      expect((legacyBudgets[0] as any).userId).toBe('quarantine-invalid-data');
      expect((legacyBudgets[1] as any).userId).toBe('quarantine-invalid-data');
      // Strictly verify limitPaise was not fabricated to 0
      expect((legacyBudgets[0] as any).limitPaise).toBeUndefined();
      expect((legacyBudgets[1] as any).limitPaise).toBeUndefined();
    });

    it('preserves existing valid UUID records idempotently when category ownership matches', async () => {
      const budgets = [
        {
          id: budgetId1,
          userId: userIdA,
          categoryId: categoryIdA,
          period: '2026-01',
          limitPaise: 500000,
          version: 2,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z'
        }
      ];

      const categories = [
        {
          id: categoryIdA,
          userId: userIdA,
          name: 'Groceries'
        }
      ];

      const mockTx = {
        table: vi.fn((tableName: string) => {
          if (tableName === 'categories') {
            return {
              toArray: vi.fn(async () => categories)
            };
          }
          if (tableName === 'budgets') {
            return {
              toCollection: () => ({
                modify: async (cb: (b: any) => void) => {
                  for (const b of budgets) {
                    cb(b);
                  }
                }
              })
            };
          }
          return {};
        })
      };

      await upgradeBudgetsToVersion6(mockTx);

      expect((budgets[0] as any).userId).toBe(userIdA);
      expect((budgets[0] as any).version).toBe(2);
      expect((budgets[0] as any).limitPaise).toBe(500000);
    });

    it('quarantines budget assigned to User A if its referenced category belongs to User B without guessing or deleting', async () => {
      const budgets = [
        {
          id: budgetId1,
          userId: userIdA,
          categoryId: categoryIdB,
          period: '2026-01',
          limitPaise: 500000,
          version: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ];

      const categories = [
        {
          id: categoryIdB,
          userId: userIdB,
          name: 'User B Category'
        }
      ];

      const mockTx = {
        table: vi.fn((tableName: string) => {
          if (tableName === 'categories') {
            return { toArray: vi.fn(async () => categories) };
          }
          if (tableName === 'budgets') {
            return {
              toCollection: () => ({
                modify: async (cb: (b: any) => void) => {
                  for (const b of budgets) {
                    cb(b);
                  }
                }
              })
            };
          }
          return {};
        })
      };

      await upgradeBudgetsToVersion6(mockTx);

      expect(budgets).toHaveLength(1);
      expect(budgets[0].userId).toBe('quarantine-conflicting-ownership');
      expect(budgets[0].userId).not.toBe(userIdA);
      expect(budgets[0].userId).not.toBe(userIdB);
      expect(budgets[0].limitPaise).toBe(500000);
    });

    it('quarantines budget with existing valid UUID userId if referenced category is missing or has invalid/nil owner', async () => {
      const nilCategoryId = createCategoryId('77777777-7777-4777-8777-777777777777');
      const localUserCategoryId = createCategoryId('88888888-8888-4888-8888-888888888888');
      const missingCategoryBudgetId = createBudgetId('99999999-9999-4999-8999-999999999999');

      const budgets = [
        {
          id: budgetId1,
          userId: userIdA,
          categoryId: categoryIdA, // Not in categories table
          period: '2026-01',
          limitPaise: 300000
        },
        {
          id: budgetId2,
          userId: userIdA,
          categoryId: nilCategoryId,
          period: '2026-02',
          limitPaise: 400000
        },
        {
          id: missingCategoryBudgetId,
          userId: userIdA,
          categoryId: localUserCategoryId,
          period: '2026-03',
          limitPaise: 500000
        }
      ];

      const categories = [
        {
          id: nilCategoryId,
          userId: '00000000-0000-0000-0000-000000000000',
          name: 'Unassigned Nil UUID Category'
        },
        {
          id: localUserCategoryId,
          userId: 'local-user',
          name: 'Legacy Local User Category'
        }
      ];

      const mockTx = {
        table: vi.fn((tableName: string) => {
          if (tableName === 'categories') {
            return { toArray: vi.fn(async () => categories) };
          }
          if (tableName === 'budgets') {
            return {
              toCollection: () => ({
                modify: async (cb: (b: any) => void) => {
                  for (const b of budgets) {
                    cb(b);
                  }
                }
              })
            };
          }
          return {};
        })
      };

      await upgradeBudgetsToVersion6(mockTx);

      expect(budgets).toHaveLength(3);
      expect(budgets[0].userId).toBe('quarantine-unresolved-ownership');
      expect(budgets[1].userId).toBe('quarantine-unresolved-ownership');
      expect(budgets[2].userId).toBe('quarantine-unresolved-ownership');
    });

    it('quarantines budget with malformed or sentinel userId (e.g. local-user or nil UUID) without guessing', async () => {
      const budgets = [
        {
          id: budgetId1,
          userId: 'local-user',
          categoryId: categoryIdA,
          period: '2026-01',
          limitPaise: 250000
        },
        {
          id: budgetId2,
          userId: '00000000-0000-0000-0000-000000000000',
          categoryId: categoryIdA,
          period: '2026-02',
          limitPaise: 350000
        }
      ];

      const categories = [
        {
          id: categoryIdA,
          userId: userIdA,
          name: 'Groceries'
        }
      ];

      const mockTx = {
        table: vi.fn((tableName: string) => {
          if (tableName === 'categories') {
            return { toArray: vi.fn(async () => categories) };
          }
          if (tableName === 'budgets') {
            return {
              toCollection: () => ({
                modify: async (cb: (b: any) => void) => {
                  for (const b of budgets) {
                    cb(b);
                  }
                }
              })
            };
          }
          return {};
        })
      };

      await upgradeBudgetsToVersion6(mockTx);

      expect(budgets).toHaveLength(2);
      expect(budgets[0].userId).toBe('quarantine-malformed-ownership');
      expect(budgets[1].userId).toBe('quarantine-malformed-ownership');
    });

    it('remains idempotent across repeated upgrades for both valid and quarantined records', async () => {
      const budgets = [
        {
          id: budgetId1,
          userId: userIdA,
          categoryId: categoryIdB, // Conflicts with categoryIdB -> userIdB
          period: '2026-01',
          limitPaise: 500000
        },
        {
          id: budgetId2,
          userId: userIdA,
          categoryId: categoryIdA,
          period: '2026-02',
          limitPaise: 600000
        }
      ];

      const categories = [
        { id: categoryIdA, userId: userIdA, name: 'Groceries' },
        { id: categoryIdB, userId: userIdB, name: 'Dining' }
      ];

      const mockTx = {
        table: vi.fn((tableName: string) => {
          if (tableName === 'categories') {
            return { toArray: vi.fn(async () => categories) };
          }
          if (tableName === 'budgets') {
            return {
              toCollection: () => ({
                modify: async (cb: (b: any) => void) => {
                  for (const b of budgets) {
                    cb(b);
                  }
                }
              })
            };
          }
          return {};
        })
      };

      await upgradeBudgetsToVersion6(mockTx);
      await upgradeBudgetsToVersion6(mockTx);

      expect(budgets[0].userId).toBe('quarantine-conflicting-ownership');
      expect(budgets[1].userId).toBe(userIdA);
    });

    it('isolates quarantined records from authenticated repository queries', async () => {
      // Quarantined record preserved in local DB
      mockDb.budgetsStorage.set(budgetId1, {
        id: budgetId1,
        userId: 'quarantine-unresolved-ownership',
        categoryId: categoryIdA,
        period: '2026-03',
        limitPaise: 500000,
        version: 1,
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z'
      });

      // Query by authenticated user A - must throw Unauthorized or return null, never leak
      await expect(budgetRepo.findById(budgetId1, userIdA)).rejects.toThrow(
        UnauthorizedEntityAccessError
      );

      const periodResults = await budgetRepo.findByPeriod('2026-03', userIdA);
      expect(periodResults).toHaveLength(0);

      const categoryResults = await budgetRepo.findByCategoryAndPeriod(
        categoryIdA,
        '2026-03',
        userIdA
      );
      expect(categoryResults).toBeNull();

      // Record is completely preserved in storage
      expect(mockDb.budgetsStorage.has(budgetId1)).toBe(true);
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  LaxmiLensDB,
  upgradeRecurringRulesToVersion7
} from '@/infrastructure/database/local/DexieDatabase';
import { DexieRecurringRuleRepository } from '@/infrastructure/database/local/repositories/DexieRecurringRuleRepository';
import { DexieRecurringOccurrenceRepository } from '@/infrastructure/database/local/repositories/DexieRecurringOccurrenceRepository';
import { RecurringRule } from '@/domain/entities/RecurringRule';
import { RecurringOccurrence } from '@/domain/entities/RecurringOccurrence';
import { Money } from '@/domain/value-objects/Money';
import {
  createAccountId,
  createCategoryId,
  createRecurringOccurrenceId,
  createRecurringRuleId,
  createUserId
} from '@/domain/value-objects/Identifiers';
import { UnauthorizedEntityAccessError } from '@/domain/errors/DomainErrors';
import { DuplicateRecurringOccurrenceError } from '@/domain/errors/RecurringErrors';
import {
  LocalRecurringOccurrenceRecord,
  LocalRecurringRuleRecord
} from '@/infrastructure/database/local/schema';

class MockRecurringDexieDB {
  public rulesStorage = new Map<string, LocalRecurringRuleRecord>();
  public occsStorage = new Map<string, LocalRecurringOccurrenceRecord>();
  private txTail: Promise<void> = Promise.resolve();

  public transaction = vi.fn(
    async <T>(_mode: string, _tables: unknown, scope: () => Promise<T>): Promise<T> => {
      const prev = this.txTail;
      let release!: () => void;
      this.txTail = new Promise<void>((res) => {
        release = res;
      });
      await prev;
      try {
        return await scope();
      } finally {
        release();
      }
    }
  );

  public recurringRules = {
    get: vi.fn(async (id: string) => this.rulesStorage.get(id) ?? null),
    put: vi.fn(async (record: LocalRecurringRuleRecord) => {
      await Promise.resolve();
      this.rulesStorage.set(record.id, { ...record });
      return record.id;
    }),
    toArray: vi.fn(async () => Array.from(this.rulesStorage.values())),
    where: vi.fn((index: string) => ({
      equals: (arg: any) => {
        const values = Array.from(this.rulesStorage.values());
        if (index === 'userId') {
          return { toArray: vi.fn(async () => values.filter((r) => r.userId === arg)) };
        }
        if (index === '[userId+id]') {
          const [uId, id] = arg;
          return {
            first: vi.fn(async () => {
              const found = this.rulesStorage.get(id);
              return found && found.userId === uId ? found : null;
            })
          };
        }
        if (index === '[userId+status]') {
          const [uId, status] = arg;
          return {
            toArray: vi.fn(async () =>
              values.filter((r) => r.userId === uId && r.status === status)
            )
          };
        }
        return { toArray: vi.fn(async () => []) };
      }
    }))
  };

  public recurringOccurrences = {
    get: vi.fn(async (id: string) => this.occsStorage.get(id) ?? null),
    put: vi.fn(async (record: LocalRecurringOccurrenceRecord) => {
      await Promise.resolve();
      this.occsStorage.set(record.id, { ...record });
      return record.id;
    }),
    toArray: vi.fn(async () => Array.from(this.occsStorage.values())),
    where: vi.fn((index: string) => ({
      equals: (arg: any) => {
        const values = Array.from(this.occsStorage.values());
        if (index === 'userId') {
          return { toArray: vi.fn(async () => values.filter((r) => r.userId === arg)) };
        }
        if (index === '[userId+id]') {
          const [uId, id] = arg;
          return {
            first: vi.fn(async () => {
              const found = this.occsStorage.get(id);
              return found && found.userId === uId ? found : null;
            })
          };
        }
        if (index === '[userId+recurringRuleId]') {
          const [uId, ruleId] = arg;
          return {
            toArray: vi.fn(async () =>
              values.filter((r) => r.userId === uId && r.recurringRuleId === ruleId)
            )
          };
        }
        if (index === '[userId+recurringRuleId+occurrenceDate]') {
          const [uId, ruleId, dt] = arg;
          return {
            toArray: vi.fn(async () =>
              values.filter(
                (r) =>
                  r.userId === uId &&
                  r.recurringRuleId === ruleId &&
                  r.occurrenceDate === dt
              )
            )
          };
        }
        if (index === '[userId+status]') {
          const [uId, st] = arg;
          return {
            toArray: vi.fn(async () =>
              values.filter((r) => r.userId === uId && r.status === st)
            )
          };
        }
        return { toArray: vi.fn(async () => []) };
      }
    }))
  };
}

describe('Phase 8 Infrastructure: Dexie v7 Migration & Recurring Repositories', () => {
  const userA = createUserId('11111111-1111-4111-8111-111111111111');
  const userB = createUserId('22222222-2222-4222-8222-222222222222');
  const accA = createAccountId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
  const accB = createAccountId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2');
  const catA = createCategoryId('cccccccc-cccc-4ccc-8ccc-ccccccccccc1');
  const rule1Id = createRecurringRuleId('44444444-4444-4444-8444-444444444441');
  const occ1Id = createRecurringOccurrenceId('55555555-5555-4555-8555-555555555551');
  const occ2Id = createRecurringOccurrenceId('55555555-5555-4555-8555-555555555552');

  let mockDb: MockRecurringDexieDB;
  let ruleRepo: DexieRecurringRuleRepository;
  let occRepo: DexieRecurringOccurrenceRepository;

  beforeEach(() => {
    mockDb = new MockRecurringDexieDB();
    ruleRepo = new DexieRecurringRuleRepository(mockDb as unknown as LaxmiLensDB);
    occRepo = new DexieRecurringOccurrenceRepository(mockDb as unknown as LaxmiLensDB);
  });

  describe('Dexie Version 7 Non-Destructive Upgrade & Fail-Closed Quarantine', () => {
    it('upgrades legacy recurringRules with valid account/category ownership and quarantines invalid/conflicting rows without deleting any', async () => {
      const accounts = [
        { id: accA, userId: userA },
        { id: accB, userId: userB }
      ];
      const categories = [{ id: catA, userId: userA }];
      const legacyRows: any[] = [
        {
          id: 'r-valid',
          name: 'Legacy Rent',
          type: 'expense',
          amountInPaise: 2000000,
          accountId: accA,
          categoryId: catA,
          frequency: 'monthly',
          interval: 1,
          startDate: '2026-01-31T00:00:00.000Z',
          nextDueDate: '2026-02-28',
          requiresUserConfirmation: true,
          isActive: true,
          version: 1
        },
        {
          id: 'r-conflict',
          userId: userA,
          name: 'Cross User Rule',
          type: 'expense',
          amountInPaise: 50000,
          accountId: accB, // owned by userB!
          frequency: 'monthly',
          interval: 1,
          startDate: '2026-01-10',
          nextDueDate: '2026-02-10',
          requiresUserConfirmation: true,
          isActive: true,
          version: 1
        },
        {
          id: 'r-unresolved',
          name: 'Orphaned Account',
          type: 'expense',
          amountInPaise: 50000,
          accountId: '99999999-9999-4999-8999-999999999999',
          frequency: 'monthly',
          interval: 1,
          startDate: '2026-01-10',
          nextDueDate: '2026-02-10',
          requiresUserConfirmation: true,
          isActive: true,
          version: 1
        },
        {
          id: 'r-bad-amount',
          userId: userA,
          name: 'Zero Amount',
          type: 'expense',
          amountInPaise: 0,
          accountId: accA,
          frequency: 'monthly',
          interval: 1,
          startDate: '2026-01-10',
          nextDueDate: '2026-02-10',
          requiresUserConfirmation: true,
          isActive: true,
          version: 1
        }
      ];

      const txMock = {
        table: vi.fn((tableName: string) => {
          if (tableName === 'accounts') {
            return { toArray: async () => accounts };
          }
          if (tableName === 'categories') {
            return { toArray: async () => categories };
          }
          if (tableName === 'recurringRules') {
            return {
              toCollection: () => ({
                modify: async (fn: (row: any) => void) => {
                  for (const row of legacyRows) fn(row);
                }
              })
            };
          }
          return { toArray: async () => [] };
        })
      };

      await upgradeRecurringRulesToVersion7(txMock);

      expect(legacyRows).toHaveLength(4); // zero deletions
      expect(legacyRows[0].userId).toBe(userA);
      expect(legacyRows[0].title).toBe('Legacy Rent');
      expect(legacyRows[0].amountPaise).toBe(2000000);
      expect(legacyRows[0].anchorDayOfMonth).toBeGreaterThanOrEqual(1);
      expect(legacyRows[0].status).toBe('active');

      expect(legacyRows[1].userId).toBe('quarantine-conflicting-ownership');
      expect(legacyRows[2].userId).toBe('quarantine-unresolved-ownership');
      expect(legacyRows[3].userId).toBe('quarantine-invalid-data');
    });
  });

  describe('User Isolation & Atomic Duplicate Prevention', () => {
    it('enforces cross-user rejection when reading or overwriting recurring rules', async () => {
      const rule = new RecurringRule({
        id: rule1Id,
        userId: userA,
        title: 'Rent',
        type: 'expense',
        amount: Money.fromPaise(1500000, 'INR'),
        accountId: accA,
        frequency: 'monthly',
        interval: 1,
        startDate: '2026-01-05',
        nextDueDate: '2026-02-05'
      });

      await ruleRepo.save(rule);
      await expect(ruleRepo.findById(rule1Id, userB)).rejects.toThrow(
        UnauthorizedEntityAccessError
      );

      const collidingRule = new RecurringRule({
        id: rule1Id,
        userId: userB,
        title: 'Spoofed',
        type: 'expense',
        amount: Money.fromPaise(1000, 'INR'),
        accountId: accB,
        frequency: 'monthly',
        interval: 1,
        startDate: '2026-01-05',
        nextDueDate: '2026-02-05'
      });

      await expect(ruleRepo.save(collidingRule)).rejects.toThrow(UnauthorizedEntityAccessError);
    });

    it('prevents concurrent duplicate occurrence inserts for same (userId, ruleId, occurrenceDate)', async () => {
      const occ1 = new RecurringOccurrence({
        id: occ1Id,
        userId: userA,
        recurringRuleId: rule1Id,
        occurrenceDate: '2026-11-25'
      });
      const occ2 = new RecurringOccurrence({
        id: occ2Id,
        userId: userA,
        recurringRuleId: rule1Id,
        occurrenceDate: '2026-11-25'
      });

      const results = await Promise.allSettled([occRepo.save(occ1), occRepo.save(occ2)]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
        DuplicateRecurringOccurrenceError
      );
      expect(await occRepo.findAll(userA)).toHaveLength(1);
    });
  });
});

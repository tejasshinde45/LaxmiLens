import { describe, it, expect, vi, beforeEach } from 'vitest';
import Dexie from 'dexie';
import { OutboxManager } from '@/infrastructure/sync/OutboxManager';
import { LaxmiLensDB } from '@/infrastructure/database/local/DexieDatabase';
import { LocalOutboxRecord } from '@/infrastructure/database/local/schema';
import { OutboxEntry } from '@/application/ports/SyncPort';
import { CreateAccountUseCase } from '@/application/use-cases/accounts/CreateAccountUseCase';
import { CreateCategoryUseCase } from '@/application/use-cases/categories/CreateCategoryUseCase';
import { CreateTransactionUseCase } from '@/application/use-cases/transactions/CreateTransactionUseCase';
import { ExecuteTransferUseCase } from '@/application/use-cases/transactions/ExecuteTransferUseCase';
import { UpdateTransactionUseCase } from '@/application/use-cases/transactions/UpdateTransactionUseCase';
import { DeleteTransactionUseCase } from '@/application/use-cases/transactions/DeleteTransactionUseCase';
import { AccountRepository } from '@/domain/repositories/AccountRepository';
import { TransactionRepository } from '@/domain/repositories/TransactionRepository';
import { CategoryRepository } from '@/domain/repositories/CategoryRepository';
import { UnitOfWork } from '@/application/ports/UnitOfWork';
import { Account } from '@/domain/entities/Account';
import { Transaction } from '@/domain/entities/Transaction';
import { Category } from '@/domain/entities/Category';
import {
  createAccountId,
  createTransactionId,
  createCategoryId,
  isValidUuid
} from '@/domain/value-objects/Identifiers';
import {
  InvalidUserIdError,
  UnauthorizedEntityAccessError
} from '@/domain/errors/DomainErrors';

describe('User-Scoped Outbox Foundation & Hardening (Phase 2D.7.1 & 2D.7.1.1)', () => {
  const userA = '11111111-1111-4111-8111-111111111111';
  const userB = '22222222-2222-4222-8222-222222222222';
  const userC = '33333333-3333-4333-8333-333333333333';

  let records: LocalOutboxRecord[];
  let mockDb: LaxmiLensDB;
  let outboxManager: OutboxManager;

  beforeEach(() => {
    records = [];

    // Realistic IndexedDB table mock implementing [userId+id] compound index and userId index
    const mockSyncOutboxTable = {
      add: vi.fn().mockImplementation(async (record: LocalOutboxRecord) => {
        const nextId = (records.length > 0 ? Math.max(...records.map((r) => r.id || 0)) : 0) + 1;
        const saved: LocalOutboxRecord = { ...record, id: nextId };
        records.push(saved);
        return nextId;
      }),
      get: vi.fn().mockImplementation(async (id: number) => {
        return records.find((r) => r.id === id);
      }),
      update: vi.fn().mockImplementation(async (id: number, changes: Partial<LocalOutboxRecord>) => {
        const item = records.find((r) => r.id === id);
        if (item) {
          Object.assign(item, changes);
          return 1;
        }
        return 0;
      }),
      delete: vi.fn().mockImplementation(async (id: number) => {
        records = records.filter((r) => r.id !== id);
      }),
      clear: vi.fn().mockImplementation(async () => {
        records = [];
      }),
      where: vi.fn().mockImplementation((indexOrField: string) => {
        if (indexOrField === 'userId') {
          return {
            equals: (expectedUserId: string) => ({
              count: vi.fn().mockImplementation(async () => {
                return records.filter((r) => r.userId === expectedUserId).length;
              }),
              toArray: vi.fn().mockImplementation(async () => {
                return records.filter((r) => r.userId === expectedUserId);
              })
            })
          };
        }

        if (indexOrField === '[userId+id]') {
          return {
            between: (lower: [string, unknown], upper: [string, unknown]) => {
              const targetUserId = lower[0];
              return {
                limit: (lim: number) => ({
                  toArray: vi.fn().mockImplementation(async () => {
                    return records
                      .filter((r) => r.userId === targetUserId)
                      .sort((a, b) => (a.id || 0) - (b.id || 0))
                      .slice(0, lim);
                  })
                }),
                toArray: vi.fn().mockImplementation(async () => {
                  return records
                    .filter((r) => r.userId === targetUserId)
                    .sort((a, b) => (a.id || 0) - (b.id || 0));
                })
              };
            }
          };
        }

        throw new Error(`Unexpected index in test: ${indexOrField}`);
      }),
      orderBy: vi.fn().mockImplementation((field: string) => ({
        limit: (lim: number) => ({
          toArray: vi.fn().mockImplementation(async () => {
            return [...records]
              .sort(
                (a, b) =>
                  ((a as unknown as Record<string, number>)[field] || 0) -
                  ((b as unknown as Record<string, number>)[field] || 0)
              )
              .slice(0, lim);
          })
        })
      }))
    };

    mockDb = {
      syncOutbox: mockSyncOutboxTable
    } as unknown as LaxmiLensDB;

    outboxManager = new OutboxManager(mockDb);
  });

  describe('1. UUID Validation & Normalization', () => {
    it('accepts valid RFC 4122 UUID and normalizes to lowercase on enqueue', async () => {
      const upperUuid = userA.toUpperCase();
      await outboxManager.enqueue({
        userId: upperUuid,
        entity: 'accounts',
        entityId: 'acc-1',
        operation: 'INSERT',
        payload: { user_id: upperUuid },
        idempotencyKey: 'idemp-1'
      });

      expect(records[0].userId).toBe(userA.toLowerCase());
    });

    it('rejects malformed UUIDs during enqueue with InvalidUserIdError', async () => {
      const malformedIds = ['not-a-uuid', '12345', 'local-user', 'user-a-1111', ''];
      for (const badId of malformedIds) {
        await expect(
          outboxManager.enqueue({
            userId: badId,
            entity: 'accounts',
            entityId: 'acc-1',
            operation: 'INSERT',
            payload: {},
            idempotencyKey: 'idemp-err'
          })
        ).rejects.toThrow(InvalidUserIdError);
      }
    });

    it('rejects whitespace-only and missing user IDs during enqueue', async () => {
      await expect(
        outboxManager.enqueue({
          userId: '   ',
          entity: 'accounts',
          entityId: 'acc-1',
          operation: 'INSERT',
          payload: {},
          idempotencyKey: 'idemp-err'
        })
      ).rejects.toThrow(InvalidUserIdError);

      await expect(
        outboxManager.enqueue({
          userId: undefined as unknown as string,
          entity: 'accounts',
          entityId: 'acc-1',
          operation: 'INSERT',
          payload: {},
          idempotencyKey: 'idemp-err'
        })
      ).rejects.toThrow(InvalidUserIdError);
    });

    it('rejects malformed or empty user ID in getPendingEntries and getPendingCount', async () => {
      await expect(outboxManager.getPendingEntries('invalid-user-id')).rejects.toThrow(
        InvalidUserIdError
      );
      await expect(outboxManager.getPendingEntries('')).rejects.toThrow(InvalidUserIdError);
      await expect(outboxManager.getPendingEntries('   ')).rejects.toThrow(InvalidUserIdError);

      await expect(outboxManager.getPendingCount('invalid-user-id')).rejects.toThrow(
        InvalidUserIdError
      );
      await expect(outboxManager.getPendingCount('')).rejects.toThrow(InvalidUserIdError);
      await expect(outboxManager.getPendingCount('   ')).rejects.toThrow(InvalidUserIdError);
    });
  });

  describe('2. Outbox Payload Ownership Consistency & Rejection', () => {
    it('accepts enqueue when top-level userId matches payload.user_id', async () => {
      await outboxManager.enqueue({
        userId: userA,
        entity: 'accounts',
        entityId: 'acc-1',
        operation: 'INSERT',
        payload: { id: 'acc-1', user_id: userA, name: 'Checking' },
        idempotencyKey: 'k-1'
      });
      expect(records).toHaveLength(1);
      expect(records[0].userId).toBe(userA);
    });

    it('accepts enqueue when top-level userId matches camelCase payload.userId', async () => {
      await outboxManager.enqueue({
        userId: userB,
        entity: 'transactions',
        entityId: 'tx-1',
        operation: 'INSERT',
        payload: { id: 'tx-1', userId: userB, amountPaise: 5000 },
        idempotencyKey: 'k-2'
      });
      expect(records).toHaveLength(1);
      expect(records[0].userId).toBe(userB);
    });

    it('rejects enqueue when top-level userId mismatches payload user ownership', async () => {
      await expect(
        outboxManager.enqueue({
          userId: userA,
          entity: 'accounts',
          entityId: 'acc-1',
          operation: 'INSERT',
          payload: { id: 'acc-1', user_id: userB }, // User B in payload, User A at top level!
          idempotencyKey: 'k-mismatch'
        })
      ).rejects.toThrow(/Outbox ownership mismatch/);

      expect(records).toHaveLength(0);
    });

    it('rejects enqueue when payload user_id is a malformed non-UUID', async () => {
      await expect(
        outboxManager.enqueue({
          userId: userA,
          entity: 'accounts',
          entityId: 'acc-1',
          operation: 'INSERT',
          payload: { id: 'acc-1', user_id: 'local-user' },
          idempotencyKey: 'k-bad-payload'
        })
      ).rejects.toThrow(InvalidUserIdError);

      expect(records).toHaveLength(0);
    });
  });

  describe('3. Tenant Isolation & Query Validation', () => {
    it('retrieves only User As events when queried for User A', async () => {
      await outboxManager.enqueue({
        userId: userA,
        entity: 'accounts',
        entityId: 'acc-a1',
        operation: 'INSERT',
        payload: { user_id: userA, name: 'Account A1' },
        idempotencyKey: 'idemp-a1'
      });
      await outboxManager.enqueue({
        userId: userB,
        entity: 'accounts',
        entityId: 'acc-b1',
        operation: 'INSERT',
        payload: { user_id: userB, name: 'Account B1' },
        idempotencyKey: 'idemp-b1'
      });
      await outboxManager.enqueue({
        userId: userA,
        entity: 'transactions',
        entityId: 'tx-a2',
        operation: 'INSERT',
        payload: { user_id: userA, amount: 100 },
        idempotencyKey: 'idemp-a2'
      });

      const userAEntries = await outboxManager.getPendingEntries(userA);
      expect(userAEntries).toHaveLength(2);
      expect(userAEntries.every((e) => e.userId === userA)).toBe(true);
      expect(userAEntries.map((e) => e.entityId)).toEqual(['acc-a1', 'tx-a2']);
    });

    it('retrieves only User Bs events when queried for User B', async () => {
      await outboxManager.enqueue({
        userId: userA,
        entity: 'accounts',
        entityId: 'acc-a1',
        operation: 'INSERT',
        payload: { user_id: userA },
        idempotencyKey: 'idemp-a1'
      });
      await outboxManager.enqueue({
        userId: userB,
        entity: 'accounts',
        entityId: 'acc-b1',
        operation: 'INSERT',
        payload: { user_id: userB },
        idempotencyKey: 'idemp-b1'
      });

      const userBEntries = await outboxManager.getPendingEntries(userB);
      expect(userBEntries).toHaveLength(1);
      expect(userBEntries[0].userId).toBe(userB);
      expect(userBEntries[0].entityId).toBe('acc-b1');
    });

    it('returns empty array when user has no pending outbox entries', async () => {
      await outboxManager.enqueue({
        userId: userA,
        entity: 'accounts',
        entityId: 'acc-a1',
        operation: 'INSERT',
        payload: { user_id: userA },
        idempotencyKey: 'idemp-a1'
      });

      const userCEntries = await outboxManager.getPendingEntries(userC);
      expect(userCEntries).toEqual([]);
    });

    it('returns exact pending count strictly isolated per user', async () => {
      expect(await outboxManager.getPendingCount(userA)).toBe(0);
      expect(await outboxManager.getPendingCount(userB)).toBe(0);

      await outboxManager.enqueue({
        userId: userA,
        entity: 'accounts',
        entityId: 'acc-a1',
        operation: 'INSERT',
        payload: { user_id: userA },
        idempotencyKey: 'k-1'
      });
      await outboxManager.enqueue({
        userId: userA,
        entity: 'accounts',
        entityId: 'acc-a2',
        operation: 'UPDATE',
        payload: { user_id: userA },
        idempotencyKey: 'k-2'
      });
      await outboxManager.enqueue({
        userId: userB,
        entity: 'accounts',
        entityId: 'acc-b1',
        operation: 'INSERT',
        payload: { user_id: userB },
        idempotencyKey: 'k-3'
      });

      expect(await outboxManager.getPendingCount(userA)).toBe(2);
      expect(await outboxManager.getPendingCount(userB)).toBe(1);
      expect(await outboxManager.getPendingCount(userC)).toBe(0);
    });

    it('handles non-positive or invalid limits safely without error', async () => {
      await outboxManager.enqueue({
        userId: userA,
        entity: 'accounts',
        entityId: 'acc-1',
        operation: 'INSERT',
        payload: { user_id: userA },
        idempotencyKey: 'k-1'
      });

      const resNegative = await outboxManager.getPendingEntries(userA, -5);
      expect(resNegative).toHaveLength(1);

      const resZero = await outboxManager.getPendingEntries(userA, 0);
      expect(resZero).toHaveLength(1);

      const resNaN = await outboxManager.getPendingEntries(userA, NaN);
      expect(resNaN).toHaveLength(1);
    });

    it('preserves FIFO ordering by id within each users queue even when writes interleave', async () => {
      await outboxManager.enqueue({
        userId: userA,
        entity: 'accounts',
        entityId: 'acc-a-1',
        operation: 'INSERT',
        payload: { user_id: userA },
        idempotencyKey: 'k-a1'
      }); // id: 1
      await outboxManager.enqueue({
        userId: userB,
        entity: 'accounts',
        entityId: 'acc-b-1',
        operation: 'INSERT',
        payload: { user_id: userB },
        idempotencyKey: 'k-b1'
      }); // id: 2
      await outboxManager.enqueue({
        userId: userA,
        entity: 'accounts',
        entityId: 'acc-a-2',
        operation: 'UPDATE',
        payload: { user_id: userA },
        idempotencyKey: 'k-a2'
      }); // id: 3
      await outboxManager.enqueue({
        userId: userB,
        entity: 'accounts',
        entityId: 'acc-b-2',
        operation: 'UPDATE',
        payload: { user_id: userB },
        idempotencyKey: 'k-b2'
      }); // id: 4
      await outboxManager.enqueue({
        userId: userA,
        entity: 'accounts',
        entityId: 'acc-a-3',
        operation: 'DELETE',
        payload: { user_id: userA },
        idempotencyKey: 'k-a3'
      }); // id: 5

      const userAEntries = await outboxManager.getPendingEntries(userA);
      expect(userAEntries.map((e) => e.id)).toEqual([1, 3, 5]);

      const userBEntries = await outboxManager.getPendingEntries(userB);
      expect(userBEntries.map((e) => e.id)).toEqual([2, 4]);
    });
  });

  describe('4. Schema Version 3 Upgrade & Legacy Ownership Consistency', () => {
    // Exact upgrade mutator logic defined in DexieDatabase.ts
    const migrateRecord = (record: LocalOutboxRecord) => {
      if (
        typeof record.userId === 'string' &&
        (record.userId.startsWith('quarantine-') || record.userId === 'ambiguous-unassigned')
      ) {
        return;
      }

      const payload = (record.payload || {}) as Record<string, unknown>;

      const topLevelUuid =
        typeof record.userId === 'string' && isValidUuid(record.userId)
          ? record.userId.trim().toLowerCase()
          : undefined;

      const payloadSnakeUuid =
        typeof payload.user_id === 'string' && isValidUuid(payload.user_id)
          ? payload.user_id.trim().toLowerCase()
          : undefined;

      const payloadCamelUuid =
        typeof payload.userId === 'string' && isValidUuid(payload.userId)
          ? payload.userId.trim().toLowerCase()
          : undefined;

      const hasMalformedTopLevel =
        typeof record.userId === 'string' && record.userId.trim() !== '' && !topLevelUuid;

      const hasMalformedPayload =
        (typeof payload.user_id === 'string' &&
          payload.user_id.trim() !== '' &&
          !payloadSnakeUuid) ||
        (typeof payload.userId === 'string' &&
          payload.userId.trim() !== '' &&
          !payloadCamelUuid);

      const validSources = [topLevelUuid, payloadSnakeUuid, payloadCamelUuid].filter(
        (s): s is string => Boolean(s)
      );

      const hasConflict =
        validSources.length > 1 && validSources.some((src) => src !== validSources[0]);

      if (hasConflict) {
        record.userId = 'quarantine-conflicting-ownership';
        return;
      }

      if (validSources.length > 0) {
        record.userId = validSources[0];
        return;
      }

      if (hasMalformedTopLevel || hasMalformedPayload) {
        record.userId = 'quarantine-malformed-ownership';
      } else {
        record.userId = 'ambiguous-unassigned';
      }
    };

    it('migrates legacy records with valid payload.user_id correctly', () => {
      const legacyRecord: LocalOutboxRecord = {
        id: 1,
        userId: undefined as unknown as string,
        entity: 'accounts',
        entityId: 'acc-1',
        operation: 'INSERT',
        payload: { id: 'acc-1', user_id: userA, name: 'HDFC Savings' },
        idempotencyKey: 'k-1',
        attempts: 0,
        createdAt: '2026-11-20T10:00:00.000Z'
      };

      migrateRecord(legacyRecord);

      expect(legacyRecord.userId).toBe(userA);
      expect(legacyRecord.entityId).toBe('acc-1');
      expect(legacyRecord.idempotencyKey).toBe('k-1');
    });

    it('migrates legacy records with camelCase payload.userId correctly', () => {
      const legacyRecord: LocalOutboxRecord = {
        id: 2,
        userId: undefined as unknown as string,
        entity: 'transactions',
        entityId: 'tx-1',
        operation: 'INSERT',
        payload: { id: 'tx-1', userId: userB, amountPaise: 50000 },
        idempotencyKey: 'k-2',
        attempts: 0,
        createdAt: '2026-11-20T10:00:00.000Z'
      };

      migrateRecord(legacyRecord);

      expect(legacyRecord.userId).toBe(userB);
    });

    it('quarantines records with conflicting ownership between top-level and payload', () => {
      const conflictingRecord: LocalOutboxRecord = {
        id: 3,
        userId: userA, // User A at top level
        entity: 'accounts',
        entityId: 'acc-conflicted',
        operation: 'UPDATE',
        payload: { id: 'acc-conflicted', user_id: userB }, // User B in payload!
        idempotencyKey: 'k-conflict',
        attempts: 0,
        createdAt: '2026-11-20T10:00:00.000Z'
      };

      migrateRecord(conflictingRecord);

      expect(conflictingRecord.userId).toBe('quarantine-conflicting-ownership');
      // Original payload and metadata are preserved completely
      expect(conflictingRecord.payload.user_id).toBe(userB);
      expect(conflictingRecord.entityId).toBe('acc-conflicted');
    });

    it('quarantines records with conflicting snake_case and camelCase payload IDs', () => {
      const conflictingPayloadRecord: LocalOutboxRecord = {
        id: 4,
        userId: undefined as unknown as string,
        entity: 'transactions',
        entityId: 'tx-conflicted',
        operation: 'INSERT',
        payload: { user_id: userA, userId: userB },
        idempotencyKey: 'k-conflict-payload',
        attempts: 0,
        createdAt: '2026-11-20T10:00:00.000Z'
      };

      migrateRecord(conflictingPayloadRecord);

      expect(conflictingPayloadRecord.userId).toBe('quarantine-conflicting-ownership');
    });

    it('quarantines legacy records with malformed non-UUID ownership (e.g. local-user)', () => {
      const malformedRecord: LocalOutboxRecord = {
        id: 5,
        userId: undefined as unknown as string,
        entity: 'categories',
        entityId: 'cat-1',
        operation: 'INSERT',
        payload: { id: 'cat-1', user_id: 'local-user', name: 'Utilities' },
        idempotencyKey: 'k-malformed',
        attempts: 0,
        createdAt: '2026-11-20T10:00:00.000Z'
      };

      migrateRecord(malformedRecord);

      expect(malformedRecord.userId).toBe('quarantine-malformed-ownership');
      expect(malformedRecord.payload.user_id).toBe('local-user');
    });

    it('preserves legacy records with missing ownership as ambiguous-unassigned', () => {
      const missingRecord: LocalOutboxRecord = {
        id: 6,
        userId: undefined as unknown as string,
        entity: 'budgets',
        entityId: 'b-1',
        operation: 'INSERT',
        payload: { period: '2026-11', limitInPaise: 100000 },
        idempotencyKey: 'k-missing',
        attempts: 0,
        createdAt: '2026-11-20T10:00:00.000Z'
      };

      migrateRecord(missingRecord);

      expect(missingRecord.userId).toBe('ambiguous-unassigned');
      expect(missingRecord.entityId).toBe('b-1');
    });

    it('is strictly idempotent on repeated migration runs', () => {
      const record: LocalOutboxRecord = {
        id: 7,
        userId: undefined as unknown as string,
        entity: 'accounts',
        entityId: 'acc-7',
        operation: 'INSERT',
        payload: { user_id: userA },
        idempotencyKey: 'k-7',
        attempts: 0,
        createdAt: '2026-11-20T10:00:00.000Z'
      };

      migrateRecord(record);
      expect(record.userId).toBe(userA);

      // 2nd run
      migrateRecord(record);
      expect(record.userId).toBe(userA);

      // 3rd run
      migrateRecord(record);
      expect(record.userId).toBe(userA);
    });

    it('prevents quarantined records from entering either user queue', async () => {
      // Simulate quarantined entries in the database
      records.push({
        id: 91,
        userId: 'ambiguous-unassigned',
        entity: 'budgets',
        entityId: 'b-1',
        operation: 'INSERT',
        payload: {},
        idempotencyKey: 'k-q1',
        attempts: 0,
        createdAt: '2026-11-20T10:00:00.000Z'
      });
      records.push({
        id: 92,
        userId: 'quarantine-conflicting-ownership',
        entity: 'accounts',
        entityId: 'acc-c1',
        operation: 'UPDATE',
        payload: {},
        idempotencyKey: 'k-q2',
        attempts: 0,
        createdAt: '2026-11-20T10:00:00.000Z'
      });

      const userAEntries = await outboxManager.getPendingEntries(userA);
      const userBEntries = await outboxManager.getPendingEntries(userB);

      expect(userAEntries).toHaveLength(0);
      expect(userBEntries).toHaveLength(0);
      expect(await outboxManager.getPendingCount(userA)).toBe(0);
      expect(await outboxManager.getPendingCount(userB)).toBe(0);
    });
  });

  describe('5. Entity and Outbox Ownership Consistency in Use Cases', () => {
    let mockAccountRepo: AccountRepository;
    let mockTxRepo: TransactionRepository;
    let mockCategoryRepo: CategoryRepository;
    let mockUnitOfWork: UnitOfWork;
    let accounts: Map<string, Account>;
    let transactions: Map<string, Transaction>;
    let categories: Map<string, Category>;

    beforeEach(() => {
      accounts = new Map();
      transactions = new Map();
      categories = new Map();

      mockAccountRepo = {
        findById: vi.fn().mockImplementation(async (id: string) => accounts.get(id) || null),
        findByUserId: vi.fn().mockImplementation(async (uid: string) =>
          [...accounts.values()].filter((a) => a.userId === uid)
        ),
        findAll: vi.fn().mockImplementation(async () => [...accounts.values()]),
        save: vi.fn().mockImplementation(async (acc: Account) => {
          accounts.set(acc.id, acc);
        }),
        saveBatch: vi.fn(),
        archive: vi.fn(),
        restore: vi.fn()
      };

      mockTxRepo = {
        findById: vi.fn().mockImplementation(async (id: string) => transactions.get(id) || null),
        findByAccountId: vi.fn().mockResolvedValue([]),
        findByIdempotencyKey: vi.fn().mockResolvedValue(null),
        save: vi.fn().mockImplementation(async (tx: Transaction) => {
          transactions.set(tx.id, tx);
        }),
        softDelete: vi.fn().mockImplementation(async (id: string, date: Date, ver: number) => {
          const tx = transactions.get(id);
          if (tx) {
            transactions.set(
              id,
              new Transaction({
                id: tx.id,
                userId: tx.userId,
                type: tx.type,
                amountPaise: tx.amountPaise,
                currency: tx.currency,
                accountId: tx.accountId,
                destinationAccountId: tx.destinationAccountId,
                categoryId: tx.categoryId,
                title: tx.title,
                note: tx.note,
                transactionDate: tx.transactionDate,
                deletedAt: date,
                version: ver,
                idempotencyKey: tx.idempotencyKey,
                createdAt: tx.createdAt,
                updatedAt: date
              })
            );
          }
        })
      };

      mockCategoryRepo = {
        findById: vi.fn().mockImplementation(async (id: string) => categories.get(id) || null),
        findByUserId: vi.fn().mockResolvedValue([]),
        findAll: vi.fn().mockResolvedValue([]),
        save: vi.fn().mockImplementation(async (cat: Category) => {
          categories.set(cat.id, cat);
        }),
        saveBatch: vi.fn(),
        archive: vi.fn(),
        seedDefaults: vi.fn().mockResolvedValue([])
      };

      mockUnitOfWork = {
        run: vi.fn().mockImplementation(async (work: () => Promise<unknown>) => {
          const accSnapshot = new Map(accounts);
          const txSnapshot = new Map(transactions);
          const catSnapshot = new Map(categories);
          const outboxSnapshot = [...records];
          try {
            return await work();
          } catch (err) {
            accounts = new Map(accSnapshot);
            transactions = new Map(txSnapshot);
            categories = new Map(catSnapshot);
            records = [...outboxSnapshot];
            throw err;
          }
        })
      };
    });

    it('CreateCategoryUseCase rejects missing or invalid user ID', async () => {
      const createCategoryUseCase = new CreateCategoryUseCase(mockCategoryRepo, outboxManager);

      await expect(
        createCategoryUseCase.execute({
          name: 'Food',
          type: 'expense'
          // userId missing
        })
      ).rejects.toThrow(InvalidUserIdError);

      await expect(
        createCategoryUseCase.execute({
          userId: 'local-user', // not a UUID
          name: 'Food',
          type: 'expense'
        })
      ).rejects.toThrow(InvalidUserIdError);

      expect(categories.size).toBe(0);
      expect(records).toHaveLength(0);
    });

    it('CreateTransactionUseCase rejects transaction when dto.userId mismatches source account owner', async () => {
      // Setup Account owned by User A
      const accA = new Account({
        id: createAccountId('acc-a-1'),
        userId: userA,
        name: 'User A Checking',
        accountType: 'bank',
        openingBalancePaise: 500000,
        currency: 'INR',
        isArchived: false,
        version: 1
      });
      accounts.set(accA.id, accA);

      const createTxUseCase = new CreateTransactionUseCase(
        mockTxRepo,
        mockAccountRepo,
        mockCategoryRepo,
        outboxManager,
        mockUnitOfWork
      );

      // Attempt to create transaction for Account A claiming User B identity
      await expect(
        createTxUseCase.execute({
          userId: userB, // Mismatched user!
          accountId: accA.id,
          type: 'expense',
          amountPaise: 10000,
          title: 'Unauthorized Transaction'
        })
      ).rejects.toThrow(UnauthorizedEntityAccessError);

      // Verify atomic rollback: neither transaction nor outbox entry was saved
      expect(transactions.size).toBe(0);
      expect(records).toHaveLength(0);
    });

    it('CreateTransactionUseCase rejects transfer when destination account belongs to a different user', async () => {
      const accA = new Account({
        id: createAccountId('acc-a-1'),
        userId: userA,
        name: 'User A Account',
        accountType: 'bank',
        openingBalancePaise: 500000,
        currency: 'INR',
        isArchived: false,
        version: 1
      });
      const accB = new Account({
        id: createAccountId('acc-b-1'),
        userId: userB, // Belongs to User B!
        name: 'User B Account',
        accountType: 'bank',
        openingBalancePaise: 100000,
        currency: 'INR',
        isArchived: false,
        version: 1
      });
      accounts.set(accA.id, accA);
      accounts.set(accB.id, accB);

      const createTxUseCase = new CreateTransactionUseCase(
        mockTxRepo,
        mockAccountRepo,
        mockCategoryRepo,
        outboxManager,
        mockUnitOfWork
      );

      await expect(
        createTxUseCase.execute({
          userId: userA,
          accountId: accA.id,
          destinationAccountId: accB.id,
          type: 'transfer',
          amountPaise: 50000,
          title: 'Cross-Tenant Transfer'
        })
      ).rejects.toThrow(UnauthorizedEntityAccessError);

      expect(transactions.size).toBe(0);
      expect(records).toHaveLength(0);
    });

    it('ExecuteTransferUseCase rejects transfer when destination account belongs to a different user', async () => {
      const accA = new Account({
        id: createAccountId('acc-a-1'),
        userId: userA,
        name: 'User A Checking',
        accountType: 'bank',
        openingBalancePaise: 500000,
        currency: 'INR',
        isArchived: false,
        version: 1
      });
      const accB = new Account({
        id: createAccountId('acc-b-1'),
        userId: userB,
        name: 'User B Savings',
        accountType: 'bank',
        openingBalancePaise: 100000,
        currency: 'INR',
        isArchived: false,
        version: 1
      });
      accounts.set(accA.id, accA);
      accounts.set(accB.id, accB);

      const transferUseCase = new ExecuteTransferUseCase(
        mockTxRepo,
        mockAccountRepo,
        outboxManager,
        mockUnitOfWork
      );

      await expect(
        transferUseCase.execute({
          userId: userA,
          fromAccountId: accA.id,
          toAccountId: accB.id,
          amountPaise: 25000
        })
      ).rejects.toThrow(UnauthorizedEntityAccessError);

      expect(transactions.size).toBe(0);
      expect(records).toHaveLength(0);
    });

    it('UpdateTransactionUseCase rejects update from unauthorized user', async () => {
      const txA = new Transaction({
        id: createTransactionId('tx-1'),
        userId: userA,
        type: 'expense',
        amountPaise: 5000,
        currency: 'INR',
        accountId: 'acc-1',
        title: 'Lunch',
        transactionDate: new Date(),
        deletedAt: null,
        version: 1,
        idempotencyKey: 'idemp-tx-1',
        createdAt: new Date(),
        updatedAt: new Date()
      });
      transactions.set(txA.id, txA);

      const updateTxUseCase = new UpdateTransactionUseCase(
        mockTxRepo,
        mockAccountRepo,
        mockCategoryRepo,
        outboxManager,
        mockUnitOfWork
      );

      await expect(
        updateTxUseCase.execute({
          id: txA.id,
          userId: userB, // User B attempting to update User A's transaction!
          title: 'Hacked Title'
        })
      ).rejects.toThrow(UnauthorizedEntityAccessError);

      expect(transactions.get(txA.id)?.title).toBe('Lunch');
      expect(records).toHaveLength(0);
    });

    it('DeleteTransactionUseCase rejects deletion from unauthorized user', async () => {
      const txA = new Transaction({
        id: createTransactionId('tx-1'),
        userId: userA,
        type: 'expense',
        amountPaise: 5000,
        currency: 'INR',
        accountId: 'acc-1',
        title: 'Lunch',
        transactionDate: new Date(),
        deletedAt: null,
        version: 1,
        idempotencyKey: 'idemp-tx-1',
        createdAt: new Date(),
        updatedAt: new Date()
      });
      transactions.set(txA.id, txA);

      const deleteTxUseCase = new DeleteTransactionUseCase(
        mockTxRepo,
        outboxManager,
        mockUnitOfWork
      );

      await expect(deleteTxUseCase.execute(txA.id, userB)).rejects.toThrow(
        UnauthorizedEntityAccessError
      );

      expect(transactions.get(txA.id)?.isDeleted).toBe(false);
      expect(records).toHaveLength(0);
    });

    it('DeleteTransactionUseCase cannot proceed without a valid authenticated user ID', async () => {
      const txA = new Transaction({
        id: createTransactionId('tx-1'),
        userId: userA,
        type: 'expense',
        amountPaise: 5000,
        currency: 'INR',
        accountId: 'acc-1',
        title: 'Coffee',
        transactionDate: new Date(),
        deletedAt: null,
        version: 1,
        idempotencyKey: 'idemp-tx-1',
        createdAt: new Date(),
        updatedAt: new Date()
      });
      transactions.set(txA.id, txA);

      const deleteTxUseCase = new DeleteTransactionUseCase(
        mockTxRepo,
        outboxManager,
        mockUnitOfWork
      );

      await expect(deleteTxUseCase.execute(txA.id, '')).rejects.toThrow(InvalidUserIdError);
      await expect(deleteTxUseCase.execute(txA.id, 'not-a-uuid')).rejects.toThrow(InvalidUserIdError);
      await expect(deleteTxUseCase.execute(txA.id, '   ')).rejects.toThrow(InvalidUserIdError);

      expect(transactions.get(txA.id)?.isDeleted).toBe(false);
      expect(records).toHaveLength(0);
    });

    it('UpdateTransactionUseCase cannot proceed without a valid authenticated user ID', async () => {
      const txA = new Transaction({
        id: createTransactionId('tx-1'),
        userId: userA,
        type: 'expense',
        amountPaise: 5000,
        currency: 'INR',
        accountId: 'acc-1',
        title: 'Coffee',
        transactionDate: new Date(),
        deletedAt: null,
        version: 1,
        idempotencyKey: 'idemp-tx-1',
        createdAt: new Date(),
        updatedAt: new Date()
      });
      transactions.set(txA.id, txA);

      const updateTxUseCase = new UpdateTransactionUseCase(
        mockTxRepo,
        mockAccountRepo,
        mockCategoryRepo,
        outboxManager,
        mockUnitOfWork
      );

      await expect(
        updateTxUseCase.execute({
          id: txA.id,
          userId: '',
          title: 'New Title'
        })
      ).rejects.toThrow(InvalidUserIdError);

      await expect(
        updateTxUseCase.execute({
          id: txA.id,
          userId: 'bad-uuid',
          title: 'New Title'
        })
      ).rejects.toThrow(InvalidUserIdError);

      expect(transactions.get(txA.id)?.title).toBe('Coffee');
      expect(records).toHaveLength(0);
    });

    it('UpdateTransactionUseCase permits update when category is a valid system default category', async () => {
      const defaultCategory = new Category({
        id: createCategoryId('cat-default-1'),
        userId: 'system-default-user',
        name: 'Food & Dining',
        type: 'expense',
        isDefault: true,
        isArchived: false,
        version: 1
      });
      categories.set(defaultCategory.id, defaultCategory);

      const txA = new Transaction({
        id: createTransactionId('tx-1'),
        userId: userA,
        type: 'expense',
        amountPaise: 5000,
        currency: 'INR',
        accountId: 'acc-1',
        title: 'Dinner',
        transactionDate: new Date(),
        deletedAt: null,
        version: 1,
        idempotencyKey: 'idemp-tx-1',
        createdAt: new Date(),
        updatedAt: new Date()
      });
      transactions.set(txA.id, txA);

      const updateTxUseCase = new UpdateTransactionUseCase(
        mockTxRepo,
        mockAccountRepo,
        mockCategoryRepo,
        outboxManager,
        mockUnitOfWork
      );

      const result = await updateTxUseCase.execute({
        id: txA.id,
        userId: userA,
        categoryId: defaultCategory.id
      });

      expect(result.categoryId).toBe(defaultCategory.id);
      expect(transactions.get(txA.id)?.categoryId).toBe(defaultCategory.id);
      expect(records).toHaveLength(1);
      expect(records[0].userId).toBe(userA);
    });

    it('CreateAccountUseCase rolls back entity save when outbox enqueue fails', async () => {
      const failingSyncPort = {
        enqueue: vi.fn().mockRejectedValue(new Error('Simulated outbox disk failure')),
        processOutbox: vi.fn(),
        getPendingCount: vi.fn(),
        clearOutbox: vi.fn()
      };

      const createAccountUseCase = new CreateAccountUseCase(
        mockAccountRepo,
        failingSyncPort,
        mockUnitOfWork
      );

      await expect(
        createAccountUseCase.execute({
          userId: userA,
          name: 'Atomic Test Account',
          accountType: 'bank',
          openingBalancePaise: 100000,
          currency: 'INR'
        })
      ).rejects.toThrow('Simulated outbox disk failure');

      expect(accounts.size).toBe(0);
    });
  });

  describe('6. Outbox Lifecycle: markSuccess and markFailure', () => {
    it('increments attempts and updates lastError on markFailure', async () => {
      await outboxManager.enqueue({
        userId: userA,
        entity: 'accounts',
        entityId: 'acc-1',
        operation: 'INSERT',
        payload: { user_id: userA },
        idempotencyKey: 'k-1'
      });

      const pending = await outboxManager.getPendingEntries(userA);
      const id = pending[0].id!;

      await outboxManager.markFailure(id, 'Network timeout connecting to Supabase');

      const updated = await mockDb.syncOutbox.get(id);
      expect(updated?.attempts).toBe(1);
      expect(updated?.lastError).toBe('Network timeout connecting to Supabase');
      expect(updated?.lastAttemptAt).toBeDefined();
    });

    it('removes entry from outbox on markSuccess', async () => {
      await outboxManager.enqueue({
        userId: userA,
        entity: 'accounts',
        entityId: 'acc-1',
        operation: 'INSERT',
        payload: { user_id: userA },
        idempotencyKey: 'k-1'
      });

      const pending = await outboxManager.getPendingEntries(userA);
      const id = pending[0].id!;

      await outboxManager.markSuccess(id);

      const after = await outboxManager.getPendingEntries(userA);
      expect(after).toHaveLength(0);
      expect(await outboxManager.getPendingCount(userA)).toBe(0);
    });
  });
});

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GetAccountsWithBalanceUseCase } from '@/application/use-cases/accounts/GetAccountsWithBalanceUseCase';
import { GetBudgetsOverviewUseCase } from '@/application/use-cases/budgets/GetBudgetsOverviewUseCase';
import { GetTransactionsUseCase } from '@/application/use-cases/transactions/GetTransactionsUseCase';
import { GetNotificationsUseCase } from '@/application/use-cases/notifications/GetNotificationsUseCase';
import { DexieTransactionRepository } from '@/infrastructure/database/local/repositories/DexieTransactionRepository';
import { DexieCategoryRepository } from '@/infrastructure/database/local/repositories/DexieCategoryRepository';
import { DexieBudgetRepository } from '@/infrastructure/database/local/repositories/DexieBudgetRepository';
import { DexieAccountRepository } from '@/infrastructure/database/local/repositories/DexieAccountRepository';
import { DexieNotificationRepository } from '@/infrastructure/database/local/repositories/DexieNotificationRepository';
import { OutboxManager } from '@/infrastructure/sync/OutboxManager';
import { LaxmiLensDB } from '@/infrastructure/database/local/DexieDatabase';
import { defaultDatabaseManager } from '@/infrastructure/database/local/DatabaseManager';
import {
  LocalAccountRecord,
  LocalBudgetRecord,
  LocalCategoryRecord,
  LocalOutboxRecord,
  LocalTransactionRecord
} from '@/infrastructure/database/local/schema';
import { Account } from '@/domain/entities/Account';
import { Budget } from '@/domain/entities/Budget';
import { Category } from '@/domain/entities/Category';
import { Transaction } from '@/domain/entities/Transaction';
import { LedgerRules } from '@/domain/rules/LedgerRules';
import { DateRange } from '@/domain/value-objects/DateRange';
import {
  createAccountId,
  createBudgetId,
  createCategoryId,
  createTransactionId,
  createUserId
} from '@/domain/value-objects/Identifiers';
import { queryClient as globalQueryClient } from '@/lib/queryClient';
import { AuthContext, AuthContextType } from '@/features/auth/context/AuthContext';
import { useTransactions } from '@/features/transactions/hooks/useTransactions';
import { useBudgets } from '@/features/budgets/hooks/useBudgets';
import { useNotifications } from '@/features/notifications/hooks/useNotifications';
import { useAccounts } from '@/features/accounts/hooks/useAccounts';
import { useCategories } from '@/features/categories/hooks/useCategories';
import { QuickAddModal } from '@/components/forms/QuickAddModal';

interface QueryMetrics {
  transactionQueries: Array<{ index: string; op: string; rowsScanned: number; rowsReturned: number }>;
  categoryQueries: Array<{ index: string; op: string; rowsScanned: number; rowsReturned: number }>;
  accountQueries: Array<{ index: string; op: string; rowsScanned: number; rowsReturned: number }>;
  budgetQueries: Array<{ index: string; op: string; rowsScanned: number; rowsReturned: number }>;
  outboxQueries: Array<{ index: string; op: string; rowsScanned: number; rowsReturned: number }>;
}

/**
 * Instrumented B-tree-style mock of LaxmiLensDB that accurately counts both query invocations
 * and scanned rows for indexed ranges vs full scans.
 */
class InstrumentedDexieDB {
  public accountsStore = new Map<string, LocalAccountRecord>();
  public transactionsStore = new Map<string, LocalTransactionRecord>();
  public categoriesStore = new Map<string, LocalCategoryRecord>();
  public budgetsStore = new Map<string, LocalBudgetRecord>();
  public outboxStore: LocalOutboxRecord[] = [];

  public metrics: QueryMetrics = {
    transactionQueries: [],
    categoryQueries: [],
    accountQueries: [],
    budgetQueries: [],
    outboxQueries: []
  };

  public resetMetrics(): void {
    this.metrics = {
      transactionQueries: [],
      categoryQueries: [],
      accountQueries: [],
      budgetQueries: [],
      outboxQueries: []
    };
  }

  public accounts = {
    get: vi.fn(async (id: string) => this.accountsStore.get(id) ?? null),
    put: vi.fn(async (record: LocalAccountRecord) => {
      this.accountsStore.set(record.id, { ...record });
      return record.id;
    }),
    bulkPut: vi.fn(async (records: LocalAccountRecord[]) => {
      records.forEach((r) => this.accountsStore.set(r.id, { ...r }));
    }),
    toArray: vi.fn(async () => {
      const all = Array.from(this.accountsStore.values());
      this.metrics.accountQueries.push({
        index: 'table',
        op: 'toArray',
        rowsScanned: all.length,
        rowsReturned: all.length
      });
      return all;
    }),
    where: vi.fn((index: string) => ({
      equals: (arg: string | [string, string]) => ({
        toArray: vi.fn(async () => {
          const all = Array.from(this.accountsStore.values());
          const matched =
            index === 'userId'
              ? all.filter((a) => a.userId === arg)
              : index === '[userId+id]' && Array.isArray(arg)
              ? all.filter((a) => a.userId === arg[0] && a.id === arg[1])
              : [];
          this.metrics.accountQueries.push({
            index,
            op: 'equals',
            rowsScanned: matched.length,
            rowsReturned: matched.length
          });
          return matched;
        }),
        first: vi.fn(async () => {
          if (index === '[userId+id]' && Array.isArray(arg)) {
            const rec = this.accountsStore.get(arg[1]);
            const matched = rec && rec.userId === arg[0] ? rec : undefined;
            this.metrics.accountQueries.push({
              index,
              op: 'first',
              rowsScanned: matched ? 1 : 0,
              rowsReturned: matched ? 1 : 0
            });
            return matched;
          }
          return undefined;
        })
      })
    }))
  };

  public transactions = {
    get: vi.fn(async (id: string) => this.transactionsStore.get(id) ?? null),
    put: vi.fn(async (record: LocalTransactionRecord) => {
      this.transactionsStore.set(record.id, { ...record });
      return record.id;
    }),
    bulkPut: vi.fn(async (records: LocalTransactionRecord[]) => {
      records.forEach((r) => this.transactionsStore.set(r.id, { ...r }));
    }),
    update: vi.fn(async (id: string, changes: Partial<LocalTransactionRecord>) => {
      const existing = this.transactionsStore.get(id);
      if (!existing) return 0;
      this.transactionsStore.set(id, { ...existing, ...changes });
      return 1;
    }),
    toArray: vi.fn(async () => {
      const all = Array.from(this.transactionsStore.values());
      this.metrics.transactionQueries.push({
        index: 'table',
        op: 'toArray',
        rowsScanned: all.length,
        rowsReturned: all.length
      });
      return all;
    }),
    where: vi.fn((index: string) => ({
      equals: (arg: string | [string, string]) => ({
        toArray: vi.fn(async () => {
          const all = Array.from(this.transactionsStore.values());
          let matched: LocalTransactionRecord[] = [];
          if (index === 'userId') {
            matched = all.filter((t) => t.userId === arg);
          } else if (index === '[userId+accountId]' && Array.isArray(arg)) {
            matched = all.filter((t) => t.userId === arg[0] && t.accountId === arg[1]);
          } else if (index === 'destinationAccountId') {
            matched = all.filter(
              (t) => t.destinationAccountId === arg || t.targetAccountId === arg
            );
          } else if (index === 'idempotencyKey') {
            matched = all.filter((t) => t.idempotencyKey === arg);
          }
          // Simulates indexed lookup scanning only matched index entries
          this.metrics.transactionQueries.push({
            index,
            op: 'equals',
            rowsScanned: matched.length,
            rowsReturned: matched.length
          });
          return matched;
        }),
        first: vi.fn(async () => {
          const all = Array.from(this.transactionsStore.values());
          let matched: LocalTransactionRecord | undefined;
          if (index === '[userId+id]' && Array.isArray(arg)) {
            const candidate = this.transactionsStore.get(arg[1]);
            matched = candidate && candidate.userId === arg[0] ? candidate : undefined;
          } else if (index === 'idempotencyKey') {
            matched = all.find((t) => t.idempotencyKey === arg);
          }
          this.metrics.transactionQueries.push({
            index,
            op: 'first',
            rowsScanned: matched ? 1 : 0,
            rowsReturned: matched ? 1 : 0
          });
          return matched;
        })
      }),
      between: (
        lower: [string, string],
        upper: [string, string],
        includeLower = true,
        includeUpper = true
      ) => ({
        toArray: vi.fn(async () => {
          const all = Array.from(this.transactionsStore.values());
          let matched: LocalTransactionRecord[] = [];
          if (index === '[userId+transactionDate]') {
            const targetUserId = lower[0];
            matched = all.filter((t) => {
              if (t.userId !== targetUserId) return false;
              const dt = t.transactionDate || '';
              const afterLower = includeLower ? dt >= lower[1] : dt > lower[1];
              const beforeUpper = includeUpper ? dt <= upper[1] : dt < upper[1];
              return afterLower && beforeUpper;
            });
          } else if (index === '[accountId+transactionDate]') {
            const targetAccId = lower[0];
            matched = all.filter((t) => {
              if (t.accountId !== targetAccId) return false;
              const dt = t.transactionDate || '';
              const afterLower = includeLower ? dt >= lower[1] : dt > lower[1];
              const beforeUpper = includeUpper ? dt <= upper[1] : dt < upper[1];
              return afterLower && beforeUpper;
            });
          }
          // Compound B-tree index range scan visits only matching keys within [lower, upper]
          this.metrics.transactionQueries.push({
            index,
            op: 'between',
            rowsScanned: matched.length,
            rowsReturned: matched.length
          });
          return matched;
        })
      })
    }))
  };

  public categories = {
    get: vi.fn(async (id: string) => this.categoriesStore.get(id) ?? null),
    put: vi.fn(async (record: LocalCategoryRecord) => {
      this.categoriesStore.set(record.id, { ...record });
      return record.id;
    }),
    bulkPut: vi.fn(async (records: LocalCategoryRecord[]) => {
      records.forEach((r) => this.categoriesStore.set(r.id, { ...r }));
    }),
    update: vi.fn(async (id: string, changes: Partial<LocalCategoryRecord>) => {
      const existing = this.categoriesStore.get(id);
      if (!existing) return 0;
      this.categoriesStore.set(id, { ...existing, ...changes });
      return 1;
    }),
    toArray: vi.fn(async () => {
      const all = Array.from(this.categoriesStore.values());
      this.metrics.categoryQueries.push({
        index: 'table',
        op: 'toArray',
        rowsScanned: all.length,
        rowsReturned: all.length
      });
      return all;
    }),
    filter: vi.fn((predicate: (c: LocalCategoryRecord) => boolean) => ({
      toArray: vi.fn(async () => {
        const all = Array.from(this.categoriesStore.values());
        const matched = all.filter(predicate);
        this.metrics.categoryQueries.push({
          index: 'full-scan',
          op: 'filter',
          rowsScanned: all.length,
          rowsReturned: matched.length
        });
        return matched;
      })
    })),
    where: vi.fn((index: string) => ({
      equals: (val: string) => ({
        toArray: vi.fn(async () => {
          const all = Array.from(this.categoriesStore.values());
          const matched = index === 'userId' ? all.filter((c) => c.userId === val) : [];
          this.metrics.categoryQueries.push({
            index,
            op: 'equals',
            rowsScanned: matched.length,
            rowsReturned: matched.length
          });
          return matched;
        })
      }),
      anyOf: (vals: string[]) => ({
        toArray: vi.fn(async () => {
          const keySet = new Set(vals);
          const all = Array.from(this.categoriesStore.values());
          const matched = index === 'userId' ? all.filter((c) => keySet.has(c.userId)) : [];
          this.metrics.categoryQueries.push({
            index,
            op: 'anyOf',
            rowsScanned: matched.length,
            rowsReturned: matched.length
          });
          return matched;
        })
      })
    }))
  };

  public budgets = {
    get: vi.fn(async (id: string) => this.budgetsStore.get(id) ?? null),
    put: vi.fn(async (record: LocalBudgetRecord) => {
      this.budgetsStore.set(record.id, { ...record });
      return record.id;
    }),
    delete: vi.fn(async (id: string) => {
      this.budgetsStore.delete(id);
    }),
    toArray: vi.fn(async () => Array.from(this.budgetsStore.values())),
    where: vi.fn((index: string) => ({
      equals: (arg: string | [string, string] | [string, string, string]) => ({
        toArray: vi.fn(async () => {
          const all = Array.from(this.budgetsStore.values());
          let matched: LocalBudgetRecord[] = [];
          if (index === '[userId+period]' && Array.isArray(arg)) {
            matched = all.filter((b) => b.userId === arg[0] && b.period === arg[1]);
          } else if (index === '[userId+categoryId+period]' && Array.isArray(arg)) {
            matched = all.filter(
              (b) => b.userId === arg[0] && b.categoryId === arg[1] && b.period === arg[2]
            );
          }
          this.metrics.budgetQueries.push({
            index,
            op: 'equals',
            rowsScanned: matched.length,
            rowsReturned: matched.length
          });
          return matched;
        }),
        first: vi.fn(async () => {
          const all = Array.from(this.budgetsStore.values());
          if (index === '[userId+id]' && Array.isArray(arg)) {
            const candidate = this.budgetsStore.get(arg[1]);
            return candidate && candidate.userId === arg[0] ? candidate : undefined;
          }
          if (index === '[userId+categoryId+period]' && Array.isArray(arg)) {
            return all.find(
              (b) => b.userId === arg[0] && b.categoryId === arg[1] && b.period === arg[2]
            );
          }
          return undefined;
        })
      })
    }))
  };

  public notifications = {
    get: vi.fn(async () => null),
    where: vi.fn(() => ({
      equals: () => ({ toArray: vi.fn(async () => []), first: vi.fn(async () => undefined) })
    }))
  };

  public syncOutbox = {
    add: vi.fn(async (record: LocalOutboxRecord) => {
      const saved = { ...record, id: this.outboxStore.length + 1 };
      this.outboxStore.push(saved);
      return saved.id;
    }),
    get: vi.fn(async (id: number) => this.outboxStore.find((o) => o.id === id) ?? null),
    where: vi.fn((index: string) => ({
      equals: (val: string) => ({
        count: vi.fn(async () => {
          const matched = this.outboxStore.filter((o) => o.userId === val);
          this.metrics.outboxQueries.push({
            index,
            op: 'count',
            rowsScanned: matched.length,
            rowsReturned: 1
          });
          return matched.length;
        }),
        toArray: vi.fn(async () => {
          const matched = this.outboxStore.filter((o) => o.userId === val);
          this.metrics.outboxQueries.push({
            index,
            op: 'equals',
            rowsScanned: matched.length,
            rowsReturned: matched.length
          });
          return matched;
        })
      }),
      between: (lower: [string, unknown]) => ({
        limit: (lim: number) => ({
          toArray: vi.fn(async () => {
            const matched = this.outboxStore.filter((o) => o.userId === lower[0]).slice(0, lim);
            this.metrics.outboxQueries.push({
              index,
              op: 'between+limit',
              rowsScanned: matched.length,
              rowsReturned: matched.length
            });
            return matched;
          })
        }),
        toArray: vi.fn(async () => {
          const matched = this.outboxStore.filter((o) => o.userId === lower[0]);
          this.metrics.outboxQueries.push({
            index,
            op: 'between',
            rowsScanned: matched.length,
            rowsReturned: matched.length
          });
          return matched;
        })
      })
    }))
  };

  public transaction = vi.fn(
    async (_mode: string, _tables: unknown[], work: () => Promise<unknown>) => await work()
  );
}

describe('Phase 12 Stage 2B: IndexedDB Query Performance Optimization', () => {
  const userA = createUserId('11111111-1111-4111-8111-111111111111');
  const userB = createUserId('22222222-2222-4222-8222-222222222222');
  const NIL_UUID = '00000000-0000-0000-0000-000000000000';

  let mockDb: InstrumentedDexieDB;
  let accountRepo: DexieAccountRepository;
  let transactionRepo: DexieTransactionRepository;
  let categoryRepo: DexieCategoryRepository;
  let budgetRepo: DexieBudgetRepository;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockDb = new InstrumentedDexieDB();
    const castDb = mockDb as unknown as LaxmiLensDB;
    accountRepo = new DexieAccountRepository(castDb);
    transactionRepo = new DexieTransactionRepository(castDb);
    categoryRepo = new DexieCategoryRepository(castDb);
    budgetRepo = new DexieBudgetRepository(castDb);
  });

  afterEach(() => {
    globalQueryClient.clear();
    vi.restoreAllMocks();
  });

  describe('1. GetAccountsWithBalanceUseCase bulk retrieval', () => {
    it('replaces 1 + 2N findByAccount queries with 2 total queries while preserving exact balances across account types, transfers, deleted rows, and archiving', async () => {
      const accountSpecs = [
        { id: 'aaaa0000-0000-4000-8000-000000000001', name: 'Axis Bank', type: 'bank' as const, opening: 1000000, archived: false },
        { id: 'aaaa0000-0000-4000-8000-000000000002', name: 'Cash Wallet', type: 'cash' as const, opening: 250000, archived: false },
        { id: 'aaaa0000-0000-4000-8000-000000000003', name: 'HDFC Millennia CC', type: 'credit_card' as const, opening: -120000, archived: false },
        { id: 'aaaa0000-0000-4000-8000-000000000004', name: 'Paytm Wallet', type: 'wallet' as const, opening: 50000, archived: false },
        { id: 'aaaa0000-0000-4000-8000-000000000005', name: 'SBI Savings', type: 'savings' as const, opening: 750000, archived: false },
        { id: 'aaaa0000-0000-4000-8000-000000000006', name: 'Personal Borrowings', type: 'other' as const, opening: -300000, archived: false, systemTag: 'personal_borrowings' },
        { id: 'aaaa0000-0000-4000-8000-000000000007', name: 'Old Dormant Bank', type: 'bank' as const, opening: 10000, archived: true },
        { id: 'aaaa0000-0000-4000-8000-000000000008', name: 'Emergency Reserve', type: 'savings' as const, opening: 2000000, archived: false }
      ];

      const domainAccounts = accountSpecs.map(
        (s) =>
          new Account({
            id: createAccountId(s.id),
            userId: userA,
            name: s.name,
            accountType: s.type,
            openingBalancePaise: s.opening,
            currency: 'INR',
            isArchived: s.archived,
            systemTag: s.systemTag
          })
      );
      await accountRepo.saveBatch(domainAccounts);

      // Seed transactions for User A + a foreign transaction for User B
      const txs: Transaction[] = [
        new Transaction({
          id: createTransactionId('bbbb0000-0000-4000-8000-000000000001'),
          userId: userA,
          type: 'income',
          amountPaise: 500000, // +₹5,000 -> Axis = 1,500,000
          currency: 'INR',
          accountId: domainAccounts[0].id,
          title: 'Salary Bonus',
          transactionDate: new Date('2026-11-05T10:00:00.000Z'),
          idempotencyKey: 'tx-1'
        }),
        new Transaction({
          id: createTransactionId('bbbb0000-0000-4000-8000-000000000002'),
          userId: userA,
          type: 'expense',
          amountPaise: 45075, // -₹450.75 -> HDFC CC = -165,075
          currency: 'INR',
          accountId: domainAccounts[2].id,
          title: 'Dining Bill',
          transactionDate: new Date('2026-11-06T20:00:00.000Z'),
          idempotencyKey: 'tx-2'
        }),
        new Transaction({
          id: createTransactionId('bbbb0000-0000-4000-8000-000000000003'),
          userId: userA,
          type: 'transfer',
          amountPaise: 200000, // -₹2,000 Axis (1,300,000), +₹2,000 Cash Wallet (450,000)
          currency: 'INR',
          accountId: domainAccounts[0].id,
          destinationAccountId: domainAccounts[1].id,
          title: 'ATM Withdrawal',
          transactionDate: new Date('2026-11-07T09:00:00.000Z'),
          idempotencyKey: 'tx-3'
        }),
        new Transaction({
          id: createTransactionId('bbbb0000-0000-4000-8000-000000000004'),
          userId: userA,
          type: 'transfer',
          amountPaise: 100000, // Borrowings repayment: -₹1,000 SBI (650,000), +₹1,000 Personal Borrowings (-200,000)
          currency: 'INR',
          accountId: domainAccounts[4].id,
          destinationAccountId: domainAccounts[5].id,
          title: 'Repay Loan',
          transactionDate: new Date('2026-11-08T12:00:00.000Z'),
          idempotencyKey: 'tx-4'
        }),
        new Transaction({
          id: createTransactionId('bbbb0000-0000-4000-8000-000000000005'),
          userId: userA,
          type: 'expense',
          amountPaise: 999999,
          currency: 'INR',
          accountId: domainAccounts[3].id,
          title: 'Soft Deleted Expense',
          transactionDate: new Date('2026-11-09T12:00:00.000Z'),
          deletedAt: new Date('2026-11-10T12:00:00.000Z'),
          idempotencyKey: 'tx-5'
        }),
        new Transaction({
          id: createTransactionId('bbbb0000-0000-4000-8000-000000000006'),
          userId: userB,
          type: 'income',
          amountPaise: 8888888,
          currency: 'INR',
          accountId: createAccountId('cccc0000-0000-4000-8000-000000000099'),
          title: 'User B Income',
          transactionDate: new Date('2026-11-09T12:00:00.000Z'),
          idempotencyKey: 'tx-6'
        })
      ];
      await transactionRepo.saveBatch(txs);

      mockDb.resetMetrics();

      const findByAccountSpy = vi.spyOn(transactionRepo, 'findByAccount');
      const findManySpy = vi.spyOn(transactionRepo, 'findMany');

      const useCase = new GetAccountsWithBalanceUseCase(accountRepo, transactionRepo);
      const result = await useCase.execute(userA, true);

      // Query count reduction: 1 account query + 1 transaction query = 2 total (vs 1 + 2*8 = 17 prior)
      expect(findByAccountSpy).not.toHaveBeenCalled();
      expect(findManySpy).toHaveBeenCalledTimes(1);
      expect(mockDb.metrics.accountQueries).toHaveLength(1);
      expect(mockDb.metrics.transactionQueries).toHaveLength(1);
      expect(
        mockDb.metrics.accountQueries.length + mockDb.metrics.transactionQueries.length
      ).toBe(2);

      // Verify every account balance matches LedgerRules.calculateAccountBalance
      const byId = new Map(result.map((r) => [r.id, r]));
      expect(byId.get(domainAccounts[0].id)?.currentBalancePaise).toBe(1300000);
      expect(byId.get(domainAccounts[1].id)?.currentBalancePaise).toBe(450000);
      expect(byId.get(domainAccounts[2].id)?.currentBalancePaise).toBe(-165075);
      expect(byId.get(domainAccounts[2].id)?.isCreditCard).toBe(true);
      expect(byId.get(domainAccounts[3].id)?.currentBalancePaise).toBe(50000);
      expect(byId.get(domainAccounts[4].id)?.currentBalancePaise).toBe(650000);
      expect(byId.get(domainAccounts[5].id)?.currentBalancePaise).toBe(-200000);
      expect(byId.get(domainAccounts[5].id)?.systemTag).toBe('personal_borrowings');
      expect(byId.get(domainAccounts[6].id)?.currentBalancePaise).toBe(10000);
      expect(byId.get(domainAccounts[7].id)?.currentBalancePaise).toBe(2000000);

      for (const acc of domainAccounts) {
        const expected = LedgerRules.calculateAccountBalance(acc.openingBalance, acc.id, txs);
        expect(byId.get(acc.id)?.currentBalancePaise).toBe(expected.paise);
      }

      // Sorting: active accounts alphabetically, archived last
      expect(result[result.length - 1].isArchived).toBe(true);
      expect(result[result.length - 1].id).toBe(domainAccounts[6].id);

      // includeArchived=false omits archived account cleanly
      const activeOnly = await useCase.execute(userA, false);
      expect(activeOnly).toHaveLength(7);
      expect(activeOnly.some((a) => a.id === domainAccounts[6].id)).toBe(false);
    });

    it('short-circuits with 1 query when user has zero accounts', async () => {
      const findManySpy = vi.spyOn(transactionRepo, 'findMany');
      const useCase = new GetAccountsWithBalanceUseCase(accountRepo, transactionRepo);

      const result = await useCase.execute(userA, true);
      expect(result).toEqual([]);
      expect(mockDb.metrics.accountQueries).toHaveLength(1);
      expect(findManySpy).not.toHaveBeenCalled();
      expect(mockDb.metrics.transactionQueries).toHaveLength(0);
    });
  });

  describe('2. DexieTransactionRepository.findMany compound index & date boundaries', () => {
    it('uses [userId+transactionDate] compound index to scan only bounded rows across multi-month dataset while preserving precision and tenant isolation', async () => {
      const accA1 = createAccountId('aaaa0000-0000-4000-8000-000000000011');
      const accA2 = createAccountId('aaaa0000-0000-4000-8000-000000000012');
      const accB1 = createAccountId('bbbb0000-0000-4000-8000-000000000021');
      const catFood = createCategoryId('cccc0000-0000-4000-8000-000000000001');

      const records: LocalTransactionRecord[] = [];
      // Generate 1,200 transactions across 24 months (50/month) for userA + 200 for userB
      for (let m = 0; m < 24; m++) {
        const year = 2025 + Math.floor(m / 12);
        const month = (m % 12) + 1;
        for (let d = 1; d <= 25; d++) {
          const iso = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}T12:00:00.000Z`;
          records.push({
            id: `tx-a-${m}-${d}-1`,
            userId: userA,
            type: 'expense',
            amountPaise: 10000,
            currency: 'INR',
            accountId: accA1,
            categoryId: catFood,
            title: `User A Expense ${m}-${d}`,
            transactionDate: iso,
            deletedAt: null,
            version: 1,
            idempotencyKey: `k-a-${m}-${d}-1`,
            createdAt: iso,
            updatedAt: iso
          });
          records.push({
            id: `tx-a-${m}-${d}-2`,
            userId: userA,
            type: 'income',
            amountPaise: 20000,
            currency: 'INR',
            accountId: accA2,
            title: `User A Income ${m}-${d}`,
            transactionDate: iso,
            deletedAt: null,
            version: 1,
            idempotencyKey: `k-a-${m}-${d}-2`,
            createdAt: iso,
            updatedAt: iso
          });
        }
      }

      // Add User B transactions inside target range 2026-06 (must never leak)
      for (let i = 0; i < 10; i++) {
        const iso = `2026-06-${String(i + 2).padStart(2, '0')}T10:00:00.000Z`;
        records.push({
          id: `tx-b-${i}`,
          userId: userB,
          type: 'expense',
          amountPaise: 50000,
          currency: 'INR',
          accountId: accB1,
          categoryId: catFood,
          title: `User B Confidential ${i}`,
          transactionDate: iso,
          deletedAt: null,
          version: 1,
          idempotencyKey: `k-b-${i}`,
          createdAt: iso,
          updatedAt: iso
        });
      }

      // Boundary records for 2026-06 UTC range
      records.push(
        {
          id: 'tx-boundary-before',
          userId: userA,
          type: 'expense',
          amountPaise: 111,
          currency: 'INR',
          accountId: accA1,
          categoryId: catFood,
          title: 'May Last Ms',
          transactionDate: '2026-05-31T23:59:59.999Z',
          deletedAt: null,
          version: 1,
          idempotencyKey: 'k-before',
          createdAt: '2026-05-31T23:59:59.999Z',
          updatedAt: '2026-05-31T23:59:59.999Z'
        },
        {
          id: 'tx-boundary-date-only',
          userId: userA,
          type: 'expense',
          amountPaise: 222,
          currency: 'INR',
          accountId: accA1,
          categoryId: catFood,
          title: 'Date Only Start',
          transactionDate: '2026-06-01',
          deletedAt: null,
          version: 1,
          idempotencyKey: 'k-date-only',
          createdAt: '2026-06-01T00:00:00.000Z',
          updatedAt: '2026-06-01T00:00:00.000Z'
        },
        {
          id: 'tx-boundary-start-utc',
          userId: userA,
          type: 'expense',
          amountPaise: 333,
          currency: 'INR',
          accountId: accA1,
          categoryId: catFood,
          title: 'June First Ms',
          transactionDate: '2026-06-01T00:00:00.000Z',
          deletedAt: null,
          version: 1,
          idempotencyKey: 'k-start',
          createdAt: '2026-06-01T00:00:00.000Z',
          updatedAt: '2026-06-01T00:00:00.000Z'
        },
        {
          id: 'tx-boundary-end-utc',
          userId: userA,
          type: 'expense',
          amountPaise: 444,
          currency: 'INR',
          accountId: accA1,
          categoryId: catFood,
          title: 'June Last Ms',
          transactionDate: '2026-06-30T23:59:59.999Z',
          deletedAt: null,
          version: 1,
          idempotencyKey: 'k-end',
          createdAt: '2026-06-30T23:59:59.999Z',
          updatedAt: '2026-06-30T23:59:59.999Z'
        },
        {
          id: 'tx-boundary-after',
          userId: userA,
          type: 'expense',
          amountPaise: 555,
          currency: 'INR',
          accountId: accA1,
          categoryId: catFood,
          title: 'July First Ms',
          transactionDate: '2026-07-01T00:00:00.000Z',
          deletedAt: null,
          version: 1,
          idempotencyKey: 'k-after',
          createdAt: '2026-07-01T00:00:00.000Z',
          updatedAt: '2026-07-01T00:00:00.000Z'
        },
        {
          id: 'tx-transfer-in-range',
          userId: userA,
          type: 'transfer',
          amountPaise: 77700,
          currency: 'INR',
          accountId: accA2,
          destinationAccountId: accA1,
          title: 'Transfer Into A1',
          transactionDate: '2026-06-15T15:00:00.000Z',
          deletedAt: null,
          version: 1,
          idempotencyKey: 'k-transfer',
          createdAt: '2026-06-15T15:00:00.000Z',
          updatedAt: '2026-06-15T15:00:00.000Z'
        }
      );

      for (const r of records) {
        mockDb.transactionsStore.set(r.id, r);
      }

      mockDb.resetMetrics();

      const juneUtcRange = new DateRange(
        new Date('2026-06-01T00:00:00.000Z'),
        new Date('2026-06-30T23:59:59.999Z')
      );

      const expensesInJune = await transactionRepo.findMany({
        userId: userA,
        dateRange: juneUtcRange,
        types: ['expense'],
        includeDeleted: false
      });

      // Verify compound index usage and drastic reduction in scanned rows (54 out of 1,216 total!)
      expect(mockDb.metrics.transactionQueries).toHaveLength(1);
      expect(mockDb.metrics.transactionQueries[0]).toMatchObject({
        index: '[userId+transactionDate]',
        op: 'between',
        rowsScanned: 54
      });

      const returnedIds = new Set(expensesInJune.map((t) => t.id));
      expect(returnedIds.has('tx-boundary-before')).toBe(false);
      expect(returnedIds.has('tx-boundary-after')).toBe(false);
      expect(returnedIds.has('tx-boundary-date-only')).toBe(true);
      expect(returnedIds.has('tx-boundary-start-utc')).toBe(true);
      expect(returnedIds.has('tx-boundary-end-utc')).toBe(true);
      expect(expensesInJune.every((t) => t.userId === userA && t.type === 'expense')).toBe(true);
      // 25 June User A expenses + 3 valid June boundaries = 28
      expect(expensesInJune).toHaveLength(28);

      // Account + dateRange query uses [accountId+transactionDate] for source + preserves incoming transfers
      mockDb.resetMetrics();
      const accA1June = await transactionRepo.findMany({
        userId: userA,
        accountId: accA1,
        dateRange: juneUtcRange,
        includeDeleted: false
      });
      expect(mockDb.metrics.transactionQueries[0].index).toBe('[accountId+transactionDate]');
      expect(accA1June.some((t) => t.id === 'tx-transfer-in-range')).toBe(true);
      expect(accA1June.some((t) => t.id === 'tx-b-0')).toBe(false);
    });

    it('coalesces concurrent identical reads cleanly while invalidating immediately on writes', async () => {
      await transactionRepo.save(
        new Transaction({
          id: createTransactionId('bbbb0000-0000-4000-8000-000000000051'),
          userId: userA,
          type: 'expense',
          amountPaise: 12000,
          currency: 'INR',
          accountId: createAccountId('aaaa0000-0000-4000-8000-000000000001'),
          title: 'Initial Coffee',
          transactionDate: new Date('2026-11-10T10:00:00.000Z'),
          idempotencyKey: 'k-coffee'
        })
      );

      mockDb.resetMetrics();
      const [r1, r2] = await Promise.all([
        transactionRepo.findMany({ userId: userA, includeDeleted: false }),
        transactionRepo.findMany({ userId: userA })
      ]);
      expect(mockDb.metrics.transactionQueries).toHaveLength(1);
      expect(r1).toHaveLength(1);
      expect(r2).toHaveLength(1);

      // Mutating via save clears coalesced state so next read fetches new row
      await transactionRepo.save(
        new Transaction({
          id: createTransactionId('bbbb0000-0000-4000-8000-000000000052'),
          userId: userA,
          type: 'income',
          amountPaise: 50000,
          currency: 'INR',
          accountId: createAccountId('aaaa0000-0000-4000-8000-000000000001'),
          title: 'Refund',
          transactionDate: new Date('2026-11-11T10:00:00.000Z'),
          idempotencyKey: 'k-refund'
        })
      );
      const afterWrite = await transactionRepo.findMany({ userId: userA, includeDeleted: false });
      expect(afterWrite).toHaveLength(2);
    });

    it('gracefully falls back when mock table does not implement .between', async () => {
      const legacyMockDb = {
        transactions: {
          where: vi.fn((index: string) => {
            if (index === 'userId') {
              return {
                equals: () => ({
                  toArray: async () => [
                    {
                      id: 'legacy-1',
                      userId: userA,
                      type: 'expense',
                      amountPaise: 5000,
                      currency: 'INR',
                      accountId: 'acc-1',
                      title: 'Inside',
                      transactionDate: '2026-11-10T12:00:00.000Z',
                      deletedAt: null,
                      version: 1,
                      idempotencyKey: 'k1',
                      createdAt: '2026-11-10T12:00:00.000Z',
                      updatedAt: '2026-11-10T12:00:00.000Z'
                    }
                  ]
                })
              };
            }
            return { equals: () => ({ toArray: async () => [] }) };
          })
        }
      } as unknown as LaxmiLensDB;

      const repo = new DexieTransactionRepository(legacyMockDb);
      const range = new DateRange(
        new Date('2026-11-01T00:00:00.000Z'),
        new Date('2026-11-30T23:59:59.999Z')
      );
      const res = await repo.findMany({ userId: userA, dateRange: range });
      expect(res).toHaveLength(1);
      expect(res[0].id).toBe('legacy-1');
    });
  });

  describe('3. DexieCategoryRepository.findByUserId indexed retrieval', () => {
    it('eliminates full-table .filter() scans while preserving user defaults, legacy NIL_UUID defaults, custom, archived categories, and strict tenant isolation', async () => {
      const records: LocalCategoryRecord[] = [
        {
          id: 'cat-userA-default',
          userId: userA,
          name: 'Salary & Wages',
          type: 'income',
          isDefault: true,
          isArchived: false,
          version: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        },
        {
          id: 'cat-userA-custom',
          userId: userA,
          name: 'Coffee Runs',
          type: 'expense',
          isDefault: false,
          isArchived: false,
          version: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        },
        {
          id: 'cat-userA-archived',
          userId: userA,
          name: 'Old Gym',
          type: 'expense',
          isDefault: false,
          isArchived: true,
          version: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        },
        {
          id: 'cat-legacy-nil-default',
          userId: NIL_UUID,
          name: 'Legacy Groceries',
          type: 'expense',
          isDefault: true,
          isSystem: true,
          isArchived: false,
          version: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        },
        {
          id: 'cat-legacy-empty-system',
          userId: '',
          name: 'Legacy Utilities',
          type: 'expense',
          isSystem: true,
          isArchived: false,
          version: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        },
        {
          // Malformed non-default record attached to NIL_UUID must NOT leak as default
          id: 'cat-nil-non-default',
          userId: NIL_UUID,
          name: 'Non-default Orphan',
          type: 'expense',
          isDefault: false,
          isSystem: false,
          isArchived: false,
          version: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        },
        {
          id: 'cat-userB-private',
          userId: userB,
          name: 'User B Secret',
          type: 'expense',
          isDefault: false,
          isArchived: false,
          version: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        },
        {
          id: 'cat-userB-default',
          userId: userB,
          name: 'User B Default',
          type: 'expense',
          isDefault: true,
          isArchived: false,
          version: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ];

      for (const r of records) {
        mockDb.categoriesStore.set(r.id, r);
      }

      mockDb.resetMetrics();

      const categoriesA = await categoryRepo.findByUserId(userA);
      const idsA = categoriesA.map((c) => c.id);

      // Zero full-table filter scans and single indexed anyOf query!
      expect(mockDb.categories.filter).not.toHaveBeenCalled();
      expect(mockDb.metrics.categoryQueries).toHaveLength(1);
      expect(mockDb.metrics.categoryQueries[0]).toMatchObject({
        index: 'userId',
        op: 'anyOf'
      });

      expect(idsA).toContain('cat-userA-default');
      expect(idsA).toContain('cat-userA-custom');
      expect(idsA).toContain('cat-userA-archived');
      expect(idsA).toContain('cat-legacy-nil-default');
      expect(idsA).toContain('cat-legacy-empty-system');
      expect(idsA).not.toContain('cat-nil-non-default');
      expect(idsA).not.toContain('cat-userB-private');
      expect(idsA).not.toContain('cat-userB-default');

      // Archived property preserved
      expect(categoriesA.find((c) => c.id === 'cat-userA-archived')?.isArchived).toBe(true);
    });

    it('coalesces concurrent findByUserId reads, invalidates on mutations, and supports legacy equals-only mocks', async () => {
      await categoryRepo.save(
        new Category({
          id: createCategoryId('cat-coalesce-1'),
          userId: userA,
          name: 'Transport',
          type: 'expense'
        })
      );

      mockDb.resetMetrics();
      const [c1, c2, c3] = await Promise.all([
        categoryRepo.findByUserId(userA),
        categoryRepo.findByUserId(userA),
        categoryRepo.findAll(userA)
      ]);

      expect(mockDb.metrics.categoryQueries).toHaveLength(1);
      expect(c1).toHaveLength(1);
      expect(c2).toHaveLength(1);
      expect(c3).toHaveLength(1);

      await categoryRepo.save(
        new Category({
          id: createCategoryId('cat-coalesce-2'),
          userId: userA,
          name: 'Freelance',
          type: 'income'
        })
      );
      const afterSave = await categoryRepo.findByUserId(userA);
      expect(afterSave).toHaveLength(2);

      // Legacy mock without .anyOf still uses indexed .equals without calling .filter
      const equalsOnlyDb = {
        categories: {
          filter: vi.fn(() => ({ toArray: async () => [] })),
          where: vi.fn(() => ({
            equals: (val: string) => ({
              toArray: async () =>
                val === NIL_UUID
                  ? [
                      {
                        id: 'nil-cat',
                        userId: NIL_UUID,
                        name: 'Legacy Default',
                        type: 'expense',
                        isDefault: true,
                        isArchived: false,
                        version: 1,
                        createdAt: '2026-01-01T00:00:00.000Z',
                        updatedAt: '2026-01-01T00:00:00.000Z'
                      }
                    ]
                  : []
            })
          }))
        }
      } as unknown as LaxmiLensDB;

      const fallbackRepo = new DexieCategoryRepository(equalsOnlyDb);
      const fallbackCats = await fallbackRepo.findByUserId(userA);
      expect(fallbackCats.map((c) => c.id)).toEqual(['nil-cat']);
      expect((equalsOnlyDb.categories as any).filter).not.toHaveBeenCalled();
    });
  });

  describe('4. Dashboard / Budget / Outbox overlapping read reduction', () => {
    it('GetBudgetsOverviewUseCase skips transaction and category reads when no budgets exist for period', async () => {
      const overviewUseCase = new GetBudgetsOverviewUseCase(
        budgetRepo,
        transactionRepo,
        categoryRepo
      );

      const overview = await overviewUseCase.execute(userA, '2026-11');
      expect(overview.budgets).toEqual([]);
      expect(overview.summary.budgetCount).toBe(0);
      expect(mockDb.metrics.budgetQueries).toHaveLength(1);
      expect(mockDb.metrics.transactionQueries).toHaveLength(0);
      expect(mockDb.metrics.categoryQueries).toHaveLength(0);
    });

    it('GetBudgetsOverviewUseCase uses bounded [userId+transactionDate] read when budgets exist and calculates exact integer paise totals', async () => {
      const catId = createCategoryId('dddd0000-0000-4000-8000-000000000001');
      await categoryRepo.save(
        new Category({
          id: catId,
          userId: userA,
          name: 'Groceries',
          type: 'expense'
        })
      );
      await budgetRepo.save(
        new Budget({
          id: createBudgetId('eeee0000-0000-4000-8000-000000000001'),
          userId: userA,
          categoryId: catId,
          period: '2026-11',
          limitPaise: 500000
        })
      );
      await transactionRepo.saveBatch([
        new Transaction({
          id: createTransactionId('ffff0000-0000-4000-8000-000000000001'),
          userId: userA,
          type: 'expense',
          amountPaise: 125050,
          currency: 'INR',
          accountId: createAccountId('aaaa0000-0000-4000-8000-000000000001'),
          categoryId: catId,
          title: 'November Market',
          transactionDate: new Date(2026, 10, 12, 14, 0, 0),
          idempotencyKey: 'nov-1'
        }),
        new Transaction({
          id: createTransactionId('ffff0000-0000-4000-8000-000000000002'),
          userId: userA,
          type: 'expense',
          amountPaise: 999999,
          currency: 'INR',
          accountId: createAccountId('aaaa0000-0000-4000-8000-000000000001'),
          categoryId: catId,
          title: 'October Market',
          transactionDate: new Date(2026, 9, 12, 14, 0, 0),
          idempotencyKey: 'oct-1'
        })
      ]);

      mockDb.resetMetrics();

      const overviewUseCase = new GetBudgetsOverviewUseCase(
        budgetRepo,
        transactionRepo,
        categoryRepo
      );
      const overview = await overviewUseCase.execute(userA, '2026-11');

      expect(overview.summary.totalSpentPaise).toBe(125050);
      expect(overview.summary.totalRemainingPaise).toBe(374950);
      expect(mockDb.metrics.transactionQueries).toHaveLength(1);
      expect(mockDb.metrics.transactionQueries[0]).toMatchObject({
        index: '[userId+transactionDate]',
        op: 'between',
        rowsScanned: 1
      });
    });

    it('skips unused transaction/outbox reads in closed QuickAddModal and coalesces concurrent Dashboard hook queries across accounts, transactions, categories, budgets, and outbox', async () => {
      const qc = new QueryClient({
        defaultOptions: { queries: { retry: false } }
      });

      const accId = createAccountId('aaaa0000-0000-4000-8000-000000000077');
      const catId = createCategoryId('cccc0000-0000-4000-8000-000000000077');

      await accountRepo.save(
        new Account({
          id: accId,
          userId: userA,
          name: 'Main Bank',
          accountType: 'bank',
          openingBalancePaise: 100000
        })
      );
      await categoryRepo.save(
        new Category({
          id: catId,
          userId: userA,
          name: 'Bills',
          type: 'expense',
          isDefault: true
        })
      );
      await transactionRepo.save(
        new Transaction({
          id: createTransactionId('bbbb0000-0000-4000-8000-000000000077'),
          userId: userA,
          type: 'expense',
          amountPaise: 25000,
          currency: 'INR',
          accountId: accId,
          categoryId: catId,
          title: 'Fiber Internet',
          transactionDate: new Date(2026, 10, 10, 12, 0, 0),
          idempotencyKey: 'tx-opt-1'
        })
      );

      const outboxManager = new OutboxManager(mockDb as unknown as LaxmiLensDB);
      await outboxManager.enqueue({
        userId: userA,
        entity: 'transactions',
        entityId: 'bbbb0000-0000-4000-8000-000000000077',
        operation: 'INSERT',
        payload: { user_id: userA },
        idempotencyKey: 'out-1'
      });

      const notificationRepo = new DexieNotificationRepository(mockDb as unknown as LaxmiLensDB);
      const getPendingSpy = vi.spyOn(outboxManager, 'getPendingEntries');
      const txFindManySpy = vi.spyOn(transactionRepo, 'findMany');

      vi.spyOn(defaultDatabaseManager, 'getActiveRepositories').mockResolvedValue({
        accountRepo,
        transactionRepo,
        categoryRepo,
        budgetRepo,
        outboxManager,
        getAccountsUseCase: new GetAccountsWithBalanceUseCase(accountRepo, transactionRepo),
        getTransactionsUseCase: new GetTransactionsUseCase(transactionRepo),
        getBudgetsOverviewUseCase: new GetBudgetsOverviewUseCase(
          budgetRepo,
          transactionRepo,
          categoryRepo
        ),
        getNotificationsUseCase: new GetNotificationsUseCase(notificationRepo)
      } as any);

      const authValue: AuthContextType = {
        user: { id: userA, email: 'perf@laxmilens.app' },
        isLoading: false,
        isAuthenticated: true,
        signIn: vi.fn(),
        signUp: vi.fn(),
        signInWithGoogle: vi.fn(),
        signOut: vi.fn(),
        resetPassword: vi.fn(),
        updatePassword: vi.fn()
      };

      // 1. Standalone closed QuickAddModal executes zero transaction or outbox queries
      mockDb.resetMetrics();
      const closedModal = render(
        <AuthContext.Provider value={authValue}>
          <QueryClientProvider client={qc}>
            <QuickAddModal isOpen={false} onClose={() => {}} />
          </QueryClientProvider>
        </AuthContext.Provider>
      );
      await waitFor(() => {
        expect(mockDb.metrics.accountQueries.length).toBeGreaterThanOrEqual(1);
      });
      expect(txFindManySpy).toHaveBeenCalledTimes(1); // Only from useAccounts -> GetAccountsWithBalanceUseCase
      expect(getPendingSpy).not.toHaveBeenCalled();
      closedModal.unmount();

      // 2. Full Dashboard-style mount with all hooks concurrent (fresh QueryClient)
      const dashQc = new QueryClient({
        defaultOptions: { queries: { retry: false } }
      });
      mockDb.resetMetrics();
      getPendingSpy.mockClear();
      txFindManySpy.mockClear();

      const MultiHookDashboardHarness: React.FC = () => {
        const acc = useAccounts();
        const tx = useTransactions(dashQc);
        const cats = useCategories(dashQc);
        const budgets = useBudgets('2026-11', dashQc);
        const notif = useNotifications(undefined, dashQc);
        return (
          <div>
            <span data-testid="acc-bal">{acc.accounts[0]?.currentBalancePaise ?? -1}</span>
            <span data-testid="tx-count">{tx.transactions.length}</span>
            <span data-testid="cat-count">{cats.categories.length}</span>
            <span data-testid="budget-count">{budgets.budgets.length}</span>
            <span data-testid="tx-pending">{tx.pendingTxIdSet.size}</span>
            <span data-testid="budget-pending">{budgets.pendingBudgetIdSet.size}</span>
            <span data-testid="notif-pending">{notif.pendingNotificationIdSet.size}</span>
            <QuickAddModal isOpen={false} onClose={() => {}} />
          </div>
        );
      };

      const rendered = render(
        <AuthContext.Provider value={authValue}>
          <QueryClientProvider client={dashQc}>
            <MultiHookDashboardHarness />
          </QueryClientProvider>
        </AuthContext.Provider>
      );

      await waitFor(() => {
        expect(rendered.getByTestId('acc-bal').textContent).toBe('75000');
        expect(rendered.getByTestId('tx-count').textContent).toBe('1');
        expect(rendered.getByTestId('cat-count').textContent).toBe('1');
        expect(rendered.getByTestId('tx-pending').textContent).toBe('1');
      });

      // Concurrent hooks coalesce outbox reads (3 -> 1) and full user transaction reads (2 -> 1)!
      expect(getPendingSpy).toHaveBeenCalledTimes(1);
      expect(mockDb.metrics.transactionQueries).toHaveLength(1);
      expect(mockDb.metrics.categoryQueries).toHaveLength(1);
      expect(mockDb.metrics.accountQueries).toHaveLength(1);
      expect(mockDb.metrics.budgetQueries).toHaveLength(1);

      // Re-rendering stays served from 5m React Query cache without issuing additional DB queries
      rendered.rerender(
        <AuthContext.Provider value={authValue}>
          <QueryClientProvider client={dashQc}>
            <MultiHookDashboardHarness />
          </QueryClientProvider>
        </AuthContext.Provider>
      );
      expect(getPendingSpy).toHaveBeenCalledTimes(1);
      expect(mockDb.metrics.transactionQueries).toHaveLength(1);

      qc.clear();
      dashQc.clear();
    });
  });
});

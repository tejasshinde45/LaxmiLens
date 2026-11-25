import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GenerateFinancialReportUseCase } from '@/application';
import { AuthPort } from '@/application/ports/AuthPort';
import { AccountRepository } from '@/domain/repositories/AccountRepository';
import { CategoryRepository } from '@/domain/repositories/CategoryRepository';
import {
  TransactionFilter,
  TransactionRepository
} from '@/domain/repositories/TransactionRepository';
import { Account } from '@/domain/entities/Account';
import { Category } from '@/domain/entities/Category';
import { Transaction } from '@/domain/entities/Transaction';
import {
  InvalidUserIdError,
  UnauthorizedEntityAccessError
} from '@/domain/errors/DomainErrors';
import {
  AccountId,
  CategoryId,
  TransactionId,
  UserId,
  createAccountId,
  createCategoryId,
  createTransactionId,
  createUserId
} from '@/domain/value-objects/Identifiers';
import { DatabaseManager } from '@/infrastructure/database/local/DatabaseManager';
import { LaxmiLensDB } from '@/infrastructure/database/local/DexieDatabase';
import {
  LocalAccountRecord,
  LocalCategoryRecord,
  LocalTransactionRecord
} from '@/infrastructure/database/local/schema';

describe('GenerateFinancialReportUseCase & DI Wiring (Phase 10 Stage 2)', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const otherUserId = '22222222-2222-4222-8222-222222222222';
  const now = new Date(2026, 10, 25, 11, 30, 0);

  const accBankId = createAccountId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
  const accCashId = createAccountId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2');
  const foreignAccountId = createAccountId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9');

  const catSalaryId = createCategoryId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1');
  const catGroceriesId = createCategoryId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2');
  const catArchivedId = createCategoryId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3');
  const foreignCategoryId = createCategoryId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb9');

  let accountsStore: Account[];
  let transactionsStore: Transaction[];
  let categoriesStore: Category[];

  let accountRepo: AccountRepository;
  let transactionRepo: TransactionRepository;
  let categoryRepo: CategoryRepository;
  let useCase: GenerateFinancialReportUseCase;

  beforeEach(() => {
    accountsStore = [
      new Account({
        id: accBankId,
        userId: createUserId(userId),
        name: 'HDFC Bank',
        accountType: 'bank',
        openingBalancePaise: 500000 // ₹5,000.00
      }),
      new Account({
        id: accCashId,
        userId: createUserId(userId),
        name: 'Cash Wallet',
        accountType: 'cash',
        openingBalancePaise: 100000 // ₹1,000.00
      })
    ];

    categoriesStore = [
      new Category({
        id: catSalaryId,
        userId: createUserId(userId),
        name: 'Salary & Wages',
        type: 'income'
      }),
      new Category({
        id: catGroceriesId,
        userId: createUserId(userId),
        name: 'Groceries',
        type: 'expense'
      }),
      new Category({
        id: catArchivedId,
        userId: createUserId(userId),
        name: 'Legacy Subscriptions',
        type: 'expense',
        isArchived: true
      })
    ];

    transactionsStore = [
      new Transaction({
        id: createTransactionId('cccccccc-cccc-4ccc-8ccc-ccccccccccc1'),
        userId: createUserId(userId),
        type: 'income',
        amountPaise: 1000000, // ₹10,000.00
        accountId: accBankId,
        categoryId: catSalaryId,
        title: 'November Salary',
        transactionDate: new Date(2026, 10, 2, 10, 0, 0),
        createdAt: new Date(2026, 10, 2, 10, 0, 0),
        idempotencyKey: 'k-1'
      }),
      new Transaction({
        id: createTransactionId('cccccccc-cccc-4ccc-8ccc-ccccccccccc2'),
        userId: createUserId(userId),
        type: 'expense',
        amountPaise: 250000, // ₹2,500.00
        accountId: accBankId,
        categoryId: catGroceriesId,
        title: 'Weekly Market',
        note: 'Organic produce',
        transactionDate: new Date(2026, 10, 8, 12, 0, 0),
        createdAt: new Date(2026, 10, 8, 12, 0, 0),
        idempotencyKey: 'k-2'
      }),
      new Transaction({
        id: createTransactionId('cccccccc-cccc-4ccc-8ccc-ccccccccccc3'),
        userId: createUserId(userId),
        type: 'expense',
        amountPaise: 50000, // ₹500.00
        accountId: accCashId,
        categoryId: catArchivedId,
        title: 'Old Streaming Plan',
        transactionDate: new Date(2026, 10, 10, 14, 0, 0),
        createdAt: new Date(2026, 10, 10, 14, 0, 0),
        idempotencyKey: 'k-3'
      }),
      new Transaction({
        id: createTransactionId('cccccccc-cccc-4ccc-8ccc-ccccccccccc4'),
        userId: createUserId(userId),
        type: 'transfer',
        amountPaise: 150000, // ₹1,500.00
        accountId: accBankId,
        destinationAccountId: accCashId,
        title: 'ATM Withdrawal',
        transactionDate: new Date(2026, 10, 12, 16, 0, 0),
        createdAt: new Date(2026, 10, 12, 16, 0, 0),
        idempotencyKey: 'k-4'
      })
    ];

    accountRepo = {
      findById: vi.fn(async (id: AccountId, reqUserId: UserId) => {
        const found = accountsStore.find((a) => a.id === id);
        if (!found) return null;
        if (found.userId !== reqUserId) {
          throw new UnauthorizedEntityAccessError('Account', id);
        }
        return found;
      }),
      findByUserId: vi.fn(async (reqUserId: UserId) =>
        accountsStore.filter((a) => a.userId === reqUserId)
      ),
      findAll: vi.fn(async (reqUserId: UserId) =>
        accountsStore.filter((a) => a.userId === reqUserId)
      ),
      save: vi.fn(async () => {}),
      saveBatch: vi.fn(async () => {}),
      archive: vi.fn(async () => {}),
      restore: vi.fn(async () => {})
    };

    transactionRepo = {
      findById: vi.fn(async (id: TransactionId, reqUserId: UserId) => {
        const found = transactionsStore.find((t) => t.id === id);
        if (!found) return null;
        if (found.userId !== reqUserId) {
          throw new UnauthorizedEntityAccessError('Transaction', id);
        }
        return found;
      }),
      findByIdempotencyKey: vi.fn(async () => null),
      findByAccount: vi.fn(async (accountId: AccountId, reqUserId: UserId) =>
        transactionsStore.filter(
          (t) =>
            t.userId === reqUserId &&
            (t.accountId === accountId || t.destinationAccountId === accountId)
        )
      ),
      findMany: vi.fn(async (filter: TransactionFilter) =>
        transactionsStore.filter((t) => {
          if (t.userId !== filter.userId) return false;
          if (!filter.includeDeleted && t.isDeleted) return false;
          return true;
        })
      ),
      save: vi.fn(async () => {}),
      saveBatch: vi.fn(async () => {}),
      softDelete: vi.fn(async () => {})
    };

    categoryRepo = {
      findById: vi.fn(async (id: CategoryId, reqUserId: UserId) => {
        const found = categoriesStore.find((c) => c.id === id);
        if (!found) return null;
        if (found.userId !== reqUserId && !found.isDefault) {
          throw new UnauthorizedEntityAccessError('Category', id);
        }
        return found;
      }),
      findByUserId: vi.fn(async (reqUserId: UserId) =>
        categoriesStore.filter((c) => c.userId === reqUserId || c.isDefault)
      ),
      findAll: vi.fn(async (reqUserId: UserId) =>
        categoriesStore.filter((c) => c.userId === reqUserId || c.isDefault)
      ),
      save: vi.fn(async () => {}),
      saveBatch: vi.fn(async () => {}),
      archive: vi.fn(async () => {}),
      seedDefaults: vi.fn(async () => [])
    };

    useCase = new GenerateFinancialReportUseCase(accountRepo, transactionRepo, categoryRepo);
  });

  it('integrates repositories cleanly for Financial Summary, Account Statement, and Category Reports', async () => {
    const summary = await useCase.execute({
      userId,
      reportType: 'summary',
      filters: { preset: 'this_month' },
      now
    });

    expect(accountRepo.findByUserId).toHaveBeenCalledWith(userId);
    expect(transactionRepo.findMany).toHaveBeenCalledWith({
      userId,
      includeDeleted: false
    });
    expect(categoryRepo.findByUserId).toHaveBeenCalledWith(userId);

    expect(summary.reportType).toBe('summary');
    expect(summary.metrics.totalIncomePaise).toBe(1000000);
    expect(summary.metrics.totalExpensePaise).toBe(300000);
    expect(summary.metrics.netCashFlowPaise).toBe(700000);
    expect(summary.metrics.transferCount).toBe(1);

    const statement = await useCase.execute({
      userId,
      reportType: 'statement',
      filters: {
        preset: 'this_month',
        statementAccountId: accBankId
      },
      now
    });

    expect(statement.reportType).toBe('statement');
    expect(statement.account.name).toBe('HDFC Bank');
    expect(statement.balances.periodOpeningBalancePaise).toBe(500000);
    // ₹5,000 + ₹10,000 (salary) - ₹2,500 (groceries) - ₹1,500 (transfer out) = ₹11,000
    expect(statement.balances.periodClosingBalancePaise).toBe(1100000);
    expect(statement.entries).toHaveLength(3);

    const categoryReport = await useCase.execute({
      userId,
      reportType: 'category',
      filters: { preset: 'this_month' },
      now
    });

    expect(categoryReport.reportType).toBe('category');
    expect(categoryReport.incomeSummary.totalPaise).toBe(1000000);
    expect(categoryReport.expenseSummary.totalPaise).toBe(300000);
    expect(categoryReport.expenseSummary.archivedCategoryCount).toBe(1);
    expect(categoryReport.excludedTransferCount).toBe(1);
  });

  it('passes all report filter criteria accurately to the report engine', async () => {
    const filteredSummary = await useCase.execute({
      userId,
      reportType: 'summary',
      filters: {
        preset: 'custom',
        customRange: { startDate: '2026-11-01', endDate: '2026-11-30' },
        accountIds: [accCashId],
        categoryIds: [catArchivedId],
        includeArchivedCategories: true
      },
      now
    });

    expect(filteredSummary.metrics.totalExpensePaise).toBe(50000);
    expect(filteredSummary.metrics.totalIncomePaise).toBe(0);
    expect(filteredSummary.appliedFilters.accountIds).toEqual([accCashId]);
    expect(filteredSummary.appliedFilters.categoryIds).toEqual([catArchivedId]);

    const excludedArchived = await useCase.execute({
      userId,
      reportType: 'category',
      filters: {
        preset: 'this_month',
        includeArchivedCategories: false,
        searchQuery: 'MARKET'
      },
      now
    });

    expect(excludedArchived.expenseSummary.totalPaise).toBe(250000);
    expect(excludedArchived.expenseBreakdown).toHaveLength(1);
    expect(excludedArchived.expenseBreakdown[0].categoryId).toBe(catGroceriesId);
  });

  it('validates userId strictly before accessing repositories and rejects unsupported report types', async () => {
    await expect(
      useCase.execute({
        userId: 'not-a-valid-uuid',
        reportType: 'summary',
        filters: { preset: 'this_month' },
        now
      })
    ).rejects.toThrow(InvalidUserIdError);

    expect(accountRepo.findByUserId).not.toHaveBeenCalled();
    expect(transactionRepo.findMany).not.toHaveBeenCalled();
    expect(categoryRepo.findByUserId).not.toHaveBeenCalled();

    await expect(
      useCase.execute({
        userId,
        reportType: 'tax' as never,
        filters: { preset: 'this_month' },
        now
      })
    ).rejects.toThrow("Unsupported report type 'tax'.");
  });

  it('scopes queries strictly to the requested user and ignores other tenants in multi-user stores', async () => {
    accountsStore.push(
      new Account({
        id: foreignAccountId,
        userId: createUserId(otherUserId),
        name: 'Other User Account',
        accountType: 'bank',
        openingBalancePaise: 9999900
      })
    );
    categoriesStore.push(
      new Category({
        id: foreignCategoryId,
        userId: createUserId(otherUserId),
        name: 'Other Category',
        type: 'expense'
      })
    );
    transactionsStore.push(
      new Transaction({
        id: createTransactionId('cccccccc-cccc-4ccc-8ccc-ccccccccccc9'),
        userId: createUserId(otherUserId),
        type: 'expense',
        amountPaise: 9999900,
        accountId: foreignAccountId,
        categoryId: foreignCategoryId,
        title: 'Other Tenant Spend',
        transactionDate: new Date(2026, 10, 5, 10, 0, 0),
        idempotencyKey: 'k-other'
      })
    );

    const summary = await useCase.execute({
      userId,
      reportType: 'summary',
      filters: { preset: 'this_month' },
      now
    });

    expect(summary.metrics.totalExpensePaise).toBe(300000);
    expect(summary.metrics.totalIncomePaise).toBe(1000000);
  });

  it('rejects foreign-user accounts, transactions, and categories returned directly or referenced by ID', async () => {
    const foreignAccount = new Account({
      id: foreignAccountId,
      userId: createUserId(otherUserId),
      name: 'Foreign Bank',
      accountType: 'bank',
      openingBalancePaise: 10000
    });
    const foreignTx = new Transaction({
      id: createTransactionId('dddddddd-dddd-4ddd-8ddd-ddddddddddd9'),
      userId: createUserId(otherUserId),
      type: 'expense',
      amountPaise: 10000,
      accountId: foreignAccountId,
      title: 'Foreign Tx',
      transactionDate: new Date(2026, 10, 5, 10, 0, 0),
      idempotencyKey: 'k-foreign-tx'
    });
    const foreignCategory = new Category({
      id: foreignCategoryId,
      userId: createUserId(otherUserId),
      name: 'Foreign Cat',
      type: 'expense'
    });
    const forgedDefaultForeignCategory = new Category({
      id: createCategoryId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb8'),
      userId: createUserId(otherUserId),
      name: 'Forged Default Foreign Cat',
      type: 'expense',
      isDefault: true
    });

    // 1. Repository leaks foreign account
    vi.mocked(accountRepo.findByUserId).mockResolvedValueOnce([...accountsStore, foreignAccount]);
    await expect(
      useCase.execute({ userId, reportType: 'summary', filters: { preset: 'this_month' }, now })
    ).rejects.toThrow(UnauthorizedEntityAccessError);

    // 2. Repository leaks foreign transaction
    vi.mocked(transactionRepo.findMany).mockResolvedValueOnce([...transactionsStore, foreignTx]);
    await expect(
      useCase.execute({ userId, reportType: 'summary', filters: { preset: 'this_month' }, now })
    ).rejects.toThrow(UnauthorizedEntityAccessError);

    // 3. Repository leaks foreign custom category
    vi.mocked(categoryRepo.findByUserId).mockResolvedValueOnce([...categoriesStore, foreignCategory]);
    await expect(
      useCase.execute({ userId, reportType: 'category', filters: { preset: 'this_month' }, now })
    ).rejects.toThrow(UnauthorizedEntityAccessError);

    // 4. Repository leaks foreign category even if isDefault flag is true
    vi.mocked(categoryRepo.findByUserId).mockResolvedValueOnce([
      ...categoriesStore,
      forgedDefaultForeignCategory
    ]);
    await expect(
      useCase.execute({ userId, reportType: 'category', filters: { preset: 'this_month' }, now })
    ).rejects.toThrow(UnauthorizedEntityAccessError);

    // 5. Caller probes a foreign statementAccountId or foreign categoryId outside cached user lists
    accountsStore.push(foreignAccount);
    await expect(
      useCase.execute({
        userId,
        reportType: 'statement',
        filters: { preset: 'this_month', statementAccountId: foreignAccountId },
        now
      })
    ).rejects.toThrow(UnauthorizedEntityAccessError);

    categoriesStore.push(foreignCategory);
    await expect(
      useCase.execute({
        userId,
        reportType: 'category',
        filters: { preset: 'this_month', categoryIds: [foreignCategoryId] },
        now
      })
    ).rejects.toThrow(UnauthorizedEntityAccessError);
  });

  it('returns valid empty reports for empty datasets without errors', async () => {
    transactionsStore = [];
    categoriesStore = [];

    const summary = await useCase.execute({
      userId,
      reportType: 'summary',
      filters: { preset: 'this_month' },
      now
    });
    expect(summary.isEmpty).toBe(true);
    expect(summary.metrics.totalIncomePaise).toBe(0);
    expect(summary.metrics.savingsRatePercent).toBeNull();

    const statement = await useCase.execute({
      userId,
      reportType: 'statement',
      filters: { preset: 'this_month', statementAccountId: accBankId },
      now
    });
    expect(statement.isEmpty).toBe(true);
    expect(statement.balances.periodOpeningBalancePaise).toBe(500000);
    expect(statement.balances.periodClosingBalancePaise).toBe(500000);

    const categoryReport = await useCase.execute({
      userId,
      reportType: 'category',
      filters: { preset: 'this_month' },
      now
    });
    expect(categoryReport.isEmpty).toBe(true);
    expect(categoryReport.expenseBreakdown).toEqual([]);
    expect(categoryReport.incomeBreakdown).toEqual([]);
  });

  it('propagates repository errors cleanly instead of converting them into empty reports', async () => {
    vi.mocked(transactionRepo.findMany).mockRejectedValueOnce(new Error('IndexedDB read failure'));
    await expect(
      useCase.execute({ userId, reportType: 'summary', filters: { preset: 'this_month' }, now })
    ).rejects.toThrow('IndexedDB read failure');

    vi.mocked(accountRepo.findByUserId).mockRejectedValueOnce(new Error('Account store offline'));
    await expect(
      useCase.execute({
        userId,
        reportType: 'statement',
        filters: { preset: 'this_month', statementAccountId: accBankId },
        now
      })
    ).rejects.toThrow('Account store offline');

    vi.mocked(categoryRepo.findByUserId).mockRejectedValueOnce(new Error('Category query aborted'));
    await expect(
      useCase.execute({ userId, reportType: 'category', filters: { preset: 'this_month' }, now })
    ).rejects.toThrow('Category query aborted');
  });

  it('operates strictly read-only without mutating retrieved entities or invoking write methods', async () => {
    const txSnapshot = transactionsStore.map((t) => ({
      id: t.id,
      amountPaise: t.amountPaise,
      deletedAt: t.deletedAt
    }));
    const accSnapshot = accountsStore.map((a) => ({
      id: a.id,
      openingBalancePaise: a.openingBalancePaise
    }));
    const catSnapshot = categoriesStore.map((c) => ({
      id: c.id,
      name: c.name,
      isArchived: c.isArchived
    }));

    await useCase.execute({ userId, reportType: 'summary', filters: { preset: 'this_month' }, now });
    await useCase.execute({
      userId,
      reportType: 'statement',
      filters: { preset: 'this_month', statementAccountId: accBankId },
      now
    });
    await useCase.execute({ userId, reportType: 'category', filters: { preset: 'this_month' }, now });

    expect(accountRepo.save).not.toHaveBeenCalled();
    expect(accountRepo.saveBatch).not.toHaveBeenCalled();
    expect(accountRepo.archive).not.toHaveBeenCalled();
    expect(accountRepo.restore).not.toHaveBeenCalled();
    expect(transactionRepo.save).not.toHaveBeenCalled();
    expect(transactionRepo.saveBatch).not.toHaveBeenCalled();
    expect(transactionRepo.softDelete).not.toHaveBeenCalled();
    expect(categoryRepo.save).not.toHaveBeenCalled();
    expect(categoryRepo.saveBatch).not.toHaveBeenCalled();
    expect(categoryRepo.archive).not.toHaveBeenCalled();

    expect(
      transactionsStore.map((t) => ({
        id: t.id,
        amountPaise: t.amountPaise,
        deletedAt: t.deletedAt
      }))
    ).toEqual(txSnapshot);
    expect(
      accountsStore.map((a) => ({ id: a.id, openingBalancePaise: a.openingBalancePaise }))
    ).toEqual(accSnapshot);
    expect(
      categoriesStore.map((c) => ({ id: c.id, name: c.name, isArchived: c.isArchived }))
    ).toEqual(catSnapshot);
  });

  it('registers generateFinancialReportUseCase in DatabaseManager DI and reuses user-scoped repositories', async () => {
    const accountRecords = new Map<string, LocalAccountRecord>([
      [
        accBankId,
        {
          id: accBankId,
          userId,
          name: 'HDFC Bank',
          accountType: 'bank',
          openingBalancePaise: 500000,
          currency: 'INR',
          isArchived: false,
          version: 1,
          createdAt: '2026-11-01T00:00:00.000Z',
          updatedAt: '2026-11-01T00:00:00.000Z'
        }
      ]
    ]);
    const txRecords = new Map<string, LocalTransactionRecord>([
      [
        'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
        {
          id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
          userId,
          type: 'income',
          amountPaise: 1000000,
          currency: 'INR',
          accountId: accBankId,
          categoryId: catSalaryId,
          title: 'DI Verified Income',
          transactionDate: new Date(2026, 10, 5, 10, 0, 0).toISOString(),
          deletedAt: null,
          version: 1,
          idempotencyKey: 'di-k-1',
          createdAt: '2026-11-05T10:00:00.000Z',
          updatedAt: '2026-11-05T10:00:00.000Z'
        }
      ]
    ]);
    const categoryRecords = new Map<string, LocalCategoryRecord>([
      [
        catSalaryId,
        {
          id: catSalaryId,
          userId,
          name: 'Salary & Wages',
          type: 'income',
          isDefault: false,
          isArchived: false,
          version: 1,
          createdAt: '2026-11-01T00:00:00.000Z',
          updatedAt: '2026-11-01T00:00:00.000Z'
        }
      ]
    ]);

    let opened = false;
    const mockDb = {
      isOpen: () => opened,
      open: async () => {
        opened = true;
        return mockDb;
      },
      close: async () => {
        opened = false;
      },
      accounts: {
        get: async (id: string) => accountRecords.get(id) || null,
        where: (index: string) => ({
          equals: (val: unknown) => {
            if (index === 'userId') {
              return {
                toArray: async () =>
                  Array.from(accountRecords.values()).filter((a) => a.userId === val)
              };
            }
            if (index === '[userId+id]' && Array.isArray(val)) {
              const [uId, id] = val as [string, string];
              return {
                first: async () => {
                  const item = accountRecords.get(id);
                  return item && item.userId === uId ? item : null;
                }
              };
            }
            return { toArray: async () => [] };
          }
        })
      },
      transactions: {
        get: async (id: string) => txRecords.get(id) || null,
        where: (index: string) => ({
          equals: (val: unknown) => {
            if (index === 'userId') {
              return {
                toArray: async () =>
                  Array.from(txRecords.values()).filter((t) => t.userId === val)
              };
            }
            return { toArray: async () => [] };
          }
        })
      },
      categories: {
        get: async (id: string) => categoryRecords.get(id) || null,
        where: (index: string) => ({
          equals: (val: unknown) => {
            if (index === 'userId') {
              return {
                toArray: async () =>
                  Array.from(categoryRecords.values()).filter((c) => c.userId === val)
              };
            }
            return { toArray: async () => [] };
          }
        }),
        filter: (predicate: (c: LocalCategoryRecord) => boolean) => ({
          toArray: async () => Array.from(categoryRecords.values()).filter(predicate)
        })
      }
    } as unknown as LaxmiLensDB;

    const mockAuthPort: AuthPort = {
      getCurrentUser: async () => ({ id: userId, email: 'reports@laxmilens.local' })
    };

    const dbManager = new DatabaseManager(mockAuthPort, () => mockDb);
    const repos = await dbManager.getActiveRepositories();

    expect(repos.generateFinancialReportUseCase).toBeInstanceOf(
      GenerateFinancialReportUseCase
    );
    // Verify DI reuses the exact single repository instances created on UserRepositories
    expect((repos.generateFinancialReportUseCase as unknown as Record<string, unknown>).accountRepo).toBe(
      repos.accountRepo
    );
    expect((repos.generateFinancialReportUseCase as unknown as Record<string, unknown>).transactionRepo).toBe(
      repos.transactionRepo
    );
    expect((repos.generateFinancialReportUseCase as unknown as Record<string, unknown>).categoryRepo).toBe(
      repos.categoryRepo
    );

    const summary = await repos.generateFinancialReportUseCase.execute({
      userId,
      reportType: 'summary',
      filters: { preset: 'this_month' },
      now
    });

    expect(summary.metrics.totalIncomePaise).toBe(1000000);
    expect(summary.metrics.netCashFlowPaise).toBe(1000000);
  });
});

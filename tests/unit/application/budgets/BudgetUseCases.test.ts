import { describe, it, expect, beforeEach } from 'vitest';
import { CreateBudgetUseCase } from '@/application/use-cases/budgets/CreateBudgetUseCase';
import { UpdateBudgetUseCase } from '@/application/use-cases/budgets/UpdateBudgetUseCase';
import { DeleteBudgetUseCase } from '@/application/use-cases/budgets/DeleteBudgetUseCase';
import { GetBudgetsOverviewUseCase } from '@/application/use-cases/budgets/GetBudgetsOverviewUseCase';
import { CheckBudgetUseCase } from '@/application/use-cases/budgets/CheckBudgetUseCase';
import { BudgetRepository } from '@/domain/repositories/BudgetRepository';
import { CategoryRepository } from '@/domain/repositories/CategoryRepository';
import {
  TransactionRepository,
  TransactionFilter
} from '@/domain/repositories/TransactionRepository';
import { SyncPort, OutboxEntry, SyncResult } from '@/application/ports/SyncPort';
import { UnitOfWork } from '@/application/ports/UnitOfWork';
import { Budget } from '@/domain/entities/Budget';
import { Category } from '@/domain/entities/Category';
import { Transaction } from '@/domain/entities/Transaction';
import {
  BudgetId,
  CategoryId,
  TransactionId,
  AccountId,
  UserId,
  createBudgetId,
  createCategoryId,
  createTransactionId,
  createAccountId,
  createUserId
} from '@/domain/value-objects/Identifiers';
import {
  CategoryArchivedError,
  CategoryNotFoundError,
  CategoryTypeMismatchError,
  InvalidTransactionAmountError,
  InvalidUserIdError,
  UnauthorizedEntityAccessError
} from '@/domain/errors/DomainErrors';
import {
  BudgetNotFoundError,
  DuplicateBudgetError,
  InvalidBudgetLimitError,
  InvalidBudgetPeriodError
} from '@/domain/errors/BudgetErrors';

class InMemoryBudgetRepository implements BudgetRepository {
  public budgets = new Map<string, Budget>();

  async findById(id: BudgetId, userId: UserId): Promise<Budget | null> {
    const budget = this.budgets.get(id);
    if (!budget) return null;
    if (budget.userId !== userId) {
      throw new UnauthorizedEntityAccessError('Budget', id);
    }
    return budget;
  }

  async findByPeriod(period: string, userId: UserId): Promise<Budget[]> {
    return Array.from(this.budgets.values()).filter(
      (b) => b.userId === userId && b.period === period
    );
  }

  async findByCategoryAndPeriod(
    categoryId: CategoryId,
    period: string,
    userId: UserId
  ): Promise<Budget | null> {
    return (
      Array.from(this.budgets.values()).find(
        (b) =>
          b.userId === userId &&
          b.categoryId === categoryId &&
          b.period === period
      ) || null
    );
  }

  async save(budget: Budget): Promise<void> {
    const existingById = this.budgets.get(budget.id);
    if (existingById && existingById.userId !== budget.userId) {
      throw new UnauthorizedEntityAccessError('Budget', budget.id);
    }

    const duplicate = Array.from(this.budgets.values()).find(
      (b) =>
        b.userId === budget.userId &&
        b.categoryId === budget.categoryId &&
        b.period === budget.period &&
        b.id !== budget.id
    );
    if (duplicate) {
      throw new DuplicateBudgetError(budget.categoryId, budget.period);
    }

    this.budgets.set(budget.id, budget);
  }

  async delete(id: BudgetId, userId: UserId): Promise<void> {
    const existing = this.budgets.get(id);
    if (!existing) {
      throw new BudgetNotFoundError(id);
    }
    if (existing.userId !== userId) {
      throw new UnauthorizedEntityAccessError('Budget', id);
    }
    this.budgets.delete(id);
  }
}

class InMemoryCategoryRepository implements CategoryRepository {
  public categories = new Map<string, Category>();

  async findById(id: CategoryId, userId: UserId): Promise<Category | null> {
    const cat = this.categories.get(id);
    if (!cat) return null;
    if (cat.userId !== userId) {
      throw new UnauthorizedEntityAccessError('Category', id);
    }
    return cat;
  }

  async findByUserId(userId: UserId): Promise<Category[]> {
    return Array.from(this.categories.values()).filter((c) => c.userId === userId);
  }

  async findAll(userId: UserId): Promise<Category[]> {
    return this.findByUserId(userId);
  }

  async save(category: Category): Promise<void> {
    this.categories.set(category.id, category);
  }

  async saveBatch(categories: Category[]): Promise<void> {
    categories.forEach((c) => this.categories.set(c.id, c));
  }

  async archive(id: CategoryId, userId: UserId): Promise<void> {
    const cat = this.categories.get(id);
    if (cat && cat.userId === userId) {
      this.categories.set(
        id,
        new Category({
          id: cat.id,
          userId: cat.userId,
          name: cat.name,
          type: cat.type,
          icon: cat.icon,
          color: cat.color,
          isDefault: cat.isDefault,
          isArchived: true,
          version: cat.version + 1,
          createdAt: cat.createdAt,
          updatedAt: new Date()
        })
      );
    }
  }

  async seedDefaults(): Promise<Category[]> {
    return [];
  }
}

class InMemoryTransactionRepository implements TransactionRepository {
  public transactions = new Map<string, Transaction>();
  public lastFilter: TransactionFilter | null = null;
  public bypassFilterInTest = false;

  async findById(id: TransactionId, userId: UserId): Promise<Transaction | null> {
    const tx = this.transactions.get(id);
    if (!tx) return null;
    if (tx.userId !== userId) {
      throw new UnauthorizedEntityAccessError('Transaction', id);
    }
    return tx;
  }

  async findByIdempotencyKey(key: string, userId: UserId): Promise<Transaction | null> {
    return (
      Array.from(this.transactions.values()).find(
        (t) => t.idempotencyKey === key && t.userId === userId
      ) || null
    );
  }

  async findByAccount(accountId: AccountId, userId: UserId): Promise<Transaction[]> {
    return Array.from(this.transactions.values()).filter(
      (t) =>
        t.userId === userId &&
        (t.accountId === accountId || t.destinationAccountId === accountId)
    );
  }

  async findMany(filter: TransactionFilter): Promise<Transaction[]> {
    this.lastFilter = filter;
    if (this.bypassFilterInTest) {
      return Array.from(this.transactions.values());
    }

    let result = Array.from(this.transactions.values()).filter(
      (t) => t.userId === filter.userId
    );
    if (!filter.includeDeleted) {
      result = result.filter((t) => !t.isDeleted);
    }
    if (filter.categoryId) {
      result = result.filter((t) => t.categoryId === filter.categoryId);
    }
    if (filter.dateRange) {
      result = result.filter((t) => filter.dateRange!.contains(t.transactionDate));
    }
    if (filter.types && filter.types.length > 0) {
      result = result.filter((t) => filter.types!.includes(t.type));
    }
    return result;
  }

  async save(transaction: Transaction): Promise<void> {
    this.transactions.set(transaction.id, transaction);
  }

  async saveBatch(transactions: Transaction[]): Promise<void> {
    transactions.forEach((t) => this.transactions.set(t.id, t));
  }

  async softDelete(
    id: TransactionId,
    userId: UserId,
    deletedAt: Date = new Date(),
    version?: number
  ): Promise<void> {
    const tx = this.transactions.get(id);
    if (tx && tx.userId === userId) {
      this.transactions.set(id, tx.markDeleted(deletedAt, version));
    }
  }
}

class InMemorySyncPort implements SyncPort {
  public enqueued: Array<Omit<OutboxEntry, 'id' | 'attempts' | 'createdAt'>> = [];
  public failNextEnqueue = false;

  async enqueue(
    entry: Omit<OutboxEntry, 'id' | 'attempts' | 'createdAt'>
  ): Promise<void> {
    if (this.failNextEnqueue) {
      this.failNextEnqueue = false;
      throw new Error('Outbox write failed');
    }
    this.enqueued.push(entry);
  }

  async processOutbox(): Promise<SyncResult> {
    return { pushedCount: 0, pulledCount: 0, conflictsCount: 0, errors: [] };
  }

  async getPendingCount(userId: string): Promise<number> {
    return this.enqueued.filter((e) => e.userId === userId).length;
  }

  async clearOutbox(): Promise<void> {
    this.enqueued = [];
  }
}

class TransactionalMockUnitOfWork implements UnitOfWork {
  public runs = 0;

  constructor(private readonly budgetRepo: InMemoryBudgetRepository) {}

  async run<T>(work: () => Promise<T>): Promise<T> {
    this.runs++;
    const snapshot = new Map(this.budgetRepo.budgets);
    try {
      return await work();
    } catch (error) {
      // Simulate rollback of local persistence if transaction fails
      this.budgetRepo.budgets = snapshot;
      throw error;
    }
  }
}

describe('Phase 3: Budget Application Use Cases & Spending Aggregation', () => {
  const userA = createUserId('11111111-1111-4111-8111-111111111111');
  const userB = createUserId('22222222-2222-4222-8222-222222222222');

  const accountA = createAccountId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  const accountSavings = createAccountId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

  const groceriesCatId = createCategoryId('33333333-3333-4333-8333-333333333333');
  const diningCatId = createCategoryId('44444444-4444-4444-8444-444444444444');
  const salaryCatId = createCategoryId('55555555-5555-4555-8555-555555555555');
  const archivedCatId = createCategoryId('66666666-6666-4666-8666-666666666666');
  const userBCatId = createCategoryId('77777777-7777-4777-8777-777777777777');
  const unbudgetedCatId = createCategoryId('88888888-8888-4888-8888-888888888888');

  let budgetRepo: InMemoryBudgetRepository;
  let categoryRepo: InMemoryCategoryRepository;
  let transactionRepo: InMemoryTransactionRepository;
  let syncPort: InMemorySyncPort;
  let unitOfWork: TransactionalMockUnitOfWork;

  let createBudget: CreateBudgetUseCase;
  let updateBudget: UpdateBudgetUseCase;
  let deleteBudget: DeleteBudgetUseCase;
  let getOverview: GetBudgetsOverviewUseCase;
  let checkBudget: CheckBudgetUseCase;

  const makeExpense = (
    id: string,
    opts: {
      userId?: UserId;
      categoryId?: CategoryId;
      amountPaise: number;
      date: Date;
      deleted?: boolean;
      type?: 'expense' | 'income' | 'transfer';
      destinationAccountId?: AccountId;
    }
  ): Transaction => {
    const type = opts.type ?? 'expense';
    return new Transaction({
      id: createTransactionId(id),
      userId: opts.userId ?? userA,
      type,
      amountPaise: opts.amountPaise,
      accountId: accountA,
      destinationAccountId: type === 'transfer' ? opts.destinationAccountId ?? accountSavings : undefined,
      categoryId: opts.categoryId,
      title: `Tx ${id.slice(0, 4)}`,
      transactionDate: opts.date,
      deletedAt: opts.deleted ? new Date() : null,
      idempotencyKey: `idem-${id}`
    });
  };

  beforeEach(async () => {
    budgetRepo = new InMemoryBudgetRepository();
    categoryRepo = new InMemoryCategoryRepository();
    transactionRepo = new InMemoryTransactionRepository();
    syncPort = new InMemorySyncPort();
    unitOfWork = new TransactionalMockUnitOfWork(budgetRepo);

    createBudget = new CreateBudgetUseCase(budgetRepo, categoryRepo, syncPort, unitOfWork);
    updateBudget = new UpdateBudgetUseCase(budgetRepo, syncPort, unitOfWork);
    deleteBudget = new DeleteBudgetUseCase(budgetRepo, syncPort, unitOfWork);
    getOverview = new GetBudgetsOverviewUseCase(budgetRepo, transactionRepo, categoryRepo);
    checkBudget = new CheckBudgetUseCase(budgetRepo, transactionRepo);

    await categoryRepo.saveBatch([
      new Category({
        id: groceriesCatId,
        userId: userA,
        name: 'Groceries',
        type: 'expense',
        icon: 'ShoppingCart',
        color: '#D9827C'
      }),
      new Category({
        id: diningCatId,
        userId: userA,
        name: 'Dining Out',
        type: 'expense',
        icon: 'Utensils',
        color: '#D9827C'
      }),
      new Category({
        id: salaryCatId,
        userId: userA,
        name: 'Salary',
        type: 'income',
        icon: 'Briefcase',
        color: '#72B895'
      }),
      new Category({
        id: archivedCatId,
        userId: userA,
        name: 'Legacy Subscriptions',
        type: 'expense',
        isArchived: true
      }),
      new Category({
        id: userBCatId,
        userId: userB,
        name: 'User B Expenses',
        type: 'expense'
      }),
      new Category({
        id: unbudgetedCatId,
        userId: userA,
        name: 'Unbudgeted Miscellaneous',
        type: 'expense'
      })
    ]);
  });

  describe('1. CreateBudgetUseCase', () => {
    it('creates a valid monthly expense budget, persists locally, and enqueues outbox INSERT', async () => {
      const created = await createBudget.execute({
        userId: userA,
        categoryId: groceriesCatId,
        period: '2026-03',
        limitPaise: 500000 // ₹5,000.00
      });

      expect(created.userId).toBe(userA);
      expect(created.categoryId).toBe(groceriesCatId);
      expect(created.period).toBe('2026-03');
      expect(created.limitPaise).toBe(500000);
      expect(created.limitFormatted).toBe('₹5,000.00');
      expect(created.version).toBe(1);

      expect(unitOfWork.runs).toBe(1);
      const saved = await budgetRepo.findById(createBudgetId(created.id), userA);
      expect(saved).not.toBeNull();
      expect(saved?.limitPaise).toBe(500000);

      expect(syncPort.enqueued).toHaveLength(1);
      expect(syncPort.enqueued[0]).toMatchObject({
        userId: userA,
        entity: 'budgets',
        entityId: created.id,
        operation: 'INSERT',
        payload: {
          id: created.id,
          user_id: userA,
          category_id: groceriesCatId,
          period: '2026-03',
          limit_paise: 500000,
          version: 1
        }
      });
    });

    it('rolls back local budget persistence if outbox enqueue fails inside UnitOfWork', async () => {
      syncPort.failNextEnqueue = true;

      await expect(
        createBudget.execute({
          userId: userA,
          categoryId: groceriesCatId,
          period: '2026-03',
          limitPaise: 500000
        })
      ).rejects.toThrow('Outbox write failed');

      expect(budgetRepo.budgets.size).toBe(0);
      expect(syncPort.enqueued).toHaveLength(0);
    });

    it('rejects duplicate budgets for the same user, category, and period', async () => {
      await createBudget.execute({
        userId: userA,
        categoryId: groceriesCatId,
        period: '2026-03',
        limitPaise: 500000
      });

      await expect(
        createBudget.execute({
          userId: userA,
          categoryId: groceriesCatId,
          period: '2026-03',
          limitPaise: 600000
        })
      ).rejects.toThrow(DuplicateBudgetError);

      expect(budgetRepo.budgets.size).toBe(1);
      expect(syncPort.enqueued).toHaveLength(1);

      // Same category in a different month IS allowed
      await expect(
        createBudget.execute({
          userId: userA,
          categoryId: groceriesCatId,
          period: '2026-04',
          limitPaise: 600000
        })
      ).resolves.not.toThrow();
    });

    it('rejects income categories', async () => {
      await expect(
        createBudget.execute({
          userId: userA,
          categoryId: salaryCatId,
          period: '2026-03',
          limitPaise: 500000
        })
      ).rejects.toThrow(CategoryTypeMismatchError);

      expect(budgetRepo.budgets.size).toBe(0);
      expect(syncPort.enqueued).toHaveLength(0);
    });

    it('rejects archived expense categories', async () => {
      await expect(
        createBudget.execute({
          userId: userA,
          categoryId: archivedCatId,
          period: '2026-03',
          limitPaise: 250000
        })
      ).rejects.toThrow(CategoryArchivedError);

      expect(budgetRepo.budgets.size).toBe(0);
      expect(syncPort.enqueued).toHaveLength(0);
    });

    it('rejects missing categories and cross-user category access', async () => {
      const missingCatId = '99999999-9999-4999-8999-999999999999';
      await expect(
        createBudget.execute({
          userId: userA,
          categoryId: missingCatId,
          period: '2026-03',
          limitPaise: 300000
        })
      ).rejects.toThrow(CategoryNotFoundError);

      await expect(
        createBudget.execute({
          userId: userA,
          categoryId: userBCatId,
          period: '2026-03',
          limitPaise: 300000
        })
      ).rejects.toThrow(UnauthorizedEntityAccessError);

      expect(budgetRepo.budgets.size).toBe(0);
      expect(syncPort.enqueued).toHaveLength(0);
    });

    it('rejects invalid userId, invalid periods, and non-positive or fractional limitPaise', async () => {
      await expect(
        createBudget.execute({
          userId: 'not-a-uuid',
          categoryId: groceriesCatId,
          period: '2026-03',
          limitPaise: 10000
        })
      ).rejects.toThrow(InvalidUserIdError);

      await expect(
        createBudget.execute({
          userId: userA,
          categoryId: groceriesCatId,
          period: '2026-13',
          limitPaise: 10000
        })
      ).rejects.toThrow(InvalidBudgetPeriodError);

      for (const badLimit of [0, -100, 125.5, NaN]) {
        await expect(
          createBudget.execute({
            userId: userA,
            categoryId: groceriesCatId,
            period: '2026-03',
            limitPaise: badLimit
          })
        ).rejects.toThrow(InvalidBudgetLimitError);
      }
    });
  });

  describe('2. UpdateBudgetUseCase', () => {
    it('updates limit, increments version, preserves identity/category/period, and enqueues outbox UPDATE', async () => {
      const created = await createBudget.execute({
        userId: userA,
        categoryId: groceriesCatId,
        period: '2026-03',
        limitPaise: 400000
      });

      const updated = await updateBudget.execute({
        id: created.id,
        userId: userA,
        limitPaise: 550000
      });

      expect(updated.id).toBe(created.id);
      expect(updated.userId).toBe(userA);
      expect(updated.categoryId).toBe(groceriesCatId);
      expect(updated.period).toBe('2026-03');
      expect(updated.limitPaise).toBe(550000);
      expect(updated.version).toBe(2);
      expect(updated.createdAt).toBe(created.createdAt);

      const secondUpdate = await updateBudget.execute({
        id: created.id,
        userId: userA,
        limitPaise: 600000
      });
      expect(secondUpdate.version).toBe(3);

      const updateOutbox = syncPort.enqueued[1];
      expect(updateOutbox).toMatchObject({
        userId: userA,
        entity: 'budgets',
        entityId: created.id,
        operation: 'UPDATE',
        payload: {
          id: created.id,
          user_id: userA,
          category_id: groceriesCatId,
          period: '2026-03',
          limit_paise: 550000,
          expected_version: 1,
          version: 2
        }
      });
    });

    it('rejects cross-user budget update and missing budget', async () => {
      const created = await createBudget.execute({
        userId: userA,
        categoryId: groceriesCatId,
        period: '2026-03',
        limitPaise: 400000
      });

      await expect(
        updateBudget.execute({
          id: created.id,
          userId: userB,
          limitPaise: 900000
        })
      ).rejects.toThrow(UnauthorizedEntityAccessError);

      const stored = await budgetRepo.findById(createBudgetId(created.id), userA);
      expect(stored?.limitPaise).toBe(400000);
      expect(stored?.version).toBe(1);

      await expect(
        updateBudget.execute({
          id: 'aaaaaaaa-1111-4111-8111-111111111111',
          userId: userA,
          limitPaise: 900000
        })
      ).rejects.toThrow(BudgetNotFoundError);
    });

    it('rejects invalid limit amounts on update', async () => {
      const created = await createBudget.execute({
        userId: userA,
        categoryId: groceriesCatId,
        period: '2026-03',
        limitPaise: 400000
      });

      await expect(
        updateBudget.execute({
          id: created.id,
          userId: userA,
          limitPaise: 0
        })
      ).rejects.toThrow(InvalidBudgetLimitError);

      await expect(
        updateBudget.execute({
          id: created.id,
          userId: userA,
          limitPaise: 99.5
        })
      ).rejects.toThrow(InvalidBudgetLimitError);
    });
  });

  describe('3. DeleteBudgetUseCase', () => {
    it('deletes authenticated user budget, preserves historical transactions/categories, enqueues DELETE outbox, and allows re-creation', async () => {
      const created = await createBudget.execute({
        userId: userA,
        categoryId: groceriesCatId,
        period: '2026-03',
        limitPaise: 400000
      });

      const tx = makeExpense('10000000-0000-4000-8000-000000000001', {
        categoryId: groceriesCatId,
        amountPaise: 15000,
        date: new Date(2026, 2, 10, 12, 0, 0)
      });
      await transactionRepo.save(tx);

      await deleteBudget.execute(created.id, userA);

      // Budget removed from local repo
      expect(await budgetRepo.findById(createBudgetId(created.id), userA)).toBeNull();

      // Deletion intent preserved in outbox
      expect(syncPort.enqueued).toHaveLength(2);
      expect(syncPort.enqueued[1]).toMatchObject({
        userId: userA,
        entity: 'budgets',
        entityId: created.id,
        operation: 'DELETE',
        payload: {
          id: created.id,
          user_id: userA,
          category_id: groceriesCatId,
          period: '2026-03',
          expected_version: 1,
          version: 2
        }
      });
      expect(typeof syncPort.enqueued[1].payload.deleted_at).toBe('string');

      // Historical transaction and category remain intact
      const preservedTx = await transactionRepo.findById(tx.id, userA);
      expect(preservedTx).not.toBeNull();
      expect(preservedTx?.isDeleted).toBe(false);
      expect(preservedTx?.amountPaise).toBe(15000);
      expect(await categoryRepo.findById(groceriesCatId, userA)).not.toBeNull();

      // Can recreate budget for same category & period after deletion
      await expect(
        createBudget.execute({
          userId: userA,
          categoryId: groceriesCatId,
          period: '2026-03',
          limitPaise: 500000
        })
      ).resolves.not.toThrow();
    });

    it('rejects cross-user budget deletion and missing budget deletion', async () => {
      const created = await createBudget.execute({
        userId: userA,
        categoryId: groceriesCatId,
        period: '2026-03',
        limitPaise: 400000
      });

      await expect(deleteBudget.execute(created.id, userB)).rejects.toThrow(
        UnauthorizedEntityAccessError
      );
      expect(await budgetRepo.findById(createBudgetId(created.id), userA)).not.toBeNull();
      expect(syncPort.enqueued).toHaveLength(1); // Only initial INSERT

      await expect(
        deleteBudget.execute('10000000-0000-4000-8000-000000000099', userA)
      ).rejects.toThrow(BudgetNotFoundError);
    });
  });

  describe('4 & 5. GetBudgetsOverviewUseCase & CheckBudgetUseCase (Spending Aggregation)', () => {
    it('aggregates expenses strictly by categoryId in integer paise and excludes income, transfers, soft-deleted, and unbudgeted categories', async () => {
      const groceriesBudget = await createBudget.execute({
        userId: userA,
        categoryId: groceriesCatId,
        period: '2026-03',
        limitPaise: 100000 // ₹1,000.00
      });
      await createBudget.execute({
        userId: userA,
        categoryId: diningCatId,
        period: '2026-03',
        limitPaise: 50000 // ₹500.00
      });

      await transactionRepo.saveBatch([
        // Groceries expenses: ₹333.33 + ₹333.34 = ₹666.67 (66667 paise)
        makeExpense('10000000-0000-4000-8000-000000000001', {
          categoryId: groceriesCatId,
          amountPaise: 33333,
          date: new Date(2026, 2, 5, 10, 0, 0)
        }),
        makeExpense('10000000-0000-4000-8000-000000000002', {
          categoryId: groceriesCatId,
          amountPaise: 33334,
          date: new Date(2026, 2, 12, 18, 30, 0)
        }),
        // Excluded: income transaction even if linked to a category
        makeExpense('10000000-0000-4000-8000-000000000003', {
          categoryId: groceriesCatId,
          amountPaise: 50000,
          date: new Date(2026, 2, 15),
          type: 'income'
        }),
        // Excluded: transfer transaction
        makeExpense('10000000-0000-4000-8000-000000000004', {
          categoryId: groceriesCatId,
          amountPaise: 200000,
          date: new Date(2026, 2, 16),
          type: 'transfer'
        }),
        // Excluded: soft-deleted expense
        makeExpense('10000000-0000-4000-8000-000000000005', {
          categoryId: groceriesCatId,
          amountPaise: 90000,
          date: new Date(2026, 2, 17),
          deleted: true
        }),
        // Dining exceeded: ₹750.00 (75000 paise -> 150%)
        makeExpense('10000000-0000-4000-8000-000000000006', {
          categoryId: diningCatId,
          amountPaise: 75000,
          date: new Date(2026, 2, 20)
        }),
        // Unbudgeted category expense (must NOT create a synthetic budget row)
        makeExpense('10000000-0000-4000-8000-000000000007', {
          categoryId: unbudgetedCatId,
          amountPaise: 120000,
          date: new Date(2026, 2, 21)
        }),
        // Foreign user's expense in the same month (must be excluded)
        makeExpense('10000000-0000-4000-8000-000000000008', {
          userId: userB,
          categoryId: userBCatId,
          amountPaise: 500000,
          date: new Date(2026, 2, 21)
        })
      ]);

      const overview = await getOverview.execute(userA, '2026-03');

      expect(overview.period).toBe('2026-03');
      expect(overview.budgets).toHaveLength(2); // Sorted alphabetically: Dining Out, Groceries

      const diningItem = overview.budgets[0];
      expect(diningItem.categoryId).toBe(diningCatId);
      expect(diningItem.categoryName).toBe('Dining Out');
      expect(diningItem.limitPaise).toBe(50000);
      expect(diningItem.spentPaise).toBe(75000);
      expect(diningItem.remainingPaise).toBe(0);
      expect(diningItem.utilizationPercentage).toBe(150); // Unclamped above 100%
      expect(diningItem.isExceeded).toBe(true);

      const groceriesItem = overview.budgets[1];
      expect(groceriesItem.budgetId).toBe(groceriesBudget.id);
      expect(groceriesItem.categoryId).toBe(groceriesCatId);
      expect(groceriesItem.categoryName).toBe('Groceries');
      expect(groceriesItem.limitPaise).toBe(100000);
      expect(groceriesItem.spentPaise).toBe(66667);
      expect(groceriesItem.remainingPaise).toBe(33333);
      expect(groceriesItem.utilizationPercentage).toBe(67);
      expect(groceriesItem.isExceeded).toBe(false);

      // Summary checks
      expect(overview.summary.budgetCount).toBe(2);
      expect(overview.summary.exceededCount).toBe(1);
      expect(overview.summary.totalBudgetLimitPaise).toBe(150000);
      expect(overview.summary.totalSpentPaise).toBe(141667);
      expect(overview.summary.totalRemainingPaise).toBe(8333);

      // CheckBudgetUseCase produces identical calculations without capping percentageUsed at 100
      const diningCheck = await checkBudget.execute(diningCatId, '2026-03', userA);
      expect(diningCheck).not.toBeNull();
      expect(diningCheck?.spentPaise).toBe(75000);
      expect(diningCheck?.spentInPaise).toBe(75000);
      expect(diningCheck?.remainingPaise).toBe(0);
      expect(diningCheck?.remainingInPaise).toBe(0);
      expect(diningCheck?.utilizationPercentage).toBe(150);
      expect(diningCheck?.percentageUsed).toBe(150);
      expect(diningCheck?.isExceeded).toBe(true);

      const groceriesCheck = await checkBudget.execute(groceriesCatId, '2026-03', userA);
      expect(groceriesCheck?.spentPaise).toBe(66667);
      expect(groceriesCheck?.remainingPaise).toBe(33333);
      expect(groceriesCheck?.percentageUsed).toBe(67);
      expect(groceriesCheck?.isExceeded).toBe(false);

      // Unbudgeted category returns null
      expect(await checkBudget.execute(unbudgetedCatId, '2026-03', userA)).toBeNull();
    });

    it('handles exact month-start, month-end, out-of-month, and leap-year February boundaries', async () => {
      await createBudget.execute({
        userId: userA,
        categoryId: groceriesCatId,
        period: '2026-03',
        limitPaise: 100000
      });
      await createBudget.execute({
        userId: userA,
        categoryId: groceriesCatId,
        period: '2024-02',
        limitPaise: 100000
      });

      await transactionRepo.saveBatch([
        // Previous month last millisecond: 2026-02-28 23:59:59.999 (EXCLUDED from 2026-03)
        makeExpense('10000000-0000-4000-8000-000000000010', {
          categoryId: groceriesCatId,
          amountPaise: 50000,
          date: new Date(2026, 1, 28, 23, 59, 59, 999)
        }),
        // Target month first millisecond: 2026-03-01 00:00:00.000 (INCLUDED)
        makeExpense('10000000-0000-4000-8000-000000000011', {
          categoryId: groceriesCatId,
          amountPaise: 10000,
          date: new Date(2026, 2, 1, 0, 0, 0, 0)
        }),
        // Target month last millisecond: 2026-03-31 23:59:59.999 (INCLUDED)
        makeExpense('10000000-0000-4000-8000-000000000012', {
          categoryId: groceriesCatId,
          amountPaise: 25000,
          date: new Date(2026, 2, 31, 23, 59, 59, 999)
        }),
        // Next month first millisecond: 2026-04-01 00:00:00.000 (EXCLUDED from 2026-03)
        makeExpense('10000000-0000-4000-8000-000000000013', {
          categoryId: groceriesCatId,
          amountPaise: 40000,
          date: new Date(2026, 3, 1, 0, 0, 0, 0)
        }),
        // Leap day 2024-02-29 23:59:59.999 (INCLUDED in 2024-02)
        makeExpense('10000000-0000-4000-8000-000000000014', {
          categoryId: groceriesCatId,
          amountPaise: 30000,
          date: new Date(2024, 1, 29, 23, 59, 59, 999)
        })
      ]);

      const marchOverview = await getOverview.execute(userA, '2026-03');
      expect(marchOverview.budgets[0].spentPaise).toBe(35000);
      expect(marchOverview.budgets[0].remainingPaise).toBe(65000);

      const marchCheck = await checkBudget.execute(groceriesCatId, '2026-03', userA);
      expect(marchCheck?.spentPaise).toBe(35000);

      const leapFebOverview = await getOverview.execute(userA, '2024-02');
      expect(leapFebOverview.budgets[0].spentPaise).toBe(30000);
    });

    it('uses category IDs rather than display names as identity keys even when two categories share the same name', async () => {
      const duplicateNameCatId1 = createCategoryId('90000000-0000-4000-8000-000000000001');
      const duplicateNameCatId2 = createCategoryId('90000000-0000-4000-8000-000000000002');

      await categoryRepo.saveBatch([
        new Category({
          id: duplicateNameCatId1,
          userId: userA,
          name: 'Transport',
          type: 'expense'
        }),
        new Category({
          id: duplicateNameCatId2,
          userId: userA,
          name: 'Transport', // Same display name, distinct ID
          type: 'expense'
        })
      ]);

      await createBudget.execute({
        userId: userA,
        categoryId: duplicateNameCatId1,
        period: '2026-05',
        limitPaise: 100000
      });
      await createBudget.execute({
        userId: userA,
        categoryId: duplicateNameCatId2,
        period: '2026-05',
        limitPaise: 200000
      });

      await transactionRepo.saveBatch([
        makeExpense('10000000-0000-4000-8000-000000000020', {
          categoryId: duplicateNameCatId1,
          amountPaise: 15000,
          date: new Date(2026, 4, 10)
        }),
        makeExpense('10000000-0000-4000-8000-000000000021', {
          categoryId: duplicateNameCatId2,
          amountPaise: 85000,
          date: new Date(2026, 4, 11)
        })
      ]);

      const overview = await getOverview.execute(userA, '2026-05');
      expect(overview.budgets).toHaveLength(2);
      const item1 = overview.budgets.find((b) => b.categoryId === duplicateNameCatId1)!;
      const item2 = overview.budgets.find((b) => b.categoryId === duplicateNameCatId2)!;
      expect(item1.spentPaise).toBe(15000);
      expect(item2.spentPaise).toBe(85000);
    });

    it('handles zero spending and exact 100% limit boundary cleanly', async () => {
      await createBudget.execute({
        userId: userA,
        categoryId: groceriesCatId,
        period: '2026-06',
        limitPaise: 100000
      });
      await createBudget.execute({
        userId: userA,
        categoryId: diningCatId,
        period: '2026-06',
        limitPaise: 50000
      });

      await transactionRepo.save(
        makeExpense('10000000-0000-4000-8000-000000000030', {
          categoryId: diningCatId,
          amountPaise: 50000, // Exact 100% limit
          date: new Date(2026, 5, 15)
        })
      );

      const overview = await getOverview.execute(userA, '2026-06');
      const groceriesItem = overview.budgets.find((b) => b.categoryId === groceriesCatId)!;
      const diningItem = overview.budgets.find((b) => b.categoryId === diningCatId)!;

      expect(groceriesItem.spentPaise).toBe(0);
      expect(groceriesItem.remainingPaise).toBe(100000);
      expect(groceriesItem.utilizationPercentage).toBe(0);
      expect(groceriesItem.isExceeded).toBe(false);

      expect(diningItem.spentPaise).toBe(50000);
      expect(diningItem.remainingPaise).toBe(0);
      expect(diningItem.utilizationPercentage).toBe(100);
      expect(diningItem.isExceeded).toBe(false);
    });

    it('rejects foreign-owned transactions and corrupt non-integer transaction amounts rather than ignoring them', async () => {
      await createBudget.execute({
        userId: userA,
        categoryId: groceriesCatId,
        period: '2026-03',
        limitPaise: 100000
      });

      // Simulate repository leak returning another user's transaction
      transactionRepo.bypassFilterInTest = true;
      await transactionRepo.save(
        makeExpense('10000000-0000-4000-8000-000000000040', {
          userId: userB,
          categoryId: groceriesCatId,
          amountPaise: 10000,
          date: new Date(2026, 2, 10)
        })
      );

      await expect(getOverview.execute(userA, '2026-03')).rejects.toThrow(
        UnauthorizedEntityAccessError
      );
      await expect(checkBudget.execute(groceriesCatId, '2026-03', userA)).rejects.toThrow(
        UnauthorizedEntityAccessError
      );

      // Now test corrupt non-integer amountPaise
      transactionRepo.transactions.clear();
      const corruptTx = {
        id: createTransactionId('10000000-0000-4000-8000-000000000041'),
        userId: userA,
        type: 'expense',
        amountPaise: 123.45, // Fractional corrupt amount
        categoryId: groceriesCatId,
        transactionDate: new Date(2026, 2, 10),
        isDeleted: false
      } as unknown as Transaction;
      transactionRepo.transactions.set(corruptTx.id, corruptTx);

      await expect(getOverview.execute(userA, '2026-03')).rejects.toThrow(
        InvalidTransactionAmountError
      );
    });

    it('preserves historical budget reporting when category is archived later and handles large safe-integer paise sums without precision loss', async () => {
      const budgetCreated = await createBudget.execute({
        userId: userA,
        categoryId: groceriesCatId,
        period: '2026-07',
        limitPaise: 900000000000 // ₹900 crore in paise
      });

      // Archive the category after budget creation
      await categoryRepo.archive(groceriesCatId, userA);

      await transactionRepo.saveBatch([
        makeExpense('10000000-0000-4000-8000-000000000050', {
          categoryId: groceriesCatId,
          amountPaise: 450000000001,
          date: new Date(2026, 6, 10)
        }),
        makeExpense('10000000-0000-4000-8000-000000000051', {
          categoryId: groceriesCatId,
          amountPaise: 999999999,
          date: new Date(2026, 6, 11)
        })
      ]);

      const overview = await getOverview.execute(userA, '2026-07');
      expect(overview.budgets).toHaveLength(1);
      expect(overview.budgets[0].budgetId).toBe(budgetCreated.id);
      expect(overview.budgets[0].categoryIsArchived).toBe(true);
      expect(overview.budgets[0].spentPaise).toBe(451000000000);
      expect(overview.budgets[0].remainingPaise).toBe(449000000000);
      expect(Number.isSafeInteger(overview.budgets[0].spentPaise)).toBe(true);
    });
  });
});

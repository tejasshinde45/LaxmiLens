import { describe, it, expect, beforeEach } from 'vitest';
import { CreateAccountUseCase } from '@/application/use-cases/accounts/CreateAccountUseCase';
import { ArchiveAccountUseCase } from '@/application/use-cases/accounts/ArchiveAccountUseCase';
import { GetAccountBalanceUseCase } from '@/application/use-cases/accounts/GetAccountBalanceUseCase';
import { CreateCategoryUseCase } from '@/application/use-cases/categories/CreateCategoryUseCase';
import { CreateTransactionUseCase } from '@/application/use-cases/transactions/CreateTransactionUseCase';
import { DeleteTransactionUseCase } from '@/application/use-cases/transactions/DeleteTransactionUseCase';
import { GetTransactionsUseCase } from '@/application/use-cases/transactions/GetTransactionsUseCase';

import { AccountRepository } from '@/domain/repositories/AccountRepository';
import { CategoryRepository } from '@/domain/repositories/CategoryRepository';
import { TransactionRepository, TransactionFilter } from '@/domain/repositories/TransactionRepository';
import { SyncPort, OutboxEntry, SyncResult } from '@/application/ports/SyncPort';
import { UnitOfWork } from '@/application/ports/UnitOfWork';

import { Account } from '@/domain/entities/Account';
import { Category } from '@/domain/entities/Category';
import { Transaction } from '@/domain/entities/Transaction';
import { AccountId, CategoryId, TransactionId, UserId } from '@/domain/value-objects/Identifiers';
import {
  CategoryTypeMismatchError,
  DuplicateTransactionError,
  AccountNotFoundError
} from '@/domain/errors/DomainErrors';

// In-Memory Test Repositories
class InMemoryAccountRepository implements AccountRepository {
  private accounts = new Map<string, Account>();

  async findById(id: AccountId, userId: UserId): Promise<Account | null> {
    const acc = this.accounts.get(id);
    return acc && acc.userId === userId ? acc : null;
  }
  async findByUserId(userId: UserId): Promise<Account[]> {
    return Array.from(this.accounts.values()).filter((a) => a.userId === userId);
  }
  async findAll(userId: UserId): Promise<Account[]> {
    return this.findByUserId(userId);
  }
  async save(account: Account): Promise<void> {
    this.accounts.set(account.id, account);
  }
  async saveBatch(accounts: Account[]): Promise<void> {
    accounts.forEach((a) => this.accounts.set(a.id, a));
  }
  async archive(id: AccountId, userId: UserId, version?: number): Promise<void> {
    const acc = this.accounts.get(id);
    if (acc && acc.userId === userId) {
      this.accounts.set(
        id,
        new Account({
          ...acc,
          isArchived: true,
          version: version ?? acc.version + 1,
          updatedAt: new Date()
        })
      );
    }
  }
  async restore(id: AccountId, userId: UserId, version?: number): Promise<void> {
    const acc = this.accounts.get(id);
    if (acc && acc.userId === userId) {
      this.accounts.set(
        id,
        new Account({
          ...acc,
          isArchived: false,
          version: version ?? acc.version + 1,
          updatedAt: new Date()
        })
      );
    }
  }
}

class InMemoryCategoryRepository implements CategoryRepository {
  private categories = new Map<string, Category>();

  async findById(id: CategoryId, userId: UserId): Promise<Category | null> {
    const cat = this.categories.get(id);
    if (!cat) return null;
    return cat.userId === userId || cat.isDefault ? cat : null;
  }
  async findByUserId(userId: UserId): Promise<Category[]> {
    return Array.from(this.categories.values()).filter((c) => c.userId === userId || c.isDefault);
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
          ...cat,
          isArchived: true,
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
  private transactions = new Map<string, Transaction>();

  async findById(id: TransactionId, userId: UserId): Promise<Transaction | null> {
    const tx = this.transactions.get(id);
    return tx && tx.userId === userId ? tx : null;
  }
  async findByIdempotencyKey(key: string, userId: UserId): Promise<Transaction | null> {
    const all = Array.from(this.transactions.values());
    return all.find((t) => t.idempotencyKey === key && t.userId === userId) || null;
  }
  async findByAccount(accountId: AccountId, userId: UserId): Promise<Transaction[]> {
    return Array.from(this.transactions.values()).filter(
      (t) => (t.accountId === accountId || t.destinationAccountId === accountId) && t.userId === userId
    );
  }
  async findMany(filter: TransactionFilter): Promise<Transaction[]> {
    let result = Array.from(this.transactions.values()).filter((t) => t.userId === filter.userId);
    if (!filter.includeDeleted) {
      result = result.filter((t) => !t.isDeleted);
    }
    if (filter.accountId) {
      result = result.filter(
        (t) => t.accountId === filter.accountId || t.destinationAccountId === filter.accountId
      );
    }
    return result;
  }
  async save(transaction: Transaction): Promise<void> {
    this.transactions.set(transaction.id, transaction);
  }
  async saveBatch(transactions: Transaction[]): Promise<void> {
    transactions.forEach((t) => this.transactions.set(t.id, t));
  }
  async softDelete(id: TransactionId, userId: UserId, deletedAt: Date = new Date(), version?: number): Promise<void> {
    const tx = this.transactions.get(id);
    if (tx && tx.userId === userId) {
      this.transactions.set(id, tx.markDeleted(deletedAt, version));
    }
  }
}

class MockUnitOfWork implements UnitOfWork {
  async run<T>(work: () => Promise<T>): Promise<T> {
    return await work();
  }
}

class MockSyncPort implements SyncPort {
  public enqueued: unknown[] = [];
  async enqueue(entry: Omit<OutboxEntry, 'id' | 'attempts' | 'createdAt'>): Promise<void> {
    this.enqueued.push(entry);
  }
  async processOutbox(): Promise<SyncResult> {
    return { pushedCount: 0, pulledCount: 0, conflictsCount: 0, errors: [] };
  }
  async getPendingCount(): Promise<number> {
    return this.enqueued.length;
  }
  async clearOutbox(): Promise<void> {
    this.enqueued = [];
  }
}

describe('Core Financial Use Cases', () => {
  let accountRepo: InMemoryAccountRepository;
  let categoryRepo: InMemoryCategoryRepository;
  let transactionRepo: InMemoryTransactionRepository;
  let syncPort: MockSyncPort;
  let unitOfWork: MockUnitOfWork;
  const testUserId = '123e4567-e89b-12d3-a456-426614174000';

  beforeEach(() => {
    accountRepo = new InMemoryAccountRepository();
    categoryRepo = new InMemoryCategoryRepository();
    transactionRepo = new InMemoryTransactionRepository();
    syncPort = new MockSyncPort();
    unitOfWork = new MockUnitOfWork();
  });

  it('creates, archives, and computes account balance', async () => {
    const createAccount = new CreateAccountUseCase(accountRepo, syncPort);
    const archiveAccount = new ArchiveAccountUseCase(accountRepo, syncPort);
    const getBalance = new GetAccountBalanceUseCase(accountRepo, transactionRepo);

    // 1. Create account with opening balance ₹5,000 (500000 paise)
    const acc = await createAccount.execute({
      userId: testUserId,
      name: 'Salary Bank',
      accountType: 'bank',
      openingBalancePaise: 500000,
      currency: 'INR'
    });

    expect(acc.name).toBe('Salary Bank');
    expect(acc.openingBalancePaise).toBe(500000);
    expect(acc.openingBalanceFormatted).toBe('₹5,000.00');

    // Initial derived balance should equal opening balance
    const balanceBefore = await getBalance.execute(acc.id, testUserId);
    expect(balanceBefore.currentBalancePaise).toBe(500000);
    expect(balanceBefore.currentBalanceFormatted).toBe('₹5,000.00');

    // Archive account
    await archiveAccount.execute(acc.id, testUserId);
    const balanceAfterArchive = await getBalance.execute(acc.id, testUserId);
    expect(balanceAfterArchive.isArchived).toBe(true);
  });

  it('creates transactions and enforces category type matching', async () => {
    const createAccount = new CreateAccountUseCase(accountRepo, syncPort);
    const createCategory = new CreateCategoryUseCase(categoryRepo, syncPort);
    const createTransaction = new CreateTransactionUseCase(
      transactionRepo,
      accountRepo,
      categoryRepo,
      syncPort,
      unitOfWork
    );

    const acc = await createAccount.execute({
      userId: testUserId,
      name: 'Wallet',
      accountType: 'cash',
      openingBalancePaise: 100000
    });

    const expenseCategory = await createCategory.execute({
      userId: testUserId,
      name: 'Food',
      type: 'expense'
    });

    // Valid expense with expense category
    const tx = await createTransaction.execute({
      userId: testUserId,
      type: 'expense',
      amountPaise: 25000, // ₹250
      accountId: acc.id,
      categoryId: expenseCategory.id,
      title: 'Lunch'
    });

    expect(tx.amountPaise).toBe(25000);
    expect(tx.title).toBe('Lunch');

    // Attempting to record an income using an expense category must fail
    await expect(
      createTransaction.execute({
        userId: testUserId,
        type: 'income',
        amountPaise: 50000,
        accountId: acc.id,
        categoryId: expenseCategory.id, // EXPENSE category for INCOME transaction!
        title: 'Invalid Income'
      })
    ).rejects.toThrow(CategoryTypeMismatchError);
  });

  it('rejects duplicate transaction creation with same idempotency key', async () => {
    const createAccount = new CreateAccountUseCase(accountRepo, syncPort);
    const createTransaction = new CreateTransactionUseCase(
      transactionRepo,
      accountRepo,
      categoryRepo,
      syncPort,
      unitOfWork
    );

    const acc = await createAccount.execute({
      userId: testUserId,
      name: 'Bank',
      accountType: 'bank',
      openingBalancePaise: 100000
    });

    const idempotencyKey = 'fixed-key-123';

    await createTransaction.execute({
      userId: testUserId,
      type: 'expense',
      amountPaise: 10000,
      accountId: acc.id,
      title: 'First Attempt',
      idempotencyKey
    });

    // Re-executing with the exact same idempotency key must reject
    await expect(
      createTransaction.execute({
        userId: testUserId,
        type: 'expense',
        amountPaise: 10000,
        accountId: acc.id,
        title: 'Duplicate Attempt',
        idempotencyKey
      })
    ).rejects.toThrow(DuplicateTransactionError);
  });

  it('soft deletes transaction and excludes from derived balance', async () => {
    const createAccount = new CreateAccountUseCase(accountRepo, syncPort);
    const createTransaction = new CreateTransactionUseCase(
      transactionRepo,
      accountRepo,
      categoryRepo,
      syncPort,
      unitOfWork
    );
    const deleteTransaction = new DeleteTransactionUseCase(transactionRepo, syncPort, unitOfWork);
    const getTransactions = new GetTransactionsUseCase(transactionRepo);
    const getBalance = new GetAccountBalanceUseCase(accountRepo, transactionRepo);

    // Opening balance ₹1,000 (100000 paise)
    const acc = await createAccount.execute({
      userId: testUserId,
      name: 'Checking',
      accountType: 'bank',
      openingBalancePaise: 100000
    });

    // Expense ₹300 (30000 paise)
    const tx = await createTransaction.execute({
      userId: testUserId,
      type: 'expense',
      amountPaise: 30000,
      accountId: acc.id,
      title: 'Coffee Beans'
    });

    // Balance after expense = ₹700 (70000 paise)
    const balanceBeforeDelete = await getBalance.execute(acc.id, testUserId);
    expect(balanceBeforeDelete.currentBalancePaise).toBe(70000);

    // Soft delete transaction
    await deleteTransaction.execute(tx.id, testUserId);

    // Active transactions list must not contain soft-deleted transaction by default
    const activeTransactions = await getTransactions.execute({ userId: testUserId as any, accountId: acc.id as any });
    expect(activeTransactions.length).toBe(0);

    // Balance after deletion recalculates back to ₹1,000 (100000 paise)
    const balanceAfterDelete = await getBalance.execute(acc.id, testUserId);
    expect(balanceAfterDelete.currentBalancePaise).toBe(100000);
    expect(balanceAfterDelete.currentBalanceFormatted).toBe('₹1,000.00');
  });
});

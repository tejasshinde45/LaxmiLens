import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CreateTransactionUseCase } from '@/application/use-cases/transactions/CreateTransactionUseCase';
import { ExecuteTransferUseCase } from '@/application/use-cases/transactions/ExecuteTransferUseCase';
import { UpdateTransactionUseCase } from '@/application/use-cases/transactions/UpdateTransactionUseCase';
import { DeleteTransactionUseCase } from '@/application/use-cases/transactions/DeleteTransactionUseCase';
import { UnitOfWork } from '@/application/ports/UnitOfWork';
import { DexieUnitOfWork } from '@/infrastructure/database/local/DexieUnitOfWork';
import { TransactionRepository, TransactionFilter } from '@/domain/repositories/TransactionRepository';
import { AccountRepository } from '@/domain/repositories/AccountRepository';
import { CategoryRepository } from '@/domain/repositories/CategoryRepository';
import { SyncPort, OutboxEntry, SyncResult } from '@/application/ports/SyncPort';
import { Transaction } from '@/domain/entities/Transaction';
import { Account } from '@/domain/entities/Account';
import { Category } from '@/domain/entities/Category';
import {
  TransactionId,
  AccountId,
  CategoryId,
  UserId,
  createTransactionId,
  createAccountId,
  createCategoryId,
  createUserId
} from '@/domain/value-objects/Identifiers';
import {
  AccountNotFoundError,
  TransactionNotFoundError,
  TransferAccountMismatchError
} from '@/domain/errors/DomainErrors';
import { LaxmiLensDB } from '@/infrastructure/database/local/DexieDatabase';

// Transactional in-memory repository with snapshot & rollback capabilities
class TransactionalInMemoryTransactionRepository implements TransactionRepository {
  public transactions = new Map<string, Transaction>();
  private snapshot = new Map<string, Transaction>();

  takeSnapshot() {
    this.snapshot = new Map(this.transactions);
  }

  rollback() {
    this.transactions = new Map(this.snapshot);
  }

  async findById(id: TransactionId): Promise<Transaction | null> {
    return this.transactions.get(id) || null;
  }

  async findByIdempotencyKey(key: string, userId?: UserId): Promise<Transaction | null> {
    const all = Array.from(this.transactions.values());
    return all.find((t) => t.idempotencyKey === key && (!userId || t.userId === userId)) || null;
  }

  async findByAccount(accountId: AccountId): Promise<Transaction[]> {
    return Array.from(this.transactions.values()).filter(
      (t) => t.accountId === accountId || t.destinationAccountId === accountId
    );
  }

  async findMany(filter: TransactionFilter): Promise<Transaction[]> {
    let result = Array.from(this.transactions.values());
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

  async softDelete(id: TransactionId, deletedAt: Date = new Date(), version?: number): Promise<void> {
    const tx = this.transactions.get(id);
    if (tx) {
      this.transactions.set(id, tx.markDeleted(deletedAt, version));
    }
  }
}

// Transactional in-memory Account Repository
class InMemoryAccountRepository implements AccountRepository {
  public accounts = new Map<string, Account>();

  async findById(id: AccountId): Promise<Account | null> {
    return this.accounts.get(id) || null;
  }
  async findByUserId(userId: UserId): Promise<Account[]> {
    return Array.from(this.accounts.values()).filter((a) => a.userId === userId);
  }
  async findAll(): Promise<Account[]> {
    return Array.from(this.accounts.values());
  }
  async save(account: Account): Promise<void> {
    this.accounts.set(account.id, account);
  }
  async saveBatch(accounts: Account[]): Promise<void> {
    accounts.forEach((a) => this.accounts.set(a.id, a));
  }
  async archive(id: AccountId, version?: number): Promise<void> {
    const acc = this.accounts.get(id);
    if (acc) {
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
  async restore(id: AccountId, version?: number): Promise<void> {
    const acc = this.accounts.get(id);
    if (acc) {
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

// Transactional in-memory Category Repository
class InMemoryCategoryRepository implements CategoryRepository {
  public categories = new Map<string, Category>();

  async findById(id: CategoryId): Promise<Category | null> {
    return this.categories.get(id) || null;
  }
  async findByUserId(userId: UserId): Promise<Category[]> {
    return Array.from(this.categories.values()).filter((c) => c.userId === userId);
  }
  async findAll(): Promise<Category[]> {
    return Array.from(this.categories.values());
  }
  async save(category: Category): Promise<void> {
    this.categories.set(category.id, category);
  }
  async saveBatch(categories: Category[]): Promise<void> {
    categories.forEach((c) => this.categories.set(c.id, c));
  }
  async archive(id: CategoryId): Promise<void> {
    const cat = this.categories.get(id);
    if (cat) {
      this.categories.set(
        id,
        new Category({ ...cat, isArchived: true, updatedAt: new Date() })
      );
    }
  }
  async seedDefaults(): Promise<Category[]> {
    return [];
  }
}

// Transactional in-memory SyncPort with simulated failure and rollback support
class TransactionalInMemorySyncPort implements SyncPort {
  public enqueued: Omit<OutboxEntry, 'id' | 'attempts' | 'createdAt'>[] = [];
  private snapshot: Omit<OutboxEntry, 'id' | 'attempts' | 'createdAt'>[] = [];
  public shouldFail = false;
  public failureMessage = 'Simulated outbox enqueue failure';

  takeSnapshot() {
    this.snapshot = [...this.enqueued];
  }

  rollback() {
    this.enqueued = [...this.snapshot];
  }

  async enqueue(entry: Omit<OutboxEntry, 'id' | 'attempts' | 'createdAt'>): Promise<void> {
    if (this.shouldFail) {
      throw new Error(this.failureMessage);
    }
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

// Transactional UnitOfWork implementing atomic two-phase commit with rollback
class SimulatedTransactionalUnitOfWork implements UnitOfWork {
  constructor(
    private readonly txRepo: TransactionalInMemoryTransactionRepository,
    private readonly syncPort: TransactionalInMemorySyncPort
  ) {}

  async run<T>(work: () => Promise<T>): Promise<T> {
    this.txRepo.takeSnapshot();
    this.syncPort.takeSnapshot();

    try {
      return await work();
    } catch (error) {
      this.txRepo.rollback();
      this.syncPort.rollback();
      throw error;
    }
  }
}

describe('Phase 2D.2: Transaction Foundation & Data Integrity Remediation', () => {
  const testUserId = '11111111-1111-4111-8111-111111111111';
  const testSourceAccId = '22222222-2222-4222-8222-222222222222';
  const testDestAccId = '33333333-3333-4333-8333-333333333333';
  const testCategoryId = '44444444-4444-4444-8444-444444444444';

  let txRepo: TransactionalInMemoryTransactionRepository;
  let accountRepo: InMemoryAccountRepository;
  let categoryRepo: InMemoryCategoryRepository;
  let syncPort: TransactionalInMemorySyncPort;
  let unitOfWork: SimulatedTransactionalUnitOfWork;

  beforeEach(() => {
    txRepo = new TransactionalInMemoryTransactionRepository();
    accountRepo = new InMemoryAccountRepository();
    categoryRepo = new InMemoryCategoryRepository();
    syncPort = new TransactionalInMemorySyncPort();
    unitOfWork = new SimulatedTransactionalUnitOfWork(txRepo, syncPort);

    // Seed test accounts
    accountRepo.accounts.set(
      testSourceAccId,
      new Account({
        id: createAccountId(testSourceAccId),
        userId: createUserId(testUserId),
        name: 'Checking Account',
        accountType: 'bank',
        openingBalancePaise: 500000,
        currency: 'INR',
        isArchived: false,
        version: 1
      })
    );

    accountRepo.accounts.set(
      testDestAccId,
      new Account({
        id: createAccountId(testDestAccId),
        userId: createUserId(testUserId),
        name: 'Savings Account',
        accountType: 'savings',
        openingBalancePaise: 100000,
        currency: 'INR',
        isArchived: false,
        version: 1
      })
    );

    // Seed test category
    categoryRepo.categories.set(
      testCategoryId,
      new Category({
        id: createCategoryId(testCategoryId),
        userId: createUserId(testUserId),
        name: 'Food & Dining Out',
        type: 'expense',
        isDefault: true,
        isArchived: false,
        version: 1
      })
    );
  });

  describe('Task A: DexieUnitOfWork Architecture & Scope', () => {
    it('DexieUnitOfWork includes accounts, transactions, and syncOutbox in its transaction scope', async () => {
      const mockAccountsTable = { name: 'accounts' } as any;
      const mockTransactionsTable = { name: 'transactions' } as any;
      const mockOutboxTable = { name: 'syncOutbox' } as any;
      const transactionSpy = vi.fn().mockImplementation(async (_mode, _tables, callback) => callback());

      const mockDb = {
        accounts: mockAccountsTable,
        transactions: mockTransactionsTable,
        syncOutbox: mockOutboxTable,
        transaction: transactionSpy
      } as unknown as LaxmiLensDB;

      const dexieUow = new DexieUnitOfWork(mockDb);

      let executed = false;
      const result = await dexieUow.run(async () => {
        executed = true;
        return 'success';
      });

      expect(executed).toBe(true);
      expect(result).toBe('success');
      expect(transactionSpy).toHaveBeenCalledTimes(1);

      const [mode, tables] = transactionSpy.mock.calls[0];
      expect(mode).toBe('rw');
      expect(tables).toEqual([mockAccountsTable, mockTransactionsTable, mockOutboxTable]);
    });

    it('DexieUnitOfWork propagates transaction abort when work throws', async () => {
      const mockDb = {
        accounts: {},
        transactions: {},
        syncOutbox: {},
        transaction: vi.fn().mockImplementation(async (_mode, _tables, callback) => callback())
      } as unknown as LaxmiLensDB;

      const dexieUow = new DexieUnitOfWork(mockDb);

      await expect(
        dexieUow.run(async () => {
          throw new Error('Simulated Dexie failure');
        })
      ).rejects.toThrow('Simulated Dexie failure');
    });
  });

  describe('Task B: CreateTransactionUseCase Atomicity & Versioning', () => {
    it('commits transaction and outbox event atomically on success at version 1', async () => {
      const useCase = new CreateTransactionUseCase(
        txRepo,
        accountRepo,
        categoryRepo,
        syncPort,
        unitOfWork
      );

      const res = await useCase.execute({
        userId: testUserId,
        type: 'expense',
        amountPaise: 45000,
        accountId: testSourceAccId,
        categoryId: testCategoryId,
        title: 'Dinner with team',
        transactionDate: '2026-11-21T12:00:00.000Z'
      });

      // 1. Transaction persisted locally
      expect(res.version).toBe(1);
      const saved = await txRepo.findById(createTransactionId(res.id));
      expect(saved).not.toBeNull();
      expect(saved?.amountPaise).toBe(45000);
      expect(saved?.version).toBe(1);

      // 2. Outbox event enqueued
      expect(syncPort.enqueued.length).toBe(1);
      const outboxEntry = syncPort.enqueued[0];
      expect(outboxEntry.entity).toBe('transactions');
      expect(outboxEntry.entityId).toBe(res.id);
      expect(outboxEntry.operation).toBe('INSERT');
      expect(outboxEntry.payload.version).toBe(1);
      expect(outboxEntry.payload.amount_paise).toBe(45000);
      expect(outboxEntry.payload.destination_account_id).toBeNull();
    });

    it('rolls back transaction persistence when outbox enqueueing fails', async () => {
      const useCase = new CreateTransactionUseCase(
        txRepo,
        accountRepo,
        categoryRepo,
        syncPort,
        unitOfWork
      );

      syncPort.shouldFail = true;
      syncPort.failureMessage = 'Simulated outbox disk error';

      await expect(
        useCase.execute({
          userId: testUserId,
          type: 'expense',
          amountPaise: 45000,
          accountId: testSourceAccId,
          title: 'Dinner'
        })
      ).rejects.toThrow('Simulated outbox disk error');

      // Verify transaction was completely rolled back from repository
      expect(txRepo.transactions.size).toBe(0);
      expect(syncPort.enqueued.length).toBe(0);
    });
  });

  describe('Task B: ExecuteTransferUseCase Atomicity & Transfer Integrity', () => {
    it('persists transfer as exactly ONE transaction record and enqueues outbox event', async () => {
      const useCase = new ExecuteTransferUseCase(
        txRepo,
        accountRepo,
        syncPort,
        unitOfWork
      );

      const res = await useCase.execute({
        userId: testUserId,
        fromAccountId: testSourceAccId,
        toAccountId: testDestAccId,
        amountPaise: 200000,
        title: 'Monthly Savings Allocation'
      });

      // Verify single transaction created
      expect(res.type).toBe('transfer');
      expect(res.accountId).toBe(testSourceAccId);
      expect(res.destinationAccountId).toBe(testDestAccId);
      expect(res.version).toBe(1);
      expect(txRepo.transactions.size).toBe(1);

      // Verify single outbox event enqueued
      expect(syncPort.enqueued.length).toBe(1);
      const entry = syncPort.enqueued[0];
      expect(entry.entity).toBe('transactions');
      expect(entry.operation).toBe('INSERT');
      expect(entry.payload.type).toBe('transfer');
      expect(entry.payload.destination_account_id).toBe(testDestAccId);
      expect(entry.payload.category_id).toBeNull();
    });

    it('rolls back transfer transaction if outbox enqueueing fails', async () => {
      const useCase = new ExecuteTransferUseCase(
        txRepo,
        accountRepo,
        syncPort,
        unitOfWork
      );

      syncPort.shouldFail = true;

      await expect(
        useCase.execute({
          fromAccountId: testSourceAccId,
          toAccountId: testDestAccId,
          amountPaise: 100000
        })
      ).rejects.toThrow('Simulated outbox enqueue failure');

      expect(txRepo.transactions.size).toBe(0);
      expect(syncPort.enqueued.length).toBe(0);
    });

    it('rejects transfer where source and destination accounts are identical', async () => {
      const useCase = new ExecuteTransferUseCase(
        txRepo,
        accountRepo,
        syncPort,
        unitOfWork
      );

      await expect(
        useCase.execute({
          fromAccountId: testSourceAccId,
          toAccountId: testSourceAccId,
          amountPaise: 100000
        })
      ).rejects.toThrow(TransferAccountMismatchError);
    });
  });

  describe('Task B: UpdateTransactionUseCase Atomicity & Version Increment', () => {
    it('updates transaction and increments version exactly once in repo and outbox', async () => {
      const createTx = new CreateTransactionUseCase(
        txRepo,
        accountRepo,
        categoryRepo,
        syncPort,
        unitOfWork
      );
      const updateTx = new UpdateTransactionUseCase(
        txRepo,
        accountRepo,
        categoryRepo,
        syncPort,
        unitOfWork
      );

      const created = await createTx.execute({
        userId: testUserId,
        type: 'expense',
        amountPaise: 10000,
        accountId: testSourceAccId,
        title: 'Initial Title'
      });
      expect(created.version).toBe(1);
      expect(syncPort.enqueued.length).toBe(1);

      const updated = await updateTx.execute({
        id: created.id,
        userId: testUserId,
        title: 'Updated Title',
        amountPaise: 15000
      });

      expect(updated.version).toBe(2);
      expect(updated.title).toBe('Updated Title');
      expect(updated.amountPaise).toBe(15000);

      // Verify repo has version 2
      const inRepo = await txRepo.findById(createTransactionId(created.id));
      expect(inRepo?.version).toBe(2);
      expect(inRepo?.title).toBe('Updated Title');

      // Verify outbox has 2 events, second is UPDATE with version 2
      expect(syncPort.enqueued.length).toBe(2);
      const updateOutbox = syncPort.enqueued[1];
      expect(updateOutbox.operation).toBe('UPDATE');
      expect(updateOutbox.entityId).toBe(created.id);
      expect(updateOutbox.payload.version).toBe(2);
      expect(updateOutbox.payload.title).toBe('Updated Title');
      expect(updateOutbox.payload.amount_paise).toBe(15000);
    });

    it('rolls back update when outbox enqueue fails, preserving version 1 in repo', async () => {
      const createTx = new CreateTransactionUseCase(
        txRepo,
        accountRepo,
        categoryRepo,
        syncPort,
        unitOfWork
      );
      const updateTx = new UpdateTransactionUseCase(
        txRepo,
        accountRepo,
        categoryRepo,
        syncPort,
        unitOfWork
      );

      const created = await createTx.execute({
        userId: testUserId,
        type: 'expense',
        amountPaise: 10000,
        accountId: testSourceAccId,
        title: 'Stable Title'
      });

      syncPort.shouldFail = true;

      await expect(
        updateTx.execute({
          id: created.id,
          userId: testUserId,
          title: 'Failed Update Title',
          amountPaise: 99999
        })
      ).rejects.toThrow('Simulated outbox enqueue failure');

      // Verify transaction in repo reverted to original version 1 and original title
      const inRepo = await txRepo.findById(createTransactionId(created.id));
      expect(inRepo?.version).toBe(1);
      expect(inRepo?.title).toBe('Stable Title');
      expect(inRepo?.amountPaise).toBe(10000);
      expect(syncPort.enqueued.length).toBe(1); // Only initial creation event exists
    });

    it('throws TransactionNotFoundError if transaction does not exist', async () => {
      const updateTx = new UpdateTransactionUseCase(
        txRepo,
        accountRepo,
        categoryRepo,
        syncPort,
        unitOfWork
      );

      await expect(
        updateTx.execute({
          id: '00000000-0000-4000-8000-000000000000',
          userId: testUserId,
          title: 'Ghost'
        })
      ).rejects.toThrow(TransactionNotFoundError);
    });
  });

  describe('Task B: DeleteTransactionUseCase Soft-Deletion Atomicity', () => {
    it('performs soft-delete, increments version, and enqueues outbox DELETE payload', async () => {
      const createTx = new CreateTransactionUseCase(
        txRepo,
        accountRepo,
        categoryRepo,
        syncPort,
        unitOfWork
      );
      const deleteTx = new DeleteTransactionUseCase(txRepo, syncPort, unitOfWork);

      const created = await createTx.execute({
        userId: testUserId,
        type: 'expense',
        amountPaise: 30000,
        accountId: testSourceAccId,
        title: 'Books'
      });

      await deleteTx.execute(created.id, testUserId);

      // Verify soft deletion in repo (record is NOT deleted from storage)
      const inRepo = await txRepo.findById(createTransactionId(created.id));
      expect(inRepo).not.toBeNull();
      expect(inRepo?.isDeleted).toBe(true);
      expect(inRepo?.deletedAt).not.toBeNull();
      expect(inRepo?.version).toBe(2);

      // Verify outbox has DELETE event with version 2 and deleted_at
      expect(syncPort.enqueued.length).toBe(2);
      const deleteOutbox = syncPort.enqueued[1];
      expect(deleteOutbox.operation).toBe('DELETE');
      expect(deleteOutbox.entityId).toBe(created.id);
      expect(deleteOutbox.payload.version).toBe(2);
      expect(deleteOutbox.payload.deleted_at).toBeDefined();
    });

    it('repeated delete on already soft-deleted transaction is an idempotent no-op', async () => {
      const createTx = new CreateTransactionUseCase(
        txRepo,
        accountRepo,
        categoryRepo,
        syncPort,
        unitOfWork
      );
      const deleteTx = new DeleteTransactionUseCase(txRepo, syncPort, unitOfWork);

      const created = await createTx.execute({
        userId: testUserId,
        type: 'expense',
        amountPaise: 30000,
        accountId: testSourceAccId,
        title: 'Supplies'
      });

      await deleteTx.execute(created.id, testUserId);
      expect(syncPort.enqueued.length).toBe(2);

      // Second delete execution must no-op without re-incrementing or re-enqueueing
      await deleteTx.execute(created.id, testUserId);
      expect(syncPort.enqueued.length).toBe(2);

      const inRepo = await txRepo.findById(createTransactionId(created.id));
      expect(inRepo?.version).toBe(2);
    });

    it('rolls back soft-delete when outbox enqueue fails', async () => {
      const createTx = new CreateTransactionUseCase(
        txRepo,
        accountRepo,
        categoryRepo,
        syncPort,
        unitOfWork
      );
      const deleteTx = new DeleteTransactionUseCase(txRepo, syncPort, unitOfWork);

      const created = await createTx.execute({
        userId: testUserId,
        type: 'expense',
        amountPaise: 30000,
        accountId: testSourceAccId,
        title: 'Groceries'
      });

      syncPort.shouldFail = true;

      await expect(deleteTx.execute(created.id, testUserId)).rejects.toThrow('Simulated outbox enqueue failure');

      // Verify transaction remains active at version 1 in repo
      const inRepo = await txRepo.findById(createTransactionId(created.id));
      expect(inRepo?.isDeleted).toBe(false);
      expect(inRepo?.deletedAt).toBeNull();
      expect(inRepo?.version).toBe(1);
    });
  });

  describe('Non-Destructive Outbox Safety', () => {
    it('preserves unrelated outbox records during transaction mutation failures', async () => {
      // Pre-existing account outbox entry
      const existingAccountEntry = {
        userId: testUserId,
        entity: 'accounts' as const,
        entityId: testSourceAccId,
        operation: 'UPDATE' as const,
        payload: { id: testSourceAccId, name: 'Renamed Checking', version: 2 },
        idempotencyKey: 'idemp-acc-upd'
      };
      await syncPort.enqueue(existingAccountEntry);
      expect(syncPort.enqueued.length).toBe(1);

      const createTx = new CreateTransactionUseCase(
        txRepo,
        accountRepo,
        categoryRepo,
        syncPort,
        unitOfWork
      );

      syncPort.shouldFail = true;

      await expect(
        createTx.execute({
          userId: testUserId,
          type: 'expense',
          amountPaise: 5000,
          accountId: testSourceAccId,
          title: 'Snack'
        })
      ).rejects.toThrow();

      // Verify the pre-existing account entry is completely untouched
      expect(syncPort.enqueued.length).toBe(1);
      expect(syncPort.enqueued[0].entity).toBe('accounts');
      expect(syncPort.enqueued[0].entityId).toBe(testSourceAccId);
    });
  });
});

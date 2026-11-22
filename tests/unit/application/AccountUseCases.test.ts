import { describe, it, expect, beforeEach } from 'vitest';
import { CreateAccountUseCase } from '@/application/use-cases/accounts/CreateAccountUseCase';
import { UpdateAccountUseCase } from '@/application/use-cases/accounts/UpdateAccountUseCase';
import { ArchiveAccountUseCase } from '@/application/use-cases/accounts/ArchiveAccountUseCase';
import { RestoreAccountUseCase } from '@/application/use-cases/accounts/RestoreAccountUseCase';
import { GetAccountsWithBalanceUseCase } from '@/application/use-cases/accounts/GetAccountsWithBalanceUseCase';
import { GetAccountDetailsUseCase } from '@/application/use-cases/accounts/GetAccountDetailsUseCase';

import { AccountRepository } from '@/domain/repositories/AccountRepository';
import { TransactionRepository, TransactionFilter } from '@/domain/repositories/TransactionRepository';
import { SyncPort, OutboxEntry, SyncResult } from '@/application/ports/SyncPort';
import { Account } from '@/domain/entities/Account';
import { Transaction } from '@/domain/entities/Transaction';
import { AccountId, TransactionId, UserId, createTransactionId } from '@/domain/value-objects/Identifiers';
import { AccountNotFoundError, UnauthorizedEntityAccessError } from '@/domain/errors/DomainErrors';

// Test Double: In-Memory Account Repository
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

// Test Double: In-Memory Transaction Repository
class InMemoryTransactionRepository implements TransactionRepository {
  public transactions = new Map<string, Transaction>();

  async findById(id: TransactionId): Promise<Transaction | null> {
    return this.transactions.get(id) || null;
  }
  async findByIdempotencyKey(key: string, userId?: UserId): Promise<Transaction | null> {
    return (
      Array.from(this.transactions.values()).find(
        (t) => t.idempotencyKey === key && (!userId || t.userId === userId)
      ) || null
    );
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
  async softDelete(id: TransactionId, deletedAt: Date = new Date()): Promise<void> {
    const tx = this.transactions.get(id);
    if (tx) {
      this.transactions.set(id, tx.markDeleted(deletedAt));
    }
  }
}

// Test Double: Mock Sync Port
class MockSyncPort implements SyncPort {
  public enqueued: Array<Omit<OutboxEntry, 'id' | 'attempts' | 'createdAt'>> = [];

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

describe('Account Management Use Cases (Milestone 5.1)', () => {
  let accountRepo: InMemoryAccountRepository;
  let transactionRepo: InMemoryTransactionRepository;
  let syncPort: MockSyncPort;

  const testUserId = '123e4567-e89b-12d3-a456-426614174000' as UserId;
  const otherUserId = '987fcdeb-51a2-43f7-9876-543210987654' as UserId;

  beforeEach(() => {
    accountRepo = new InMemoryAccountRepository();
    transactionRepo = new InMemoryTransactionRepository();
    syncPort = new MockSyncPort();
  });

  describe('CreateAccountUseCase', () => {
    it('creates an account with all required and optional fields including notes', async () => {
      const useCase = new CreateAccountUseCase(accountRepo, syncPort);

      const created = await useCase.execute({
        userId: testUserId,
        name: 'HDFC Salary Account',
        accountType: 'bank',
        openingBalancePaise: 2500000, // ₹25,000.00
        currency: 'INR',
        institutionName: 'HDFC Bank',
        color: '#D6AD60',
        icon: 'landmark',
        notes: 'Primary salary credit account'
      });

      expect(created.id).toBeDefined();
      expect(created.name).toBe('HDFC Salary Account');
      expect(created.accountType).toBe('bank');
      expect(created.openingBalancePaise).toBe(2500000);
      expect(created.openingBalanceFormatted).toBe('₹25,000.00');
      expect(created.institutionName).toBe('HDFC Bank');
      expect(created.color).toBe('#D6AD60');
      expect(created.notes).toBe('Primary salary credit account');
      expect(created.isArchived).toBe(false);

      // Verify persisted in repo
      const stored = await accountRepo.findById(created.id);
      expect(stored).not.toBeNull();
      expect(stored?.notes).toBe('Primary salary credit account');

      // Verify sync outbox enqueue
      expect(syncPort.enqueued.length).toBe(1);
      expect(syncPort.enqueued[0].entity).toBe('accounts');
      expect(syncPort.enqueued[0].operation).toBe('INSERT');
    });
  });

  describe('UpdateAccountUseCase', () => {
    it('updates account metadata while preserving immutable opening balance', async () => {
      const createUseCase = new CreateAccountUseCase(accountRepo, syncPort);
      const updateUseCase = new UpdateAccountUseCase(accountRepo, syncPort);

      const created = await createUseCase.execute({
        userId: testUserId,
        name: 'SBI Old Name',
        accountType: 'savings',
        openingBalancePaise: 1000000,
        currency: 'INR',
        notes: 'Old notes'
      });

      syncPort.clearOutbox();

      const updated = await updateUseCase.execute({
        id: created.id,
        name: 'SBI Main Savings',
        accountType: 'savings',
        institutionName: 'State Bank of India',
        color: '#72B895',
        icon: 'piggy-bank',
        notes: 'Emergency fund bucket'
      });

      expect(updated.name).toBe('SBI Main Savings');
      expect(updated.institutionName).toBe('State Bank of India');
      expect(updated.notes).toBe('Emergency fund bucket');
      // Opening balance must be unchanged
      expect(updated.openingBalancePaise).toBe(1000000);

      // Verify sync outbox enqueue
      expect(syncPort.enqueued.length).toBe(1);
      expect(syncPort.enqueued[0].entity).toBe('accounts');
      expect(syncPort.enqueued[0].operation).toBe('UPDATE');
    });

    it('throws AccountNotFoundError when updating non-existent account', async () => {
      const updateUseCase = new UpdateAccountUseCase(accountRepo, syncPort);

      await expect(
        updateUseCase.execute({
          id: 'non-existent-id' as AccountId,
          name: 'Ghost Account',
          accountType: 'cash'
        })
      ).rejects.toThrow(AccountNotFoundError);
    });
  });

  describe('ArchiveAccountUseCase & RestoreAccountUseCase', () => {
    it('archives and restores an account with sync outbox events', async () => {
      const createUseCase = new CreateAccountUseCase(accountRepo, syncPort);
      const archiveUseCase = new ArchiveAccountUseCase(accountRepo, syncPort);
      const restoreUseCase = new RestoreAccountUseCase(accountRepo, syncPort);

      const created = await createUseCase.execute({
        userId: testUserId,
        name: 'Old Wallet',
        accountType: 'wallet',
        openingBalancePaise: 0,
        currency: 'INR'
      });

      // Archive
      await archiveUseCase.execute(created.id);
      const archived = await accountRepo.findById(created.id);
      expect(archived?.isArchived).toBe(true);
      expect(archived?.version).toBe(2);

      // Restore
      await restoreUseCase.execute(created.id);
      const restored = await accountRepo.findById(created.id);
      expect(restored?.isArchived).toBe(false);
      expect(restored?.version).toBe(3);

      // Verify sync events were enqueued as UPDATE operations
      const outboxOps = syncPort.enqueued.map((e) => e.operation);
      expect(outboxOps).toEqual(['INSERT', 'UPDATE', 'UPDATE']);
      expect(syncPort.enqueued[1].payload.is_archived).toBe(true);
      expect(syncPort.enqueued[1].payload.version).toBe(2);
      expect(syncPort.enqueued[2].payload.is_archived).toBe(false);
      expect(syncPort.enqueued[2].payload.version).toBe(3);
    });

    it('throws AccountNotFoundError when restoring non-existent account', async () => {
      const restoreUseCase = new RestoreAccountUseCase(accountRepo, syncPort);
      await expect(restoreUseCase.execute('missing-id' as AccountId)).rejects.toThrow(
        AccountNotFoundError
      );
    });
  });

  describe('GetAccountsWithBalanceUseCase', () => {
    it('derives real-time balances using LedgerRules (opening + inflows - outflows)', async () => {
      const createUseCase = new CreateAccountUseCase(accountRepo, syncPort);
      const getAccountsWithBalance = new GetAccountsWithBalanceUseCase(accountRepo, transactionRepo);

      // Account 1: Bank (Opening ₹10,000)
      const bank = await createUseCase.execute({
        userId: testUserId,
        name: 'ICICI Current',
        accountType: 'bank',
        openingBalancePaise: 1000000, // ₹10,000.00
        currency: 'INR'
      });

      // Income transaction (+₹5,000)
      await transactionRepo.save(
        new Transaction({
          id: createTransactionId(crypto.randomUUID()),
          userId: testUserId,
          title: 'Monthly Salary',
          accountId: bank.id,
          amountPaise: 500000,
          currency: 'INR',
          type: 'income',
          categoryId: 'cat-1' as any,
          transactionDate: new Date(),
          idempotencyKey: crypto.randomUUID()
        })
      );

      // Expense transaction (-₹2,000)
      await transactionRepo.save(
        new Transaction({
          id: createTransactionId(crypto.randomUUID()),
          userId: testUserId,
          title: 'Electricity Bill',
          accountId: bank.id,
          amountPaise: 200000,
          currency: 'INR',
          type: 'expense',
          categoryId: 'cat-2' as any,
          transactionDate: new Date(),
          idempotencyKey: crypto.randomUUID()
        })
      );

      const accountsWithBalance = await getAccountsWithBalance.execute(testUserId, true);
      expect(accountsWithBalance.length).toBe(1);

      const result = accountsWithBalance[0];
      // 1000000 + 500000 - 200000 = 1300000 (₹13,000.00)
      expect(result.currentBalancePaise).toBe(1300000);
      expect(result.currentBalanceFormatted).toBe('₹13,000.00');
    });

    it('excludes archived accounts when includeArchived is false', async () => {
      const createUseCase = new CreateAccountUseCase(accountRepo, syncPort);
      const archiveUseCase = new ArchiveAccountUseCase(accountRepo, syncPort);
      const getAccountsWithBalance = new GetAccountsWithBalanceUseCase(accountRepo, transactionRepo);

      const activeAcc = await createUseCase.execute({
        userId: testUserId,
        name: 'Active Account',
        accountType: 'bank',
        openingBalancePaise: 1000,
        currency: 'INR'
      });

      const toArchiveAcc = await createUseCase.execute({
        userId: testUserId,
        name: 'Archived Account',
        accountType: 'cash',
        openingBalancePaise: 0,
        currency: 'INR'
      });

      await archiveUseCase.execute(toArchiveAcc.id);

      const withoutArchived = await getAccountsWithBalance.execute(testUserId, false);
      expect(withoutArchived.length).toBe(1);
      expect(withoutArchived[0].id).toBe(activeAcc.id);

      const withArchived = await getAccountsWithBalance.execute(testUserId, true);
      expect(withArchived.length).toBe(2);
    });
  });

  describe('GetAccountDetailsUseCase', () => {
    it('returns detailed account info and transaction count for owner', async () => {
      const createUseCase = new CreateAccountUseCase(accountRepo, syncPort);
      const getDetailsUseCase = new GetAccountDetailsUseCase(accountRepo, transactionRepo);

      const acc = await createUseCase.execute({
        userId: testUserId,
        name: 'Kotak 811',
        accountType: 'savings',
        openingBalancePaise: 500000,
        currency: 'INR',
        notes: 'Interest earning balance'
      });

      // Add 2 transactions
      await transactionRepo.save(
        new Transaction({
          id: createTransactionId(crypto.randomUUID()),
          userId: testUserId,
          title: 'Direct Dividend',
          accountId: acc.id,
          amountPaise: 100000,
          currency: 'INR',
          type: 'income',
          categoryId: 'cat-1' as any,
          transactionDate: new Date(),
          idempotencyKey: crypto.randomUUID()
        })
      );
      await transactionRepo.save(
        new Transaction({
          id: createTransactionId(crypto.randomUUID()),
          userId: testUserId,
          title: 'Grocery Supermart',
          accountId: acc.id,
          amountPaise: 50000,
          currency: 'INR',
          type: 'expense',
          categoryId: 'cat-2' as any,
          transactionDate: new Date(),
          idempotencyKey: crypto.randomUUID()
        })
      );

      const details = await getDetailsUseCase.execute(acc.id, testUserId);
      expect(details.id).toBe(acc.id);
      expect(details.name).toBe('Kotak 811');
      expect(details.notes).toBe('Interest earning balance');
      expect(details.currentBalancePaise).toBe(550000); // 500000 + 100000 - 50000
      expect(details.transactionCount).toBe(2);
    });

    it('enforces tenant isolation and throws UnauthorizedEntityAccessError if requested by another user', async () => {
      const createUseCase = new CreateAccountUseCase(accountRepo, syncPort);
      const getDetailsUseCase = new GetAccountDetailsUseCase(accountRepo, transactionRepo);

      const acc = await createUseCase.execute({
        userId: testUserId,
        name: 'Private Vault',
        accountType: 'cash',
        openingBalancePaise: 100000,
        currency: 'INR'
      });

      await expect(getDetailsUseCase.execute(acc.id, otherUserId)).rejects.toThrow(
        UnauthorizedEntityAccessError
      );
    });
  });
});

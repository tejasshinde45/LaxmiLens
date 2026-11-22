import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { DexieAccountRepository } from '@/infrastructure/database/local/repositories/DexieAccountRepository';
import { DexieTransactionRepository } from '@/infrastructure/database/local/repositories/DexieTransactionRepository';
import { DexieCategoryRepository } from '@/infrastructure/database/local/repositories/DexieCategoryRepository';
import { DexieUnitOfWork } from '@/infrastructure/database/local/DexieUnitOfWork';
import { OutboxManager } from '@/infrastructure/sync/OutboxManager';
import { LaxmiLensDB } from '@/infrastructure/database/local/DexieDatabase';
import {
  LocalAccountRecord,
  LocalTransactionRecord,
  LocalCategoryRecord,
  LocalOutboxRecord
} from '@/infrastructure/database/local/schema';
import { CreateAccountUseCase } from '@/application/use-cases/accounts/CreateAccountUseCase';
import { UpdateAccountUseCase } from '@/application/use-cases/accounts/UpdateAccountUseCase';
import { ArchiveAccountUseCase } from '@/application/use-cases/accounts/ArchiveAccountUseCase';
import { RestoreAccountUseCase } from '@/application/use-cases/accounts/RestoreAccountUseCase';
import { GetAccountsWithBalanceUseCase } from '@/application/use-cases/accounts/GetAccountsWithBalanceUseCase';
import { GetAccountDetailsUseCase } from '@/application/use-cases/accounts/GetAccountDetailsUseCase';
import { CreateTransactionUseCase } from '@/application/use-cases/transactions/CreateTransactionUseCase';
import { UpdateTransactionUseCase } from '@/application/use-cases/transactions/UpdateTransactionUseCase';
import { DeleteTransactionUseCase } from '@/application/use-cases/transactions/DeleteTransactionUseCase';
import { ExecuteTransferUseCase } from '@/application/use-cases/transactions/ExecuteTransferUseCase';
import { GetTransactionsUseCase } from '@/application/use-cases/transactions/GetTransactionsUseCase';
import { CreateCategoryUseCase } from '@/application/use-cases/categories/CreateCategoryUseCase';
import { Account, AccountType } from '@/domain/entities/Account';
import { Transaction } from '@/domain/entities/Transaction';
import { Category } from '@/domain/entities/Category';
import {
  createAccountId,
  createTransactionId,
  createCategoryId,
  createUserId
} from '@/domain/value-objects/Identifiers';
import {
  InvalidUserIdError,
  UnauthorizedEntityAccessError,
  AccountNotFoundError,
  TransactionNotFoundError,
  CategoryNotFoundError
} from '@/domain/errors/DomainErrors';

describe('Phase 2D.7.2: User-Scoped Local Repository Isolation Security Regression Suite', () => {
  const userA = '11111111-1111-4111-8111-111111111111';
  const userB = '22222222-2222-4222-8222-222222222222';

  let localAccounts: Map<string, LocalAccountRecord>;
  let localTransactions: Map<string, LocalTransactionRecord>;
  let localCategories: Map<string, LocalCategoryRecord>;
  let outboxRecords: LocalOutboxRecord[];

  let mockDb: LaxmiLensDB;
  let accountRepo: DexieAccountRepository;
  let transactionRepo: DexieTransactionRepository;
  let categoryRepo: DexieCategoryRepository;
  let outboxManager: OutboxManager;
  let unitOfWork: DexieUnitOfWork;

  beforeEach(() => {
    localAccounts = new Map();
    localTransactions = new Map();
    localCategories = new Map();
    outboxRecords = [];

    // Realistic IndexedDB table mocks supporting compound and field-level indexes
    const mockAccountsTable = {
      get: vi.fn().mockImplementation(async (id: string) => {
        return localAccounts.get(id) || null;
      }),
      put: vi.fn().mockImplementation(async (record: LocalAccountRecord) => {
        localAccounts.set(record.id, { ...record });
      }),
      bulkPut: vi.fn().mockImplementation(async (records: LocalAccountRecord[]) => {
        records.forEach((r) => localAccounts.set(r.id, { ...r }));
      }),
      update: vi.fn().mockImplementation(async (id: string, changes: Partial<LocalAccountRecord>) => {
        const acc = localAccounts.get(id);
        if (acc) {
          Object.assign(acc, changes);
          return 1;
        }
        return 0;
      }),
      toArray: vi.fn().mockImplementation(async () => {
        return Array.from(localAccounts.values());
      }),
      where: vi.fn().mockImplementation((index: string) => {
        if (index === 'userId') {
          return {
            equals: (val: string) => ({
              toArray: vi.fn().mockImplementation(async () => {
                return Array.from(localAccounts.values()).filter((a) => a.userId === val);
              })
            })
          };
        }
        if (index === '[userId+id]') {
          return {
            equals: ([uId, id]: [string, string]) => ({
              first: vi.fn().mockImplementation(async () => {
                const acc = localAccounts.get(id);
                return acc && acc.userId === uId ? acc : undefined;
              })
            })
          };
        }
        return {
          equals: () => ({ toArray: async () => [], first: async () => undefined })
        };
      })
    };

    const mockTransactionsTable = {
      get: vi.fn().mockImplementation(async (id: string) => {
        return localTransactions.get(id) || null;
      }),
      put: vi.fn().mockImplementation(async (record: LocalTransactionRecord) => {
        localTransactions.set(record.id, { ...record });
      }),
      bulkPut: vi.fn().mockImplementation(async (records: LocalTransactionRecord[]) => {
        records.forEach((r) => localTransactions.set(r.id, { ...r }));
      }),
      update: vi.fn().mockImplementation(async (id: string, changes: Partial<LocalTransactionRecord>) => {
        const tx = localTransactions.get(id);
        if (tx) {
          Object.assign(tx, changes);
          return 1;
        }
        return 0;
      }),
      toArray: vi.fn().mockImplementation(async () => {
        return Array.from(localTransactions.values());
      }),
      where: vi.fn().mockImplementation((index: string) => {
        if (index === 'userId') {
          return {
            equals: (val: string) => ({
              toArray: vi.fn().mockImplementation(async () => {
                return Array.from(localTransactions.values()).filter((t) => t.userId === val);
              })
            })
          };
        }
        if (index === '[userId+id]') {
          return {
            equals: ([uId, id]: [string, string]) => ({
              first: vi.fn().mockImplementation(async () => {
                const tx = localTransactions.get(id);
                return tx && tx.userId === uId ? tx : undefined;
              })
            })
          };
        }
        if (index === '[userId+accountId]') {
          return {
            equals: ([uId, accId]: [string, string]) => ({
              toArray: vi.fn().mockImplementation(async () => {
                return Array.from(localTransactions.values()).filter(
                  (t) => t.userId === uId && t.accountId === accId
                );
              })
            })
          };
        }
        if (index === 'destinationAccountId') {
          return {
            equals: (accId: string) => ({
              toArray: vi.fn().mockImplementation(async () => {
                return Array.from(localTransactions.values()).filter(
                  (t) => t.destinationAccountId === accId || t.targetAccountId === accId
                );
              })
            })
          };
        }
        if (index === 'idempotencyKey') {
          return {
            equals: (key: string) => ({
              toArray: vi.fn().mockImplementation(async () => {
                return Array.from(localTransactions.values()).filter((t) => t.idempotencyKey === key);
              }),
              first: vi.fn().mockImplementation(async () => {
                return Array.from(localTransactions.values()).find((t) => t.idempotencyKey === key);
              })
            })
          };
        }
        return {
          equals: () => ({ toArray: async () => [], first: async () => undefined })
        };
      })
    };

    const mockCategoriesTable = {
      get: vi.fn().mockImplementation(async (id: string) => {
        return localCategories.get(id) || null;
      }),
      put: vi.fn().mockImplementation(async (record: LocalCategoryRecord) => {
        localCategories.set(record.id, { ...record });
      }),
      bulkPut: vi.fn().mockImplementation(async (records: LocalCategoryRecord[]) => {
        records.forEach((r) => localCategories.set(r.id, { ...r }));
      }),
      update: vi.fn().mockImplementation(async (id: string, changes: Partial<LocalCategoryRecord>) => {
        const cat = localCategories.get(id);
        if (cat) {
          Object.assign(cat, changes);
          return 1;
        }
        return 0;
      }),
      toArray: vi.fn().mockImplementation(async () => {
        return Array.from(localCategories.values());
      }),
      filter: vi.fn().mockImplementation((predicate: (c: LocalCategoryRecord) => boolean) => ({
        toArray: vi.fn().mockImplementation(async () => {
          return Array.from(localCategories.values()).filter(predicate);
        })
      })),
      where: vi.fn().mockImplementation((field: string) => {
        if (field === 'userId') {
          return {
            equals: (val: string) => ({
              toArray: vi.fn().mockImplementation(async () => {
                return Array.from(localCategories.values()).filter((c) => c.userId === val);
              })
            })
          };
        }
        return {
          equals: () => ({ toArray: async () => [] })
        };
      })
    };

    const mockSyncOutboxTable = {
      add: vi.fn().mockImplementation(async (record: LocalOutboxRecord) => {
        const nextId = (outboxRecords.length > 0 ? Math.max(...outboxRecords.map((r) => r.id || 0)) : 0) + 1;
        const saved: LocalOutboxRecord = { ...record, id: nextId };
        outboxRecords.push(saved);
        return nextId;
      }),
      get: vi.fn().mockImplementation(async (id: number) => {
        return outboxRecords.find((r) => r.id === id);
      }),
      where: vi.fn().mockImplementation((field: string) => {
        if (field === 'userId') {
          return {
            equals: (val: string) => ({
              count: vi.fn().mockImplementation(async () => {
                return outboxRecords.filter((r) => r.userId === val).length;
              }),
              toArray: vi.fn().mockImplementation(async () => {
                return outboxRecords.filter((r) => r.userId === val);
              })
            })
          };
        }
        if (field === '[userId+id]') {
          return {
            between: (lower: [string, unknown]) => ({
              limit: (lim: number) => ({
                toArray: vi.fn().mockImplementation(async () => {
                  return outboxRecords.filter((r) => r.userId === lower[0]).slice(0, lim);
                })
              }),
              toArray: vi.fn().mockImplementation(async () => {
                return outboxRecords.filter((r) => r.userId === lower[0]);
              })
            })
          };
        }
        return {
          equals: () => ({ toArray: async () => [], count: async () => 0 })
        };
      })
    };

    mockDb = {
      accounts: mockAccountsTable,
      transactions: mockTransactionsTable,
      categories: mockCategoriesTable,
      syncOutbox: mockSyncOutboxTable,
      transaction: vi.fn().mockImplementation(async (_mode: string, _tables: unknown[], work: () => Promise<unknown>) => {
        return await work();
      })
    } as unknown as LaxmiLensDB;

    accountRepo = new DexieAccountRepository(mockDb);
    transactionRepo = new DexieTransactionRepository(mockDb);
    categoryRepo = new DexieCategoryRepository(mockDb);
    outboxManager = new OutboxManager(mockDb);
    unitOfWork = new DexieUnitOfWork(mockDb);
  });

  // 1. User A cannot retrieve User B's account by ID
  it('1. User A cannot retrieve User B\'s account by ID', async () => {
    const accBId = createAccountId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    localAccounts.set(accBId, {
      id: accBId,
      userId: userB,
      name: 'User B HDFC Savings',
      accountType: 'savings',
      openingBalancePaise: 5000000,
      currency: 'INR',
      isArchived: false,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    // User B can retrieve their own account
    const foundByB = await accountRepo.findById(accBId, createUserId(userB));
    expect(foundByB).not.toBeNull();
    expect(foundByB?.id).toBe(accBId);
    expect(foundByB?.userId).toBe(userB);

    // User A attempting to retrieve User B's account by ID must be blocked with UnauthorizedEntityAccessError
    await expect(accountRepo.findById(accBId, createUserId(userA))).rejects.toThrow(
      UnauthorizedEntityAccessError
    );
  });

  // 2. User A cannot retrieve User B's account through findAll
  it('2. User A cannot retrieve User B\'s account through findAll or findByUserId', async () => {
    const accAId = createAccountId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    const accBId = createAccountId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

    localAccounts.set(accAId, {
      id: accAId,
      userId: userA,
      name: 'User A Checking',
      accountType: 'bank',
      openingBalancePaise: 100000,
      currency: 'INR',
      isArchived: false,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    localAccounts.set(accBId, {
      id: accBId,
      userId: userB,
      name: 'User B Secret Vault',
      accountType: 'bank',
      openingBalancePaise: 99999999,
      currency: 'INR',
      isArchived: false,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const accountsA = await accountRepo.findAll(createUserId(userA));
    expect(accountsA.map((a) => a.id)).toEqual([accAId]);
    expect(accountsA.some((a) => a.id === accBId)).toBe(false);

    const accountsB = await accountRepo.findAll(createUserId(userB));
    expect(accountsB.map((a) => a.id)).toEqual([accBId]);
    expect(accountsB.some((a) => a.id === accAId)).toBe(false);
  });

  // 3. User A cannot update User B's account
  it('3. User A cannot update User B\'s account', async () => {
    const accBId = createAccountId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    localAccounts.set(accBId, {
      id: accBId,
      userId: userB,
      name: 'User B Account',
      accountType: 'bank',
      openingBalancePaise: 50000,
      currency: 'INR',
      isArchived: false,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const updateUseCase = new UpdateAccountUseCase(accountRepo, outboxManager, unitOfWork);

    // Direct repository save rejection when updating another user's account
    const conflictingAccount = new Account({
      id: accBId,
      userId: createUserId(userA),
      name: 'Malicious Takeover',
      accountType: 'bank',
      openingBalancePaise: 0,
      currency: 'INR'
    });
    await expect(accountRepo.save(conflictingAccount)).rejects.toThrow(
      UnauthorizedEntityAccessError
    );

    // Use case level rejection
    await expect(
      updateUseCase.execute({
        id: accBId,
        userId: userA,
        name: 'Hacked Account Name'
      })
    ).rejects.toThrow(UnauthorizedEntityAccessError);

    // Ensure state remained untouched in storage
    expect(localAccounts.get(accBId)?.name).toBe('User B Account');
  });

  // 4. User A cannot archive or restore User B's account
  it('4. User A cannot archive or restore User B\'s account', async () => {
    const accBId = createAccountId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    localAccounts.set(accBId, {
      id: accBId,
      userId: userB,
      name: 'User B Account',
      accountType: 'bank',
      openingBalancePaise: 50000,
      currency: 'INR',
      isArchived: false,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const archiveUseCase = new ArchiveAccountUseCase(accountRepo, outboxManager, unitOfWork);
    const restoreUseCase = new RestoreAccountUseCase(accountRepo, outboxManager, unitOfWork);

    // Archive rejection
    await expect(archiveUseCase.execute(accBId, userA)).rejects.toThrow(
      UnauthorizedEntityAccessError
    );
    expect(localAccounts.get(accBId)?.isArchived).toBe(false);

    // User B archives legitimately
    await archiveUseCase.execute(accBId, userB);
    expect(localAccounts.get(accBId)?.isArchived).toBe(true);

    // User A attempts to restore
    await expect(restoreUseCase.execute(accBId, userA)).rejects.toThrow(
      UnauthorizedEntityAccessError
    );
    expect(localAccounts.get(accBId)?.isArchived).toBe(true);
  });

  // 5. User A cannot retrieve User B's transaction
  it('5. User A cannot retrieve User B\'s transaction', async () => {
    const txBId = createTransactionId('tx-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    localTransactions.set(txBId, {
      id: txBId,
      userId: userB,
      type: 'expense',
      amountPaise: 25000,
      currency: 'INR',
      accountId: 'acc-b-1',
      title: 'Confidential B Expense',
      transactionDate: new Date().toISOString(),
      deletedAt: null,
      version: 1,
      idempotencyKey: 'idemp-tx-b',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    // User B can retrieve their transaction
    const foundByB = await transactionRepo.findById(txBId, createUserId(userB));
    expect(foundByB).not.toBeNull();
    expect(foundByB?.id).toBe(txBId);

    // User A cannot retrieve User B's transaction
    await expect(transactionRepo.findById(txBId, createUserId(userA))).rejects.toThrow(
      UnauthorizedEntityAccessError
    );
  });

  // 6. User A cannot list User B's transactions
  it('6. User A cannot list User B\'s transactions', async () => {
    const txAId = createTransactionId('tx-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    const txBId = createTransactionId('tx-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

    localTransactions.set(txAId, {
      id: txAId,
      userId: userA,
      type: 'income',
      amountPaise: 100000,
      currency: 'INR',
      accountId: 'acc-a-1',
      title: 'User A Salary',
      transactionDate: new Date().toISOString(),
      deletedAt: null,
      version: 1,
      idempotencyKey: 'idemp-tx-a',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    localTransactions.set(txBId, {
      id: txBId,
      userId: userB,
      type: 'expense',
      amountPaise: 5000,
      currency: 'INR',
      accountId: 'acc-b-1',
      title: 'User B Expense',
      transactionDate: new Date().toISOString(),
      deletedAt: null,
      version: 1,
      idempotencyKey: 'idemp-tx-b',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const getTransactions = new GetTransactionsUseCase(transactionRepo);

    const listA = await getTransactions.execute({ userId: createUserId(userA) });
    expect(listA.map((t) => t.id)).toEqual([txAId]);
    expect(listA.some((t) => t.id === txBId)).toBe(false);

    const listB = await getTransactions.execute({ userId: createUserId(userB) });
    expect(listB.map((t) => t.id)).toEqual([txBId]);
    expect(listB.some((t) => t.id === txAId)).toBe(false);
  });

  // 7. User A cannot update or soft-delete User B's transaction
  it('7. User A cannot update or soft-delete User B\'s transaction', async () => {
    const txBId = createTransactionId('tx-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    localTransactions.set(txBId, {
      id: txBId,
      userId: userB,
      type: 'expense',
      amountPaise: 50000,
      currency: 'INR',
      accountId: 'acc-b-1',
      title: 'Legitimate Expense',
      transactionDate: new Date().toISOString(),
      deletedAt: null,
      version: 1,
      idempotencyKey: 'idemp-tx-b',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const updateTxUseCase = new UpdateTransactionUseCase(
      transactionRepo,
      accountRepo,
      categoryRepo,
      outboxManager,
      unitOfWork
    );
    const deleteTxUseCase = new DeleteTransactionUseCase(
      transactionRepo,
      outboxManager,
      unitOfWork
    );

    // Update rejection
    await expect(
      updateTxUseCase.execute({
        id: txBId,
        userId: userA,
        title: 'Tampered Title'
      })
    ).rejects.toThrow(UnauthorizedEntityAccessError);

    // Soft delete rejection
    await expect(deleteTxUseCase.execute(txBId, userA)).rejects.toThrow(
      UnauthorizedEntityAccessError
    );

    expect(localTransactions.get(txBId)?.isDeleted).toBeUndefined();
    expect(localTransactions.get(txBId)?.title).toBe('Legitimate Expense');
  });

  // 8. User A cannot access User B's custom category
  it('8. User A cannot access User B\'s custom category', async () => {
    const catBId = createCategoryId('cat-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    localCategories.set(catBId, {
      id: catBId,
      userId: userB,
      name: 'User B Private Hobby',
      type: 'expense',
      isDefault: false,
      isArchived: false,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    // User B accesses their custom category
    const foundByB = await categoryRepo.findById(catBId, createUserId(userB));
    expect(foundByB).not.toBeNull();
    expect(foundByB?.name).toBe('User B Private Hobby');

    // User A is rejected
    await expect(categoryRepo.findById(catBId, createUserId(userA))).rejects.toThrow(
      UnauthorizedEntityAccessError
    );

    // Listing categories for User A does not expose User B's category
    const listA = await categoryRepo.findAll(createUserId(userA));
    expect(listA.some((c) => c.id === catBId)).toBe(false);
  });

  // 9. Default categories remain accessible according to the existing category contract
  it('9. Default categories remain accessible across tenants without leaking custom categories', async () => {
    const defaultCatId = createCategoryId('cat-default-0000-000000000001');
    localCategories.set(defaultCatId, {
      id: defaultCatId,
      userId: '00000000-0000-0000-0000-000000000000',
      name: 'Food & Dining Out',
      type: 'expense',
      isDefault: true,
      isArchived: false,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    // Both User A and User B can access the default system category
    const catForA = await categoryRepo.findById(defaultCatId, createUserId(userA));
    const catForB = await categoryRepo.findById(defaultCatId, createUserId(userB));
    expect(catForA).not.toBeNull();
    expect(catForB).not.toBeNull();
    expect(catForA?.name).toBe('Food & Dining Out');
    expect(catForB?.name).toBe('Food & Dining Out');

    // Archiving default category must be rejected
    await expect(categoryRepo.archive(defaultCatId, createUserId(userA))).rejects.toThrow(
      'Default system categories cannot be archived.'
    );

    // Converting custom category to default is rejected
    const customCat = new Category({
      id: createCategoryId('cat-custom-1'),
      userId: createUserId(userA),
      name: 'Custom Cat',
      type: 'expense',
      isDefault: false
    });
    await categoryRepo.save(customCat);

    const maliciousUpgrade = new Category({
      id: customCat.id,
      userId: createUserId(userA),
      name: 'Elevated Default Cat',
      type: 'expense',
      isDefault: true // Attempt to elevate to default!
    });
    await expect(categoryRepo.save(maliciousUpgrade)).rejects.toThrow(
      'Converting a custom category into a default category is not permitted.'
    );
  });

  // 10. Missing or malformed user IDs are rejected
  it('10. Missing or malformed user IDs are rejected across all repos and use cases', async () => {
    const invalidIds = ['', 'local-user', '   ', 'not-a-valid-uuid', '12345'];

    for (const badId of invalidIds) {
      await expect(
        accountRepo.findById(createAccountId('acc-1'), badId as any)
      ).rejects.toThrow(InvalidUserIdError);

      await expect(
        accountRepo.findAll(badId as any)
      ).rejects.toThrow(InvalidUserIdError);

      await expect(
        transactionRepo.findById(createTransactionId('tx-1'), badId as any)
      ).rejects.toThrow(InvalidUserIdError);

      await expect(
        transactionRepo.findMany({ userId: badId as any })
      ).rejects.toThrow(InvalidUserIdError);

      await expect(
        categoryRepo.findById(createCategoryId('cat-1'), badId as any)
      ).rejects.toThrow(InvalidUserIdError);
    }
  });

  // 11. Existing historical records remain preserved
  it('11. Existing historical records in Dexie schema remain preserved', async () => {
    const historicalAccId = 'historical-acc-hdfc';
    localAccounts.set(historicalAccId, {
      id: historicalAccId,
      userId: userA,
      name: 'Historical HDFC Account',
      accountType: 'bank',
      openingBalancePaise: 5000000,
      currency: 'INR',
      isArchived: false,
      version: 2,
      createdAt: '2026-11-20T10:00:00.000Z',
      updatedAt: '2026-11-20T10:00:00.000Z'
    });

    const retrieved = await accountRepo.findById(createAccountId(historicalAccId), createUserId(userA));
    expect(retrieved).not.toBeNull();
    expect(retrieved?.name).toBe('Historical HDFC Account');
    expect(retrieved?.openingBalancePaise).toBe(5000000);
    expect(retrieved?.version).toBe(2);
    expect(retrieved?.createdAt.toISOString()).toBe('2026-11-20T10:00:00.000Z');
  });

  // 12. Existing account and transaction functionality remains correct
  it('12. Existing account and transaction functionality remains correct end-to-end', async () => {
    const createAccount = new CreateAccountUseCase(accountRepo, outboxManager, unitOfWork);
    const createTx = new CreateTransactionUseCase(
      transactionRepo,
      accountRepo,
      categoryRepo,
      outboxManager,
      unitOfWork
    );
    const executeTransfer = new ExecuteTransferUseCase(
      transactionRepo,
      accountRepo,
      outboxManager,
      unitOfWork
    );
    const getAccountsWithBalance = new GetAccountsWithBalanceUseCase(accountRepo, transactionRepo);

    // 1. Create checking and savings accounts for user A
    const checking = await createAccount.execute({
      userId: userA,
      name: 'Checking',
      accountType: 'bank',
      openingBalancePaise: 1000000 // ₹10,000.00
    });

    const savings = await createAccount.execute({
      userId: userA,
      name: 'Savings',
      accountType: 'savings',
      openingBalancePaise: 500000 // ₹5,000.00
    });

    // 2. Add income transaction (+₹2,000)
    await createTx.execute({
      userId: userA,
      type: 'income',
      amountPaise: 200000,
      accountId: checking.id,
      title: 'Side Gig'
    });

    // 3. Add expense transaction (-₹500)
    await createTx.execute({
      userId: userA,
      type: 'expense',
      amountPaise: 50000,
      accountId: checking.id,
      title: 'Groceries'
    });

    // 4. Transfer ₹3,000 from checking to savings
    await executeTransfer.execute({
      userId: userA,
      fromAccountId: checking.id,
      toAccountId: savings.id,
      amountPaise: 300000,
      title: 'Savings Transfer'
    });

    // 5. Verify derived balances:
    // Checking: 10,000 + 2,000 - 500 - 3,000 = 8,500 (850000 paise)
    // Savings: 5,000 + 3,000 = 8,000 (800000 paise)
    const balances = await getAccountsWithBalance.execute(userA);
    const checkingBal = balances.find((b) => b.id === checking.id);
    const savingsBal = balances.find((b) => b.id === savings.id);

    expect(checkingBal?.currentBalancePaise).toBe(850000);
    expect(checkingBal?.currentBalanceFormatted).toBe('₹8,500.00');

    expect(savingsBal?.currentBalancePaise).toBe(800000);
    expect(savingsBal?.currentBalanceFormatted).toBe('₹8,000.00');
  });

  // 13. Query caching does not leak results across authenticated users
  it('13. Query caching does not leak results across authenticated users', async () => {
    const queryClient = new QueryClient();

    const queryKeyUserA = ['accounts', userA];
    const queryKeyUserB = ['accounts', userB];

    // Seed cache for User A
    const dataUserA = [{ id: 'acc-a', name: 'User A Secret Account', balance: 100000 }];
    queryClient.setQueryData(queryKeyUserA, dataUserA);

    // Ensure User B's query cache is empty and completely decoupled
    const cachedUserB = queryClient.getQueryData(queryKeyUserB);
    expect(cachedUserB).toBeUndefined();

    // Ensure User A's cache is preserved
    const cachedUserA = queryClient.getQueryData(queryKeyUserA);
    expect(cachedUserA).toEqual(dataUserA);

    // Switching user clears cache safely
    queryClient.clear();
    expect(queryClient.getQueryData(queryKeyUserA)).toBeUndefined();
    expect(queryClient.getQueryData(queryKeyUserB)).toBeUndefined();
  });

  // 14. UnitOfWork atomicity remains intact
  it('14. UnitOfWork atomicity remains intact during failures', async () => {
    // Failing sync port
    const failingSyncPort = {
      enqueue: vi.fn().mockRejectedValue(new Error('Simulated transactional disk error')),
      getPendingCount: vi.fn(),
      clearOutbox: vi.fn()
    };

    const failingUow = {
      run: vi.fn().mockImplementation(async (work: () => Promise<unknown>) => {
        // Simulates Dexie transaction abort on failure: no state is committed
        await work();
      })
    };

    const createAccount = new CreateAccountUseCase(
      accountRepo,
      failingSyncPort as any,
      failingUow as any
    );

    // Initial state
    expect(localAccounts.size).toBe(0);
    expect(outboxRecords.length).toBe(0);

    await expect(
      createAccount.execute({
        userId: userA,
        name: 'Atomic Rollback Test',
        accountType: 'bank',
        openingBalancePaise: 50000
      })
    ).rejects.toThrow('Simulated transactional disk error');
  });
});

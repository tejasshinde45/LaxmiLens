import React from 'react';
import Dexie from 'dexie';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LaxmiLensDB } from '@/infrastructure/database/local/DexieDatabase';
import {
  LocalAccountRecord,
  LocalBorrowingRecord,
  LocalBorrowingRepaymentRecord,
  LocalOutboxRecord,
  LocalRecurringOccurrenceRecord,
  LocalRecurringRuleRecord,
  LocalTransactionRecord
} from '@/infrastructure/database/local/schema';
import { DexieAccountRepository } from '@/infrastructure/database/local/repositories/DexieAccountRepository';
import { DexieAccountDeletionInspector } from '@/infrastructure/database/local/repositories/DexieAccountDeletionInspector';
import { DexieUnitOfWork } from '@/infrastructure/database/local/DexieUnitOfWork';
import { OutboxManager } from '@/infrastructure/sync/OutboxManager';
import {
  DeleteAccountUseCase,
  AccountDeletionEligibility
} from '@/application/use-cases/accounts/DeleteAccountUseCase';
import { Account } from '@/domain/entities/Account';
import {
  AccountDeletionBlockedError,
  UnauthorizedEntityAccessError
} from '@/domain/errors/DomainErrors';
import {
  createAccountId,
  createUserId
} from '@/domain/value-objects/Identifiers';
import { AccountSyncDispatcher } from '@/infrastructure/sync/dispatchers/AccountSyncDispatcher';
import { SupabaseAccountRepository } from '@/infrastructure/database/cloud/repositories/SupabaseAccountRepository';
import {
  SyncAccountDependencyError,
  SyncConflictError
} from '@/infrastructure/sync/errors/SyncErrors';
import { AccountsPage } from '@/features/accounts/AccountsPage';
import * as useAccountsModule from '@/features/accounts/hooks/useAccounts';
import { AccountWithBalanceDTO } from '@/application/dto/AccountDTO';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn()
  }
}));

const USER_1 = '11111111-1111-4111-8111-111111111111';
const USER_2 = '22222222-2222-4222-8222-222222222222';
const ACC_TARGET = '33333333-3333-4333-8333-333333333301';
const ACC_OTHER = '33333333-3333-4333-8333-333333333302';
const ACC_PB = '33333333-3333-4333-8333-333333333303';
const RULE_1 = '44444444-4444-4444-8444-444444444401';
const OCC_1 = '55555555-5555-4555-8555-555555555501';
const TX_1 = '66666666-6666-4666-8666-666666666601';
const TX_2 = '66666666-6666-4666-8666-666666666602';

function createInMemoryDexieDb() {
  const accounts = new Map<string, LocalAccountRecord>();
  const transactions = new Map<string, LocalTransactionRecord>();
  const recurringRules = new Map<string, LocalRecurringRuleRecord>();
  const recurringOccurrences = new Map<string, LocalRecurringOccurrenceRecord>();
  const borrowings = new Map<string, LocalBorrowingRecord>();
  const borrowingRepayments = new Map<string, LocalBorrowingRepaymentRecord>();
  const syncOutbox = new Map<number, LocalOutboxRecord>();
  let nextOutboxId = 1;

  function makeTable<T extends object, K extends string | number>(
    map: Map<K, T>,
    keyField: keyof T,
    autoIncrement = false
  ) {
    const getAll = () => Array.from(map.values()).map((r) => ({ ...r }));

    return {
      get: vi.fn(async (key: K) => {
        const found = map.get(key);
        return found ? { ...found } : undefined;
      }),
      put: vi.fn(async (record: T) => {
        let key = record[keyField] as unknown as K | undefined;
        if (autoIncrement && (key === undefined || key === null)) {
          key = nextOutboxId++ as unknown as K;
          (record as Record<string, unknown>)[keyField as string] = key;
        }
        map.set(key as K, { ...record });
        return key as K;
      }),
      add: vi.fn(async (record: T) => {
        let key = record[keyField] as unknown as K | undefined;
        if (autoIncrement && (key === undefined || key === null)) {
          key = nextOutboxId++ as unknown as K;
          (record as Record<string, unknown>)[keyField as string] = key;
        }
        map.set(key as K, { ...record });
        return key as K;
      }),
      delete: vi.fn(async (key: K) => {
        map.delete(key);
      }),
      toArray: vi.fn(async () => getAll()),
      where: vi.fn((index: string) => ({
        equals: (val: unknown) => {
          const matched = () =>
            getAll().filter((r) => {
              const rec = r as Record<string, unknown>;
              if (index === '[userId+id]' && Array.isArray(val)) {
                return rec.userId === val[0] && rec.id === val[1];
              }
              return rec[index] === val;
            });
          return {
            toArray: vi.fn(async () => matched()),
            first: vi.fn(async () => matched()[0]),
            count: vi.fn(async () => matched().length)
          };
        },
        between: (
          lower: [string, unknown],
          upper: [string, unknown],
          includeLower = true,
          includeUpper = true
        ) => {
          const targetUserId = lower[0];
          const minVal = lower[1] === Dexie.minKey ? -Infinity : Number(lower[1]);
          const maxVal = upper[1] === Dexie.maxKey ? Infinity : Number(upper[1]);
          const matched = () =>
            getAll()
              .filter((r) => {
                const rec = r as Record<string, unknown>;
                if (rec.userId !== targetUserId) return false;
                const idVal = Number(rec.id ?? 0);
                const ge = includeLower ? idVal >= minVal : idVal > minVal;
                const le = includeUpper ? idVal <= maxVal : idVal < maxVal;
                return ge && le;
              })
              .sort(
                (a, b) =>
                  Number((a as Record<string, unknown>).id) -
                  Number((b as Record<string, unknown>).id)
              );
          return {
            limit: (limitNum: number) => ({
              toArray: vi.fn(async () => matched().slice(0, limitNum))
            }),
            toArray: vi.fn(async () => matched())
          };
        }
      }))
    };
  }

  let txTail: Promise<unknown> = Promise.resolve();

  const dbObj = {
    accounts: makeTable<LocalAccountRecord, string>(accounts, 'id'),
    transactions: makeTable<LocalTransactionRecord, string>(transactions, 'id'),
    recurringRules: makeTable<LocalRecurringRuleRecord, string>(recurringRules, 'id'),
    recurringOccurrences: makeTable<LocalRecurringOccurrenceRecord, string>(
      recurringOccurrences,
      'id'
    ),
    borrowings: makeTable<LocalBorrowingRecord, string>(borrowings, 'id'),
    borrowingRepayments: makeTable<LocalBorrowingRepaymentRecord, string>(
      borrowingRepayments,
      'id'
    ),
    syncOutbox: makeTable<LocalOutboxRecord, number>(syncOutbox, 'id', true),
    transaction: vi.fn(async (...args: unknown[]) => {
      const scope = args[args.length - 1] as () => Promise<unknown>;
      const run = txTail.then(async () => {
        const snap = {
          accounts: new Map(accounts),
          transactions: new Map(transactions),
          recurringRules: new Map(recurringRules),
          recurringOccurrences: new Map(recurringOccurrences),
          borrowings: new Map(borrowings),
          borrowingRepayments: new Map(borrowingRepayments),
          syncOutbox: new Map(syncOutbox)
        };
        try {
          return await scope();
        } catch (err) {
          accounts.clear();
          snap.accounts.forEach((v, k) => accounts.set(k, v));
          transactions.clear();
          snap.transactions.forEach((v, k) => transactions.set(k, v));
          recurringRules.clear();
          snap.recurringRules.forEach((v, k) => recurringRules.set(k, v));
          recurringOccurrences.clear();
          snap.recurringOccurrences.forEach((v, k) => recurringOccurrences.set(k, v));
          borrowings.clear();
          snap.borrowings.forEach((v, k) => borrowings.set(k, v));
          borrowingRepayments.clear();
          snap.borrowingRepayments.forEach((v, k) => borrowingRepayments.set(k, v));
          syncOutbox.clear();
          snap.syncOutbox.forEach((v, k) => syncOutbox.set(k, v));
          throw err;
        }
      });
      txTail = run.catch(() => undefined);
      return run;
    })
  };

  return dbObj as unknown as LaxmiLensDB;
}

function makeAccountEntity(
  id: string,
  name: string,
  overrides: Partial<ConstructorParameters<typeof Account>[0]> = {}
): Account {
  return new Account({
    id: createAccountId(id),
    userId: createUserId(USER_1),
    name,
    accountType: 'bank',
    openingBalancePaise: 0,
    currency: 'INR',
    isArchived: false,
    version: 1,
    ...overrides
  });
}

describe('Safe Permanent Account Deletion', () => {
  let db: LaxmiLensDB;
  let accountRepo: DexieAccountRepository;
  let inspector: DexieAccountDeletionInspector;
  let outboxManager: OutboxManager;
  let uow: DexieUnitOfWork;
  let useCase: DeleteAccountUseCase;

  beforeEach(async () => {
    db = createInMemoryDexieDb();
    accountRepo = new DexieAccountRepository(db);
    inspector = new DexieAccountDeletionInspector(db);
    outboxManager = new OutboxManager(db);
    uow = new DexieUnitOfWork(db);
    useCase = new DeleteAccountUseCase(accountRepo, inspector, outboxManager, uow);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  it('1. allows permanent deletion of an empty active account and enqueues outbox DELETE atomically', async () => {
    await accountRepo.save(makeAccountEntity(ACC_TARGET, 'Empty Savings'));

    const eligibility = await useCase.checkEligibility(ACC_TARGET, USER_1);
    expect(eligibility.canDelete).toBe(true);
    expect(eligibility.reasons).toEqual([]);

    await useCase.execute(ACC_TARGET, USER_1);

    expect(await db.accounts.get(ACC_TARGET)).toBeUndefined();

    const outbox = await outboxManager.getPendingEntries(USER_1);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].entity).toBe('accounts');
    expect(outbox[0].entityId).toBe(ACC_TARGET);
    expect(outbox[0].operation).toBe('DELETE');
    expect(outbox[0].payload.expected_version).toBe(1);
    expect(outbox[0].payload.version).toBe(2);
    expect(outbox[0].payload.user_id).toBe(USER_1);
    expect(typeof outbox[0].payload.deleted_at).toBe('string');
  });

  it('2. blocks deletion when active transactions reference the account and preserves records', async () => {
    await accountRepo.save(makeAccountEntity(ACC_TARGET, 'Active Tx Bank'));
    await db.transactions.put({
      id: TX_1,
      userId: USER_1,
      type: 'expense',
      amountPaise: 50000,
      currency: 'INR',
      accountId: ACC_TARGET,
      title: 'Coffee',
      transactionDate: new Date().toISOString(),
      deletedAt: null,
      version: 1,
      idempotencyKey: 'k-active-1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const eligibility = await useCase.checkEligibility(ACC_TARGET, USER_1);
    expect(eligibility.canDelete).toBe(false);
    expect(eligibility.reasons.join(' ')).toMatch(/1 active transaction/i);

    await expect(useCase.execute(ACC_TARGET, USER_1)).rejects.toThrow(
      AccountDeletionBlockedError
    );

    expect(await db.accounts.get(ACC_TARGET)).toBeDefined();
    expect(await db.transactions.get(TX_1)).toBeDefined();
    expect(await outboxManager.getPendingEntries(USER_1)).toHaveLength(0);
  });

  it('3. blocks deletion when soft-deleted transaction tombstones reference the account', async () => {
    await accountRepo.save(makeAccountEntity(ACC_TARGET, 'Tombstone Bank'));
    await db.transactions.put({
      id: TX_1,
      userId: USER_1,
      type: 'income',
      amountPaise: 120000,
      currency: 'INR',
      accountId: ACC_TARGET,
      title: 'Deleted Bonus',
      transactionDate: new Date().toISOString(),
      deletedAt: new Date().toISOString(),
      isDeleted: true,
      version: 2,
      idempotencyKey: 'k-deleted-1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const eligibility = await useCase.checkEligibility(ACC_TARGET, USER_1);
    expect(eligibility.canDelete).toBe(false);
    expect(eligibility.reasons.join(' ')).toMatch(/1 deleted transaction tombstone/i);

    await expect(useCase.execute(ACC_TARGET, USER_1)).rejects.toThrow(
      AccountDeletionBlockedError
    );
    expect(await db.accounts.get(ACC_TARGET)).toBeDefined();
    expect(await db.transactions.get(TX_1)).toBeDefined();
  });

  it('4. blocks deletion when account is either source or destination of a transfer', async () => {
    await accountRepo.save(makeAccountEntity(ACC_TARGET, 'Source Bank'));
    await accountRepo.save(makeAccountEntity(ACC_OTHER, 'Destination Bank'));

    await db.transactions.put({
      id: TX_1,
      userId: USER_1,
      type: 'transfer',
      amountPaise: 250000,
      currency: 'INR',
      accountId: ACC_TARGET,
      destinationAccountId: ACC_OTHER,
      title: 'Transfer Out',
      transactionDate: new Date().toISOString(),
      deletedAt: null,
      version: 1,
      idempotencyKey: 'k-transfer-1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const sourceCheck = await useCase.checkEligibility(ACC_TARGET, USER_1);
    expect(sourceCheck.canDelete).toBe(false);
    expect(sourceCheck.reasons.join(' ')).toMatch(/transfer/i);

    const destCheck = await useCase.checkEligibility(ACC_OTHER, USER_1);
    expect(destCheck.canDelete).toBe(false);
    expect(destCheck.reasons.join(' ')).toMatch(/transfer/i);

    await expect(useCase.execute(ACC_TARGET, USER_1)).rejects.toThrow(
      AccountDeletionBlockedError
    );
    await expect(useCase.execute(ACC_OTHER, USER_1)).rejects.toThrow(
      AccountDeletionBlockedError
    );
    expect(await db.transactions.get(TX_1)).toBeDefined();
  });

  it('5. blocks deletion when pending sync outbox operations exist for the account or dependents', async () => {
    await accountRepo.save(makeAccountEntity(ACC_TARGET, 'Unsynced Account'));

    await outboxManager.enqueue({
      userId: USER_1,
      entity: 'accounts',
      entityId: ACC_TARGET,
      operation: 'INSERT',
      payload: {
        id: ACC_TARGET,
        user_id: USER_1,
        name: 'Unsynced Account',
        account_type: 'bank',
        opening_balance_paise: 0,
        currency: 'INR',
        version: 1
      },
      idempotencyKey: 'outbox-acc-insert'
    });

    const eligibility = await useCase.checkEligibility(ACC_TARGET, USER_1);
    expect(eligibility.canDelete).toBe(false);
    expect(eligibility.reasons.join(' ')).toMatch(/pending synchronization operation/i);

    await expect(useCase.execute(ACC_TARGET, USER_1)).rejects.toThrow(
      AccountDeletionBlockedError
    );

    // Original pending INSERT outbox entry must NOT be discarded manually
    const pending = await outboxManager.getPendingEntries(USER_1);
    expect(pending).toHaveLength(1);
    expect(pending[0].operation).toBe('INSERT');
  });

  it('6. blocks deletion when recurring rules or occurrences reference the account', async () => {
    await accountRepo.save(makeAccountEntity(ACC_TARGET, 'Subscription Bank'));
    await db.recurringRules.put({
      id: RULE_1,
      userId: USER_1,
      title: 'Internet Bill',
      type: 'expense',
      amountPaise: 99900,
      accountId: ACC_TARGET,
      frequency: 'monthly',
      interval: 1,
      anchorDayOfMonth: 5,
      startDate: '2026-01-05',
      nextDueDate: '2026-12-05',
      status: 'active',
      requiresUserConfirmation: true,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null
    });
    await db.recurringOccurrences.put({
      id: OCC_1,
      userId: USER_1,
      recurringRuleId: RULE_1,
      occurrenceDate: '2026-12-05',
      status: 'pending',
      idempotencyKey: 'occ-1',
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null
    });

    const eligibility = await useCase.checkEligibility(ACC_TARGET, USER_1);
    expect(eligibility.canDelete).toBe(false);
    expect(eligibility.reasons.join(' ')).toMatch(/recurring rule.*scheduled occurrence/i);

    await expect(useCase.execute(ACC_TARGET, USER_1)).rejects.toThrow(
      AccountDeletionBlockedError
    );
    expect(await db.accounts.get(ACC_TARGET)).toBeDefined();
    expect(await db.recurringRules.get(RULE_1)).toBeDefined();
    expect(await db.recurringOccurrences.get(OCC_1)).toBeDefined();
  });

  it('6b. blocks deletion when borrowing or repayment records reference the account', async () => {
    await accountRepo.save(makeAccountEntity(ACC_TARGET, 'Borrowing Receiving Bank'));
    await db.borrowings.put({
      id: '77777777-7777-4777-8777-777777777701',
      userId: USER_1,
      lenderId: '88888888-8888-4888-8888-888888888801',
      amountPaise: 500000,
      borrowingDate: new Date().toISOString(),
      receivingAccountId: ACC_TARGET,
      transactionId: TX_1,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const eligibility = await useCase.checkEligibility(ACC_TARGET, USER_1);
    expect(eligibility.canDelete).toBe(false);
    expect(eligibility.reasons.join(' ')).toMatch(/borrowing or repayment record/i);

    await expect(useCase.execute(ACC_TARGET, USER_1)).rejects.toThrow(
      AccountDeletionBlockedError
    );
  });

  it('7. allows permanent deletion of an archived account when it has no dependencies', async () => {
    await accountRepo.save(
      makeAccountEntity(ACC_TARGET, 'Archived Empty Account', {
        isArchived: true,
        version: 3
      })
    );

    const eligibility = await useCase.checkEligibility(ACC_TARGET, USER_1);
    expect(eligibility.canDelete).toBe(true);
    expect(eligibility.isArchived).toBe(true);

    await useCase.execute(ACC_TARGET, USER_1);

    expect(await db.accounts.get(ACC_TARGET)).toBeUndefined();
    const outbox = await outboxManager.getPendingEntries(USER_1);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].payload.expected_version).toBe(3);
    expect(outbox[0].payload.version).toBe(4);
  });

  it('8. blocks deletion of system-managed Personal Borrowings account and enforces tenant isolation', async () => {
    await accountRepo.save(
      makeAccountEntity(ACC_PB, 'Personal Borrowings', {
        accountType: 'other',
        systemTag: 'personal_borrowings'
      })
    );

    const eligibility = await useCase.checkEligibility(ACC_PB, USER_1);
    expect(eligibility.canDelete).toBe(false);
    expect(eligibility.isSystemAccount).toBe(true);
    expect(eligibility.reasons.join(' ')).toMatch(/system-managed/i);

    await expect(useCase.execute(ACC_PB, USER_1)).rejects.toThrow(
      AccountDeletionBlockedError
    );
    expect(await db.accounts.get(ACC_PB)).toBeDefined();

    // Cross-tenant attempt must fail cleanly
    await expect(useCase.execute(ACC_PB, USER_2)).rejects.toThrow(
      UnauthorizedEntityAccessError
    );
  });

  it('9. prevents deletion safely if a concurrent dependency is created between eligibility check and execution', async () => {
    await accountRepo.save(makeAccountEntity(ACC_TARGET, 'Race Target Bank'));

    // Initial UI eligibility check succeeds cleanly
    const initialEligibility = await useCase.checkEligibility(ACC_TARGET, USER_1);
    expect(initialEligibility.canDelete).toBe(true);

    // Simulate a concurrent transaction committed before the user confirms deletion
    await db.transactions.put({
      id: TX_2,
      userId: USER_1,
      type: 'expense',
      amountPaise: 45000,
      currency: 'INR',
      accountId: ACC_TARGET,
      title: 'Concurrent Expense',
      transactionDate: new Date().toISOString(),
      deletedAt: null,
      version: 1,
      idempotencyKey: 'k-concurrent-1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    await expect(useCase.execute(ACC_TARGET, USER_1)).rejects.toThrow(
      AccountDeletionBlockedError
    );

    // Account, concurrent transaction, and clean outbox state remain preserved
    expect(await db.accounts.get(ACC_TARGET)).toBeDefined();
    expect(await db.transactions.get(TX_2)).toBeDefined();
    expect(await outboxManager.getPendingEntries(USER_1)).toHaveLength(0);
  });

  it('10. preserves unrelated financial accounts, transactions, recurring rules, and outbox entries on successful deletion', async () => {
    await accountRepo.save(makeAccountEntity(ACC_TARGET, 'Unused Old Bank'));
    await accountRepo.save(
      makeAccountEntity(ACC_OTHER, 'Primary Salary Bank', {
        openingBalancePaise: 5000000
      })
    );

    await db.transactions.put({
      id: TX_1,
      userId: USER_1,
      type: 'income',
      amountPaise: 8000000,
      currency: 'INR',
      accountId: ACC_OTHER,
      title: 'Salary Credit',
      transactionDate: new Date().toISOString(),
      deletedAt: null,
      version: 1,
      idempotencyKey: 'k-other-1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    await db.recurringRules.put({
      id: RULE_1,
      userId: USER_1,
      title: 'Rent',
      type: 'expense',
      amountPaise: 1500000,
      accountId: ACC_OTHER,
      frequency: 'monthly',
      interval: 1,
      anchorDayOfMonth: 1,
      startDate: '2026-01-01',
      nextDueDate: '2026-12-01',
      status: 'active',
      requiresUserConfirmation: true,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null
    });

    await outboxManager.enqueue({
      userId: USER_1,
      entity: 'transactions',
      entityId: TX_1,
      operation: 'INSERT',
      payload: {
        id: TX_1,
        user_id: USER_1,
        account_id: ACC_OTHER
      },
      idempotencyKey: 'outbox-tx-other'
    });

    await useCase.execute(ACC_TARGET, USER_1);

    expect(await db.accounts.get(ACC_TARGET)).toBeUndefined();
    expect(await db.accounts.get(ACC_OTHER)).toBeDefined();
    expect(await db.transactions.get(TX_1)).toBeDefined();
    expect(await db.recurringRules.get(RULE_1)).toBeDefined();

    const outbox = await outboxManager.getPendingEntries(USER_1);
    expect(outbox).toHaveLength(2);
    expect(outbox.some((e) => e.entity === 'transactions' && e.entityId === TX_1)).toBe(true);
    expect(
      outbox.some(
        (e) => e.entity === 'accounts' && e.entityId === ACC_TARGET && e.operation === 'DELETE'
      )
    ).toBe(true);
  });

  it('syncs account DELETE entries cleanly through AccountSyncDispatcher and SupabaseAccountRepository.safeDelete without cascading', async () => {
    const rpcMock = vi.fn().mockResolvedValue({ data: true, error: null });
    const fakeSupabaseClient = {
      rpc: rpcMock,
      from: vi.fn()
    } as unknown as ConstructorParameters<typeof SupabaseAccountRepository>[0];

    const cloudRepo = new SupabaseAccountRepository(fakeSupabaseClient);
    const dispatcher = new AccountSyncDispatcher(
      cloudRepo,
      {
        getCurrentUser: async () => ({ id: USER_1, email: 'user@laxmilens.app' })
      } as ConstructorParameters<typeof AccountSyncDispatcher>[1],
      outboxManager
    );

    await accountRepo.save(makeAccountEntity(ACC_TARGET, 'To Sync Delete'));
    await useCase.execute(ACC_TARGET, USER_1);

    const pending = await outboxManager.getPendingEntries(USER_1);
    expect(pending).toHaveLength(1);

    await dispatcher.dispatch(pending[0]);

    expect(rpcMock).toHaveBeenCalledWith('safe_delete_account', {
      p_account_id: ACC_TARGET,
      p_expected_version: 1,
      p_deleted_at: expect.any(String)
    });
    expect(await outboxManager.getPendingEntries(USER_1)).toHaveLength(0);

    // Verify dependency violation maps to permanent SyncAccountDependencyError
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: {
        code: '23503',
        message: 'Account cannot be deleted because active or deleted transactions reference it.'
      }
    });
    await expect(cloudRepo.safeDelete(ACC_TARGET, USER_1, 1)).rejects.toThrow(
      SyncAccountDependencyError
    );

    // Verify fallback path when RPC is missing (PGRST202) still checks cloud dependencies and never deletes
    const deleteSpy = vi.fn();
    const txBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [{ id: TX_1 }], error: null })
    };
    const emptyDepBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null })
    };
    const accLookupBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: ACC_TARGET,
          user_id: USER_1,
          name: 'To Sync Delete',
          account_type: 'bank',
          opening_balance_paise: 0,
          currency: 'INR',
          system_tag: null,
          is_archived: false,
          version: 1
        },
        error: null
      }),
      delete: deleteSpy
    };
    const fallbackClient = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: 'PGRST202', message: 'Could not find the function public.safe_delete_account' }
      }),
      from: vi.fn((table: string) => {
        if (table === 'accounts') return accLookupBuilder;
        if (table === 'transactions') return txBuilder;
        return emptyDepBuilder;
      })
    } as unknown as ConstructorParameters<typeof SupabaseAccountRepository>[0];

    const fallbackRepo = new SupabaseAccountRepository(fallbackClient);
    await expect(fallbackRepo.safeDelete(ACC_TARGET, USER_1, 1)).rejects.toThrow(
      SyncAccountDependencyError
    );
    expect(deleteSpy).not.toHaveBeenCalled();

    // Verify version conflict maps to SyncConflictError
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: {
        code: '40001',
        message: 'Version conflict on account'
      }
    });
    await expect(cloudRepo.safeDelete(ACC_TARGET, USER_1, 1)).rejects.toThrow(
      SyncConflictError
    );
  });

  it('renders Delete Account action in menu, displays blockers vs confirmation UI, and hides action on Personal Borrowings', async () => {
    const user = userEvent.setup();
    const emptyAcc: AccountWithBalanceDTO = {
      id: ACC_TARGET,
      userId: USER_1,
      name: 'Disposable Savings',
      accountType: 'savings',
      openingBalancePaise: 0,
      openingBalanceFormatted: '₹0.00',
      currentBalancePaise: 0,
      currentBalanceFormatted: '₹0.00',
      currency: 'INR',
      isArchived: false,
      isCreditCard: false,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const busyAcc: AccountWithBalanceDTO = {
      id: ACC_OTHER,
      userId: USER_1,
      name: 'Salary Checking',
      accountType: 'bank',
      openingBalancePaise: 100000,
      openingBalanceFormatted: '₹1,000.00',
      currentBalancePaise: 100000,
      currentBalanceFormatted: '₹1,000.00',
      currency: 'INR',
      isArchived: false,
      isCreditCard: false,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const systemAcc: AccountWithBalanceDTO = {
      id: ACC_PB,
      userId: USER_1,
      name: 'Personal Borrowings',
      accountType: 'other',
      openingBalancePaise: 0,
      openingBalanceFormatted: '₹0.00',
      currentBalancePaise: 0,
      currentBalanceFormatted: '₹0.00',
      currency: 'INR',
      systemTag: 'personal_borrowings',
      isArchived: false,
      isCreditCard: false,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const deleteSpy = vi.fn().mockResolvedValue(undefined);
    const checkEligibilityMock = vi.fn(
      async (accountId: string): Promise<AccountDeletionEligibility> => {
        if (accountId === ACC_OTHER) {
          return {
            accountId: ACC_OTHER,
            accountName: 'Salary Checking',
            accountType: 'bank',
            isArchived: false,
            canDelete: false,
            isSystemAccount: false,
            reasons: ['2 active transactions reference this account.'],
            dependencies: {
              activeTransactionCount: 2,
              transferCount: 0,
              softDeletedTransactionCount: 0,
              activeRecurringRuleCount: 0,
              deletedRecurringRuleCount: 0,
              recurringOccurrenceCount: 0,
              borrowingCount: 0,
              repaymentCount: 0,
              pendingAccountOutboxCount: 0,
              pendingDependentOutboxCount: 0
            }
          };
        }
        return {
          accountId: ACC_TARGET,
          accountName: 'Disposable Savings',
          accountType: 'savings',
          isArchived: false,
          canDelete: true,
          isSystemAccount: false,
          reasons: [],
          dependencies: {
            activeTransactionCount: 0,
            transferCount: 0,
            softDeletedTransactionCount: 0,
            activeRecurringRuleCount: 0,
            deletedRecurringRuleCount: 0,
            recurringOccurrenceCount: 0,
            borrowingCount: 0,
            repaymentCount: 0,
            pendingAccountOutboxCount: 0,
            pendingDependentOutboxCount: 0
          }
        };
      }
    );

    vi.spyOn(useAccountsModule, 'useAccounts').mockReturnValue({
      accounts: [emptyAcc, busyAcc, systemAcc],
      summary: {
        totalNetWorthPaise: 100000,
        totalNetWorthFormatted: '₹1,000.00',
        totalAssetsPaise: 100000,
        totalAssetsFormatted: '₹1,000.00',
        totalLiabilitiesPaise: 0,
        totalLiabilitiesFormatted: '₹0.00',
        activeAccountsCount: 3,
        archivedAccountsCount: 0
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      createAccount: vi.fn(),
      isCreating: false,
      updateAccount: vi.fn(),
      isUpdating: false,
      archiveAccount: vi.fn(),
      isArchiving: false,
      restoreAccount: vi.fn(),
      isRestoring: false
    });

    vi.spyOn(useAccountsModule, 'useAccountDeletion').mockReturnValue({
      checkEligibility: checkEligibilityMock,
      deleteAccount: deleteSpy,
      isDeleting: false
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <AccountsPage />
      </QueryClientProvider>
    );

    // System account must NOT expose Delete Account in actions menu
    await user.click(screen.getByRole('button', { name: 'Options for Personal Borrowings' }));
    expect(screen.queryByRole('menuitem', { name: /delete account/i })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');

    // Account with dependencies displays block reasons and disables deletion
    await user.click(screen.getByRole('button', { name: 'Options for Salary Checking' }));
    await user.click(await screen.findByRole('menuitem', { name: /delete account/i }));

    const blockedDialog = await screen.findByRole('dialog');
    await waitFor(() => {
      expect(
        within(blockedDialog).getByText('Deletion Blocked by Existing Dependencies')
      ).toBeInTheDocument();
    });
    expect(
      within(blockedDialog).getByText('2 active transactions reference this account.')
    ).toBeInTheDocument();
    expect(within(blockedDialog).getByText('Salary Checking')).toBeInTheDocument();
    expect(within(blockedDialog).getByText('Bank Account')).toBeInTheDocument();
    expect(
      within(blockedDialog).queryByRole('button', { name: /delete permanently/i })
    ).not.toBeInTheDocument();

    await user.click(within(blockedDialog).getAllByRole('button', { name: 'Close' })[0]);

    // Eligible account shows name, type, irreversible notice, checkbox gate, then executes
    await user.click(screen.getByRole('button', { name: 'Options for Disposable Savings' }));
    await user.click(await screen.findByRole('menuitem', { name: /delete account/i }));

    const confirmDialog = await screen.findByRole('dialog');
    await waitFor(() => {
      expect(
        within(confirmDialog).getByLabelText(/confirm i want to permanently delete/i)
      ).toBeInTheDocument();
    });
    expect(within(confirmDialog).getAllByText('Disposable Savings').length).toBeGreaterThanOrEqual(1);
    expect(within(confirmDialog).getByText('Savings Account')).toBeInTheDocument();
    const deleteBtn = within(confirmDialog).getByRole('button', { name: /delete permanently/i });
    expect(deleteBtn).toBeDisabled();

    await user.click(
      within(confirmDialog).getByLabelText(/confirm i want to permanently delete/i)
    );
    expect(deleteBtn).toBeEnabled();

    await user.click(deleteBtn);
    await waitFor(() => {
      expect(deleteSpy).toHaveBeenCalledWith(ACC_TARGET);
    });

    qc.clear();
  });
});

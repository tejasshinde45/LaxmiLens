import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  BACKUP_REPLACE_CONFIRMATION_TEXT,
  BackupArchiveDocument
} from '@/application/dto/BackupDTO';
import { AuthPort, AuthUser } from '@/application/ports/AuthPort';
import { BackupSyncActivityGuard } from '@/application/ports/BackupStoragePort';
import { DecryptBackupFileUseCase } from '@/application/use-cases/backup/DecryptBackupFileUseCase';
import { ExecuteBackupRestoreUseCase } from '@/application/use-cases/backup/ExecuteBackupRestoreUseCase';
import { ExportEncryptedBackupUseCase } from '@/application/use-cases/backup/ExportEncryptedBackupUseCase';
import { GenerateRestorePreviewUseCase } from '@/application/use-cases/backup/GenerateRestorePreviewUseCase';
import { BrowserBackupFileExporter } from '@/infrastructure/backup/BrowserBackupFileExporter';
import { ReactQueryBackupCacheInvalidator } from '@/infrastructure/backup/ReactQueryBackupCacheInvalidator';
import { DatabaseManager } from '@/infrastructure/database/local/DatabaseManager';
import { LaxmiLensDB } from '@/infrastructure/database/local/DexieDatabase';
import { DexieBackupRepository } from '@/infrastructure/database/local/repositories/DexieBackupRepository';
import {
  LocalAccountRecord,
  LocalBorrowingRecord,
  LocalBorrowingRepaymentRecord,
  LocalBudgetRecord,
  LocalCategoryRecord,
  LocalLenderRecord,
  LocalNotificationPreferenceRecord,
  LocalNotificationRecord,
  LocalOutboxRecord,
  LocalProfileRecord,
  LocalRecurringOccurrenceRecord,
  LocalRecurringRuleRecord,
  LocalSyncMetadataRecord,
  LocalTransactionRecord
} from '@/infrastructure/database/local/schema';
import {
  BackupDecryptionError,
  BackupOwnershipMismatchError,
  BackupPersistenceError,
  BackupSyncConflictError,
  BackupValidationError,
  InvalidBackupFormatError,
  SafetyBackupRequiredError
} from '@/domain/errors/BackupErrors';
import {
  SafetyBackupReceiptRegistry
} from '@/application/services/SafetyBackupReceiptService';
import {
  ManualSyncCoordinator
} from '@/infrastructure/sync/ManualSyncCoordinator';
import { SyncInProgressError } from '@/infrastructure/sync/errors/SyncErrors';
import { OutboxManager } from '@/infrastructure/sync/OutboxManager';
import { AccountSyncDispatcher } from '@/infrastructure/sync/dispatchers/AccountSyncDispatcher';
import { TransactionSyncDispatcher } from '@/infrastructure/sync/dispatchers/TransactionSyncDispatcher';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '99999999-9999-4999-8999-999999999999';

const ACC_BANK = '22222222-2222-4222-8222-222222222201';
const ACC_BORROW = '22222222-2222-4222-8222-222222222202';
const CAT_EXPENSE = '33333333-3333-4333-8333-333333333301';
const CAT_INCOME = '33333333-3333-4333-8333-333333333302';
const CLOUD_CAT_ID = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
const TX_EXPENSE = '44444444-4444-4444-8444-444444444401';
const TX_BORROW = '44444444-4444-4444-8444-444444444402';
const TX_REPAY = '44444444-4444-4444-8444-444444444403';
const BUDGET_ID = '55555555-5555-4555-8555-555555555501';
const RULE_ID = '66666666-6666-4666-8666-666666666601';
const OCC_ID = '77777777-7777-4777-8777-777777777701';
const LENDER_ID = '88888888-8888-4888-8888-888888888801';
const BORROWING_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const REPAYMENT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const NOTIFICATION_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';

const PASSPHRASE = 'LaxmiLens#Stage2!Vault';

function cloneDeep<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

class InMemoryTable<TRecord extends Record<string, unknown>, TKey extends string | number> {
  private storage = new Map<TKey, TRecord>();

  constructor(
    public readonly name: string,
    private readonly keyField: keyof TRecord & string,
    private readonly autoIncrement = false,
    private readonly getNextAutoId?: () => number
  ) {}

  public snapshot(): Map<TKey, TRecord> {
    const copy = new Map<TKey, TRecord>();
    for (const [k, v] of this.storage.entries()) {
      copy.set(k, cloneDeep(v));
    }
    return copy;
  }

  public restoreSnapshot(snap: Map<TKey, TRecord>): void {
    this.storage = snap;
  }

  public async get(key: TKey): Promise<TRecord | undefined> {
    const val = this.storage.get(key);
    return val ? cloneDeep(val) : undefined;
  }

  public async toArray(): Promise<TRecord[]> {
    return Array.from(this.storage.values()).map((r) => cloneDeep(r));
  }

  public async put(record: TRecord): Promise<TKey> {
    const copy = cloneDeep(record);
    const key = copy[this.keyField] as TKey;
    this.storage.set(key, copy);
    return key;
  }

  public async bulkPut(records: readonly TRecord[]): Promise<TKey> {
    let lastKey!: TKey;
    for (const record of records) {
      lastKey = await this.put(record);
    }
    return lastKey;
  }

  public async bulkAdd(records: readonly TRecord[]): Promise<TKey> {
    let lastKey!: TKey;
    for (const record of records) {
      const copy = cloneDeep(record);
      if (this.autoIncrement && copy[this.keyField] === undefined && this.getNextAutoId) {
        (copy as Record<string, unknown>)[this.keyField] = this.getNextAutoId();
      }
      const key = copy[this.keyField] as TKey;
      this.storage.set(key, copy);
      lastKey = key;
    }
    return lastKey;
  }

  public async delete(key: TKey): Promise<void> {
    this.storage.delete(key);
  }

  public async bulkDelete(keys: readonly TKey[]): Promise<void> {
    for (const key of keys) {
      this.storage.delete(key);
    }
  }

  public where(field: string) {
    return {
      equals: (value: unknown) => ({
        count: async () =>
          Array.from(this.storage.values()).filter((r) => r[field] === value).length,
        toArray: async () =>
          Array.from(this.storage.values())
            .filter((r) => r[field] === value)
            .map((r) => cloneDeep(r))
      })
    };
  }
}

class MockTransactionalLaxmiLensDB {
  public readonly verno = 8;
  private opened = false;
  private nextOutboxAutoId = 100;

  public readonly profiles = new InMemoryTable<LocalProfileRecord & Record<string, unknown>, string>(
    'profiles',
    'id'
  );
  public readonly accounts = new InMemoryTable<LocalAccountRecord & Record<string, unknown>, string>(
    'accounts',
    'id'
  );
  public readonly categories = new InMemoryTable<
    LocalCategoryRecord & Record<string, unknown>,
    string
  >('categories', 'id');
  public readonly transactions = new InMemoryTable<
    LocalTransactionRecord & Record<string, unknown>,
    string
  >('transactions', 'id');
  public readonly budgets = new InMemoryTable<LocalBudgetRecord & Record<string, unknown>, string>(
    'budgets',
    'id'
  );
  public readonly lenders = new InMemoryTable<LocalLenderRecord & Record<string, unknown>, string>(
    'lenders',
    'id'
  );
  public readonly borrowings = new InMemoryTable<
    LocalBorrowingRecord & Record<string, unknown>,
    string
  >('borrowings', 'id');
  public readonly borrowingRepayments = new InMemoryTable<
    LocalBorrowingRepaymentRecord & Record<string, unknown>,
    string
  >('borrowingRepayments', 'id');
  public readonly recurringRules = new InMemoryTable<
    LocalRecurringRuleRecord & Record<string, unknown>,
    string
  >('recurringRules', 'id');
  public readonly recurringOccurrences = new InMemoryTable<
    LocalRecurringOccurrenceRecord & Record<string, unknown>,
    string
  >('recurringOccurrences', 'id');
  public readonly notifications = new InMemoryTable<
    LocalNotificationRecord & Record<string, unknown>,
    string
  >('notifications', 'id');
  public readonly notificationPreferences = new InMemoryTable<
    LocalNotificationPreferenceRecord & Record<string, unknown>,
    string
  >('notificationPreferences', 'userId');
  public readonly syncOutbox = new InMemoryTable<LocalOutboxRecord & Record<string, unknown>, number>(
    'syncOutbox',
    'id',
    true,
    () => this.nextOutboxAutoId++
  );
  public readonly syncMetadata = new InMemoryTable<
    LocalSyncMetadataRecord & Record<string, unknown>,
    string
  >('syncMetadata', 'key');

  public isOpen(): boolean {
    return this.opened;
  }

  public async open(): Promise<this> {
    this.opened = true;
    return this;
  }

  public async close(): Promise<void> {
    this.opened = false;
  }

  public async transaction<T>(
    mode: string,
    _tables: unknown,
    scope: () => Promise<T>
  ): Promise<T> {
    if (mode === 'r') {
      return await scope();
    }

    const snapshots = {
      nextOutboxAutoId: this.nextOutboxAutoId,
      profiles: this.profiles.snapshot(),
      accounts: this.accounts.snapshot(),
      categories: this.categories.snapshot(),
      transactions: this.transactions.snapshot(),
      budgets: this.budgets.snapshot(),
      lenders: this.lenders.snapshot(),
      borrowings: this.borrowings.snapshot(),
      borrowingRepayments: this.borrowingRepayments.snapshot(),
      recurringRules: this.recurringRules.snapshot(),
      recurringOccurrences: this.recurringOccurrences.snapshot(),
      notifications: this.notifications.snapshot(),
      notificationPreferences: this.notificationPreferences.snapshot(),
      syncOutbox: this.syncOutbox.snapshot(),
      syncMetadata: this.syncMetadata.snapshot()
    };

    try {
      return await scope();
    } catch (error) {
      this.nextOutboxAutoId = snapshots.nextOutboxAutoId;
      this.profiles.restoreSnapshot(snapshots.profiles);
      this.accounts.restoreSnapshot(snapshots.accounts);
      this.categories.restoreSnapshot(snapshots.categories);
      this.transactions.restoreSnapshot(snapshots.transactions);
      this.budgets.restoreSnapshot(snapshots.budgets);
      this.lenders.restoreSnapshot(snapshots.lenders);
      this.borrowings.restoreSnapshot(snapshots.borrowings);
      this.borrowingRepayments.restoreSnapshot(snapshots.borrowingRepayments);
      this.recurringRules.restoreSnapshot(snapshots.recurringRules);
      this.recurringOccurrences.restoreSnapshot(snapshots.recurringOccurrences);
      this.notifications.restoreSnapshot(snapshots.notifications);
      this.notificationPreferences.restoreSnapshot(snapshots.notificationPreferences);
      this.syncOutbox.restoreSnapshot(snapshots.syncOutbox);
      this.syncMetadata.restoreSnapshot(snapshots.syncMetadata);
      throw error;
    }
  }
}

function createAuthPort(user: AuthUser | null): AuthPort {
  return {
    getCurrentUser: vi.fn(async () => user),
    signInWithEmail: vi.fn(),
    signUpWithEmail: vi.fn(),
    signInWithOAuth: vi.fn(),
    signOut: vi.fn(),
    resetPasswordForEmail: vi.fn(),
    updatePassword: vi.fn(),
    onAuthStateChange: vi.fn(() => () => {})
  };
}

async function seedFullUserDataset(db: MockTransactionalLaxmiLensDB): Promise<void> {
  await db.profiles.put({
    id: USER_A,
    email: 'usera@example.com',
    displayName: 'User A',
    currency: 'INR',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  });

  await db.accounts.bulkPut([
    {
      id: ACC_BANK,
      userId: USER_A,
      name: 'HDFC Checking',
      accountType: 'bank',
      openingBalancePaise: 500000,
      currency: 'INR',
      isArchived: false,
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    },
    {
      id: ACC_BORROW,
      userId: USER_A,
      name: 'Personal Borrowings',
      accountType: 'other',
      openingBalancePaise: 0,
      currency: 'INR',
      systemTag: 'personal_borrowings',
      isArchived: false,
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    },
    {
      id: '22222222-2222-4222-8222-222222222298',
      userId: 'quarantine-unresolved-ownership',
      name: 'Quarantined Account',
      accountType: 'cash',
      openingBalancePaise: 100,
      currency: 'INR',
      isArchived: false,
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
  ]);

  await db.categories.bulkPut([
    {
      id: CAT_EXPENSE,
      userId: USER_A,
      name: 'Groceries & Household',
      type: 'expense',
      isDefault: true,
      isArchived: false,
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    },
    {
      id: CAT_INCOME,
      userId: USER_A,
      name: 'Salary & Wages',
      type: 'income',
      isDefault: true,
      isArchived: false,
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
  ]);

  await db.transactions.bulkPut([
    {
      id: TX_EXPENSE,
      userId: USER_A,
      type: 'expense',
      amountPaise: 15000,
      currency: 'INR',
      accountId: ACC_BANK,
      categoryId: CAT_EXPENSE,
      title: 'Grocery Basket',
      transactionDate: '2026-11-10T10:00:00.000Z',
      deletedAt: null,
      version: 1,
      deviceId: 'device-alpha',
      idempotencyKey: 'tx-exp-1',
      createdAt: '2026-11-10T10:00:00.000Z',
      updatedAt: '2026-11-10T10:00:00.000Z'
    },
    {
      id: TX_BORROW,
      userId: USER_A,
      type: 'income',
      amountPaise: 100000,
      currency: 'INR',
      accountId: ACC_BORROW,
      categoryId: CAT_INCOME,
      title: 'Friend Loan',
      transactionDate: '2026-11-05T10:00:00.000Z',
      deletedAt: null,
      version: 1,
      deviceId: 'device-alpha',
      idempotencyKey: 'tx-bor-1',
      createdAt: '2026-11-05T10:00:00.000Z',
      updatedAt: '2026-11-05T10:00:00.000Z'
    },
    {
      id: TX_REPAY,
      userId: USER_A,
      type: 'transfer',
      amountPaise: 50000,
      currency: 'INR',
      accountId: ACC_BANK,
      destinationAccountId: ACC_BORROW,
      title: 'Loan Repayment',
      transactionDate: '2026-11-15T10:00:00.000Z',
      deletedAt: null,
      version: 1,
      deviceId: 'device-alpha',
      idempotencyKey: 'tx-rep-1',
      createdAt: '2026-11-15T10:00:00.000Z',
      updatedAt: '2026-11-15T10:00:00.000Z'
    }
  ]);

  await db.budgets.put({
    id: BUDGET_ID,
    userId: USER_A,
    categoryId: CAT_EXPENSE,
    period: '2026-11',
    limitPaise: 200000,
    version: 1,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z'
  });

  await db.lenders.put({
    id: LENDER_ID,
    userId: USER_A,
    name: 'Rahul',
    isArchived: false,
    createdAt: '2026-11-05T00:00:00.000Z',
    updatedAt: '2026-11-05T00:00:00.000Z'
  });

  await db.borrowings.put({
    id: BORROWING_ID,
    userId: USER_A,
    lenderId: LENDER_ID,
    amountPaise: 100000,
    borrowingDate: '2026-11-05',
    receivingAccountId: ACC_BORROW,
    transactionId: TX_BORROW,
    status: 'active',
    createdAt: '2026-11-05T00:00:00.000Z',
    updatedAt: '2026-11-05T00:00:00.000Z'
  });

  await db.borrowingRepayments.put({
    id: REPAYMENT_ID,
    userId: USER_A,
    borrowingId: BORROWING_ID,
    lenderId: LENDER_ID,
    amountPaise: 50000,
    repaymentDate: '2026-11-15',
    paymentAccountId: ACC_BANK,
    transactionId: TX_REPAY,
    createdAt: '2026-11-15T00:00:00.000Z',
    updatedAt: '2026-11-15T00:00:00.000Z'
  });

  await db.recurringRules.put({
    id: RULE_ID,
    userId: USER_A,
    title: 'Rent',
    type: 'expense',
    amountPaise: 1500000,
    accountId: ACC_BANK,
    categoryId: CAT_EXPENSE,
    frequency: 'monthly',
    interval: 1,
    anchorDayOfMonth: 5,
    startDate: '2026-01-05',
    nextDueDate: '2026-12-05',
    status: 'active',
    requiresUserConfirmation: true,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-11-05T00:00:00.000Z'
  });

  await db.recurringOccurrences.put({
    id: OCC_ID,
    userId: USER_A,
    recurringRuleId: RULE_ID,
    occurrenceDate: '2026-11-05',
    status: 'confirmed',
    transactionId: TX_EXPENSE,
    idempotencyKey: `rec-${RULE_ID}-2026-11-05`,
    confirmedAt: '2026-11-05T09:00:00.000Z',
    version: 1,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-05T09:00:00.000Z'
  });

  await db.notifications.put({
    id: NOTIFICATION_ID,
    userId: USER_A,
    category: 'budget_warning',
    severity: 'warning',
    status: 'unread',
    dedupeKey: 'budget-warn-2026-11',
    title: 'Budget Warning',
    message: 'Approaching budget limit',
    entityType: 'budget',
    entityId: BUDGET_ID,
    triggerDate: '2026-11-20',
    actionRoute: '/budgets',
    metadataJson: JSON.stringify({ budgetId: BUDGET_ID }),
    version: 1,
    createdAt: '2026-11-20T10:00:00.000Z',
    updatedAt: '2026-11-20T10:00:00.000Z'
  });

  await db.notificationPreferences.put({
    userId: USER_A,
    recurringPaymentEnabled: true,
    budgetWarningEnabled: true,
    budgetExceededEnabled: false,
    upcomingLeadDays: 4,
    version: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-11-10T00:00:00.000Z'
  });

  await db.syncMetadata.bulkPut([
    {
      key: `cat_map:${USER_A}:${CAT_EXPENSE}`,
      value: CLOUD_CAT_ID,
      updatedAt: '2026-11-01T00:00:00.000Z'
    },
    {
      key: `cat_rev:${USER_A}:${CLOUD_CAT_ID}`,
      value: CAT_EXPENSE,
      updatedAt: '2026-11-01T00:00:00.000Z'
    },
    {
      key: `legacy_migration_${USER_A}`,
      value: 'done',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
  ]);

  // Deliberately insert child transaction BEFORE parent account to verify dependency ordering on restore
  await db.syncOutbox.bulkPut([
    {
      id: 7,
      userId: USER_A,
      entity: 'transactions',
      entityId: TX_EXPENSE,
      operation: 'INSERT',
      payload: {
        id: TX_EXPENSE,
        device_id: 'device-alpha',
        version: 1,
        amount_paise: 15000
      },
      idempotencyKey: 'tx-exp-1',
      attempts: 5,
      lastAttemptAt: '2026-11-25T09:00:00.000Z',
      lastError: 'Offline timeout',
      createdAt: '2026-11-10T10:00:01.000Z'
    },
    {
      id: 2,
      userId: USER_A,
      entity: 'accounts',
      entityId: ACC_BANK,
      operation: 'INSERT',
      payload: { id: ACC_BANK, version: 1, name: 'HDFC Checking' },
      idempotencyKey: 'acc-bank-1',
      attempts: 2,
      lastError: 'Transient error',
      createdAt: '2026-11-10T10:00:00.000Z'
    }
  ]);
}

describe('Phase 11 Stage 2: Backup Export, Decrypt, Preview & Atomic Restore Workflows', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('exports an encrypted 14-store backup with zero outer plaintext and safe deferred URL cleanup', async () => {
    vi.useFakeTimers();
    const db = new MockTransactionalLaxmiLensDB();
    await db.open();
    await seedFullUserDataset(db);

    const createObjectUrlSpy = vi.fn(() => 'blob:laxmilens-backup-url');
    const revokeObjectUrlSpy = vi.fn();
    vi.stubGlobal('URL', {
      createObjectURL: createObjectUrlSpy,
      revokeObjectURL: revokeObjectUrlSpy
    });

    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});

    const dbManager = new DatabaseManager(
      createAuthPort({ id: USER_A, email: 'usera@example.com' }),
      () => db as unknown as LaxmiLensDB
    );
    const repos = await dbManager.getActiveRepositories();

    const exported = await repos.exportEncryptedBackupUseCase.execute({
      passphrase: PASSPHRASE
    });

    expect(exported.downloaded).toBe(true);
    expect(exported.safetyBackupCreated).toBe(true);
    expect(exported.filename).toMatch(/^laxmilens-backup-.*\.laxmibak$/);
    expect(exported.manifest.dexieSchemaVersion).toBe(8);
    expect(exported.manifest.excludedQuarantinedCounts.accounts).toBe(1);
    expect(exported.manifest.excludedQuarantinedCounts.total).toBe(1);
    expect(exported.manifest.counts.pendingOutbox).toBe(2);

    // Outer envelope contains zero financial or identity metadata
    const serializedEnvelope = JSON.stringify(exported.envelope);
    expect(serializedEnvelope).not.toContain('HDFC Checking');
    expect(serializedEnvelope).not.toContain('Grocery Basket');
    expect(serializedEnvelope).not.toContain('usera@example.com');
    expect(serializedEnvelope).not.toContain(USER_A);

    // Object URL is NOT revoked synchronously on click, only after cleanup delay
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrlSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(revokeObjectUrlSpy).toHaveBeenCalledWith('blob:laxmilens-backup-url');
  });

  it('rejects wrong passphrases and corrupted container files without triggering PBKDF2 on malformed headers', async () => {
    const db = new MockTransactionalLaxmiLensDB();
    await db.open();
    await seedFullUserDataset(db);

    const auth = createAuthPort({ id: USER_A, email: 'usera@example.com' });
    const storage = new DexieBackupRepository(db as unknown as LaxmiLensDB);
    const exporter = new ExportEncryptedBackupUseCase(auth, storage);
    const decryptor = new DecryptBackupFileUseCase(auth);

    const exported = await exporter.execute({ passphrase: PASSPHRASE, downloadFile: false });

    await expect(
      decryptor.execute({ rawContent: exported.envelope, passphrase: 'Wrong#Passphrase123' })
    ).rejects.toThrow(BackupDecryptionError);

    const deriveKeySpy = vi.spyOn(globalThis.crypto.subtle, 'deriveKey');
    await expect(
      decryptor.execute({ rawContent: '{corrupted-json', passphrase: PASSPHRASE })
    ).rejects.toThrow(InvalidBackupFormatError);
    await expect(
      decryptor.execute({
        rawContent: { ...exported.envelope, kdf: { ...exported.envelope.kdf, iterations: 1 } },
        passphrase: PASSPHRASE
      })
    ).rejects.toThrow(InvalidBackupFormatError);
    expect(deriveKeySpy).not.toHaveBeenCalled();
  });

  it('supports empty restore into a DB containing only untouched seeded default categories, preserving backup UUIDs and regenerating outbox IDs', async () => {
    // 1. Export full backup from Source Device
    const sourceDb = new MockTransactionalLaxmiLensDB();
    await sourceDb.open();
    await seedFullUserDataset(sourceDb);

    const authA = createAuthPort({ id: USER_A, email: 'usera@example.com' });
    const sourceStorage = new DexieBackupRepository(sourceDb as unknown as LaxmiLensDB);
    const exported = await new ExportEncryptedBackupUseCase(authA, sourceStorage).execute({
      passphrase: PASSPHRASE,
      downloadFile: false
    });

    // 2. Target Device freshly initialized with two random-UUID seeded default categories only
    const targetDb = new MockTransactionalLaxmiLensDB();
    await targetDb.open();
    const freshDefaultExpenseId = '33333333-3333-4333-8333-aaaaaaaa0001';
    const freshDefaultIncomeId = '33333333-3333-4333-8333-aaaaaaaa0002';
    await targetDb.categories.bulkPut([
      {
        id: freshDefaultExpenseId,
        userId: USER_A,
        name: 'Groceries & Household',
        type: 'expense',
        isDefault: true,
        isArchived: false,
        version: 1,
        createdAt: '2026-11-26T00:00:00.000Z',
        updatedAt: '2026-11-26T00:00:00.000Z'
      },
      {
        id: freshDefaultIncomeId,
        userId: USER_A,
        name: 'Salary & Wages',
        type: 'income',
        isDefault: true,
        isArchived: false,
        version: 1,
        createdAt: '2026-11-26T00:00:00.000Z',
        updatedAt: '2026-11-26T00:00:00.000Z'
      }
    ]);

    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const dbManager = new DatabaseManager(
      authA,
      () => targetDb as unknown as LaxmiLensDB,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      new BrowserBackupFileExporter(),
      new ReactQueryBackupCacheInvalidator(queryClient)
    );

    const repos = await dbManager.getActiveRepositories();
    const syncSpy = vi.spyOn(repos.syncCoordinator, 'run');

    // Preview via encrypted envelope
    const preview = await repos.generateRestorePreviewUseCase.execute({
      rawContent: JSON.stringify(exported.envelope),
      passphrase: PASSPHRASE,
      mode: 'empty'
    });

    expect(preview.valid).toBe(true);
    expect(preview.ownerMatchesAuthenticatedUser).toBe(true);
    expect(preview.modeCompatibility.canRestoreIntoEmpty).toBe(true);
    expect(preview.modeCompatibility.requiresReplaceConfirmation).toBe(false);
    expect(preview.modeCompatibility.targetHasOnlyDefaultCategories).toBe(true);
    expect(preview.restorePendingOutboxEnabled).toBe(true);
    expect(preview.categoryIdentityContract.targetDefaultReconciliationAction).toBe(
      'replace_unused_seeded_defaults'
    );
    expect(preview.categoryIdentityContract.unresolvedSeededDefaultCategoryIds).toEqual([
      freshDefaultExpenseId,
      freshDefaultIncomeId
    ]);

    const { archive } = await repos.decryptBackupFileUseCase.execute({
      rawContent: exported.envelope,
      passphrase: PASSPHRASE
    });

    const result = await repos.executeBackupRestoreUseCase.execute({
      archive,
      mode: 'empty',
      restorePendingOutbox: true
    });

    expect(result.mode).toBe('empty');
    expect(result.autoSyncTriggered).toBe(false);
    expect(result.cachesInvalidated).toBe(true);
    expect(result.replacedSeededDefaultCategoryIds).toEqual([
      freshDefaultExpenseId,
      freshDefaultIncomeId
    ]);
    expect(result.restoredOutboxCount).toBe(2);

    // Unused seeded defaults removed; backup UUIDs preserved verbatim across categories and transactions
    const targetCategories = await targetDb.categories.toArray();
    expect(targetCategories.map((c) => c.id).sort()).toEqual([CAT_EXPENSE, CAT_INCOME]);

    const restoredTxs = await targetDb.transactions.toArray();
    expect(restoredTxs.find((t) => t.id === TX_EXPENSE)?.categoryId).toBe(CAT_EXPENSE);
    expect(restoredTxs.find((t) => t.id === TX_EXPENSE)?.deviceId).toBe('device-alpha');

    // Pending outbox restored with newly regenerated auto-increment IDs, reset attempts, and dependency order (accounts before transactions)
    const restoredOutbox = (await targetDb.syncOutbox.toArray()).sort(
      (a, b) => (a.id ?? 0) - (b.id ?? 0)
    );
    expect(restoredOutbox).toHaveLength(2);
    expect(restoredOutbox[0]!.id).toBe(100);
    expect(restoredOutbox[1]!.id).toBe(101);
    expect(restoredOutbox[0]!.entity).toBe('accounts');
    expect(restoredOutbox[1]!.entity).toBe('transactions');
    expect(restoredOutbox[1]!.attempts).toBe(0);
    expect(restoredOutbox[1]!.lastError).toBeUndefined();
    expect(restoredOutbox[1]!.lastAttemptAt).toBeUndefined();

    // React Query caches invalidated cleanly and ZERO automatic cloud sync occurred
    expect(invalidateSpy).toHaveBeenCalled();
    expect(syncSpy).not.toHaveBeenCalled();
  });

  it('rejects empty restore when a target default category is referenced or when identity conflicts/ambiguities exist', async () => {
    const sourceDb = new MockTransactionalLaxmiLensDB();
    await sourceDb.open();
    await seedFullUserDataset(sourceDb);

    const authA = createAuthPort({ id: USER_A, email: 'usera@example.com' });
    const sourceStorage = new DexieBackupRepository(sourceDb as unknown as LaxmiLensDB);
    const exported = await new ExportEncryptedBackupUseCase(authA, sourceStorage).execute({
      passphrase: PASSPHRASE,
      downloadFile: false
    });
    const decrypted = await new DecryptBackupFileUseCase(authA).execute({
      rawContent: exported.envelope,
      passphrase: PASSPHRASE
    });

    // 1. Target category referenced by existing transaction (even before any replace attempted)
    const referencedTargetDb = new MockTransactionalLaxmiLensDB();
    await referencedTargetDb.open();
    const seededCatId = '33333333-3333-4333-8333-bbbbbbbb0001';
    await referencedTargetDb.categories.put({
      id: seededCatId,
      userId: USER_A,
      name: 'Groceries & Household',
      type: 'expense',
      isDefault: true,
      isArchived: false,
      version: 1,
      createdAt: '2026-11-26T00:00:00.000Z',
      updatedAt: '2026-11-26T00:00:00.000Z'
    });
    await referencedTargetDb.accounts.put({
      id: ACC_BANK,
      userId: USER_A,
      name: 'Existing Account',
      accountType: 'bank',
      openingBalancePaise: 1000,
      currency: 'INR',
      isArchived: false,
      version: 1,
      createdAt: '2026-11-26T00:00:00.000Z',
      updatedAt: '2026-11-26T00:00:00.000Z'
    });
    await referencedTargetDb.transactions.put({
      id: TX_EXPENSE,
      userId: USER_A,
      type: 'expense',
      amountPaise: 500,
      currency: 'INR',
      accountId: ACC_BANK,
      categoryId: seededCatId,
      title: 'Existing Expense',
      transactionDate: '2026-11-26T00:00:00.000Z',
      deletedAt: null,
      version: 1,
      idempotencyKey: 'ref-tx-1',
      createdAt: '2026-11-26T00:00:00.000Z',
      updatedAt: '2026-11-26T00:00:00.000Z'
    });

    const refStorage = new DexieBackupRepository(referencedTargetDb as unknown as LaxmiLensDB);
    const refExecutor = new ExecuteBackupRestoreUseCase(authA, refStorage);
    await expect(
      refExecutor.execute({ archive: decrypted.archive, mode: 'empty' })
    ).rejects.toThrow(BackupValidationError);

    // 2. Modified/non-seed unmatched default category cannot be silently deleted in empty mode
    const modifiedDefaultDb = new MockTransactionalLaxmiLensDB();
    await modifiedDefaultDb.open();
    await modifiedDefaultDb.categories.put({
      id: '33333333-3333-4333-8333-bbbbbbbb0002',
      userId: USER_A,
      name: 'Renamed Or Unknown Default',
      type: 'expense',
      isDefault: true,
      isArchived: false,
      version: 2,
      createdAt: '2026-11-26T00:00:00.000Z',
      updatedAt: '2026-11-26T00:00:00.000Z'
    });
    const modStorage = new DexieBackupRepository(modifiedDefaultDb as unknown as LaxmiLensDB);
    await expect(
      new ExecuteBackupRestoreUseCase(authA, modStorage).execute({
        archive: decrypted.archive,
        mode: 'empty'
      })
    ).rejects.toThrow(BackupValidationError);
  });

  it('requires safety backup and exact REPLACE confirmation, supports excluding outbox, and preserves other syncMetadata keys', async () => {
    const backupSourceDb = new MockTransactionalLaxmiLensDB();
    await backupSourceDb.open();
    await seedFullUserDataset(backupSourceDb);

    const authA = createAuthPort({ id: USER_A, email: 'usera@example.com' });
    const sourceStorage = new DexieBackupRepository(backupSourceDb as unknown as LaxmiLensDB);
    const targetArchive = (
      await new DecryptBackupFileUseCase(authA).execute({
        rawContent: (
          await new ExportEncryptedBackupUseCase(authA, sourceStorage).execute({
            passphrase: PASSPHRASE,
            downloadFile: false
          })
        ).envelope,
        passphrase: PASSPHRASE
      })
    ).archive;

    // Populate target DB with existing user data that differs from the backup
    const targetDb = new MockTransactionalLaxmiLensDB();
    await targetDb.open();
    await targetDb.accounts.put({
      id: '22222222-2222-4222-8222-ffffffffffff',
      userId: USER_A,
      name: 'Old Device Account',
      accountType: 'cash',
      openingBalancePaise: 99000,
      currency: 'INR',
      isArchived: false,
      version: 1,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z'
    });
    await targetDb.syncMetadata.put({
      key: `legacy_migration_${USER_A}`,
      value: 'preserved-local-flag',
      updatedAt: '2026-01-01T00:00:00.000Z'
    });

    const receiptRegistry = new SafetyBackupReceiptRegistry();
    const targetStorage = new DexieBackupRepository(targetDb as unknown as LaxmiLensDB);
    const targetExport = new ExportEncryptedBackupUseCase(
      authA,
      targetStorage,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      receiptRegistry
    );
    const executor = new ExecuteBackupRestoreUseCase(
      authA,
      targetStorage,
      undefined,
      undefined,
      undefined,
      undefined,
      receiptRegistry
    );

    // Reject missing REPLACE confirmation and spoofed boolean without genuine safety-backup receipt
    await expect(
      executor.execute({
        archive: targetArchive,
        mode: 'replace',
        confirmationText: 'confirm',
        ...({ safetyBackupConfirmed: true } as unknown as Record<string, unknown>)
      })
    ).rejects.toThrow(BackupValidationError);

    await expect(
      executor.execute({
        archive: targetArchive,
        mode: 'replace',
        confirmationText: BACKUP_REPLACE_CONFIRMATION_TEXT,
        ...({ safetyBackupConfirmed: true } as unknown as Record<string, unknown>)
      })
    ).rejects.toThrow(SafetyBackupRequiredError);

    // Generate genuine safety backup first, then execute REPLACE with pendingOutbox disabled
    const safetyBackup = await targetExport.execute({
      passphrase: PASSPHRASE,
      downloadFile: false
    });
    const result = await executor.execute({
      archive: targetArchive,
      mode: 'replace',
      confirmationText: BACKUP_REPLACE_CONFIRMATION_TEXT,
      safetyBackupReceipt: safetyBackup.safetyBackupReceipt,
      restorePendingOutbox: false
    });

    expect(result.mode).toBe('replace');
    expect(result.restoredOutboxCount).toBe(0);
    expect(await targetDb.syncOutbox.toArray()).toHaveLength(0);

    // Old account removed and replaced completely across all 14 stores; non-category syncMetadata preserved
    const restoredAccounts = await targetDb.accounts.toArray();
    expect(restoredAccounts.map((a) => a.id).sort()).toEqual([ACC_BANK, ACC_BORROW]);
    expect(await targetDb.syncMetadata.get(`legacy_migration_${USER_A}`)).toBeDefined();
  });

  it('rejects cross-user restore and blocks backup/restore operations while manual synchronization is active', async () => {
    const db = new MockTransactionalLaxmiLensDB();
    await db.open();
    await seedFullUserDataset(db);

    const authA = createAuthPort({ id: USER_A, email: 'usera@example.com' });
    const authB = createAuthPort({ id: USER_B, email: 'userb@example.com' });
    const storageA = new DexieBackupRepository(db as unknown as LaxmiLensDB);
    const exportedA = await new ExportEncryptedBackupUseCase(authA, storageA).execute({
      passphrase: PASSPHRASE,
      downloadFile: false
    });

    // Cross-user preview & restore as User B must throw BackupOwnershipMismatchError
    const targetDbB = new MockTransactionalLaxmiLensDB();
    await targetDbB.open();
    const storageB = new DexieBackupRepository(targetDbB as unknown as LaxmiLensDB);
    const previewB = new GenerateRestorePreviewUseCase(authB, storageB);

    await expect(
      previewB.execute({
        rawContent: exportedA.envelope,
        passphrase: PASSPHRASE,
        mode: 'empty'
      })
    ).rejects.toThrow(BackupOwnershipMismatchError);

    // Active manual sync guard blocks export, decrypt, preview, and execute
    let syncRunning = true;
    const syncGuard: BackupSyncActivityGuard = { isSyncRunning: () => syncRunning };

    await expect(
      new ExportEncryptedBackupUseCase(authA, storageA, syncGuard).execute({
        passphrase: PASSPHRASE,
        downloadFile: false
      })
    ).rejects.toThrow(BackupSyncConflictError);

    await expect(
      new DecryptBackupFileUseCase(authA, syncGuard).execute({
        rawContent: exportedA.envelope,
        passphrase: PASSPHRASE
      })
    ).rejects.toThrow(BackupSyncConflictError);

    await expect(
      new GenerateRestorePreviewUseCase(authA, storageA, syncGuard).execute({
        rawContent: exportedA.envelope,
        passphrase: PASSPHRASE
      })
    ).rejects.toThrow(BackupSyncConflictError);

    const decryptedA = await new DecryptBackupFileUseCase(authA).execute({
      rawContent: exportedA.envelope,
      passphrase: PASSPHRASE
    });
    await expect(
      new ExecuteBackupRestoreUseCase(authA, storageA, syncGuard).execute({
        archive: decryptedA.archive as BackupArchiveDocument,
        mode: 'replace',
        confirmationText: BACKUP_REPLACE_CONFIRMATION_TEXT
      })
    ).rejects.toThrow(BackupSyncConflictError);

    syncRunning = false;
  });

  it('rolls back all 14 stores atomically and skips cache invalidation when a mid-restore store write fails', async () => {
    const sourceDb = new MockTransactionalLaxmiLensDB();
    await sourceDb.open();
    await seedFullUserDataset(sourceDb);

    const authA = createAuthPort({ id: USER_A, email: 'usera@example.com' });
    const sourceStorage = new DexieBackupRepository(sourceDb as unknown as LaxmiLensDB);
    const exported = await new ExportEncryptedBackupUseCase(authA, sourceStorage).execute({
      passphrase: PASSPHRASE,
      downloadFile: false
    });
    const decrypted = await new DecryptBackupFileUseCase(authA).execute({
      rawContent: exported.envelope,
      passphrase: PASSPHRASE
    });

    // Target DB contains an existing account and transaction that must remain intact on rollback
    const targetDb = new MockTransactionalLaxmiLensDB();
    await targetDb.open();
    const originalAccId = '22222222-2222-4222-8222-eeee00000001';
    await targetDb.accounts.put({
      id: originalAccId,
      userId: USER_A,
      name: 'Pre-Existing Account Must Survive',
      accountType: 'bank',
      openingBalancePaise: 77700,
      currency: 'INR',
      isArchived: false,
      version: 1,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z'
    });

    // Inject mid-transaction write failure AFTER replace clears old data and writes categories/accounts
    vi.spyOn(targetDb.budgets, 'bulkPut').mockRejectedValueOnce(
      new Error('Simulated IndexedDB quota exceeded during budgets write')
    );

    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const storage = new DexieBackupRepository(targetDb as unknown as LaxmiLensDB);
    const executor = new ExecuteBackupRestoreUseCase(
      authA,
      storage,
      undefined,
      undefined,
      new ReactQueryBackupCacheInvalidator(queryClient)
    );

    const safetyForRollback = await new ExportEncryptedBackupUseCase(authA, storage).execute({
      passphrase: PASSPHRASE,
      downloadFile: false
    });

    await expect(
      executor.execute({
        archive: decrypted.archive,
        mode: 'replace',
        confirmationText: BACKUP_REPLACE_CONFIRMATION_TEXT,
        safetyBackupReceipt: safetyForRollback.safetyBackupReceipt
      })
    ).rejects.toThrow(BackupPersistenceError);

    // Complete rollback: original account intact, zero partial backup records committed, no cache invalidation
    const remainingAccounts = await targetDb.accounts.toArray();
    expect(remainingAccounts).toHaveLength(1);
    expect(remainingAccounts[0]!.id).toBe(originalAccId);
    expect(remainingAccounts[0]!.name).toBe('Pre-Existing Account Must Survive');
    expect(await targetDb.categories.toArray()).toHaveLength(0);
    expect(await targetDb.transactions.toArray()).toHaveLength(0);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('supports Blob/File preview input, rejects ambiguous UUID category conflicts via DatabaseManager DI, and enforces ManualSyncCoordinator concurrency guard', async () => {
    const sourceDb = new MockTransactionalLaxmiLensDB();
    await sourceDb.open();
    await seedFullUserDataset(sourceDb);

    const authA = createAuthPort({ id: USER_A, email: 'usera@example.com' });
    const sourceManager = new DatabaseManager(
      authA,
      () => sourceDb as unknown as LaxmiLensDB
    );
    const sourceRepos = await sourceManager.getActiveRepositories();
    const exported = await sourceRepos.exportEncryptedBackupUseCase.execute({
      passphrase: PASSPHRASE,
      downloadFile: false
    });

    const targetDb = new MockTransactionalLaxmiLensDB();
    await targetDb.open();
    // Seed a target category sharing CAT_EXPENSE UUID but conflicting type ('income' instead of 'expense')
    await targetDb.categories.put({
      id: CAT_EXPENSE,
      userId: USER_A,
      name: 'Groceries & Household',
      type: 'income',
      isDefault: true,
      isArchived: false,
      version: 1,
      createdAt: '2026-11-26T00:00:00.000Z',
      updatedAt: '2026-11-26T00:00:00.000Z'
    });

    const targetManager = new DatabaseManager(
      authA,
      () => targetDb as unknown as LaxmiLensDB
    );
    const targetRepos = await targetManager.getActiveRepositories();
    const backupBlob = new Blob([JSON.stringify(exported.envelope)], {
      type: 'application/json'
    });

    await expect(
      targetRepos.generateRestorePreviewUseCase.execute({
        file: backupBlob,
        passphrase: PASSPHRASE,
        mode: 'empty'
      })
    ).rejects.toThrow(BackupValidationError);

    // DatabaseManager pre-wired syncCoordinator blocks backup workflows when running
    vi.spyOn(targetRepos.syncCoordinator, 'isSyncRunning').mockReturnValue(true);
    await expect(
      targetRepos.exportEncryptedBackupUseCase.execute({
        passphrase: PASSPHRASE,
        downloadFile: false
      })
    ).rejects.toThrow(BackupSyncConflictError);
  });

  it('enforces verifiable safety-backup receipts: binds to user/DB/state, rejects forgery/reuse/mutation, and invalidates on state change', async () => {
    const sourceDb = new MockTransactionalLaxmiLensDB();
    await sourceDb.open();
    await seedFullUserDataset(sourceDb);

    const authA = createAuthPort({ id: USER_A, email: 'usera@example.com' });
    const authB = createAuthPort({ id: USER_B, email: 'userb@example.com' });
    const sourceManager = new DatabaseManager(
      authA,
      () => sourceDb as unknown as LaxmiLensDB
    );
    const sourceRepos = await sourceManager.getActiveRepositories();
    const exported = await sourceRepos.exportEncryptedBackupUseCase.execute({
      passphrase: PASSPHRASE,
      downloadFile: false
    });
    const decrypted = await sourceRepos.decryptBackupFileUseCase.execute({
      rawContent: exported.envelope,
      passphrase: PASSPHRASE
    });

    // Target DB with existing data
    const targetDb = new MockTransactionalLaxmiLensDB();
    await targetDb.open();
    await targetDb.accounts.put({
      id: '22222222-2222-4222-8222-eeee00000002',
      userId: USER_A,
      name: 'Existing Target Account',
      accountType: 'bank',
      openingBalancePaise: 42000,
      currency: 'INR',
      isArchived: false,
      version: 1,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z'
    });

    const registry = new SafetyBackupReceiptRegistry();
    const targetStorage = new DexieBackupRepository(targetDb as unknown as LaxmiLensDB);
    const exportUc = new ExportEncryptedBackupUseCase(
      authA,
      targetStorage,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      registry
    );
    const restoreUc = new ExecuteBackupRestoreUseCase(
      authA,
      targetStorage,
      undefined,
      undefined,
      undefined,
      undefined,
      registry
    );

    // 1. Forged receipt rejected
    const fakeReceipt = {
      receiptId: '00000000-0000-4000-8000-000000000123',
      userId: USER_A,
      databaseIdentity: targetStorage.getDatabaseIdentity(),
      stateDigestSha256Hex: 'a'.repeat(64),
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    };
    await expect(
      restoreUc.execute({
        archive: decrypted.archive,
        mode: 'replace',
        confirmationText: BACKUP_REPLACE_CONFIRMATION_TEXT,
        safetyBackupReceipt: fakeReceipt
      })
    ).rejects.toThrow(SafetyBackupRequiredError);

    // 2. Receipt invalidated when relevant DB state mutates after safety backup
    const safetyFirst = await exportUc.execute({
      passphrase: PASSPHRASE,
      downloadFile: false
    });
    expect(registry.countActive()).toBe(1);

    await targetDb.accounts.put({
      id: '22222222-2222-4222-8222-eeee00000003',
      userId: USER_A,
      name: 'Account Added After Safety Backup',
      accountType: 'cash',
      openingBalancePaise: 5000,
      currency: 'INR',
      isArchived: false,
      version: 1,
      createdAt: '2026-11-26T00:00:00.000Z',
      updatedAt: '2026-11-26T00:00:00.000Z'
    });

    await expect(
      restoreUc.execute({
        archive: decrypted.archive,
        mode: 'replace',
        confirmationText: BACKUP_REPLACE_CONFIRMATION_TEXT,
        safetyBackupReceipt: safetyFirst.safetyBackupReceipt
      })
    ).rejects.toThrow(SafetyBackupRequiredError);
    expect(registry.countActive()).toBe(0);

    // 3. Receipt bound to another DB instance rejected
    const secondDb = new MockTransactionalLaxmiLensDB();
    await secondDb.open();
    const safetySecond = await exportUc.execute({
      passphrase: PASSPHRASE,
      downloadFile: false
    });
    const otherDbRestoreUc = new ExecuteBackupRestoreUseCase(
      authA,
      new DexieBackupRepository(secondDb as unknown as LaxmiLensDB),
      undefined,
      undefined,
      undefined,
      undefined,
      registry
    );
    await expect(
      otherDbRestoreUc.execute({
        archive: decrypted.archive,
        mode: 'replace',
        confirmationText: BACKUP_REPLACE_CONFIRMATION_TEXT,
        safetyBackupReceipt: safetySecond.safetyBackupReceipt
      })
    ).rejects.toThrow(SafetyBackupRequiredError);

    // 4. Receipt issued by User A rejected when User B attempts restore on same registry
    const freshSafety = await exportUc.execute({
      passphrase: PASSPHRASE,
      downloadFile: false
    });
    const restoreAsUserB = new ExecuteBackupRestoreUseCase(
      authB,
      new DexieBackupRepository(targetDb as unknown as LaxmiLensDB),
      undefined,
      undefined,
      undefined,
      undefined,
      registry
    );
    await expect(
      restoreAsUserB.execute({
        archive: decrypted.archive,
        mode: 'replace',
        confirmationText: BACKUP_REPLACE_CONFIRMATION_TEXT,
        safetyBackupReceipt: freshSafety.safetyBackupReceipt
      })
    ).rejects.toThrow(SafetyBackupRequiredError);

    // 5. Valid receipt succeeds once and cannot be reused (even after re-issuing or re-trying!)
    await restoreUc.execute({
      archive: decrypted.archive,
      mode: 'replace',
      confirmationText: BACKUP_REPLACE_CONFIRMATION_TEXT,
      safetyBackupReceipt: freshSafety.safetyBackupReceipt
    });
    await expect(
      restoreUc.execute({
        archive: decrypted.archive,
        mode: 'replace',
        confirmationText: BACKUP_REPLACE_CONFIRMATION_TEXT,
        safetyBackupReceipt: freshSafety.safetyBackupReceipt
      })
    ).rejects.toThrow(SafetyBackupRequiredError);

    // Zero receipts persisted to IndexedDB
    expect(
      (await targetDb.syncMetadata.toArray()).some((r) => r.key.includes('receipt'))
    ).toBe(false);
  });

  it('coordinates shared exclusive lock with ManualSyncCoordinator, prevents concurrent sync/backup/restore, and always releases lock on errors', async () => {
    const db = new MockTransactionalLaxmiLensDB();
    await db.open();
    await seedFullUserDataset(db);

    const authA = createAuthPort({ id: USER_A, email: 'usera@example.com' });
    const outboxManager = new OutboxManager(db as unknown as LaxmiLensDB);

    let resolvePendingOutboxGate!: () => void;
    let outboxGate: Promise<void> | null = null;
    vi.spyOn(outboxManager, 'getPendingEntries').mockImplementation(async () => {
      if (outboxGate) {
        await outboxGate;
      }
      return [];
    });

    const syncCoordinator = new ManualSyncCoordinator(
      {} as AccountSyncDispatcher,
      {} as TransactionSyncDispatcher,
      outboxManager,
      authA
    );
    const storage = new DexieBackupRepository(db as unknown as LaxmiLensDB);
    const registry = new SafetyBackupReceiptRegistry();
    const exportUc = new ExportEncryptedBackupUseCase(
      authA,
      storage,
      syncCoordinator,
      undefined,
      undefined,
      undefined,
      USER_A,
      registry
    );
    const decryptUc = new DecryptBackupFileUseCase(authA, syncCoordinator);
    const previewUc = new GenerateRestorePreviewUseCase(
      authA,
      storage,
      syncCoordinator,
      decryptUc
    );
    const restoreUc = new ExecuteBackupRestoreUseCase(
      authA,
      storage,
      syncCoordinator,
      undefined,
      undefined,
      USER_A,
      registry
    );

    const initialBackup = await exportUc.execute({
      passphrase: PASSPHRASE,
      downloadFile: false
    });
    const decrypted = await decryptUc.execute({
      rawContent: initialBackup.envelope,
      passphrase: PASSPHRASE
    });

    // 1. While ManualSyncCoordinator holds the mutex, export/decrypt/preview/restore reject cleanly
    outboxGate = new Promise<void>((resolve) => {
      resolvePendingOutboxGate = resolve;
    });
    const syncRunPromise = syncCoordinator.run();
    await Promise.resolve();
    expect(syncCoordinator.isSyncRunning()).toBe(true);

    await expect(
      exportUc.execute({ passphrase: PASSPHRASE, downloadFile: false })
    ).rejects.toThrow(BackupSyncConflictError);
    await expect(
      decryptUc.execute({ rawContent: initialBackup.envelope, passphrase: PASSPHRASE })
    ).rejects.toThrow(BackupSyncConflictError);
    await expect(
      previewUc.execute({ archive: decrypted.archive, mode: 'replace' })
    ).rejects.toThrow(BackupSyncConflictError);
    await expect(
      restoreUc.execute({
        archive: decrypted.archive,
        mode: 'replace',
        confirmationText: BACKUP_REPLACE_CONFIRMATION_TEXT,
        safetyBackupReceipt: initialBackup.safetyBackupReceipt
      })
    ).rejects.toThrow(BackupSyncConflictError);

    resolvePendingOutboxGate();
    outboxGate = null;
    await syncRunPromise;
    expect(syncCoordinator.isOperationInProgress()).toBe(false);

    // 2. While Export holds the exclusive lock, ManualSyncCoordinator.run() rejects immediately with SyncInProgressError
    let releaseSnapshotGate!: () => void;
    const origCapture = storage.captureUserSnapshot.bind(storage);
    const captureSpy = vi.spyOn(storage, 'captureUserSnapshot').mockImplementationOnce(async (id) => {
      await new Promise<void>((resolve) => {
        releaseSnapshotGate = resolve;
      });
      return origCapture(id);
    });

    const slowExportPromise = exportUc.execute({
      passphrase: PASSPHRASE,
      downloadFile: false
    });
    await vi.waitFor(() => {
      expect(captureSpy).toHaveBeenCalledTimes(1);
    });
    expect(syncCoordinator.isOperationInProgress()).toBe(true);
    await expect(syncCoordinator.run()).rejects.toThrow(SyncInProgressError);
    releaseSnapshotGate();
    const safetyReceiptExport = await slowExportPromise;
    expect(syncCoordinator.isOperationInProgress()).toBe(false);

    // 3. While Restore holds the exclusive lock across live validation + atomic write, ManualSyncCoordinator.run() rejects
    let releaseRestoreWriteGate!: () => void;
    const origExecRestore = storage.executeAtomicRestore.bind(storage);
    const execSpy = vi
      .spyOn(storage, 'executeAtomicRestore')
      .mockImplementationOnce(async (args) => {
        await new Promise<void>((resolve) => {
          releaseRestoreWriteGate = resolve;
        });
        return origExecRestore(args);
      });

    const slowRestorePromise = restoreUc.execute({
      archive: decrypted.archive,
      mode: 'replace',
      confirmationText: BACKUP_REPLACE_CONFIRMATION_TEXT,
      safetyBackupReceipt: safetyReceiptExport.safetyBackupReceipt
    });
    await vi.waitFor(() => {
      expect(execSpy).toHaveBeenCalledTimes(1);
    });
    expect(syncCoordinator.isOperationInProgress()).toBe(true);
    await expect(syncCoordinator.run()).rejects.toThrow(SyncInProgressError);
    releaseRestoreWriteGate();
    await slowRestorePromise;
    expect(syncCoordinator.isOperationInProgress()).toBe(false);

    // 4. Failed export & failed atomic restore release the lock unconditionally in finally
    await expect(
      exportUc.execute({ passphrase: 'short', downloadFile: false })
    ).rejects.toThrow();
    expect(syncCoordinator.isOperationInProgress()).toBe(false);

    const safetyBeforeFailure = await exportUc.execute({
      passphrase: PASSPHRASE,
      downloadFile: false
    });
    vi.spyOn(db.budgets, 'bulkPut').mockRejectedValueOnce(new Error('Simulated write error'));
    await expect(
      restoreUc.execute({
        archive: decrypted.archive,
        mode: 'replace',
        confirmationText: BACKUP_REPLACE_CONFIRMATION_TEXT,
        safetyBackupReceipt: safetyBeforeFailure.safetyBackupReceipt
      })
    ).rejects.toThrow(BackupPersistenceError);
    expect(syncCoordinator.isOperationInProgress()).toBe(false);

    // Sync & preview resume working normally after failed backup/restore
    await expect(syncCoordinator.run()).resolves.toBeDefined();
    await expect(
      previewUc.execute({ archive: decrypted.archive })
    ).resolves.toMatchObject({
      valid: true,
      modeCompatibility: { requiresReplaceConfirmation: true }
    });
  });
});

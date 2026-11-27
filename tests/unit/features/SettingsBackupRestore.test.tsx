import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { SettingsPage } from '@/features/settings/SettingsPage';
import * as useAuthModule from '@/features/auth/hooks/useAuth';
import * as useAccountSyncModule from '@/features/accounts/hooks/useAccountSync';
import * as useNotificationPreferencesModule from '@/features/notifications/hooks/useNotificationPreferences';
import {
  defaultDatabaseManager,
  UserRepositories
} from '@/infrastructure/database/local/DatabaseManager';
import { DexieBackupRepository } from '@/infrastructure/database/local/repositories/DexieBackupRepository';
import { BackupEncryptionService } from '@/application/services/BackupEncryptionService';
import { BackupValidationService } from '@/application/services/BackupValidationService';
import { SafetyBackupReceiptRegistry } from '@/application/services/SafetyBackupReceiptService';
import { ExportEncryptedBackupUseCase } from '@/application/use-cases/backup/ExportEncryptedBackupUseCase';
import { DecryptBackupFileUseCase } from '@/application/use-cases/backup/DecryptBackupFileUseCase';
import { GenerateRestorePreviewUseCase } from '@/application/use-cases/backup/GenerateRestorePreviewUseCase';
import { ExecuteBackupRestoreUseCase } from '@/application/use-cases/backup/ExecuteBackupRestoreUseCase';
import { AuthPort } from '@/application/ports/AuthPort';
import { BackupCacheInvalidator, BackupFileExporter } from '@/application/ports/BackupStoragePort';
import { LaxmiLensDB } from '@/infrastructure/database/local/DexieDatabase';
import { ManualSyncCoordinator } from '@/infrastructure/sync/ManualSyncCoordinator';
import { OutboxManager } from '@/infrastructure/sync/OutboxManager';
import { AccountSyncDispatcher } from '@/infrastructure/sync/dispatchers/AccountSyncDispatcher';
import { TransactionSyncDispatcher } from '@/infrastructure/sync/dispatchers/TransactionSyncDispatcher';
import {
  LocalAccountRecord,
  LocalBudgetRecord,
  LocalCategoryRecord,
  LocalOutboxRecord,
  LocalTransactionRecord
} from '@/infrastructure/database/local/schema';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn()
  }
}));

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '99999999-9999-4999-8999-999999999999';
const ACC_BANK = '22222222-2222-4222-8222-222222222201';
const CAT_EXPENSE = '33333333-3333-4333-8333-333333333301';
const TX_1 = '44444444-4444-4444-8444-444444444401';
const BUDGET_1 = '55555555-5555-4555-8555-555555555501';
const PASSPHRASE = 'SettingsVault#2026!Secure';

function cloneDeep<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

class InMemoryUiTestTable<TRecord extends Record<string, unknown>, TKey extends string | number> {
  private map = new Map<TKey, TRecord>();

  constructor(
    private readonly keyField: keyof TRecord & string,
    private readonly autoInc = false,
    private readonly nextId?: () => number
  ) {}

  public snapshot(): Map<TKey, TRecord> {
    const out = new Map<TKey, TRecord>();
    for (const [k, v] of this.map.entries()) out.set(k, cloneDeep(v));
    return out;
  }

  public restoreSnapshot(s: Map<TKey, TRecord>): void {
    this.map = s;
  }

  public async get(k: TKey): Promise<TRecord | undefined> {
    const row = this.map.get(k);
    return row ? cloneDeep(row) : undefined;
  }

  public async toArray(): Promise<TRecord[]> {
    return Array.from(this.map.values()).map((r) => cloneDeep(r));
  }

  public async put(r: TRecord): Promise<TKey> {
    const copy = cloneDeep(r);
    const k = copy[this.keyField] as TKey;
    this.map.set(k, copy);
    return k;
  }

  public async bulkPut(records: readonly TRecord[]): Promise<TKey> {
    let last!: TKey;
    for (const r of records) last = await this.put(r);
    return last;
  }

  public async bulkAdd(records: readonly TRecord[]): Promise<TKey> {
    let last!: TKey;
    for (const r of records) {
      const copy = cloneDeep(r);
      if (this.autoInc && copy[this.keyField] === undefined && this.nextId) {
        (copy as Record<string, unknown>)[this.keyField] = this.nextId();
      }
      const k = copy[this.keyField] as TKey;
      this.map.set(k, copy);
      last = k;
    }
    return last;
  }

  public async delete(k: TKey): Promise<void> {
    this.map.delete(k);
  }

  public async bulkDelete(keys: readonly TKey[]): Promise<void> {
    for (const k of keys) this.map.delete(k);
  }
}

class UiMockDb {
  public readonly verno = 8;
  public readonly name = 'LaxmiLens_LocalDB_UI_Test';
  private seq = 10;

  public readonly profiles = new InMemoryUiTestTable<Record<string, unknown>, string>('id');
  public readonly accounts = new InMemoryUiTestTable<
    LocalAccountRecord & Record<string, unknown>,
    string
  >('id');
  public readonly categories = new InMemoryUiTestTable<
    LocalCategoryRecord & Record<string, unknown>,
    string
  >('id');
  public readonly transactions = new InMemoryUiTestTable<
    LocalTransactionRecord & Record<string, unknown>,
    string
  >('id');
  public readonly budgets = new InMemoryUiTestTable<
    LocalBudgetRecord & Record<string, unknown>,
    string
  >('id');
  public readonly lenders = new InMemoryUiTestTable<Record<string, unknown>, string>('id');
  public readonly borrowings = new InMemoryUiTestTable<Record<string, unknown>, string>('id');
  public readonly borrowingRepayments = new InMemoryUiTestTable<Record<string, unknown>, string>(
    'id'
  );
  public readonly recurringRules = new InMemoryUiTestTable<Record<string, unknown>, string>('id');
  public readonly recurringOccurrences = new InMemoryUiTestTable<Record<string, unknown>, string>(
    'id'
  );
  public readonly notifications = new InMemoryUiTestTable<Record<string, unknown>, string>('id');
  public readonly notificationPreferences = new InMemoryUiTestTable<
    Record<string, unknown>,
    string
  >('userId');
  public readonly syncOutbox = new InMemoryUiTestTable<
    LocalOutboxRecord & Record<string, unknown>,
    number
  >('id', true, () => this.seq++);
  public readonly syncMetadata = new InMemoryUiTestTable<Record<string, unknown>, string>('key');

  public async transaction<T>(
    mode: string,
    _tables: unknown,
    scope: () => Promise<T>
  ): Promise<T> {
    if (mode === 'r') return await scope();
    const snap = {
      seq: this.seq,
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
    } catch (err) {
      this.seq = snap.seq;
      this.profiles.restoreSnapshot(snap.profiles);
      this.accounts.restoreSnapshot(snap.accounts);
      this.categories.restoreSnapshot(snap.categories);
      this.transactions.restoreSnapshot(snap.transactions);
      this.budgets.restoreSnapshot(snap.budgets);
      this.lenders.restoreSnapshot(snap.lenders);
      this.borrowings.restoreSnapshot(snap.borrowings);
      this.borrowingRepayments.restoreSnapshot(snap.borrowingRepayments);
      this.recurringRules.restoreSnapshot(snap.recurringRules);
      this.recurringOccurrences.restoreSnapshot(snap.recurringOccurrences);
      this.notifications.restoreSnapshot(snap.notifications);
      this.notificationPreferences.restoreSnapshot(snap.notificationPreferences);
      this.syncOutbox.restoreSnapshot(snap.syncOutbox);
      this.syncMetadata.restoreSnapshot(snap.syncMetadata);
      throw err;
    }
  }
}

async function seedSourceData(db: UiMockDb, userId = USER_A): Promise<void> {
  await db.accounts.put({
    id: ACC_BANK,
    userId,
    name: 'Obsidian Bank',
    accountType: 'bank',
    openingBalancePaise: 250000,
    currency: 'INR',
    isArchived: false,
    version: 1,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z'
  });
  await db.categories.put({
    id: CAT_EXPENSE,
    userId,
    name: 'Groceries & Household',
    type: 'expense',
    isDefault: true,
    isArchived: false,
    version: 1,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z'
  });
  await db.transactions.put({
    id: TX_1,
    userId,
    type: 'expense',
    amountPaise: 32000,
    currency: 'INR',
    accountId: ACC_BANK,
    categoryId: CAT_EXPENSE,
    title: 'Organic Market',
    transactionDate: '2026-11-15T09:00:00.000Z',
    deletedAt: null,
    version: 1,
    idempotencyKey: 'ui-tx-1',
    createdAt: '2026-11-15T09:00:00.000Z',
    updatedAt: '2026-11-15T09:00:00.000Z'
  });
  await db.budgets.put({
    id: BUDGET_1,
    userId,
    categoryId: CAT_EXPENSE,
    period: '2026-11',
    limitPaise: 150000,
    version: 1,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z'
  });
  await db.syncOutbox.bulkAdd([
    {
      userId,
      entity: 'transactions',
      entityId: TX_1,
      operation: 'INSERT',
      payload: { id: TX_1, amount_paise: 32000 },
      idempotencyKey: 'ui-tx-1',
      attempts: 2,
      lastError: 'Offline',
      createdAt: '2026-11-15T09:00:00.000Z'
    }
  ]);
}

function buildWiredBackupRepos(
  db: UiMockDb,
  activeUserRef: { current: { id: string; email: string } | null },
  options?: { isSyncRunning?: boolean }
) {
  let exportedFiles: Array<{ filename: string; content: string }> = [];
  const authPort: AuthPort = {
    getCurrentUser: vi.fn(async () => activeUserRef.current),
    signInWithEmail: vi.fn(),
    signUpWithEmail: vi.fn(),
    signInWithOAuth: vi.fn(),
    signOut: vi.fn(),
    resetPasswordForEmail: vi.fn(),
    updatePassword: vi.fn(),
    onAuthStateChange: vi.fn(() => () => {})
  };
  const backupRepo = new DexieBackupRepository(db as unknown as LaxmiLensDB);
  const receiptRegistry = new SafetyBackupReceiptRegistry();
  const encryption = new BackupEncryptionService();
  const validation = new BackupValidationService();
  const outboxManager = new OutboxManager(db as unknown as LaxmiLensDB);
  const syncCoordinator = new ManualSyncCoordinator(
    {} as AccountSyncDispatcher,
    {} as TransactionSyncDispatcher,
    outboxManager,
    authPort
  );
  if (options?.isSyncRunning) {
    vi.spyOn(syncCoordinator, 'isSyncRunning').mockReturnValue(true);
  }
  const syncRunSpy = vi.spyOn(syncCoordinator, 'run');

  const fileExporter: BackupFileExporter = {
    downloadEnvelope: vi.fn((envelope, filename = 'backup.laxmibak') => {
      const content = JSON.stringify(envelope, null, 2);
      exportedFiles.push({ filename, content });
      return {
        filename,
        byteLength: new TextEncoder().encode(content).byteLength,
        downloaded: true
      };
    })
  };
  const cacheInvalidator: BackupCacheInvalidator = {
    invalidateUserCaches: vi.fn(async () => {})
  };

  const exportEncryptedBackupUseCase = new ExportEncryptedBackupUseCase(
    authPort,
    backupRepo,
    syncCoordinator,
    encryption,
    validation,
    fileExporter,
    undefined,
    receiptRegistry
  );
  const decryptBackupFileUseCase = new DecryptBackupFileUseCase(authPort, syncCoordinator, encryption);
  const generateRestorePreviewUseCase = new GenerateRestorePreviewUseCase(
    authPort,
    backupRepo,
    syncCoordinator,
    decryptBackupFileUseCase,
    validation
  );
  const executeBackupRestoreUseCase = new ExecuteBackupRestoreUseCase(
    authPort,
    backupRepo,
    syncCoordinator,
    validation,
    cacheInvalidator,
    undefined,
    receiptRegistry
  );

  return {
    repos: {
      userId: activeUserRef.current?.id ?? USER_A,
      syncCoordinator,
      backupRepo,
      exportEncryptedBackupUseCase,
      decryptBackupFileUseCase,
      generateRestorePreviewUseCase,
      executeBackupRestoreUseCase
    } as unknown as UserRepositories,
    exportedFiles,
    syncRunSpy,
    cacheInvalidator,
    receiptRegistry
  };
}

function renderSettings(queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('Phase 11 Stage 3: Settings Data Backup & Restore UI', () => {
  let queryClient: QueryClient;
  const activeUserRef = { current: { id: USER_A, email: 'usera@example.com' } as { id: string; email: string } | null };

  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    activeUserRef.current = { id: USER_A, email: 'usera@example.com' };
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    });

    vi.spyOn(useAuthModule, 'useAuth').mockImplementation(() => ({
      user: activeUserRef.current,
      isAuthenticated: Boolean(activeUserRef.current),
      isLoading: false,
      signIn: vi.fn(),
      signUp: vi.fn(),
      signInWithGoogle: vi.fn(),
      signOut: vi.fn(),
      resetPassword: vi.fn(),
      updatePassword: vi.fn()
    }));

    vi.spyOn(useAccountSyncModule, 'useAccountSync').mockImplementation(() => ({
      syncNow: vi.fn(),
      isSyncing: false,
      pendingCount: 0,
      lastResult: undefined,
      isAuthenticated: Boolean(activeUserRef.current)
    }));

    vi.spyOn(useNotificationPreferencesModule, 'useNotificationPreferences').mockReturnValue({
      preferences: {
        userId: USER_A,
        recurringPaymentEnabled: true,
        budgetWarningEnabled: true,
        budgetExceededEnabled: true,
        upcomingLeadDays: 3,
        version: 1,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
        isDefault: true
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      updatePreferences: vi.fn(),
      isSaving: false,
      saveError: null
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates an encrypted backup via Settings UI, validates 12-char passphrase, supports visibility toggles, and clears passphrases without persisting secrets', async () => {
    const db = new UiMockDb();
    await seedSourceData(db);
    const { repos, exportedFiles, syncRunSpy } = buildWiredBackupRepos(db, activeUserRef);
    vi.spyOn(defaultDatabaseManager, 'getActiveRepositories').mockResolvedValue(repos);

    renderSettings(queryClient);

    expect(screen.getByRole('heading', { name: 'Data Backup & Restore' })).toBeInTheDocument();
    expect(screen.getByText('Notification Preferences')).toBeInTheDocument();

    const passphraseInput = screen.getByLabelText('Encryption Passphrase') as HTMLInputElement;
    const confirmInput = screen.getByLabelText('Confirm Passphrase') as HTMLInputElement;
    const createBtn = screen.getByRole('button', { name: /Create Backup/i });

    // Too short passphrase -> button remains disabled & error guidance shows
    fireEvent.change(passphraseInput, { target: { value: 'short7' } });
    fireEvent.change(confirmInput, { target: { value: 'short7' } });
    expect(screen.getByText(/Passphrase must be at least 12 characters long/i)).toBeInTheDocument();
    expect(createBtn).toBeDisabled();

    // Show/hide passphrase toggle
    expect(passphraseInput.type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: 'Show passphrase' }));
    expect(passphraseInput.type).toBe('text');
    fireEvent.click(screen.getByRole('button', { name: 'Hide passphrase' }));
    expect(passphraseInput.type).toBe('password');

    // Mismatched confirm -> mismatch error & disabled submit
    fireEvent.change(passphraseInput, { target: { value: PASSPHRASE } });
    fireEvent.change(confirmInput, { target: { value: 'Different#12345' } });
    expect(screen.getByText(/Passphrases do not match/i)).toBeInTheDocument();
    expect(createBtn).toBeDisabled();

    // Matching valid passphrase -> encrypt & download
    fireEvent.change(confirmInput, { target: { value: PASSPHRASE } });
    expect(createBtn).toBeEnabled();
    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(screen.getByText(/Encrypted backup downloaded to your device/i)).toBeInTheDocument();
    });

    expect(exportedFiles).toHaveLength(1);
    expect(passphraseInput.value).toBe('');
    expect(confirmInput.value).toBe('');
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(syncRunSpy).not.toHaveBeenCalled();
  });

  it('shows clear errors on wrong passphrase/corrupted file and executes empty restore with untouched seeded defaults cleanly', async () => {
    // 1. Export genuine encrypted archive from source DB
    const sourceDb = new UiMockDb();
    await seedSourceData(sourceDb);
    const { repos: sourceRepos, exportedFiles } = buildWiredBackupRepos(sourceDb, activeUserRef);
    const sourceExport = await sourceRepos.exportEncryptedBackupUseCase.execute({
      passphrase: PASSPHRASE,
      downloadFile: true
    });
    expect(exportedFiles).toHaveLength(1);
    const backupFile = new File([exportedFiles[0]!.content], sourceExport.filename, {
      type: 'application/json'
    });

    // 2. Target DB initialized only with an untouched seeded default category (random UUID)
    const targetDb = new UiMockDb();
    await targetDb.categories.put({
      id: '33333333-3333-4333-8333-eeeeeeee0001',
      userId: USER_A,
      name: 'Groceries & Household',
      type: 'expense',
      isDefault: true,
      isArchived: false,
      version: 1,
      createdAt: '2026-11-26T00:00:00.000Z',
      updatedAt: '2026-11-26T00:00:00.000Z'
    });

    const { repos: targetRepos, cacheInvalidator, syncRunSpy } = buildWiredBackupRepos(
      targetDb,
      activeUserRef
    );
    vi.spyOn(defaultDatabaseManager, 'getActiveRepositories').mockResolvedValue(targetRepos);

    renderSettings(queryClient);

    const fileInput = screen.getByLabelText(/Encrypted Backup File/i) as HTMLInputElement;
    const restorePassInput = screen.getByLabelText('Backup Passphrase') as HTMLInputElement;
    const previewBtn = screen.getByRole('button', { name: /Decrypt & Preview/i });

    // Corrupted file test first
    const corruptFile = new File(['{bad-json'], 'corrupt.laxmibak', { type: 'application/json' });
    fireEvent.change(fileInput, { target: { files: [corruptFile] } });
    fireEvent.change(restorePassInput, { target: { value: PASSPHRASE } });
    fireEvent.click(previewBtn);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/not valid JSON|not a valid LaxmiLens/i);
    });

    // Wrong passphrase on valid file
    fireEvent.change(fileInput, { target: { files: [backupFile] } });
    fireEvent.change(restorePassInput, { target: { value: 'WrongPassphrase#2026' } });
    fireEvent.click(previewBtn);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Could not unlock this backup/i);
    });

    // Correct passphrase opens preview dialog & clears input passphrase
    fireEvent.change(restorePassInput, { target: { value: PASSPHRASE } });
    fireEvent.click(previewBtn);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Restore Preview & Verification')).toBeInTheDocument();
    expect(within(dialog).getByText('Account Ownership Verified')).toBeInTheDocument();
    expect(within(dialog).getByText('Schema v8')).toBeInTheDocument();
    expect(within(dialog).getByText(/Fresh Seeded Defaults Only/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/Different seeded UUIDs: 1/i)).toBeInTheDocument();
    expect(restorePassInput.value).toBe('');

    // Toggle pending outbox off and back on cleanly without re-entering passphrase
    const outboxSwitch = within(dialog).getByRole('switch', {
      name: /Restore pending offline sync queue/i
    });
    expect(outboxSwitch).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(outboxSwitch);
    await waitFor(() => {
      expect(outboxSwitch).toHaveAttribute('aria-checked', 'false');
    });
    fireEvent.click(outboxSwitch);
    await waitFor(() => {
      expect(outboxSwitch).toHaveAttribute('aria-checked', 'true');
    });

    // Empty restore requires explicit checkbox confirmation
    const restoreBtn = within(dialog).getByRole('button', { name: /Restore Backup Locally/i });
    expect(restoreBtn).toBeDisabled();
    fireEvent.click(
      within(dialog).getByLabelText(/I confirm restoring this backup into my local LaxmiLens database/i)
    );
    expect(restoreBtn).toBeEnabled();
    fireEvent.click(restoreBtn);

    await waitFor(() => {
      expect(screen.getByText(/Local database restored successfully/i)).toBeInTheDocument();
    });

    // Verify real records & preserved category UUID in DB, cache invalidation, and zero auto sync
    const restoredAccounts = await targetDb.accounts.toArray();
    const restoredCategories = await targetDb.categories.toArray();
    expect(restoredAccounts.map((a) => a.id)).toEqual([ACC_BANK]);
    expect(restoredCategories.map((c) => c.id)).toEqual([CAT_EXPENSE]);
    expect(await targetDb.syncOutbox.toArray()).toHaveLength(1);
    expect(cacheInvalidator.invalidateUserCaches).toHaveBeenCalledWith(USER_A);
    expect(syncRunSpy).not.toHaveBeenCalled();
  });

  it('enforces verifiable safety-backup export before exposing Replace controls, requires typed REPLACE, and rejects without valid receipt', async () => {
    const sourceDb = new UiMockDb();
    await seedSourceData(sourceDb);
    const { repos: sourceRepos, exportedFiles } = buildWiredBackupRepos(sourceDb, activeUserRef);
    const exported = await sourceRepos.exportEncryptedBackupUseCase.execute({
      passphrase: PASSPHRASE,
      downloadFile: true
    });
    const backupFile = new File([exportedFiles[0]!.content], exported.filename, {
      type: 'application/json'
    });

    // Populate target DB with existing user data
    const targetDb = new UiMockDb();
    await targetDb.accounts.put({
      id: '22222222-2222-4222-8222-ffffffff9999',
      userId: USER_A,
      name: 'Existing Device Wallet',
      accountType: 'cash',
      openingBalancePaise: 90000,
      currency: 'INR',
      isArchived: false,
      version: 1,
      createdAt: '2026-10-10T00:00:00.000Z',
      updatedAt: '2026-10-10T00:00:00.000Z'
    });

    const { repos: targetRepos } = buildWiredBackupRepos(targetDb, activeUserRef);
    vi.spyOn(defaultDatabaseManager, 'getActiveRepositories').mockResolvedValue(targetRepos);

    renderSettings(queryClient);

    fireEvent.change(screen.getByLabelText(/Encrypted Backup File/i), {
      target: { files: [backupFile] }
    });
    fireEvent.change(screen.getByLabelText('Backup Passphrase'), {
      target: { value: PASSPHRASE }
    });
    fireEvent.click(screen.getByRole('button', { name: /Decrypt & Preview/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Replace Warning: Existing Local Data Will Be Overwritten/i)).toBeInTheDocument();

    // Critical security requirement: Replace confirmation input and action MUST NOT be exposed yet
    expect(
      within(dialog).queryByRole('button', { name: /Replace Local Data & Restore/i })
    ).not.toBeInTheDocument();
    expect(within(dialog).queryByPlaceholderText('REPLACE')).not.toBeInTheDocument();

    // Step 1: Download mandatory safety backup via real export use case
    fireEvent.change(within(dialog).getByLabelText('Safety Backup Passphrase'), {
      target: { value: 'SafetyVault#2026!' }
    });
    fireEvent.change(within(dialog).getByLabelText('Confirm Safety Passphrase'), {
      target: { value: 'SafetyVault#2026!' }
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /Download Safety Backup/i }));

    await waitFor(() => {
      expect(within(dialog).getByText('Verified Receipt Issued')).toBeInTheDocument();
    });

    // Step 2 unlocked ONLY after real receipt issued
    const replaceInput = within(dialog).getByPlaceholderText('REPLACE');
    const replaceBtn = within(dialog).getByRole('button', {
      name: /Replace Local Data & Restore/i
    });
    expect(replaceBtn).toBeDisabled();

    fireEvent.change(replaceInput, { target: { value: 'replace' } });
    expect(replaceBtn).toBeDisabled();

    fireEvent.change(replaceInput, { target: { value: 'REPLACE' } });
    expect(replaceBtn).toBeEnabled();
    fireEvent.click(replaceBtn);

    await waitFor(() => {
      expect(screen.getByText(/Local database restored successfully/i)).toBeInTheDocument();
    });

    const accountsAfter = await targetDb.accounts.toArray();
    expect(accountsAfter.map((a) => a.id)).toEqual([ACC_BANK]);
  });

  it('disables backup/restore while sync is running and clears sensitive UI state on user session switch', async () => {
    vi.spyOn(useAccountSyncModule, 'useAccountSync').mockImplementation(() => ({
      syncNow: vi.fn(),
      isSyncing: true,
      pendingCount: 2,
      lastResult: undefined,
      isAuthenticated: true
    }));

    const { rerender } = renderSettings(queryClient);

    expect(screen.getByText(/Cloud synchronization is running/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Encryption Passphrase')).toBeDisabled();
    expect(screen.getByLabelText('Backup Passphrase')).toBeDisabled();

    // Enable controls and enter passphrase, then switch authenticated user -> inputs reset cleanly
    vi.spyOn(useAccountSyncModule, 'useAccountSync').mockImplementation(() => ({
      syncNow: vi.fn(),
      isSyncing: false,
      pendingCount: 0,
      lastResult: undefined,
      isAuthenticated: true
    }));

    rerender(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    const encPass = screen.getByLabelText('Encryption Passphrase') as HTMLInputElement;
    const resPass = screen.getByLabelText('Backup Passphrase') as HTMLInputElement;
    fireEvent.change(encPass, { target: { value: PASSPHRASE } });
    fireEvent.change(resPass, { target: { value: PASSPHRASE } });
    expect(encPass.value).toBe(PASSPHRASE);

    activeUserRef.current = { id: USER_B, email: 'userb@example.com' };
    rerender(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect((screen.getByLabelText('Encryption Passphrase') as HTMLInputElement).value).toBe('');
      expect((screen.getByLabelText('Backup Passphrase') as HTMLInputElement).value).toBe('');
    });
  });

  it('displays up to five validation issues and total count when restore validation reports multiple integrity errors', async () => {
    const db = new UiMockDb();
    await seedSourceData(db, USER_A);
    const accBorrowId = '22222222-2222-4222-8222-222222222202';
    const txBorrowId = '44444444-4444-4444-8444-444444444402';
    const lenderId = '88888888-8888-4888-8888-888888888801';
    const borrowId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
    const repayIds = [
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb03',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb04',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb05'
    ];

    await db.accounts.put({
      id: accBorrowId,
      userId: USER_A,
      name: 'Personal Borrowings',
      accountType: 'other',
      openingBalancePaise: 0,
      currency: 'INR',
      systemTag: 'personal_borrowings',
      isArchived: false,
      version: 1,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z'
    });
    await db.transactions.put({
      id: txBorrowId,
      userId: USER_A,
      type: 'transfer',
      amountPaise: 50000,
      currency: 'INR',
      accountId: accBorrowId,
      destinationAccountId: ACC_BANK,
      title: 'Loan Receipt',
      transactionDate: '2026-11-10T09:00:00.000Z',
      deletedAt: null,
      version: 1,
      idempotencyKey: 'ui-bor-tx-1',
      createdAt: '2026-11-10T09:00:00.000Z',
      updatedAt: '2026-11-10T09:00:00.000Z'
    });
    await db.lenders.put({
      id: lenderId,
      userId: USER_A,
      name: 'Rahul',
      isArchived: false,
      createdAt: '2026-11-10T09:00:00.000Z',
      updatedAt: '2026-11-10T09:00:00.000Z'
    });
    await db.borrowings.put({
      id: borrowId,
      userId: USER_A,
      lenderId,
      amountPaise: 50000,
      borrowingDate: '2026-11-10T09:00:00.000Z',
      dueDate: 'not-a-valid-date',
      receivingAccountId: ACC_BANK,
      transactionId: txBorrowId,
      status: 'active',
      createdAt: '2026-11-10T09:00:00.000Z',
      updatedAt: '2026-11-10T09:00:00.000Z'
    });
    for (const repayId of repayIds) {
      await db.borrowingRepayments.put({
        id: repayId,
        userId: USER_A,
        borrowingId: borrowId,
        lenderId,
        amountPaise: 10000,
        repaymentDate: '2026-11-11T09:00:00.000Z',
        paymentAccountId: ACC_BANK,
        transactionId: TX_1,
        createdAt: '2026-11-11T09:00:00.000Z',
        updatedAt: '2026-11-11T09:00:00.000Z'
      });
    }

    const wired = buildWiredBackupRepos(db, activeUserRef);
    const exported = await wired.repos.exportEncryptedBackupUseCase.execute({
      passphrase: PASSPHRASE,
      downloadFile: false
    });
    vi.spyOn(defaultDatabaseManager, 'getActiveRepositories').mockResolvedValue(wired.repos);

    renderSettings(queryClient);

    const fileInput = screen.getByLabelText(/Encrypted Backup File/i) as HTMLInputElement;
    const file = new File([JSON.stringify(exported.envelope)], 'bad-due-date.laxmibak', {
      type: 'application/json'
    });
    fireEvent.change(fileInput, { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText('Backup Passphrase'), {
      target: { value: PASSPHRASE }
    });
    fireEvent.click(screen.getByRole('button', { name: /Decrypt & Preview/i }));

    await waitFor(() => {
      const alertEl = screen.getByRole('alert');
      expect(alertEl).toHaveTextContent(/Backup failed validation with 6 integrity issue\(s\):/i);
      expect(alertEl).toHaveTextContent(/\[1\] \[borrowings\/INVALID_BORROWING_RECORD\]/);
      expect(alertEl).toHaveTextContent(
        /\[5\] \[borrowingRepayments\/MISSING_REPAYMENT_BORROWING\]/
      );
      expect(alertEl).toHaveTextContent(/\(\+1 more\)/);
      expect(alertEl).not.toHaveTextContent(/\[6\]/);
    });
  });
});

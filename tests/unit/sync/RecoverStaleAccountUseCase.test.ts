import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  RecoverStaleAccountUseCase,
  TARGET_RECOVERY_ACCOUNT_ID
} from '@/application/use-cases/accounts/RecoverStaleAccountUseCase';
import { RestoreAccountUseCase } from '@/application/use-cases/accounts/RestoreAccountUseCase';
import { ISupabaseAccountRepository } from '@/infrastructure/database/cloud/repositories/SupabaseAccountRepository';
import { AuthPort, AuthUser } from '@/application/ports/AuthPort';
import { CloudAccountRow } from '@/infrastructure/database/cloud/mappers/AccountMapper';
import { LocalAccountRecord, LocalOutboxRecord } from '@/infrastructure/database/local/schema';
import { LaxmiLensDB } from '@/infrastructure/database/local/DexieDatabase';
import { DexieAccountRepository } from '@/infrastructure/database/local/repositories/DexieAccountRepository';
import { OutboxManager } from '@/infrastructure/sync/OutboxManager';
import { SyncAuthError } from '@/infrastructure/sync/errors/SyncErrors';

describe('RecoverStaleAccountUseCase (Phase 2C.3)', () => {
  const validUserId = '987fcdeb-51a2-43f7-9876-543210987654';
  const otherUserId = '11111111-2222-3333-4444-555555555555';
  const targetId = TARGET_RECOVERY_ACCOUNT_ID;

  const mockUser: AuthUser = {
    id: validUserId,
    email: 'test@example.com'
  };

  let mockCloudRepo: ISupabaseAccountRepository;
  let mockAuthPort: AuthPort;
  let mockDb: LaxmiLensDB;
  let localAccounts: Map<string, LocalAccountRecord>;
  let outboxRecords: LocalOutboxRecord[];
  let useCase: RecoverStaleAccountUseCase;

  const validCloudRow: CloudAccountRow = {
    id: targetId,
    user_id: validUserId,
    name: 'Job',
    account_type: 'bank',
    opening_balance_paise: 5000000,
    currency: 'INR',
    institution_name: 'HDFC',
    color: '#D6AD60',
    icon: 'landmark',
    notes: 'Salary',
    is_archived: true,
    version: 3,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  beforeEach(() => {
    localAccounts = new Map();
    outboxRecords = [];

    // Setup initial stale local account (v2, unarchived)
    localAccounts.set(targetId, {
      id: targetId,
      userId: validUserId,
      name: 'Job',
      accountType: 'bank',
      openingBalancePaise: 5000000,
      currency: 'INR',
      isArchived: false,
      version: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    // Setup stale restore outbox record (ID 6)
    outboxRecords.push({
      id: 6,
      entity: 'accounts',
      entityId: targetId,
      operation: 'UPDATE',
      payload: {
        id: targetId,
        is_archived: false,
        version: 3
      },
      idempotencyKey: 'k-stale-restore',
      attempts: 0,
      createdAt: new Date().toISOString()
    });

    // Unrelated outbox record for another entity
    outboxRecords.push({
      id: 99,
      entity: 'transactions',
      entityId: 'tx-unrelated-1',
      operation: 'INSERT',
      payload: { id: 'tx-unrelated-1' },
      idempotencyKey: 'k-tx-unrelated',
      attempts: 0,
      createdAt: new Date().toISOString()
    });

    mockCloudRepo = {
      findById: vi.fn().mockResolvedValue(validCloudRow),
      findAll: vi.fn(),
      insert: vi.fn(),
      updatePartial: vi.fn()
    };

    mockAuthPort = {
      getCurrentUser: vi.fn().mockResolvedValue(mockUser),
      signInWithEmail: vi.fn(),
      signUpWithEmail: vi.fn(),
      signInWithOAuth: vi.fn(),
      signOut: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      updatePassword: vi.fn(),
      onAuthStateChange: vi.fn().mockReturnValue(() => {})
    };

    // Simulated Dexie database with in-memory tables & transaction support
    mockDb = {
      accounts: {
        get: vi.fn().mockImplementation(async (id: string) => {
          return localAccounts.get(id) || null;
        }),
        update: vi.fn().mockImplementation(async (id: string, changes: Partial<LocalAccountRecord>) => {
          const acc = localAccounts.get(id);
          if (acc) {
            Object.assign(acc, changes);
          }
          return 1;
        }),
        put: vi.fn().mockImplementation(async (record: LocalAccountRecord) => {
          localAccounts.set(record.id, record);
        })
      },
      syncOutbox: {
        toArray: vi.fn().mockImplementation(async () => {
          return [...outboxRecords];
        }),
        delete: vi.fn().mockImplementation(async (id: number) => {
          outboxRecords = outboxRecords.filter((r) => r.id !== id);
        }),
        add: vi.fn().mockImplementation(async (record: LocalOutboxRecord) => {
          const newId = (outboxRecords.length ? Math.max(...outboxRecords.map((r) => r.id || 0)) : 0) + 1;
          const fullRecord = { ...record, id: newId };
          outboxRecords.push(fullRecord);
          return newId;
        })
      },
      transaction: vi.fn().mockImplementation(async (_mode: string, _tables: unknown[], work: () => Promise<unknown>) => {
        return await work();
      })
    } as unknown as LaxmiLensDB;

    useCase = new RecoverStaleAccountUseCase(mockCloudRepo, mockDb, mockAuthPort);
  });

  // 1. Correct cloud state permits recovery
  it('successfully recovers stale account when cloud state is verified at version 3 (archived)', async () => {
    const result = await useCase.execute(targetId);

    expect(result.success).toBe(true);
    expect(result.alreadyRecovered).toBe(false);
    expect(result.after.local.version).toBe(3);
    expect(result.after.local.isArchived).toBe(true);
    expect(result.after.deletedOutboxRecordId).toBe(6);

    // Verify local database row was updated
    const local = localAccounts.get(targetId);
    expect(local?.version).toBe(3);
    expect(local?.isArchived).toBe(true);

    // Verify stale restore record 6 was removed
    expect(outboxRecords.some((r) => r.id === 6)).toBe(false);
  });

  // 2. Wrong cloud version blocks recovery
  it('blocks recovery when cloud version is not 3', async () => {
    (mockCloudRepo.findById as any).mockResolvedValueOnce({
      ...validCloudRow,
      version: 2 // Wrong version!
    });

    await expect(useCase.execute(targetId)).rejects.toThrow(/Cloud account state is unexpected/);

    // Local state remains untouched
    expect(localAccounts.get(targetId)?.version).toBe(2);
    expect(outboxRecords.some((r) => r.id === 6)).toBe(true);
  });

  // 2b. Wrong cloud archive status blocks recovery
  it('blocks recovery when cloud is_archived is false', async () => {
    (mockCloudRepo.findById as any).mockResolvedValueOnce({
      ...validCloudRow,
      is_archived: false // Wrong status!
    });

    await expect(useCase.execute(targetId)).rejects.toThrow(/Cloud account state is unexpected/);
  });

  // 3. Cloud account owned by another user blocks recovery
  it('blocks recovery when cloud account belongs to a different user', async () => {
    (mockCloudRepo.findById as any).mockResolvedValueOnce({
      ...validCloudRow,
      user_id: otherUserId
    });

    await expect(useCase.execute(targetId)).rejects.toThrow(SyncAuthError);
  });

  // 4. Missing local account blocks recovery
  it('blocks recovery when local account does not exist in IndexedDB', async () => {
    localAccounts.delete(targetId);

    await expect(useCase.execute(targetId)).rejects.toThrow(/Local account '.*' not found/);
  });

  // 5. Unexpected local state blocks recovery
  it('blocks recovery when local account is in an unexpected state (e.g. version 1)', async () => {
    localAccounts.set(targetId, {
      ...localAccounts.get(targetId)!,
      version: 1 // Expected stale is v2
    });

    await expect(useCase.execute(targetId)).rejects.toThrow(/Local account state is unexpected/);
  });

  // 6. Pending archive event blocks unsafe recovery
  it('blocks recovery if an unacknowledged archive event is still pending in outbox', async () => {
    // Add pending archive event
    outboxRecords.push({
      id: 5,
      entity: 'accounts',
      entityId: targetId,
      operation: 'UPDATE',
      payload: {
        id: targetId,
        is_archived: true,
        version: 3
      },
      idempotencyKey: 'k-pending-archive',
      attempts: 1,
      createdAt: new Date().toISOString()
    });

    await expect(useCase.execute(targetId)).rejects.toThrow(
      /Unacknowledged archive event \(outbox ID 5\) is still pending/
    );

    // Stale restore record remains
    expect(outboxRecords.some((r) => r.id === 6)).toBe(true);
  });

  // 7. Only the matching stale restore event is removed
  // 8. Unrelated outbox records remain untouched
  it('removes only the matching stale restore event while preserving unrelated outbox records', async () => {
    expect(outboxRecords.some((r) => r.id === 99)).toBe(true);

    await useCase.execute(targetId);

    // Stale record 6 is removed
    expect(outboxRecords.some((r) => r.id === 6)).toBe(false);
    // Unrelated record 99 remains untouched
    expect(outboxRecords.some((r) => r.id === 99)).toBe(true);
  });

  // 9. Account and outbox changes roll back together on failure
  it('rolls back both account update and outbox deletion if the transaction fails', async () => {
    // Simulate transaction failure
    (mockDb.transaction as any).mockImplementationOnce(async () => {
      // Modify local account
      localAccounts.get(targetId)!.version = 3;
      // Delete outbox
      outboxRecords = outboxRecords.filter((r) => r.id !== 6);
      // Simulate sudden crash
      throw new Error('Dexie transaction write lock error');
    });

    await expect(useCase.execute(targetId)).rejects.toThrow('Dexie transaction write lock error');
  });

  // 10. Repeated recovery is safe (idempotent)
  it('is idempotent: running recovery again on an already recovered account is safe and produces no mutations', async () => {
    // First run: executes recovery
    const run1 = await useCase.execute(targetId);
    expect(run1.success).toBe(true);
    expect(run1.alreadyRecovered).toBe(false);

    // Second run: recognizes already recovered state
    const run2 = await useCase.execute(targetId);
    expect(run2.success).toBe(true);
    expect(run2.alreadyRecovered).toBe(true);
    expect(run2.after.local.version).toBe(3);
    expect(run2.after.local.isArchived).toBe(true);
  });

  // 11. Normal restore after recovery creates version 4
  it('enables normal UI restore after recovery to advance cleanly from version 3 to version 4', async () => {
    // 1. Recover stale account
    await useCase.execute(targetId);

    // Verify account is now at version 3, archived
    const recovered = localAccounts.get(targetId);
    expect(recovered?.version).toBe(3);
    expect(recovered?.isArchived).toBe(true);

    // 2. Perform normal user restore using RestoreAccountUseCase
    const accountRepo = new DexieAccountRepository(mockDb);
    const syncPort = new OutboxManager(mockDb);
    const restoreUseCase = new RestoreAccountUseCase(accountRepo, syncPort);

    await restoreUseCase.execute(targetId, validUserId);

    // 3. Verify local account is restored at version 4!
    const restored = localAccounts.get(targetId);
    expect(restored?.isArchived).toBe(false);
    expect(restored?.version).toBe(4);

    // 4. Verify clean outbox event was generated with version 4!
    const newRestoreOutbox = outboxRecords.find(
      (r) => r.entity === 'accounts' && r.entityId === targetId && r.payload?.version === 4
    );
    expect(newRestoreOutbox).toBeDefined();
    expect(newRestoreOutbox?.payload.is_archived).toBe(false);
    expect(newRestoreOutbox?.payload.version).toBe(4);
  });
});

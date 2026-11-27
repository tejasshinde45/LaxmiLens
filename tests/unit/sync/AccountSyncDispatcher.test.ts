import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AccountSyncDispatcher } from '@/infrastructure/sync/dispatchers/AccountSyncDispatcher';
import { ISupabaseAccountRepository } from '@/infrastructure/database/cloud/repositories/SupabaseAccountRepository';
import { AuthPort, AuthUser } from '@/application/ports/AuthPort';
import { OutboxManager } from '@/infrastructure/sync/OutboxManager';
import { LocalOutboxRecord } from '@/infrastructure/database/local/schema';
import { CloudAccountRow } from '@/infrastructure/database/cloud/mappers/AccountMapper';
import { SyncAuthError, SyncInProgressError } from '@/infrastructure/sync/errors/SyncErrors';

describe('AccountSyncDispatcher', () => {
  const validId = '123e4567-e89b-12d3-a456-426614174000';
  const validUserId = '987fcdeb-51a2-43f7-9876-543210987654';

  const mockUser: AuthUser = {
    id: validUserId,
    email: 'user@example.com'
  };

  const sampleCloudRow: CloudAccountRow = {
    id: validId,
    user_id: validUserId,
    name: 'Salary Account',
    account_type: 'bank',
    opening_balance_paise: 500000,
    currency: 'INR',
    institution_name: 'HDFC',
    color: '#10B981',
    icon: 'Landmark',
    notes: 'Payroll',
    is_archived: false,
    version: 1
  };

  let mockRepo: ISupabaseAccountRepository;
  let mockAuthPort: AuthPort;
  let mockOutboxManager: OutboxManager;
  let dispatcher: AccountSyncDispatcher;

  beforeEach(() => {
    mockRepo = {
      insert: vi.fn().mockResolvedValue(sampleCloudRow),
      updatePartial: vi.fn().mockResolvedValue({ ...sampleCloudRow, version: 2 }),
      findById: vi.fn(),
      findAll: vi.fn()
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

    mockOutboxManager = {
      markSuccess: vi.fn().mockResolvedValue(undefined),
      markFailure: vi.fn().mockResolvedValue(undefined),
      enqueue: vi.fn(),
      getPendingCount: vi.fn(),
      getPendingEntries: vi.fn(),
      clearOutbox: vi.fn(),
      processOutbox: vi.fn()
    } as unknown as OutboxManager;

    dispatcher = new AccountSyncDispatcher(mockRepo, mockAuthPort, mockOutboxManager);
  });

  describe('dispatch INSERT', () => {
    it('successfully processes valid INSERT outbox record and marks outbox success', async () => {
      const entry: LocalOutboxRecord = {
        id: 101,
        entity: 'accounts',
        entityId: validId,
        operation: 'INSERT',
        payload: {
          id: validId,
          user_id: validUserId,
          name: 'Salary Account',
          account_type: 'bank',
          opening_balance_paise: 500000,
          currency: 'INR',
          is_archived: false,
          version: 1
        },
        idempotencyKey: 'k-1',
        attempts: 0,
        createdAt: new Date().toISOString()
      };

      await dispatcher.dispatch(entry);

      expect(mockAuthPort.getCurrentUser).toHaveBeenCalled();
      expect(mockRepo.insert).toHaveBeenCalled();
      expect(mockOutboxManager.markSuccess).toHaveBeenCalledWith(101);
      expect(mockOutboxManager.markFailure).not.toHaveBeenCalled();
    });
  });

  describe('dispatch UPDATE', () => {
    it('successfully processes valid UPDATE outbox record and marks outbox success', async () => {
      const entry: LocalOutboxRecord = {
        id: 102,
        entity: 'accounts',
        entityId: validId,
        operation: 'UPDATE',
        payload: {
          id: validId,
          user_id: validUserId,
          name: 'Renamed Account',
          notes: 'New notes',
          version: 2
        },
        idempotencyKey: 'k-2',
        attempts: 0,
        createdAt: new Date().toISOString()
      };

      await dispatcher.dispatch(entry);

      expect(mockRepo.updatePartial).toHaveBeenCalledWith(
        validId,
        validUserId,
        expect.objectContaining({ name: 'Renamed Account', notes: 'New notes', version: 2 }),
        1 // expectedVersion = targetVersion - 1
      );
      expect(mockOutboxManager.markSuccess).toHaveBeenCalledWith(102);
    });

    it('successfully processes Archive delta update with user_id', async () => {
      const entry: LocalOutboxRecord = {
        id: 103,
        entity: 'accounts',
        entityId: validId,
        operation: 'UPDATE',
        payload: {
          id: validId,
          user_id: validUserId,
          is_archived: true,
          version: 3
        },
        idempotencyKey: 'k-3',
        attempts: 0,
        createdAt: new Date().toISOString()
      };

      await dispatcher.dispatch(entry);

      expect(mockRepo.updatePartial).toHaveBeenCalledWith(
        validId,
        validUserId,
        expect.objectContaining({ is_archived: true, version: 3 }),
        2
      );
      expect(mockOutboxManager.markSuccess).toHaveBeenCalledWith(103);
    });

    it('successfully processes Archive delta update WITHOUT user_id (Fix A requirement)', async () => {
      // Matches the exact shape of Record ID 5 from production test evidence
      const entry: LocalOutboxRecord = {
        id: 5,
        entity: 'accounts',
        entityId: validId,
        operation: 'UPDATE',
        payload: {
          id: validId,
          is_archived: true,
          version: 3
        },
        idempotencyKey: 'k-archive-no-user',
        attempts: 4,
        createdAt: new Date().toISOString()
      };

      await dispatcher.dispatch(entry);

      // Successfully dispatches and uses authenticated currentUser.id for remote ownership filter
      expect(mockRepo.updatePartial).toHaveBeenCalledWith(
        validId,
        validUserId,
        expect.objectContaining({ is_archived: true, version: 3 }),
        2
      );
      expect(mockOutboxManager.markSuccess).toHaveBeenCalledWith(5);
    });

    it('successfully processes Restore delta update WITHOUT user_id (Fix A requirement)', async () => {
      const entry: LocalOutboxRecord = {
        id: 6,
        entity: 'accounts',
        entityId: validId,
        operation: 'UPDATE',
        payload: {
          id: validId,
          is_archived: false,
          version: 4
        },
        idempotencyKey: 'k-restore-no-user',
        attempts: 0,
        createdAt: new Date().toISOString()
      };

      await dispatcher.dispatch(entry);

      expect(mockRepo.updatePartial).toHaveBeenCalledWith(
        validId,
        validUserId,
        expect.objectContaining({ is_archived: false, version: 4 }),
        3
      );
      expect(mockOutboxManager.markSuccess).toHaveBeenCalledWith(6);
    });

    it('rejects partial UPDATE if payload user_id does not match authenticated user', async () => {
      const entry: LocalOutboxRecord = {
        id: 110,
        entity: 'accounts',
        entityId: validId,
        operation: 'UPDATE',
        payload: {
          id: validId,
          user_id: '00000000-0000-0000-0000-000000000000', // Different user!
          is_archived: true,
          version: 3
        },
        idempotencyKey: 'k-diff-user-update',
        attempts: 0,
        createdAt: new Date().toISOString()
      };

      await expect(dispatcher.dispatch(entry)).rejects.toThrow(SyncAuthError);
      expect(mockRepo.updatePartial).not.toHaveBeenCalled();
      expect(mockOutboxManager.markSuccess).not.toHaveBeenCalled();
      expect(mockOutboxManager.markFailure).toHaveBeenCalledWith(110, expect.stringContaining('does not match'));
    });

    it('rejects dispatch if payload id does not match entry entityId', async () => {
      const entry: LocalOutboxRecord = {
        id: 111,
        entity: 'accounts',
        entityId: validId,
        operation: 'UPDATE',
        payload: {
          id: '00000000-0000-0000-0000-999999999999', // Mismatched ID!
          is_archived: true,
          version: 3
        },
        idempotencyKey: 'k-mismatched-id',
        attempts: 0,
        createdAt: new Date().toISOString()
      };

      await expect(dispatcher.dispatch(entry)).rejects.toThrow(
        /Payload ID '.*' does not match entityId/
      );
      expect(mockRepo.updatePartial).not.toHaveBeenCalled();
      expect(mockOutboxManager.markSuccess).not.toHaveBeenCalled();
    });

    it('successfully processes Restore delta update', async () => {
      const entry: LocalOutboxRecord = {
        id: 104,
        entity: 'accounts',
        entityId: validId,
        operation: 'UPDATE',
        payload: {
          id: validId,
          user_id: validUserId,
          is_archived: false,
          version: 4
        },
        idempotencyKey: 'k-4',
        attempts: 0,
        createdAt: new Date().toISOString()
      };

      await dispatcher.dispatch(entry);

      expect(mockRepo.updatePartial).toHaveBeenCalledWith(
        validId,
        validUserId,
        expect.objectContaining({ is_archived: false, version: 4 }),
        3
      );
      expect(mockOutboxManager.markSuccess).toHaveBeenCalledWith(104);
    });
  });

  describe('Authentication and Security Guards', () => {
    it('aborts dispatch if user is not authenticated', async () => {
      (mockAuthPort.getCurrentUser as any).mockResolvedValueOnce(null);

      const entry: LocalOutboxRecord = {
        id: 105,
        entity: 'accounts',
        entityId: validId,
        operation: 'INSERT',
        payload: { id: validId, user_id: validUserId, name: 'Bank', account_type: 'bank', opening_balance_paise: 0 },
        idempotencyKey: 'k-5',
        attempts: 0,
        createdAt: new Date().toISOString()
      };

      await expect(dispatcher.dispatch(entry)).rejects.toThrow(SyncAuthError);
      expect(mockRepo.insert).not.toHaveBeenCalled();
      expect(mockOutboxManager.markSuccess).not.toHaveBeenCalled();
      expect(mockOutboxManager.markFailure).toHaveBeenCalledWith(105, expect.stringContaining('not authenticated'));
    });

    it('aborts dispatch if outbox payload user_id does not match authenticated user', async () => {
      const differentUserRecord: LocalOutboxRecord = {
        id: 106,
        entity: 'accounts',
        entityId: validId,
        operation: 'INSERT',
        payload: {
          id: validId,
          user_id: '00000000-0000-0000-0000-000000000000', // Different user!
          name: 'Bank',
          account_type: 'bank',
          opening_balance_paise: 0
        },
        idempotencyKey: 'k-6',
        attempts: 0,
        createdAt: new Date().toISOString()
      };

      await expect(dispatcher.dispatch(differentUserRecord)).rejects.toThrow(SyncAuthError);
      expect(mockRepo.insert).not.toHaveBeenCalled();
      expect(mockOutboxManager.markSuccess).not.toHaveBeenCalled();
      expect(mockOutboxManager.markFailure).toHaveBeenCalledWith(106, expect.stringContaining('does not match'));
    });

    it('aborts dispatch if INSERT payload user_id is missing/undefined', async () => {
      const missingUserRecord: LocalOutboxRecord = {
        id: 112,
        entity: 'accounts',
        entityId: validId,
        operation: 'INSERT',
        payload: {
          id: validId,
          // user_id is missing!
          name: 'Bank',
          account_type: 'bank',
          opening_balance_paise: 0
        },
        idempotencyKey: 'k-missing-user-insert',
        attempts: 0,
        createdAt: new Date().toISOString()
      };

      await expect(dispatcher.dispatch(missingUserRecord)).rejects.toThrow(SyncAuthError);
      expect(mockRepo.insert).not.toHaveBeenCalled();
      expect(mockOutboxManager.markSuccess).not.toHaveBeenCalled();
      expect(mockOutboxManager.markFailure).toHaveBeenCalledWith(112, expect.stringContaining('does not match'));
    });
  });

  describe('Entity and Operation Guards', () => {
    it('rejects unsupported entity type without acknowledging success', async () => {
      const entry: LocalOutboxRecord = {
        id: 107,
        entity: 'transactions' as any,
        entityId: 'tx-1',
        operation: 'INSERT',
        payload: { user_id: validUserId },
        idempotencyKey: 'k-7',
        attempts: 0,
        createdAt: new Date().toISOString()
      };

      await expect(dispatcher.dispatch(entry)).rejects.toThrow(/only processes 'accounts' entities/);
      expect(mockOutboxManager.markSuccess).not.toHaveBeenCalled();
      expect(mockOutboxManager.markFailure).toHaveBeenCalledWith(107, expect.stringContaining('accounts'));
    });

    it('rejects unsupported operation (e.g. DELETE)', async () => {
      const entry: LocalOutboxRecord = {
        id: 108,
        entity: 'accounts',
        entityId: validId,
        operation: 'DELETE',
        payload: { id: validId, user_id: validUserId },
        idempotencyKey: 'k-8',
        attempts: 0,
        createdAt: new Date().toISOString()
      };

      await expect(dispatcher.dispatch(entry)).rejects.toThrow(/only processes 'INSERT' and 'UPDATE'/);
      expect(mockOutboxManager.markSuccess).not.toHaveBeenCalled();
      expect(mockOutboxManager.markFailure).toHaveBeenCalledWith(108, expect.stringContaining('DELETE'));
    });
  });

  describe('Failure and Outbox Retention', () => {
    it('calls markFailure and retains outbox record when repository throws error', async () => {
      (mockRepo.insert as any).mockRejectedValueOnce(new Error('Cloud DB Connection Lost'));

      const entry: LocalOutboxRecord = {
        id: 109,
        entity: 'accounts',
        entityId: validId,
        operation: 'INSERT',
        payload: {
          id: validId,
          user_id: validUserId,
          name: 'Failing Account',
          account_type: 'bank',
          opening_balance_paise: 0,
          version: 1
        },
        idempotencyKey: 'k-9',
        attempts: 0,
        createdAt: new Date().toISOString()
      };

      await expect(dispatcher.dispatch(entry)).rejects.toThrow('Cloud DB Connection Lost');
      expect(mockOutboxManager.markSuccess).not.toHaveBeenCalled();
      expect(mockOutboxManager.markFailure).toHaveBeenCalledWith(109, 'Cloud DB Connection Lost');
    });
  });

  describe('Per-Account In-Flight Concurrency Protection', () => {
    const secondAccountId = '223e4567-e89b-12d3-a456-426614174099';

    it('rejects duplicate concurrent dispatch for the same accountId with SyncInProgressError without calling markFailure, and releases lock afterwards', async () => {
      let releaseFirstCall: () => void = () => {};
      const firstCallGate = new Promise<void>((resolve) => {
        releaseFirstCall = resolve;
      });

      (mockRepo.insert as any).mockImplementationOnce(async () => {
        await firstCallGate;
        return sampleCloudRow;
      });

      const entry1: LocalOutboxRecord = {
        id: 201,
        userId: validUserId,
        entity: 'accounts',
        entityId: validId,
        operation: 'INSERT',
        payload: {
          id: validId,
          user_id: validUserId,
          name: 'Salary Account',
          account_type: 'bank',
          opening_balance_paise: 500000,
          version: 1
        },
        idempotencyKey: 'k-inflight-1',
        attempts: 0,
        createdAt: new Date().toISOString()
      };

      const entry2: LocalOutboxRecord = {
        ...entry1,
        id: 202,
        operation: 'UPDATE',
        payload: {
          id: validId,
          user_id: validUserId,
          name: 'Salary Account Renamed',
          version: 2
        },
        idempotencyKey: 'k-inflight-2'
      };

      const firstPromise = dispatcher.dispatch(entry1);
      await expect(dispatcher.dispatch(entry2)).rejects.toThrow(SyncInProgressError);
      expect(mockOutboxManager.markFailure).not.toHaveBeenCalled();

      releaseFirstCall();
      await expect(firstPromise).resolves.toBeUndefined();
      expect(mockOutboxManager.markSuccess).toHaveBeenCalledWith(201);

      // Lock must release cleanly so subsequent dispatch for the same account succeeds
      (mockRepo.updatePartial as any).mockResolvedValueOnce({ ...sampleCloudRow, version: 2 });
      await expect(dispatcher.dispatch(entry2)).resolves.toBeUndefined();
      expect(mockOutboxManager.markSuccess).toHaveBeenCalledWith(202);
    });

    it('allows distinct accounts to dispatch concurrently and releases lock even when dispatch throws', async () => {
      let releaseFirst: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });

      (mockRepo.insert as any)
        .mockImplementationOnce(async () => {
          await gate;
          throw new Error('Transient failure for first account');
        })
        .mockResolvedValueOnce({ ...sampleCloudRow, id: secondAccountId, name: 'Second' });

      const accountA: LocalOutboxRecord = {
        id: 203,
        userId: validUserId,
        entity: 'accounts',
        entityId: validId,
        operation: 'INSERT',
        payload: {
          id: validId,
          user_id: validUserId,
          name: 'Account A',
          account_type: 'bank',
          opening_balance_paise: 0,
          version: 1
        },
        idempotencyKey: 'k-a',
        attempts: 0,
        createdAt: new Date().toISOString()
      };

      const accountB: LocalOutboxRecord = {
        id: 204,
        userId: validUserId,
        entity: 'accounts',
        entityId: secondAccountId,
        operation: 'INSERT',
        payload: {
          id: secondAccountId,
          user_id: validUserId,
          name: 'Account B',
          account_type: 'cash',
          opening_balance_paise: 10000,
          version: 1
        },
        idempotencyKey: 'k-b',
        attempts: 0,
        createdAt: new Date().toISOString()
      };

      const p1 = dispatcher.dispatch(accountA);
      const p2 = dispatcher.dispatch(accountB);
      await expect(p2).resolves.toBeUndefined();
      expect(mockOutboxManager.markSuccess).toHaveBeenCalledWith(204);

      releaseFirst();
      await expect(p1).rejects.toThrow('Transient failure for first account');
      expect(mockOutboxManager.markFailure).toHaveBeenCalledWith(203, 'Transient failure for first account');

      // Lock was released in finally despite error
      (mockRepo.insert as any).mockResolvedValueOnce(sampleCloudRow);
      await expect(dispatcher.dispatch(accountA)).resolves.toBeUndefined();
    });
  });
});

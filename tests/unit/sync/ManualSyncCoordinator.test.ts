import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ManualSyncCoordinator,
  UnifiedSyncResult
} from '@/infrastructure/sync/ManualSyncCoordinator';
import { AccountSyncDispatcher } from '@/infrastructure/sync/dispatchers/AccountSyncDispatcher';
import { TransactionSyncDispatcher } from '@/infrastructure/sync/dispatchers/TransactionSyncDispatcher';
import { OutboxManager } from '@/infrastructure/sync/OutboxManager';
import { AuthPort, AuthUser } from '@/application/ports/AuthPort';
import { LocalOutboxRecord } from '@/infrastructure/database/local/schema';
import {
  SyncAuthError,
  SyncInProgressError,
  SyncAccountDependencyError,
  SyncUnresolvedCategoryError,
  SyncConflictError,
  SyncDatabaseError
} from '@/infrastructure/sync/errors/SyncErrors';

describe('ManualSyncCoordinator (Phase 2D.5)', () => {
  const validUserId = '987fcdeb-51a2-43f7-9876-543210987654';
  const validAccId = '11111111-1111-4111-8111-111111111111';
  const validAccId2 = '22222222-2222-4222-8222-222222222222';
  const validTxId = '33333333-3333-4333-8333-333333333333';
  const validTxId2 = '44444444-4444-4444-8444-444444444444';
  const validDateIso = '2026-11-21T12:00:00.000Z';

  const mockUser: AuthUser = {
    id: validUserId,
    email: 'coordinator@example.com'
  };

  let mockAccountDispatcher: AccountSyncDispatcher;
  let mockTransactionDispatcher: TransactionSyncDispatcher;
  let mockOutboxManager: OutboxManager;
  let mockAuthPort: AuthPort;
  let coordinator: ManualSyncCoordinator;
  let outboxEntries: LocalOutboxRecord[];
  let executionOrder: string[];

  beforeEach(() => {
    outboxEntries = [];
    executionOrder = [];

    mockAccountDispatcher = {
      dispatch: vi.fn().mockImplementation(async (entry: LocalOutboxRecord) => {
        executionOrder.push(`account:${entry.operation}:${entry.entityId}`);
        await mockOutboxManager.markSuccess(entry.id!);
      })
    } as unknown as AccountSyncDispatcher;

    mockTransactionDispatcher = {
      dispatch: vi.fn().mockImplementation(async (entry: LocalOutboxRecord) => {
        executionOrder.push(`transaction:${entry.operation}:${entry.entityId}`);
        await mockOutboxManager.markSuccess(entry.id!);
      })
    } as unknown as TransactionSyncDispatcher;

    mockOutboxManager = {
      getPendingEntries: vi.fn().mockImplementation(async (userIdOrLimit: string | number = 100, limit = 100) => {
        const actualLimit = typeof userIdOrLimit === 'number' ? userIdOrLimit : limit;
        const targetUserId = typeof userIdOrLimit === 'string' ? userIdOrLimit : undefined;
        const filtered = targetUserId
          ? outboxEntries.filter((e) => !e.userId || e.userId === targetUserId || e.payload?.user_id === targetUserId)
          : outboxEntries;
        return filtered.slice(0, actualLimit);
      }),
      getPendingCount: vi.fn().mockImplementation(async (userId?: string) => {
        if (userId) {
          return outboxEntries.filter((e) => !e.userId || e.userId === userId || e.payload?.user_id === userId).length;
        }
        return outboxEntries.length;
      }),
      markSuccess: vi.fn().mockImplementation(async (id: number) => {
        outboxEntries = outboxEntries.filter((e) => e.id !== id);
      }),
      markFailure: vi.fn().mockImplementation(async (id: number, error: string) => {
        const item = outboxEntries.find((e) => e.id === id);
        if (item) {
          item.attempts += 1;
          item.lastError = error;
        }
      })
    } as unknown as OutboxManager;

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

    coordinator = new ManualSyncCoordinator(
      mockAccountDispatcher,
      mockTransactionDispatcher,
      mockOutboxManager,
      mockAuthPort
    );
  });

  describe('1. Account-only manual synchronization', () => {
    it('synchronizes account entries when only accounts are pending', async () => {
      outboxEntries = [
        {
          id: 1,
          entity: 'accounts',
          entityId: validAccId,
          operation: 'INSERT',
          payload: { id: validAccId, user_id: validUserId, name: 'HDFC Bank' },
          idempotencyKey: 'k-1',
          attempts: 0,
          createdAt: validDateIso
        }
      ];

      const result = await coordinator.run();

      expect(result.syncedCount).toBe(1);
      expect(result.failedCount).toBe(0);
      expect(result.accounts.syncedCount).toBe(1);
      expect(result.transactions.syncedCount).toBe(0);
      expect(mockAccountDispatcher.dispatch).toHaveBeenCalledTimes(1);
      expect(mockTransactionDispatcher.dispatch).not.toHaveBeenCalled();
      expect(outboxEntries.length).toBe(0);
    });
  });

  describe('2. Transaction-only synchronization', () => {
    it('synchronizes transaction entries when only transactions are pending', async () => {
      outboxEntries = [
        {
          id: 2,
          entity: 'transactions',
          entityId: validTxId,
          operation: 'INSERT',
          payload: {
            id: validTxId,
            user_id: validUserId,
            type: 'expense',
            amount_paise: 50000,
            currency: 'INR',
            account_id: validAccId,
            destination_account_id: null,
            category_id: null,
            title: 'Groceries',
            transaction_date: validDateIso,
            version: 1,
            idempotency_key: 'tx-k-1'
          },
          idempotencyKey: 'tx-k-1',
          attempts: 0,
          createdAt: validDateIso
        }
      ];

      const result = await coordinator.run();

      expect(result.syncedCount).toBe(1);
      expect(result.failedCount).toBe(0);
      expect(result.accounts.syncedCount).toBe(0);
      expect(result.transactions.syncedCount).toBe(1);
      expect(mockTransactionDispatcher.dispatch).toHaveBeenCalledTimes(1);
      expect(mockAccountDispatcher.dispatch).not.toHaveBeenCalled();
      expect(outboxEntries.length).toBe(0);
    });
  });

  describe('3 & 4. Accounts processed before transactions & dependent transaction INSERT', () => {
    it('dispatches account INSERT before dependent transaction INSERT', async () => {
      // Transaction was placed in outbox before account (or interleaved)
      outboxEntries = [
        {
          id: 10,
          entity: 'transactions',
          entityId: validTxId,
          operation: 'INSERT',
          payload: {
            id: validTxId,
            user_id: validUserId,
            account_id: validAccId,
            amount_paise: 10000,
            version: 1
          },
          idempotencyKey: 'tx-1',
          attempts: 0,
          createdAt: validDateIso
        },
        {
          id: 11,
          entity: 'accounts',
          entityId: validAccId,
          operation: 'INSERT',
          payload: { id: validAccId, user_id: validUserId, name: 'Salary Account' },
          idempotencyKey: 'acc-1',
          attempts: 0,
          createdAt: validDateIso
        }
      ];

      const result = await coordinator.run();

      expect(result.accounts.syncedCount).toBe(1);
      expect(result.transactions.syncedCount).toBe(1);
      expect(result.syncedCount).toBe(2);
      expect(executionOrder).toEqual([
        `account:INSERT:${validAccId}`,
        `transaction:INSERT:${validTxId}`
      ]);
    });
  });

  describe('5. Account INSERT failure preserves transaction dependency failure', () => {
    it('retains transaction dependency failure when referenced account INSERT fails', async () => {
      mockAccountDispatcher.dispatch = vi.fn().mockRejectedValue(
        new Error('Supabase RLS denied account creation')
      );
      mockTransactionDispatcher.dispatch = vi.fn().mockRejectedValue(
        new SyncAccountDependencyError('Referenced account was not found in cloud', validAccId)
      );

      outboxEntries = [
        {
          id: 20,
          entity: 'accounts',
          entityId: validAccId,
          operation: 'INSERT',
          payload: { id: validAccId, user_id: validUserId },
          idempotencyKey: 'acc-20',
          attempts: 0,
          createdAt: validDateIso
        },
        {
          id: 21,
          entity: 'transactions',
          entityId: validTxId,
          operation: 'INSERT',
          payload: { id: validTxId, account_id: validAccId, version: 1 },
          idempotencyKey: 'tx-21',
          attempts: 0,
          createdAt: validDateIso
        }
      ];

      const result = await coordinator.run();

      expect(result.accounts.failedCount).toBe(1);
      expect(result.transactions.failedCount).toBe(1);
      expect(result.transactions.dependencyBlockedCount).toBe(1);
      expect(result.errors).toHaveLength(2);
      expect(result.errors[1].category).toBe('dependency');
      // Both entries remain in outbox
      expect(outboxEntries).toHaveLength(2);
    });
  });

  describe('6 & 7. Account UPDATE ordering & Per-account FIFO', () => {
    it('processes account INSERT before UPDATE and skips later events if earlier event fails', async () => {
      let firstAttempt = true;
      mockAccountDispatcher.dispatch = vi.fn().mockImplementation(async (entry: LocalOutboxRecord) => {
        if (entry.operation === 'INSERT' && firstAttempt) {
          firstAttempt = false;
          throw new SyncDatabaseError('DB Timeout', 'PGRST500');
        }
        await mockOutboxManager.markSuccess(entry.id!);
      });

      outboxEntries = [
        {
          id: 30,
          entity: 'accounts',
          entityId: validAccId,
          operation: 'INSERT',
          payload: { id: validAccId, version: 1 },
          idempotencyKey: 'acc-30',
          attempts: 0,
          createdAt: validDateIso
        },
        {
          id: 31,
          entity: 'accounts',
          entityId: validAccId, // SAME account
          operation: 'UPDATE',
          payload: { id: validAccId, name: 'Renamed', version: 2 },
          idempotencyKey: 'acc-31',
          attempts: 0,
          createdAt: validDateIso
        },
        {
          id: 32,
          entity: 'accounts',
          entityId: validAccId2, // DIFFERENT account
          operation: 'INSERT',
          payload: { id: validAccId2, name: 'Other Bank', version: 1 },
          idempotencyKey: 'acc-32',
          attempts: 0,
          createdAt: validDateIso
        }
      ];

      const result = await coordinator.run();

      expect(result.accounts.failedCount).toBe(1);
      expect(result.accounts.skippedCount).toBe(1); // acc-31 skipped because acc-30 failed
      expect(result.accounts.syncedCount).toBe(1); // acc-32 succeeded
      expect(outboxEntries.find((e) => e.id === 30)).toBeDefined();
      expect(outboxEntries.find((e) => e.id === 31)).toBeDefined();
      expect(outboxEntries.find((e) => e.id === 32)).toBeUndefined(); // Succeeded and removed
    });
  });

  describe('8 & 9. Per-transaction FIFO & Failed earlier transaction blocks later events', () => {
    it('processes transactions in FIFO order and skips later events for the same transaction upon failure', async () => {
      mockTransactionDispatcher.dispatch = vi.fn().mockImplementation(async (entry: LocalOutboxRecord) => {
        if (entry.entityId === validTxId && entry.operation === 'UPDATE') {
          throw new SyncConflictError('OCC conflict on v2');
        }
        await mockOutboxManager.markSuccess(entry.id!);
      });

      outboxEntries = [
        {
          id: 40,
          entity: 'transactions',
          entityId: validTxId,
          operation: 'UPDATE',
          payload: { id: validTxId, version: 2 },
          idempotencyKey: 'tx-40',
          attempts: 0,
          createdAt: validDateIso
        },
        {
          id: 41,
          entity: 'transactions',
          entityId: validTxId, // SAME transaction
          operation: 'DELETE',
          payload: { id: validTxId, version: 3, deleted_at: validDateIso },
          idempotencyKey: 'tx-41',
          attempts: 0,
          createdAt: validDateIso
        },
        {
          id: 42,
          entity: 'transactions',
          entityId: validTxId2, // DIFFERENT transaction
          operation: 'INSERT',
          payload: { id: validTxId2, version: 1 },
          idempotencyKey: 'tx-42',
          attempts: 0,
          createdAt: validDateIso
        }
      ];

      const result = await coordinator.run();

      expect(result.transactions.failedCount).toBe(1);
      expect(result.transactions.skippedCount).toBe(1); // tx-41 skipped because tx-40 failed
      expect(result.transactions.syncedCount).toBe(1); // tx-42 succeeded
      expect(result.transactions.conflictCount).toBe(1);
      expect(outboxEntries.find((e) => e.id === 40)).toBeDefined();
      expect(outboxEntries.find((e) => e.id === 41)).toBeDefined();
      expect(outboxEntries.find((e) => e.id === 42)).toBeUndefined();
    });
  });

  describe('10. Unrelated transactions continue safely', () => {
    it('allows unrelated transactions to succeed even when one transaction encounters an error', async () => {
      mockTransactionDispatcher.dispatch = vi.fn().mockImplementation(async (entry: LocalOutboxRecord) => {
        if (entry.entityId === validTxId) {
          throw new SyncDatabaseError('Failed', 'PGRST500');
        }
        await mockOutboxManager.markSuccess(entry.id!);
      });

      outboxEntries = [
        {
          id: 50,
          entity: 'transactions',
          entityId: validTxId,
          operation: 'INSERT',
          payload: { id: validTxId, version: 1 },
          idempotencyKey: 'tx-50',
          attempts: 0,
          createdAt: validDateIso
        },
        {
          id: 51,
          entity: 'transactions',
          entityId: validTxId2,
          operation: 'INSERT',
          payload: { id: validTxId2, version: 1 },
          idempotencyKey: 'tx-51',
          attempts: 0,
          createdAt: validDateIso
        }
      ];

      const result = await coordinator.run();

      expect(result.transactions.failedCount).toBe(1);
      expect(result.transactions.syncedCount).toBe(1);
      expect(result.stillPendingCount).toBe(1);
    });
  });

  describe('11. Categorized transactions remain blocked', () => {
    it('classifies category blocker and retains outbox entry without deleting it', async () => {
      mockTransactionDispatcher.dispatch = vi.fn().mockRejectedValue(
        new SyncUnresolvedCategoryError('Categorized transaction sync blocked', 'cat-uuid')
      );

      outboxEntries = [
        {
          id: 60,
          entity: 'transactions',
          entityId: validTxId,
          operation: 'INSERT',
          payload: { id: validTxId, category_id: 'cat-uuid', version: 1 },
          idempotencyKey: 'tx-60',
          attempts: 0,
          createdAt: validDateIso
        }
      ];

      const result = await coordinator.run();

      expect(result.transactions.categoryBlockedCount).toBe(1);
      expect(result.transactions.failedCount).toBe(1);
      expect(result.transactions.syncedCount).toBe(0);
      expect(result.errors[0].category).toBe('category');
      expect(outboxEntries).toHaveLength(1);
    });
  });

  describe('12. Missing account dependency remains blocked', () => {
    it('classifies dependency blocker and retains entry', async () => {
      mockTransactionDispatcher.dispatch = vi.fn().mockRejectedValue(
        new SyncAccountDependencyError('Referenced account missing', validAccId)
      );

      outboxEntries = [
        {
          id: 70,
          entity: 'transactions',
          entityId: validTxId,
          operation: 'INSERT',
          payload: { id: validTxId, account_id: validAccId, version: 1 },
          idempotencyKey: 'tx-70',
          attempts: 0,
          createdAt: validDateIso
        }
      ];

      const result = await coordinator.run();

      expect(result.transactions.dependencyBlockedCount).toBe(1);
      expect(result.errors[0].category).toBe('dependency');
      expect(outboxEntries).toHaveLength(1);
    });
  });

  describe('13. Unsupported entities remain in outbox', () => {
    it('counts unsupported entities and preserves them in outbox untouched', async () => {
      outboxEntries = [
        {
          id: 80,
          entity: 'categories' as any,
          entityId: 'cat-1',
          operation: 'INSERT',
          payload: { id: 'cat-1', name: 'Food' },
          idempotencyKey: 'cat-k',
          attempts: 0,
          createdAt: validDateIso
        },
        {
          id: 81,
          entity: 'budgets' as any,
          entityId: 'b-1',
          operation: 'INSERT',
          payload: { id: 'b-1' },
          idempotencyKey: 'b-k',
          attempts: 0,
          createdAt: validDateIso
        }
      ];

      const result = await coordinator.run();

      expect(result.unsupportedCount).toBe(2);
      expect(result.syncedCount).toBe(0);
      expect(result.failedCount).toBe(0);
      expect(mockAccountDispatcher.dispatch).not.toHaveBeenCalled();
      expect(mockTransactionDispatcher.dispatch).not.toHaveBeenCalled();
      expect(outboxEntries).toHaveLength(2); // Untouched
    });
  });

  describe('14 & 15. Single global manual run mutex & Competing run rejection', () => {
    it('prevents overlapping manual sync runs and throws SyncInProgressError', async () => {
      let resolveFirstRun: () => void;
      const delayedRunPromise = new Promise<void>((resolve) => {
        resolveFirstRun = resolve;
      });

      mockAccountDispatcher.dispatch = vi.fn().mockImplementation(async () => {
        await delayedRunPromise;
      });

      outboxEntries = [
        {
          id: 90,
          entity: 'accounts',
          entityId: validAccId,
          operation: 'INSERT',
          payload: { id: validAccId, version: 1 },
          idempotencyKey: 'acc-90',
          attempts: 0,
          createdAt: validDateIso
        }
      ];

      // Start run 1
      const firstRunPromise = coordinator.run();
      expect(coordinator.isSyncRunning()).toBe(true);

      // Attempt concurrent run 2
      await expect(coordinator.run()).rejects.toThrow(SyncInProgressError);

      // Complete run 1
      resolveFirstRun!();
      await firstRunPromise;

      expect(coordinator.isSyncRunning()).toBe(false);
    });
  });

  describe('16 & 17 & 18. Acknowledgement safety & Failure retention', () => {
    it('surfaces acknowledgment failure and does not count as complete success', async () => {
      // Simulate dispatcher throwing because outboxManager.markSuccess failed
      mockAccountDispatcher.dispatch = vi.fn().mockRejectedValue(
        new Error('IndexedDB Transaction Aborted during markSuccess')
      );

      outboxEntries = [
        {
          id: 100,
          entity: 'accounts',
          entityId: validAccId,
          operation: 'INSERT',
          payload: { id: validAccId, version: 1 },
          idempotencyKey: 'acc-100',
          attempts: 0,
          createdAt: validDateIso
        }
      ];

      const result = await coordinator.run();

      expect(result.accounts.syncedCount).toBe(0);
      expect(result.accounts.failedCount).toBe(1);
      expect(result.errors[0].error).toContain('IndexedDB Transaction Aborted');
      expect(outboxEntries).toHaveLength(1); // Preserved
    });
  });

  describe('19 & 20. Stable DELETE timestamp & Missing timestamp rejection', () => {
    it('rejects DELETE transaction outbox entry when deleted_at is missing', async () => {
      mockTransactionDispatcher.dispatch = vi.fn().mockRejectedValue(
        new Error('Missing or invalid deleted_at in transaction delete payload.')
      );

      outboxEntries = [
        {
          id: 110,
          entity: 'transactions',
          entityId: validTxId,
          operation: 'DELETE',
          payload: { id: validTxId, version: 2 }, // missing deleted_at
          idempotencyKey: 'tx-110',
          attempts: 0,
          createdAt: validDateIso
        }
      ];

      const result = await coordinator.run();

      expect(result.transactions.failedCount).toBe(1);
      expect(result.errors[0].error).toContain('Missing or invalid deleted_at');
    });
  });

  describe('21. Expected version progression validation', () => {
    it('validates target version and records OCC failure when versions diverge', async () => {
      mockTransactionDispatcher.dispatch = vi.fn().mockRejectedValue(
        new SyncConflictError('Version mismatch: cloud version is 3, expected 1')
      );

      outboxEntries = [
        {
          id: 120,
          entity: 'transactions',
          entityId: validTxId,
          operation: 'UPDATE',
          payload: { id: validTxId, version: 2 },
          idempotencyKey: 'tx-120',
          attempts: 0,
          createdAt: validDateIso
        }
      ];

      const result = await coordinator.run();

      expect(result.transactions.conflictCount).toBe(1);
      expect(result.errors[0].category).toBe('conflict');
    });
  });
});

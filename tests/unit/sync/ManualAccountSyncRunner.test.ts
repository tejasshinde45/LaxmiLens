import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ManualAccountSyncRunner } from '@/infrastructure/sync/ManualAccountSyncRunner';
import { AccountSyncDispatcher } from '@/infrastructure/sync/dispatchers/AccountSyncDispatcher';
import { OutboxManager } from '@/infrastructure/sync/OutboxManager';
import { AuthPort, AuthUser } from '@/application/ports/AuthPort';
import { LocalOutboxRecord } from '@/infrastructure/database/local/schema';
import { SyncAuthError, SyncInProgressError } from '@/infrastructure/sync/errors/SyncErrors';

describe('ManualAccountSyncRunner (Phase 2C)', () => {
  const validUserId = '987fcdeb-51a2-43f7-9876-543210987654';
  const otherUserId = '11111111-2222-3333-4444-555555555555';

  const mockUser: AuthUser = {
    id: validUserId,
    email: 'test@example.com'
  };

  let mockDispatcher: AccountSyncDispatcher;
  let mockOutboxManager: OutboxManager;
  let mockAuthPort: AuthPort;
  let runner: ManualAccountSyncRunner;
  let outboxEntries: LocalOutboxRecord[];

  beforeEach(() => {
    outboxEntries = [];

    mockDispatcher = {
      dispatch: vi.fn().mockImplementation(async (entry: LocalOutboxRecord) => {
        // Guard cross-user payloads similar to real dispatcher
        if (entry.payload.user_id && entry.payload.user_id !== validUserId) {
          throw new SyncAuthError('Cross-user account payload rejected.');
        }
        // Simulated dispatcher acknowledgment behavior
        await mockOutboxManager.markSuccess(entry.id!);
      })
    } as unknown as AccountSyncDispatcher;

    mockOutboxManager = {
      getPendingEntries: vi.fn().mockImplementation(async (userIdOrLimit: string | number = 50, limit = 50) => {
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

    runner = new ManualAccountSyncRunner(mockDispatcher, mockOutboxManager, mockAuthPort);
  });

  // 1. Authenticated manual execution
  it('successfully synchronizes pending accounts when user is authenticated', async () => {
    outboxEntries = [
      {
        id: 1,
        entity: 'accounts',
        entityId: 'acc-1',
        operation: 'INSERT',
        payload: { id: 'acc-1', user_id: validUserId, name: 'Bank' },
        idempotencyKey: 'idemp-1',
        attempts: 0,
        createdAt: new Date().toISOString()
      }
    ];

    const result = await runner.run();

    expect(result.syncedCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(result.skippedCount).toBe(0);
    expect(mockDispatcher.dispatch).toHaveBeenCalledTimes(1);
    expect(outboxEntries.length).toBe(0); // Acknowledged and removed
  });

  // 2. Unauthenticated execution rejection
  it('rejects execution when no authenticated user is present', async () => {
    (mockAuthPort.getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    outboxEntries = [
      {
        id: 1,
        entity: 'accounts',
        entityId: 'acc-1',
        operation: 'INSERT',
        payload: { id: 'acc-1', user_id: validUserId, name: 'Bank' },
        idempotencyKey: 'idemp-1',
        attempts: 0,
        createdAt: new Date().toISOString()
      }
    ];

    await expect(runner.run()).rejects.toThrow(SyncAuthError);
    expect(mockDispatcher.dispatch).not.toHaveBeenCalled();
    expect(outboxEntries.length).toBe(1); // Left in outbox
  });

  // 3. Sequential processing of account entries
  it('processes account entries sequentially in strict outbox insertion order', async () => {
    const callOrder: string[] = [];

    (mockDispatcher.dispatch as ReturnType<typeof vi.fn>).mockImplementation(
      async (entry: LocalOutboxRecord) => {
        callOrder.push(entry.entityId);
        await mockOutboxManager.markSuccess(entry.id!);
      }
    );

    outboxEntries = [
      {
        id: 1,
        entity: 'accounts',
        entityId: 'acc-first',
        operation: 'INSERT',
        payload: { id: 'acc-first', user_id: validUserId },
        idempotencyKey: 'k-1',
        attempts: 0,
        createdAt: new Date().toISOString()
      },
      {
        id: 2,
        entity: 'accounts',
        entityId: 'acc-second',
        operation: 'INSERT',
        payload: { id: 'acc-second', user_id: validUserId },
        idempotencyKey: 'k-2',
        attempts: 0,
        createdAt: new Date().toISOString()
      },
      {
        id: 3,
        entity: 'accounts',
        entityId: 'acc-third',
        operation: 'INSERT',
        payload: { id: 'acc-third', user_id: validUserId },
        idempotencyKey: 'k-3',
        attempts: 0,
        createdAt: new Date().toISOString()
      }
    ];

    const result = await runner.run();

    expect(result.syncedCount).toBe(3);
    expect(callOrder).toEqual(['acc-first', 'acc-second', 'acc-third']);
  });

  // 4. Version 1 before version 2 before version 3
  it('preserves exact version ordering (v1 -> v2 -> v3) for mutations on the same account', async () => {
    const versionOrder: number[] = [];

    (mockDispatcher.dispatch as ReturnType<typeof vi.fn>).mockImplementation(
      async (entry: LocalOutboxRecord) => {
        versionOrder.push(entry.payload.version as number);
        await mockOutboxManager.markSuccess(entry.id!);
      }
    );

    outboxEntries = [
      {
        id: 1,
        entity: 'accounts',
        entityId: 'acc-same',
        operation: 'INSERT',
        payload: { id: 'acc-same', user_id: validUserId, version: 1 },
        idempotencyKey: 'k-v1',
        attempts: 0,
        createdAt: new Date().toISOString()
      },
      {
        id: 2,
        entity: 'accounts',
        entityId: 'acc-same',
        operation: 'UPDATE',
        payload: { id: 'acc-same', user_id: validUserId, version: 2 },
        idempotencyKey: 'k-v2',
        attempts: 0,
        createdAt: new Date().toISOString()
      },
      {
        id: 3,
        entity: 'accounts',
        entityId: 'acc-same',
        operation: 'UPDATE',
        payload: { id: 'acc-same', user_id: validUserId, version: 3 },
        idempotencyKey: 'k-v3',
        attempts: 0,
        createdAt: new Date().toISOString()
      }
    ];

    const result = await runner.run();

    expect(result.syncedCount).toBe(3);
    expect(versionOrder).toEqual([1, 2, 3]);
  });

  // 4b. Archive v3 followed by restore v4 in order
  it('synchronizes Archive v3 followed by Restore v4 in strict order without user_id in payloads', async () => {
    const executedOps: Array<{ version: number; is_archived: boolean }> = [];

    (mockDispatcher.dispatch as ReturnType<typeof vi.fn>).mockImplementation(
      async (entry: LocalOutboxRecord) => {
        executedOps.push({
          version: entry.payload.version as number,
          is_archived: entry.payload.is_archived as boolean
        });
        await mockOutboxManager.markSuccess(entry.id!);
      }
    );

    // Exact delta shapes from Phase 2C.1 audit
    outboxEntries = [
      {
        id: 5,
        entity: 'accounts',
        entityId: 'acc-target',
        operation: 'UPDATE',
        payload: {
          id: 'acc-target',
          is_archived: true,
          version: 3
        },
        idempotencyKey: 'k-arc-v3',
        attempts: 4,
        createdAt: new Date().toISOString()
      },
      {
        id: 6,
        entity: 'accounts',
        entityId: 'acc-target',
        operation: 'UPDATE',
        payload: {
          id: 'acc-target',
          is_archived: false,
          version: 4
        },
        idempotencyKey: 'k-res-v4',
        attempts: 0,
        createdAt: new Date().toISOString()
      }
    ];

    const result = await runner.run();

    expect(result.syncedCount).toBe(2);
    expect(result.failedCount).toBe(0);
    expect(executedOps).toEqual([
      { version: 3, is_archived: true },
      { version: 4, is_archived: false }
    ]);
    expect(outboxEntries.length).toBe(0);
  });

  // 5. Stop processing later entries after a failed entry for the same account
  it('stops processing subsequent entries for an account after its first failure while allowing other accounts to continue', async () => {
    const dispatchedIds: number[] = [];

    (mockDispatcher.dispatch as ReturnType<typeof vi.fn>).mockImplementation(
      async (entry: LocalOutboxRecord) => {
        dispatchedIds.push(entry.id!);
        if (entry.id === 1) {
          // Entry 1 fails
          await mockOutboxManager.markFailure(entry.id, 'Cloud connection timeout');
          throw new Error('Cloud connection timeout');
        }
        await mockOutboxManager.markSuccess(entry.id!);
      }
    );

    outboxEntries = [
      {
        id: 1,
        entity: 'accounts',
        entityId: 'acc-A',
        operation: 'INSERT',
        payload: { id: 'acc-A', user_id: validUserId, version: 1 },
        idempotencyKey: 'k-a1',
        attempts: 0,
        createdAt: new Date().toISOString()
      },
      {
        id: 2,
        entity: 'accounts',
        entityId: 'acc-A', // Same account!
        operation: 'UPDATE',
        payload: { id: 'acc-A', user_id: validUserId, version: 2 },
        idempotencyKey: 'k-a2',
        attempts: 0,
        createdAt: new Date().toISOString()
      },
      {
        id: 3,
        entity: 'accounts',
        entityId: 'acc-B', // Different account!
        operation: 'INSERT',
        payload: { id: 'acc-B', user_id: validUserId, version: 1 },
        idempotencyKey: 'k-b1',
        attempts: 0,
        createdAt: new Date().toISOString()
      }
    ];

    const result = await runner.run();

    expect(result.failedCount).toBe(1);
    expect(result.skippedCount).toBe(1); // acc-A v2 was skipped!
    expect(result.syncedCount).toBe(1); // acc-B v1 succeeded!

    // Verify entry 2 was never dispatched
    expect(dispatchedIds).toEqual([1, 3]);
    expect(dispatchedIds).not.toContain(2);

    // Verify acc-A entries remain in outbox
    expect(outboxEntries.some((e) => e.id === 1)).toBe(true);
    expect(outboxEntries.some((e) => e.id === 2)).toBe(true);
    // Verify acc-B was acknowledged and removed
    expect(outboxEntries.some((e) => e.id === 3)).toBe(false);
  });

  // 6. Unsupported entities remain untouched
  it('leaves unsupported entities completely untouched in the outbox', async () => {
    outboxEntries = [
      {
        id: 1,
        entity: 'transactions',
        entityId: 'tx-1',
        operation: 'INSERT',
        payload: { id: 'tx-1' },
        idempotencyKey: 'tx-k1',
        attempts: 0,
        createdAt: new Date().toISOString()
      },
      {
        id: 2,
        entity: 'accounts',
        entityId: 'acc-1',
        operation: 'INSERT',
        payload: { id: 'acc-1', user_id: validUserId },
        idempotencyKey: 'acc-k1',
        attempts: 0,
        createdAt: new Date().toISOString()
      },
      {
        id: 3,
        entity: 'categories',
        entityId: 'cat-1',
        operation: 'INSERT',
        payload: { id: 'cat-1' },
        idempotencyKey: 'cat-k1',
        attempts: 0,
        createdAt: new Date().toISOString()
      }
    ];

    const result = await runner.run();

    expect(result.unsupportedCount).toBe(2);
    expect(result.syncedCount).toBe(1);
    expect(mockDispatcher.dispatch).toHaveBeenCalledTimes(1);
    expect(mockDispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'accounts' })
    );

    // Verify unsupported entries remain in outbox
    expect(outboxEntries.some((e) => e.id === 1)).toBe(true);
    expect(outboxEntries.some((e) => e.id === 3)).toBe(true);
    // Only the account was acknowledged
    expect(outboxEntries.some((e) => e.id === 2)).toBe(false);
  });

  // 7. Failed entries remain in the outbox
  it('retains failed entries in the outbox without deletion', async () => {
    (mockDispatcher.dispatch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Supabase network error 503')
    );

    outboxEntries = [
      {
        id: 1,
        entity: 'accounts',
        entityId: 'acc-1',
        operation: 'INSERT',
        payload: { id: 'acc-1', user_id: validUserId },
        idempotencyKey: 'k-1',
        attempts: 0,
        createdAt: new Date().toISOString()
      }
    ];

    const result = await runner.run();

    expect(result.failedCount).toBe(1);
    expect(mockOutboxManager.markSuccess).not.toHaveBeenCalled();
    expect(outboxEntries.length).toBe(1);
  });

  // 8. Successful entries are acknowledged only after verified cloud persistence
  it('acknowledges outbox entries only when dispatcher confirms cloud persistence', async () => {
    let cloudPersisted = false;

    (mockDispatcher.dispatch as ReturnType<typeof vi.fn>).mockImplementation(
      async (entry: LocalOutboxRecord) => {
        cloudPersisted = true;
        await mockOutboxManager.markSuccess(entry.id!);
      }
    );

    outboxEntries = [
      {
        id: 1,
        entity: 'accounts',
        entityId: 'acc-1',
        operation: 'INSERT',
        payload: { id: 'acc-1', user_id: validUserId },
        idempotencyKey: 'k-1',
        attempts: 0,
        createdAt: new Date().toISOString()
      }
    ];

    await runner.run();

    expect(cloudPersisted).toBe(true);
    expect(mockOutboxManager.markSuccess).toHaveBeenCalledWith(1);
    expect(outboxEntries.length).toBe(0);
  });

  // 9. No automatic execution on application initialization
  it('does not trigger automatic synchronization on instantiation', () => {
    new ManualAccountSyncRunner(mockDispatcher, mockOutboxManager, mockAuthPort);

    expect(mockDispatcher.dispatch).not.toHaveBeenCalled();
    expect(mockAuthPort.getCurrentUser).not.toHaveBeenCalled();
  });

  // 10. No execution triggered by browser online events
  it('does not trigger synchronization when browser window fires online event', () => {
    window.dispatchEvent(new Event('online'));

    expect(mockDispatcher.dispatch).not.toHaveBeenCalled();
    expect(runner.isSyncRunning()).toBe(false);
  });

  // 11. Concurrent manual clicks cannot run overlapping synchronization jobs
  it('prevents overlapping synchronization jobs when concurrent manual clicks occur', async () => {
    let resolveFirstRun!: () => void;
    const firstRunPromise = new Promise<void>((resolve) => {
      resolveFirstRun = resolve;
    });

    (mockDispatcher.dispatch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      await firstRunPromise;
    });

    outboxEntries = [
      {
        id: 1,
        entity: 'accounts',
        entityId: 'acc-1',
        operation: 'INSERT',
        payload: { id: 'acc-1', user_id: validUserId },
        idempotencyKey: 'k-1',
        attempts: 0,
        createdAt: new Date().toISOString()
      }
    ];

    // Trigger first run (deliberately unresolved)
    const run1 = runner.run();
    expect(runner.isSyncRunning()).toBe(true);

    // Attempt second run concurrently
    await expect(runner.run()).rejects.toThrow(SyncInProgressError);

    // Resolve first run
    resolveFirstRun();
    await run1;

    expect(runner.isSyncRunning()).toBe(false);
  });

  // 12. No cross-user account dispatch
  it('rejects dispatch and prevents cross-user account writes', async () => {
    outboxEntries = [
      {
        id: 1,
        entity: 'accounts',
        entityId: 'acc-cross',
        operation: 'INSERT',
        payload: { id: 'acc-cross', user_id: otherUserId, name: 'Other User Account' },
        idempotencyKey: 'k-cross',
        attempts: 0,
        createdAt: new Date().toISOString()
      }
    ];

    const result = await runner.run();

    expect(result.failedCount).toBe(1);
    expect(result.syncedCount).toBe(0);
    expect(mockOutboxManager.markSuccess).not.toHaveBeenCalled();
    expect(outboxEntries.length).toBe(1); // Not acknowledged
  });
});

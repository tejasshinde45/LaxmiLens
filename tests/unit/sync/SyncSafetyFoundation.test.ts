import { describe, it, expect, vi, beforeEach } from 'vitest';
import Dexie from 'dexie';
import { APP_CONFIG } from '@/config/constants';
import { AuthPort, AuthUser } from '@/application/ports/AuthPort';
import { BackupSyncConflictError } from '@/domain/errors/BackupErrors';
import { DatabaseManager } from '@/infrastructure/database/local/DatabaseManager';
import { LaxmiLensDB } from '@/infrastructure/database/local/DexieDatabase';
import { LocalOutboxRecord } from '@/infrastructure/database/local/schema';
import { AccountSyncDispatcher } from '@/infrastructure/sync/dispatchers/AccountSyncDispatcher';
import { BorrowingRepaymentSyncDispatcher } from '@/infrastructure/sync/dispatchers/BorrowingRepaymentSyncDispatcher';
import { BorrowingSyncDispatcher } from '@/infrastructure/sync/dispatchers/BorrowingSyncDispatcher';
import { TransactionSyncDispatcher } from '@/infrastructure/sync/dispatchers/TransactionSyncDispatcher';
import {
  SyncAuthError,
  SyncConflictError,
  SyncDatabaseError,
  SyncInProgressError,
  SyncUnresolvedCategoryError
} from '@/infrastructure/sync/errors/SyncErrors';
import { ManualSyncCoordinator } from '@/infrastructure/sync/ManualSyncCoordinator';
import { OutboxManager } from '@/infrastructure/sync/OutboxManager';
import {
  BroadcastChannelFactory,
  BroadcastChannelLike,
  CrossTabSyncCoordinator,
  CrossTabSyncMessage,
  WebLockProvider,
  WebLockRequestOptions
} from '@/infrastructure/sync/CrossTabSyncCoordinator';
import {
  classifySyncError,
  computeSyncBackoffDelayMs,
  inferSyncErrorClassificationFromMessage
} from '@/infrastructure/sync/SyncRetryPolicy';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';

function makeUuid(index: number, prefix = 'aaaaaaaa-aaaa-4aaa-8aaa'): string {
  return `${prefix}-${String(index).padStart(12, '0')}`;
}

function createAuthPort(user: AuthUser | null): AuthPort {
  return {
    getCurrentUser: vi.fn().mockResolvedValue(user),
    signInWithEmail: vi.fn(),
    signUpWithEmail: vi.fn(),
    signInWithOAuth: vi.fn(),
    signOut: vi.fn(),
    resetPasswordForEmail: vi.fn(),
    updatePassword: vi.fn(),
    onAuthStateChange: vi.fn(() => () => {})
  };
}

/**
 * In-memory IndexedDB/Dexie syncOutbox store faithfully implementing
 * `[userId+id]` cursor pagination (`between` + `limit` + `toArray`) and mutations.
 */
function createInMemoryOutboxEnv(initialRecords: LocalOutboxRecord[] = []) {
  let records: LocalOutboxRecord[] = initialRecords.map((r) => ({ ...r }));
  let nextId = records.reduce((max, r) => Math.max(max, r.id ?? 0), 0) + 1;

  const mockDb = {
    syncOutbox: {
      add: vi.fn(async (record: LocalOutboxRecord) => {
        const assignedId = record.id ?? nextId++;
        nextId = Math.max(nextId, assignedId + 1);
        records.push({ ...record, id: assignedId });
        records.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
        return assignedId;
      }),
      get: vi.fn(async (id: number) => {
        const found = records.find((r) => r.id === id);
        return found ? { ...found } : undefined;
      }),
      update: vi.fn(async (id: number, changes: Partial<LocalOutboxRecord>) => {
        const idx = records.findIndex((r) => r.id === id);
        if (idx === -1) return 0;
        records[idx] = { ...records[idx], ...changes };
        return 1;
      }),
      delete: vi.fn(async (id: number) => {
        records = records.filter((r) => r.id !== id);
      }),
      clear: vi.fn(async () => {
        records = [];
      }),
      where: vi.fn((index: string) => {
        if (index === 'userId') {
          return {
            equals: (userId: string) => ({
              count: async () => records.filter((r) => r.userId === userId).length,
              toArray: async () => records.filter((r) => r.userId === userId).map((r) => ({ ...r }))
            })
          };
        }

        if (index === '[userId+id]') {
          return {
            between: (
              lower: [string, unknown],
              upper: [string, unknown],
              includeLower = true,
              includeUpper = true
            ) => ({
              limit: (lim: number) => ({
                toArray: async () => {
                  const [targetUserId, lowerKey] = lower;
                  const [, upperKey] = upper;
                  const filtered = records
                    .filter((r) => {
                      if (r.userId !== targetUserId || typeof r.id !== 'number') return false;
                      if (lowerKey !== Dexie.minKey && typeof lowerKey === 'number') {
                        if (includeLower ? r.id < lowerKey : r.id <= lowerKey) return false;
                      }
                      if (upperKey !== Dexie.maxKey && typeof upperKey === 'number') {
                        if (includeUpper ? r.id > upperKey : r.id >= upperKey) return false;
                      }
                      return true;
                    })
                    .sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
                  return filtered.slice(0, lim).map((r) => ({ ...r }));
                }
              })
            })
          };
        }

        throw new Error(`Unsupported mock index query: ${index}`);
      })
    }
  } as unknown as LaxmiLensDB;

  const outboxManager = new OutboxManager(mockDb);
  return {
    mockDb,
    outboxManager,
    getRecords: () => records
  };
}

/**
 * Shared in-memory Web Locks simulator across multiple virtual browser tabs.
 */
function createSharedWebLockProvider(): WebLockProvider {
  const heldLocks = new Set<string>();
  return {
    async request<T>(
      name: string,
      options: WebLockRequestOptions,
      callback: (lock: unknown | null) => Promise<T>
    ): Promise<T> {
      if (heldLocks.has(name)) {
        if (options.ifAvailable) {
          return await callback(null);
        }
        throw new Error(`Blocking lock wait not expected for ${name}`);
      }
      heldLocks.add(name);
      try {
        return await callback({ name, mode: options.mode ?? 'exclusive' });
      } finally {
        heldLocks.delete(name);
      }
    }
  };
}

/**
 * Shared in-memory BroadcastChannel bus delivering messages strictly to other open channels
 * bound to the same channel name.
 */
function createSharedBroadcastBus(): BroadcastChannelFactory {
  const listenersByChannel = new Map<string, Set<MockChannel>>();

  class MockChannel implements BroadcastChannelLike {
    public onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
    private readonly listeners = new Set<(event: MessageEvent<unknown>) => void>();
    private closed = false;

    constructor(private readonly name: string) {
      let group = listenersByChannel.get(name);
      if (!group) {
        group = new Set();
        listenersByChannel.set(name, group);
      }
      group.add(this);
    }

    public postMessage(message: unknown): void {
      if (this.closed) return;
      const peers = listenersByChannel.get(this.name);
      if (!peers) return;
      const payload = structuredClone(message);
      for (const peer of peers) {
        if (peer === this || peer.closed) continue;
        const evt = { data: payload } as MessageEvent<unknown>;
        peer.onmessage?.(evt);
        for (const fn of peer.listeners) {
          fn(evt);
        }
      }
    }

    public addEventListener(_type: 'message', listener: (event: MessageEvent<unknown>) => void): void {
      this.listeners.add(listener);
    }

    public removeEventListener(
      _type: 'message',
      listener: (event: MessageEvent<unknown>) => void
    ): void {
      this.listeners.delete(listener);
    }

    public close(): void {
      this.closed = true;
      this.listeners.clear();
      this.onmessage = null;
      listenersByChannel.get(this.name)?.delete(this);
    }
  }

  return (name: string) => new MockChannel(name);
}

function createAccountEntry(
  id: number,
  userId: string,
  accountId: string,
  operation: 'INSERT' | 'UPDATE' = 'INSERT'
): LocalOutboxRecord {
  return {
    id,
    userId,
    entity: 'accounts',
    entityId: accountId,
    operation,
    payload: {
      id: accountId,
      user_id: userId,
      name: `Account ${id}`,
      account_type: 'bank',
      opening_balance_paise: 10000,
      version: operation === 'INSERT' ? 1 : 2
    },
    idempotencyKey: `acc-${userId}-${id}`,
    attempts: 0,
    createdAt: new Date(1_700_000_000_000 + id * 1000).toISOString()
  };
}

function createTransactionEntry(
  id: number,
  userId: string,
  txId: string,
  accountId: string,
  categoryId?: string
): LocalOutboxRecord {
  return {
    id,
    userId,
    entity: 'transactions',
    entityId: txId,
    operation: 'INSERT',
    payload: {
      id: txId,
      user_id: userId,
      account_id: accountId,
      ...(categoryId ? { category_id: categoryId } : {}),
      type: 'expense',
      amount_paise: 25000,
      date: '2026-11-01T10:00:00.000Z',
      version: 1
    },
    idempotencyKey: `tx-${userId}-${id}`,
    attempts: 0,
    createdAt: new Date(1_700_000_000_000 + id * 1000).toISOString()
  };
}

describe('Synchronization Safety Foundation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('1. classifies transient errors and applies APP_CONFIG.sync exponential backoff with bounded jitter, max retries, and network recovery reset', async () => {
    // Error classification coverage for transient failures
    expect(classifySyncError(new TypeError('Failed to fetch')).disposition).toBe('transient');
    expect(classifySyncError(Object.assign(new Error('Rate limited'), { status: 429 }))).toMatchObject({
      errorClass: 'transient_http',
      disposition: 'transient',
      retryable: true
    });
    expect(classifySyncError(Object.assign(new Error('Request timeout'), { status: 408 })).disposition).toBe(
      'transient'
    );
    expect(classifySyncError(new SyncDatabaseError('Gateway down', '503')).disposition).toBe(
      'transient'
    );

    // APP_CONFIG.sync bounds: initial=1000, max=60000, +/-20% jitter
    expect(APP_CONFIG.sync.maxRetries).toBe(5);
    expect(computeSyncBackoffDelayMs(1, APP_CONFIG.sync, () => 0)).toBe(800);
    expect(computeSyncBackoffDelayMs(1, APP_CONFIG.sync, () => 0.5)).toBe(1000);
    expect(computeSyncBackoffDelayMs(1, APP_CONFIG.sync, () => 1)).toBe(1200);
    expect(computeSyncBackoffDelayMs(2, APP_CONFIG.sync, () => 0.5)).toBe(2000);
    expect(computeSyncBackoffDelayMs(10, APP_CONFIG.sync, () => 1)).toBe(60000);

    let nowMs = 1_000_000;
    const accId = makeUuid(1);
    const { outboxManager, getRecords } = createInMemoryOutboxEnv([
      createAccountEntry(1, USER_A, accId)
    ]);

    const accountDispatch = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('HTTP 503 Service Unavailable'), { status: 503 }))
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockImplementation(async (entry: LocalOutboxRecord) => {
        if (entry.id !== undefined) {
          await outboxManager.markSuccess(entry.id);
        }
      });

    const coordinator = new ManualSyncCoordinator(
      { dispatch: accountDispatch } as unknown as AccountSyncDispatcher,
      { dispatch: vi.fn() } as unknown as TransactionSyncDispatcher,
      outboxManager,
      createAuthPort({ id: USER_A, email: 'a@test.com' }),
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
      undefined,
      {
        nowMs: () => nowMs,
        randomFn: () => 0.5, // zero-offset deterministic midpoint (exact base delay)
        webLockProvider: null,
        broadcastChannelFactory: null
      }
    );

    // Attempt 1 fails with transient 503 -> next retry at nowMs + 1000ms
    const res1 = await coordinator.run({ mode: 'background' });
    expect(res1.failedCount).toBe(1);
    expect(res1.errors[0].disposition).toBe('transient');
    expect(res1.errors[0].retryable).toBe(true);
    expect(accountDispatch).toHaveBeenCalledTimes(1);

    // Immediately running background sync respects active backoff (does not dispatch again)
    nowMs += 500;
    const resBackedOff = await coordinator.run({ mode: 'background' });
    expect(resBackedOff.skippedBackoffCount).toBe(1);
    expect(resBackedOff.totalProcessed).toBe(0);
    expect(accountDispatch).toHaveBeenCalledTimes(1);

    // Advance past 1000ms -> Attempt 2 runs and fails -> backoff becomes 2000ms
    nowMs += 600;
    const res2 = await coordinator.run({ mode: 'background' });
    expect(res2.failedCount).toBe(1);
    expect(accountDispatch).toHaveBeenCalledTimes(2);

    // Still inside 2000ms backoff window -> skipped
    nowMs += 500;
    const resBackedOff2 = await coordinator.run({ mode: 'background' });
    expect(resBackedOff2.skippedBackoffCount).toBe(1);

    // Network recovery clears transient backoff delay immediately
    coordinator.notifyNetworkRecovered(USER_A);
    const resRecovered = await coordinator.run({ mode: 'background' });
    expect(resRecovered.syncedCount).toBe(1);
    expect(resRecovered.stillPendingCount).toBe(0);
    expect(getRecords()).toHaveLength(0);
  });

  it('2. does not repeatedly retry permanent errors, preserves outbox records, and allows explicit manual retry without recreating records', async () => {
    // Classification checks for permanent error classes
    expect(classifySyncError(new SyncConflictError('OCC version mismatch'))).toMatchObject({
      errorClass: 'conflict',
      disposition: 'permanent',
      retryable: false
    });
    expect(classifySyncError(new SyncDatabaseError('RLS denied', '42501')).disposition).toBe(
      'permanent'
    );
    expect(classifySyncError(new SyncDatabaseError('Check constraint', '23514')).disposition).toBe(
      'permanent'
    );
    expect(
      classifySyncError(new SyncUnresolvedCategoryError('Unmapped category', 'cat-1')).disposition
    ).toBe('permanent');
    expect(
      inferSyncErrorClassificationFromMessage('RLS permission denied (42501)').disposition
    ).toBe('permanent');
    expect(
      inferSyncErrorClassificationFromMessage(
        "Version mismatch on account 'acc-1': cloud version is 2, expected previous version was 1."
      )
    ).toMatchObject({
      errorClass: 'conflict',
      disposition: 'permanent',
      retryable: false,
      errorCategory: 'conflict'
    });

    const accId = makeUuid(2);
    const { outboxManager, getRecords } = createInMemoryOutboxEnv([
      createAccountEntry(1, USER_A, accId)
    ]);

    const accountDispatch = vi
      .fn()
      .mockImplementationOnce(async (entry: LocalOutboxRecord) => {
        await outboxManager.markFailure(entry.id!, 'Version conflict on cloud record');
        throw new SyncConflictError('Version conflict on cloud record');
      })
      .mockImplementationOnce(async (entry: LocalOutboxRecord) => {
        await outboxManager.markSuccess(entry.id!);
      });

    const coordinator = new ManualSyncCoordinator(
      { dispatch: accountDispatch } as unknown as AccountSyncDispatcher,
      { dispatch: vi.fn() } as unknown as TransactionSyncDispatcher,
      outboxManager,
      createAuthPort({ id: USER_A, email: 'a@test.com' }),
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
      undefined,
      { webLockProvider: null, broadcastChannelFactory: null }
    );

    const first = await coordinator.run({ mode: 'background' });
    expect(first.failedCount).toBe(1);
    expect(first.errors[0].disposition).toBe('permanent');
    expect(getRecords()).toHaveLength(1);
    expect(getRecords()[0].id).toBe(1);

    // Subsequent automatic/background runs do not hammer permanent failures
    const second = await coordinator.run({ mode: 'background' });
    const third = await coordinator.run({ mode: 'background' });
    expect(second.skippedPausedCount).toBe(1);
    expect(third.skippedPausedCount).toBe(1);
    expect(accountDispatch).toHaveBeenCalledTimes(1);
    expect(getRecords()).toHaveLength(1);
    expect(getRecords()[0].id).toBe(1);

    // Explicit manual retry processes the preserved outbox record without delete+recreate
    const retried = await coordinator.retryFailed();
    expect(retried.syncedCount).toBe(1);
    expect(retried.stillPendingCount).toBe(0);
    expect(accountDispatch).toHaveBeenCalledTimes(2);
    expect(accountDispatch.mock.calls[1][0].id).toBe(1);
    expect(getRecords()).toHaveLength(0);
  });

  it('3. pauses retry execution on authentication errors until session refreshes (including DatabaseManager hook)', async () => {
    expect(classifySyncError(new SyncAuthError('JWT expired')).disposition).toBe('auth');
    expect(classifySyncError(Object.assign(new Error('Unauthorized'), { status: 401 })).disposition).toBe(
      'auth'
    );
    expect(classifySyncError({ code: 'PGRST301', message: 'JWT expired' }).disposition).toBe('auth');

    const acc1 = makeUuid(10);
    const acc2 = makeUuid(11);
    const { outboxManager, getRecords } = createInMemoryOutboxEnv([
      createAccountEntry(1, USER_A, acc1),
      createAccountEntry(2, USER_A, acc2)
    ]);

    const accountDispatch = vi
      .fn()
      .mockRejectedValueOnce(new SyncAuthError('Session expired (401)'))
      .mockImplementation(async (entry: LocalOutboxRecord) => {
        if (entry.id !== undefined) await outboxManager.markSuccess(entry.id);
      });

    const coordinator = new ManualSyncCoordinator(
      { dispatch: accountDispatch } as unknown as AccountSyncDispatcher,
      { dispatch: vi.fn() } as unknown as TransactionSyncDispatcher,
      outboxManager,
      createAuthPort({ id: USER_A, email: 'a@test.com' }),
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
      undefined,
      { webLockProvider: null, broadcastChannelFactory: null }
    );

    const first = await coordinator.run({ mode: 'background' });
    expect(first.authPaused).toBe(true);
    expect(coordinator.isAuthPaused(USER_A)).toBe(true);
    // Entry 2 in same run also paused immediately without hitting server with expired JWT
    expect(accountDispatch).toHaveBeenCalledTimes(1);
    expect(getRecords()).toHaveLength(2);

    // Subsequent background run stays paused until auth refreshes
    const pausedRun = await coordinator.run({ mode: 'background' });
    expect(pausedRun.skippedAuthPaused).toBe(true);
    expect(pausedRun.totalProcessed).toBe(0);
    expect(accountDispatch).toHaveBeenCalledTimes(1);

    // Refresh session -> unpauses and completes pending sync
    coordinator.notifyAuthRefreshed(USER_A);
    expect(coordinator.isAuthPaused(USER_A)).toBe(false);

    const resumed = await coordinator.run({ mode: 'background' });
    expect(resumed.syncedCount).toBe(2);
    expect(resumed.stillPendingCount).toBe(0);
    expect(getRecords()).toHaveLength(0);

    // Verify DatabaseManager.notifyAuthRefreshed forwards only for matching active user
    const dm = new DatabaseManager(createAuthPort({ id: USER_A, email: 'a@test.com' }));
    const notifySpy = vi.fn();
    (dm as unknown as { activeRepositories: unknown; activeUserId: string }).activeRepositories = {
      syncCoordinator: { notifyAuthRefreshed: notifySpy }
    };
    (dm as unknown as { activeUserId: string }).activeUserId = USER_A;

    dm.notifyAuthRefreshed(USER_B);
    expect(notifySpy).not.toHaveBeenCalled();

    dm.notifyAuthRefreshed(USER_A);
    expect(notifySpy).toHaveBeenCalledWith(USER_A);
  });

  it('4. paginates beyond the old 100-entry limit cleanly (250 pending entries across multiple cursor batches)', async () => {
    const initialEntries: LocalOutboxRecord[] = [];
    for (let i = 1; i <= 250; i++) {
      initialEntries.push(createAccountEntry(i, USER_A, makeUuid(i)));
    }

    const { outboxManager, getRecords } = createInMemoryOutboxEnv(initialEntries);
    const getPageSpy = vi.spyOn(outboxManager, 'getPendingEntriesPage');

    const accountDispatch = vi.fn(async (entry: LocalOutboxRecord) => {
      if (entry.id !== undefined) {
        await outboxManager.markSuccess(entry.id);
      }
    });

    const coordinator = new ManualSyncCoordinator(
      { dispatch: accountDispatch } as unknown as AccountSyncDispatcher,
      { dispatch: vi.fn() } as unknown as TransactionSyncDispatcher,
      outboxManager,
      createAuthPort({ id: USER_A, email: 'a@test.com' }),
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
      undefined,
      { webLockProvider: null, broadcastChannelFactory: null }
    );

    const result = await coordinator.run();

    expect(result.totalPending).toBe(250);
    expect(result.pagesProcessed).toBe(3); // 100 + 100 + 50
    expect(result.syncedCount).toBe(250);
    expect(result.failedCount).toBe(0);
    expect(result.stillPendingCount).toBe(0);
    expect(getRecords()).toHaveLength(0);
    expect(getPageSpy).toHaveBeenCalled();
  });

  it('5. avoids queue starvation when page 1 contains paused/permanent failures and terminates cleanly without infinite loops', async () => {
    const failingAccountId = makeUuid(1);
    const entries: LocalOutboxRecord[] = [];

    // Page 1 (ids 1..50): failed/permanent entries for distinct failing accounts
    for (let i = 1; i <= 50; i++) {
      entries.push({
        ...createAccountEntry(i, USER_A, i === 1 ? failingAccountId : makeUuid(i)),
        attempts: 1,
        lastAttemptAt: new Date().toISOString(),
        lastError: 'RLS permission denied (42501)'
      });
    }

    // Page 2 (ids 51..75): fresh eligible entries for independent accounts
    for (let i = 51; i <= 75; i++) {
      entries.push(createAccountEntry(i, USER_A, makeUuid(i)));
    }

    const { outboxManager, getRecords } = createInMemoryOutboxEnv(entries);
    const accountDispatch = vi.fn(async (entry: LocalOutboxRecord) => {
      if (entry.id !== undefined) {
        await outboxManager.markSuccess(entry.id);
      }
    });

    const coordinator = new ManualSyncCoordinator(
      { dispatch: accountDispatch } as unknown as AccountSyncDispatcher,
      { dispatch: vi.fn() } as unknown as TransactionSyncDispatcher,
      outboxManager,
      createAuthPort({ id: USER_A, email: 'a@test.com' }),
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
      undefined,
      { webLockProvider: null, broadcastChannelFactory: null }
    );

    // Run background sync with pageSize = 50 -> page 1 skipped, page 2 synced!
    const res1 = await coordinator.run({ mode: 'background', pageSize: 50 });
    expect(res1.pagesProcessed).toBe(2);
    expect(res1.skippedPausedCount).toBe(50);
    expect(res1.syncedCount).toBe(25);
    expect(res1.stillPendingCount).toBe(50);
    expect(getRecords()).toHaveLength(50);

    // Run again when ONLY paused entries remain across a page boundary -> finishes in 1 pass cleanly
    const resAllPaused = await coordinator.run({ mode: 'background', pageSize: 25 });
    expect(resAllPaused.pagesProcessed).toBe(3); // 25 + 25 + empty cursor page check
    expect(resAllPaused.totalProcessed).toBe(0);
    expect(resAllPaused.skippedPausedCount).toBe(50);
    expect(accountDispatch).toHaveBeenCalledTimes(25);
  });

  it('6. preserves FIFO and cross-entity dependency ordering across pages and paused prerequisites (including Borrowing Repayment -> Update)', async () => {
    const blockedAccountId = makeUuid(1);
    const healthyAccountId = makeUuid(2);
    const blockedTxId = makeUuid(101);
    const healthyTxId = makeUuid(102);

    const { outboxManager } = createInMemoryOutboxEnv([
      // Page 1: blocked/permanent account + an UPDATE on same blocked account
      {
        ...createAccountEntry(1, USER_A, blockedAccountId, 'INSERT'),
        attempts: 1,
        lastError: 'RLS permission denied (42501)'
      },
      // Page 2: UPDATE on blocked account + TX on blocked account + healthy Account + healthy TX
      createAccountEntry(2, USER_A, blockedAccountId, 'UPDATE'),
      createTransactionEntry(3, USER_A, blockedTxId, blockedAccountId),
      createAccountEntry(4, USER_A, healthyAccountId, 'INSERT'),
      createTransactionEntry(5, USER_A, healthyTxId, healthyAccountId)
    ]);

    const dispatchedOrder: string[] = [];
    const coordinator = new ManualSyncCoordinator(
      {
        dispatch: vi.fn(async (e: LocalOutboxRecord) => {
          dispatchedOrder.push(`account:${e.entityId}:${e.operation}`);
          await outboxManager.markSuccess(e.id!);
        })
      } as unknown as AccountSyncDispatcher,
      {
        dispatch: vi.fn(async (e: LocalOutboxRecord) => {
          dispatchedOrder.push(`tx:${e.entityId}`);
          await outboxManager.markSuccess(e.id!);
        })
      } as unknown as TransactionSyncDispatcher,
      outboxManager,
      createAuthPort({ id: USER_A, email: 'a@test.com' }),
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
      undefined,
      { webLockProvider: null, broadcastChannelFactory: null }
    );

    const res = await coordinator.run({ mode: 'background', pageSize: 2 });
    expect(res.syncedCount).toBe(2);
    expect(dispatchedOrder).toEqual([
      `account:${healthyAccountId}:INSERT`,
      `tx:${healthyTxId}`
    ]);
    // Account UPDATE and blocked TX never dispatched
    expect(res.accounts.skippedCount).toBe(2);
    expect(res.transactions.dependencyBlockedCount).toBe(1);

    // Verify Stage 6 -> Stage 7 Borrowing guard: failed/paused repayment blocks Borrowing status UPDATE
    const borrowingId = makeUuid(300);
    const repaymentId = makeUuid(301);
    const borrowingUpdateEnv = createInMemoryOutboxEnv([
      {
        id: 1,
        userId: USER_A,
        entity: 'borrowing_repayments',
        entityId: repaymentId,
        operation: 'INSERT',
        payload: { borrowing_id: borrowingId, amount_paise: 5000 },
        idempotencyKey: 'rep-1',
        attempts: 1,
        lastError: 'Failed to fetch',
        lastAttemptAt: new Date(1_000_000).toISOString(),
        createdAt: new Date(1_000_000).toISOString()
      },
      {
        id: 2,
        userId: USER_A,
        entity: 'borrowings',
        entityId: borrowingId,
        operation: 'UPDATE',
        payload: { id: borrowingId, user_id: USER_A, status: 'repaid' },
        idempotencyKey: 'bor-upd-1',
        attempts: 0,
        createdAt: new Date(1_000_100).toISOString()
      }
    ]);

    const borrowingDispatchSpy = vi.fn();
    const coordinator2 = new ManualSyncCoordinator(
      { dispatch: vi.fn() } as unknown as AccountSyncDispatcher,
      { dispatch: vi.fn() } as unknown as TransactionSyncDispatcher,
      borrowingUpdateEnv.outboxManager,
      createAuthPort({ id: USER_A, email: 'a@test.com' }),
      undefined,
      undefined,
      { dispatch: borrowingDispatchSpy } as unknown as BorrowingSyncDispatcher,
      { dispatch: vi.fn() } as unknown as BorrowingRepaymentSyncDispatcher,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        nowMs: () => 1_000_200, // inside 1000ms backoff for repayment
        webLockProvider: null,
        broadcastChannelFactory: null
      }
    );

    const borRes = await coordinator2.run({ mode: 'background' });
    expect(borRes.borrowing_repayments.skippedCount).toBe(1);
    expect(borRes.borrowings.skippedCount).toBe(1);
    expect(borRes.borrowings.dependencyBlockedCount).toBe(1);
    expect(borrowingDispatchSpy).not.toHaveBeenCalled();
  });

  it('7. enforces two-tab sync mutual exclusion via Web Locks and isolates BroadcastChannel events by user and sessionGeneration', async () => {
    const sharedLocks = createSharedWebLockProvider();
    const sharedChannels = createSharedBroadcastBus();

    const { outboxManager: outboxTab1 } = createInMemoryOutboxEnv([
      createAccountEntry(1, USER_A, makeUuid(1))
    ]);
    const { outboxManager: outboxTab2 } = createInMemoryOutboxEnv([
      createAccountEntry(2, USER_A, makeUuid(2))
    ]);
    const { outboxManager: outboxUserB } = createInMemoryOutboxEnv([
      createAccountEntry(3, USER_B, makeUuid(3))
    ]);

    let releaseTab1: () => void = () => {};
    const tab1Gate = new Promise<void>((resolve) => {
      releaseTab1 = resolve;
    });

    const tab2Events: CrossTabSyncMessage[] = [];
    const userBEvents: CrossTabSyncMessage[] = [];

    const tab1Coordinator = new ManualSyncCoordinator(
      {
        dispatch: vi.fn(async (e: LocalOutboxRecord) => {
          await tab1Gate;
          await outboxTab1.markSuccess(e.id!);
        })
      } as unknown as AccountSyncDispatcher,
      { dispatch: vi.fn() } as unknown as TransactionSyncDispatcher,
      outboxTab1,
      createAuthPort({ id: USER_A, email: 'a@test.com' }),
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
      undefined,
      {
        userId: USER_A,
        sessionGeneration: 2,
        webLockProvider: sharedLocks,
        broadcastChannelFactory: sharedChannels,
        tabId: 'tab-1'
      }
    );

    const tab2Coordinator = new ManualSyncCoordinator(
      {
        dispatch: vi.fn(async (e: LocalOutboxRecord) => {
          await outboxTab2.markSuccess(e.id!);
        })
      } as unknown as AccountSyncDispatcher,
      { dispatch: vi.fn() } as unknown as TransactionSyncDispatcher,
      outboxTab2,
      createAuthPort({ id: USER_A, email: 'a@test.com' }),
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
      undefined,
      {
        userId: USER_A,
        sessionGeneration: 1,
        webLockProvider: sharedLocks,
        broadcastChannelFactory: sharedChannels,
        tabId: 'tab-2',
        onCrossTabEvent: (msg) => tab2Events.push(msg)
      }
    );

    const userBCoordinator = new ManualSyncCoordinator(
      {
        dispatch: vi.fn(async (e: LocalOutboxRecord) => {
          await outboxUserB.markSuccess(e.id!);
        })
      } as unknown as AccountSyncDispatcher,
      { dispatch: vi.fn() } as unknown as TransactionSyncDispatcher,
      outboxUserB,
      createAuthPort({ id: USER_B, email: 'b@test.com' }),
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
      undefined,
      {
        userId: USER_B,
        sessionGeneration: 1,
        webLockProvider: sharedLocks,
        broadcastChannelFactory: sharedChannels,
        tabId: 'tab-user-b',
        onCrossTabEvent: (msg) => userBEvents.push(msg)
      }
    );

    // Start Tab 1 sync -> holds lock `laxmilens_sync_<USER_A>`
    const tab1Promise = tab1Coordinator.run();

    // Flush microtasks so Tab 1 enters lock critical section
    await Promise.resolve();
    await Promise.resolve();

    // Tab 2 manual sync rejects on cross-tab contention; background skips cleanly
    await expect(tab2Coordinator.run()).rejects.toThrow(SyncInProgressError);
    const tab2Bg = await tab2Coordinator.run({ mode: 'background' });
    expect(tab2Bg.skippedLockContention).toBe(true);

    // Different user (USER_B) is NOT blocked by USER_A's lock
    const userBRes = await userBCoordinator.run();
    expect(userBRes.syncedCount).toBe(1);

    // Complete Tab 1 -> Tab 2 receives syncStarted and syncCompleted; USER_B receives nothing
    releaseTab1();
    const tab1Res = await tab1Promise;
    expect(tab1Res.syncedCount).toBe(1);
    expect(tab2Events.map((e) => e.type)).toEqual(['syncStarted', 'syncCompleted']);
    expect(userBEvents).toHaveLength(0);

    // Stale sessionGeneration regression check on CrossTabSyncCoordinator directly
    const receivedByReceiver: CrossTabSyncMessage[] = [];
    const receiver = new CrossTabSyncCoordinator({
      broadcastChannelFactory: sharedChannels,
      tabId: 'receiver-tab'
    });
    receiver.bindUserChannel({
      userId: USER_A,
      isSessionValid: (uid) => uid === USER_A,
      onMessage: (m) => receivedByReceiver.push(m)
    });

    const sender = new CrossTabSyncCoordinator({
      broadcastChannelFactory: sharedChannels,
      tabId: 'sender-tab'
    });
    sender.bindUserChannel({
      userId: USER_A,
      isSessionValid: () => true,
      onMessage: () => {}
    });

    // Advance generation to 5, then attempt an out-of-order stale generation 2
    sender.broadcast({ type: 'syncCompleted', userId: USER_A, sessionGeneration: 5, syncedCount: 1 });
    sender.broadcast({ type: 'syncCompleted', userId: USER_A, sessionGeneration: 2, syncedCount: 99 });
    // Spoof wrong user payload directly onto channel -> must be ignored
    const rawWrongUser = sharedChannels(`laxmilens_sync_${USER_A}`);
    rawWrongUser.postMessage({
      type: 'restoreCompleted',
      userId: USER_B,
      sessionGeneration: 10,
      sourceTabId: 'evil-tab',
      timestamp: new Date().toISOString()
    });
    rawWrongUser.close();

    expect(receivedByReceiver).toHaveLength(1);
    expect(receivedByReceiver[0].sessionGeneration).toBe(5);

    tab1Coordinator.dispose();
    tab2Coordinator.dispose();
    userBCoordinator.dispose();
    receiver.dispose();
    sender.dispose();
  });

  it('8. enforces cross-tab backup/restore vs sync exclusion and broadcasts restoreCompleted for cache invalidation', async () => {
    const sharedLocks = createSharedWebLockProvider();
    const sharedChannels = createSharedBroadcastBus();

    const { outboxManager: outbox1 } = createInMemoryOutboxEnv([
      createAccountEntry(1, USER_A, makeUuid(1))
    ]);
    const { outboxManager: outbox2 } = createInMemoryOutboxEnv([
      createAccountEntry(2, USER_A, makeUuid(2))
    ]);

    const tab1Events: CrossTabSyncMessage[] = [];
    const tab2Events: CrossTabSyncMessage[] = [];
    let invalidateCalls = 0;

    const tab1Coordinator = new ManualSyncCoordinator(
      {
        dispatch: vi.fn(async (e: LocalOutboxRecord) => outbox1.markSuccess(e.id!))
      } as unknown as AccountSyncDispatcher,
      { dispatch: vi.fn() } as unknown as TransactionSyncDispatcher,
      outbox1,
      createAuthPort({ id: USER_A, email: 'a@test.com' }),
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
      undefined,
      {
        userId: USER_A,
        sessionGeneration: 1,
        webLockProvider: sharedLocks,
        broadcastChannelFactory: sharedChannels,
        tabId: 'tab-1',
        onCrossTabEvent: (msg) => tab1Events.push(msg)
      }
    );

    const tab2Coordinator = new ManualSyncCoordinator(
      {
        dispatch: vi.fn(async (e: LocalOutboxRecord) => outbox2.markSuccess(e.id!))
      } as unknown as AccountSyncDispatcher,
      { dispatch: vi.fn() } as unknown as TransactionSyncDispatcher,
      outbox2,
      createAuthPort({ id: USER_A, email: 'a@test.com' }),
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
      undefined,
      {
        userId: USER_A,
        sessionGeneration: 1,
        webLockProvider: sharedLocks,
        broadcastChannelFactory: sharedChannels,
        tabId: 'tab-2',
        onCrossTabEvent: (msg) => {
          tab2Events.push(msg);
          if (msg.type === 'restoreCompleted') {
            invalidateCalls++;
          }
        }
      }
    );

    // Tab 1 holds restore exclusive lock -> Tab 2 sync rejects/skips; finishing restore broadcasts restoreCompleted
    let releaseRestore: () => void = () => {};
    const restoreGate = new Promise<void>((resolve) => {
      releaseRestore = resolve;
    });

    const restorePromise = tab1Coordinator.runExclusive('restore', async () => {
      await restoreGate;
      return 'restored-ok';
    });

    await Promise.resolve();
    await Promise.resolve();

    await expect(tab2Coordinator.run()).rejects.toThrow(SyncInProgressError);
    const bgSkipped = await tab2Coordinator.run({ mode: 'background' });
    expect(bgSkipped.skippedLockContention).toBe(true);

    releaseRestore();
    await expect(restorePromise).resolves.toBe('restored-ok');
    expect(tab2Events.map((e) => e.type)).toEqual(['restoreCompleted']);
    expect(invalidateCalls).toBe(1);

    // Reverse: Tab 2 runs sync -> Tab 1 backup rejects with BackupSyncConflictError
    let releaseSync: () => void = () => {};
    const syncGate = new Promise<void>((resolve) => {
      releaseSync = resolve;
    });
    const tab2WithSlowDispatch = new ManualSyncCoordinator(
      {
        dispatch: vi.fn(async () => {
          await syncGate;
        })
      } as unknown as AccountSyncDispatcher,
      { dispatch: vi.fn() } as unknown as TransactionSyncDispatcher,
      outbox2,
      createAuthPort({ id: USER_A, email: 'a@test.com' }),
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
      undefined,
      {
        userId: USER_A,
        sessionGeneration: 2,
        webLockProvider: sharedLocks,
        broadcastChannelFactory: sharedChannels,
        tabId: 'tab-2-slow'
      }
    );

    const slowSyncPromise = tab2WithSlowDispatch.run();
    await Promise.resolve();
    await Promise.resolve();

    await expect(
      tab1Coordinator.runExclusive('backup', async () => 'should-not-run')
    ).rejects.toThrow(BackupSyncConflictError);

    releaseSync();
    await slowSyncPromise;

    tab1Coordinator.dispose();
    tab2Coordinator.dispose();
    tab2WithSlowDispatch.dispose();
  });

  it('9. falls back safely when Web Locks (navigator.locks) and BroadcastChannel are unavailable', async () => {
    const { outboxManager, getRecords } = createInMemoryOutboxEnv([
      createAccountEntry(1, USER_A, makeUuid(1))
    ]);

    const coordinator = new ManualSyncCoordinator(
      {
        dispatch: vi.fn(async (e: LocalOutboxRecord) => outboxManager.markSuccess(e.id!))
      } as unknown as AccountSyncDispatcher,
      { dispatch: vi.fn() } as unknown as TransactionSyncDispatcher,
      outboxManager,
      createAuthPort({ id: USER_A, email: 'a@test.com' }),
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
      undefined,
      {
        userId: USER_A,
        webLockProvider: null,
        broadcastChannelFactory: null
      }
    );

    const res = await coordinator.run();
    expect(res.syncedCount).toBe(1);
    expect(getRecords()).toHaveLength(0);

    const restoreOutput = await coordinator.runExclusive('restore', async () => 'done-without-locks');
    expect(restoreOutput).toBe('done-without-locks');
    expect(coordinator.isOperationInProgress()).toBe(false);

    coordinator.dispose();
  });
});

import Dexie from 'dexie';
import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthPort, AuthUser } from '@/application/ports/AuthPort';
import { BackupCacheInvalidator } from '@/application/ports/BackupStoragePort';
import { LaxmiLensDB } from '@/infrastructure/database/local/DexieDatabase';
import { DatabaseManager } from '@/infrastructure/database/local/DatabaseManager';
import { DexieUnitOfWork } from '@/infrastructure/database/local/DexieUnitOfWork';
import { LocalOutboxRecord } from '@/infrastructure/database/local/schema';
import { OutboxManager } from '@/infrastructure/sync/OutboxManager';
import { LocalWriteCommitNotifier } from '@/infrastructure/sync/LocalWriteCommitNotifier';
import { ManualSyncCoordinator } from '@/infrastructure/sync/ManualSyncCoordinator';
import {
  AutoSyncScheduler,
  AutoSyncStateSnapshot
} from '@/infrastructure/sync/AutoSyncScheduler';
import {
  SyncLifecycleAdapter,
  SyncLifecycleHandlers,
  SyncTimerProvider
} from '@/infrastructure/sync/SyncLifecycleAdapter';
import { AccountSyncDispatcher } from '@/infrastructure/sync/dispatchers/AccountSyncDispatcher';
import { TransactionSyncDispatcher } from '@/infrastructure/sync/dispatchers/TransactionSyncDispatcher';
import {
  BroadcastChannelFactory,
  BroadcastChannelLike,
  WebLockProvider
} from '@/infrastructure/sync/CrossTabSyncCoordinator';
import { AuthContext, AuthContextType, AuthProvider } from '@/features/auth/context/AuthContext';
import { defaultDatabaseManager } from '@/infrastructure/database/local/DatabaseManager';
import { defaultLegacyMigrator } from '@/infrastructure/database/local/LegacyDatabaseMigrator';
import { useAutoSyncState } from '@/hooks/useAutoSyncState';
import { useAccountSync } from '@/features/accounts/hooks/useAccountSync';
import { DecryptBackupFileUseCase } from '@/application/use-cases/backup/DecryptBackupFileUseCase';
import { GenerateRestorePreviewUseCase } from '@/application/use-cases/backup/GenerateRestorePreviewUseCase';
import { ExportEncryptedBackupUseCase } from '@/application/use-cases/backup/ExportEncryptedBackupUseCase';
import { ExecuteBackupRestoreUseCase } from '@/application/use-cases/backup/ExecuteBackupRestoreUseCase';
import {
  BackupEncryptionService
} from '@/application/services/BackupEncryptionService';
import { BackupValidationService } from '@/application/services/BackupValidationService';
import { computeLocalDatabaseStateDigest, SafetyBackupReceiptRegistry } from '@/application/services/SafetyBackupReceiptService';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const ACC_1 = '33333333-3333-4333-8333-333333333331';
const ACC_2 = '33333333-3333-4333-8333-333333333332';

function createControlledLifecycle(initialOnline = true) {
  let online = initialOnline;
  const listeners = new Set<SyncLifecycleHandlers>();

  const adapter: SyncLifecycleAdapter = {
    isOnline: () => online,
    subscribe: (handlers) => {
      listeners.add(handlers);
      return () => {
        listeners.delete(handlers);
      };
    }
  };

  return {
    adapter,
    getListenerCount: () => listeners.size,
    setOnline: (next: boolean) => {
      online = next;
    },
    emitOnline: () => {
      online = true;
      for (const h of Array.from(listeners)) h.onOnline();
    },
    emitOffline: () => {
      online = false;
      for (const h of Array.from(listeners)) h.onOffline();
    },
    emitForeground: () => {
      for (const h of Array.from(listeners)) h.onForeground();
    }
  };
}

function createFakeTimerProvider(initialMs = 1_000_000) {
  let now = initialMs;
  let nextId = 1;
  const scheduled = new Map<number, { fireAt: number; callback: () => void }>();

  const timerProvider: SyncTimerProvider = {
    nowMs: () => now,
    setTimeout: (cb, delayMs) => {
      const id = nextId++;
      scheduled.set(id, {
        fireAt: now + Math.max(0, Math.floor(delayMs)),
        callback: cb
      });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: (id) => {
      scheduled.delete(id as unknown as number);
    }
  };

  const advanceBy = async (ms: number) => {
    const target = now + Math.max(0, ms);
    while (true) {
      let earliestId: number | null = null;
      let earliestTime = Infinity;
      for (const [id, item] of scheduled.entries()) {
        if (item.fireAt <= target && item.fireAt < earliestTime) {
          earliestTime = item.fireAt;
          earliestId = id;
        }
      }
      if (earliestId === null) {
        break;
      }
      const task = scheduled.get(earliestId)!;
      scheduled.delete(earliestId);
      now = Math.max(now, task.fireAt);
      task.callback();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }
    now = target;
  };

  return {
    timerProvider,
    advanceBy,
    getNow: () => now,
    getPendingTimerCount: () => scheduled.size
  };
}

function createInMemoryOutboxEnv(
  initialEntries: LocalOutboxRecord[] = [],
  commitNotifier?: LocalWriteCommitNotifier
) {
  const store: LocalOutboxRecord[] = initialEntries.map((e) => ({ ...e }));
  let nextId = store.reduce((max, r) => Math.max(max, r.id ?? 0), 0) + 1;

  const db = {
    isOpen: vi.fn(() => true),
    close: vi.fn(async () => undefined),
    open: vi.fn(async () => db),
    transaction: vi.fn(async (...args: unknown[]) => {
      const fn = args[args.length - 1] as () => Promise<unknown>;
      const snapshot = store.map((r) => ({ ...r }));
      try {
        return await fn();
      } catch (err) {
        // Restore outbox snapshot on rollback
        store.length = 0;
        store.push(...snapshot);
        throw err;
      }
    }),
    syncOutbox: {
      add: vi.fn(async (record: LocalOutboxRecord) => {
        const entry = { ...record, id: record.id ?? nextId++ };
        store.push(entry);
        return entry.id!;
      }),
      get: vi.fn(async (id: number) => {
        const found = store.find((e) => e.id === id);
        return found ? { ...found } : undefined;
      }),
      delete: vi.fn(async (id: number) => {
        const idx = store.findIndex((e) => e.id === id);
        if (idx >= 0) store.splice(idx, 1);
      }),
      update: vi.fn(async (id: number, patch: Partial<LocalOutboxRecord>) => {
        const found = store.find((e) => e.id === id);
        if (!found) return 0;
        Object.assign(found, patch);
        return 1;
      }),
      clear: vi.fn(async () => {
        store.length = 0;
      }),
      where: vi.fn((index: string) => ({
        equals: (uid: string) => ({
          count: vi.fn(async () => store.filter((e) => e.userId === uid).length),
          toArray: vi.fn(async () =>
            store.filter((e) => e.userId === uid).map((e) => ({ ...e }))
          )
        }),
        between: (
          lower: [string, unknown],
          upper: [string, unknown],
          includeLower = true,
          includeUpper = true
        ) => {
          const uid = lower[0];
          const minVal = lower[1] === Dexie.minKey ? -Infinity : Number(lower[1]);
          const maxVal = upper[1] === Dexie.maxKey ? Infinity : Number(upper[1]);
          const rows = store
            .filter((e) => {
              if (e.userId !== uid) return false;
              const idVal = Number(e.id ?? 0);
              const ge = includeLower ? idVal >= minVal : idVal > minVal;
              const le = includeUpper ? idVal <= maxVal : idVal < maxVal;
              return ge && le;
            })
            .sort((a, b) => Number(a.id) - Number(b.id))
            .map((e) => ({ ...e }));
          return {
            limit: (limitNum: number) => ({
              toArray: vi.fn(async () => rows.slice(0, limitNum))
            }),
            toArray: vi.fn(async () => rows)
          };
        }
      }))
    },
    accounts: { toArray: vi.fn(async () => []), where: vi.fn() },
    transactions: { toArray: vi.fn(async () => []), where: vi.fn() },
    categories: { toArray: vi.fn(async () => []), where: vi.fn() },
    budgets: { toArray: vi.fn(async () => []), where: vi.fn() },
    recurringRules: { toArray: vi.fn(async () => []), where: vi.fn() },
    recurringOccurrences: { toArray: vi.fn(async () => []), where: vi.fn() },
    notifications: { toArray: vi.fn(async () => []), where: vi.fn() },
    notificationPreferences: { toArray: vi.fn(async () => []), where: vi.fn() },
    lenders: { toArray: vi.fn(async () => []), where: vi.fn() },
    borrowings: { toArray: vi.fn(async () => []), where: vi.fn() },
    borrowingRepayments: { toArray: vi.fn(async () => []), where: vi.fn() }
  } as unknown as LaxmiLensDB;

  const outboxManager = new OutboxManager(db, commitNotifier);
  const unitOfWork = new DexieUnitOfWork(db, undefined, commitNotifier);

  return {
    db,
    outboxManager,
    unitOfWork,
    getRecords: () => store.map((r) => ({ ...r }))
  };
}

function createMockAuth(user: AuthUser | null): AuthPort {
  return {
    getCurrentUser: vi.fn(async () => user),
    signInWithEmail: vi.fn(),
    signUpWithEmail: vi.fn(),
    signInWithOAuth: vi.fn(),
    signOut: vi.fn(async () => undefined),
    resetPasswordForEmail: vi.fn(),
    updatePassword: vi.fn(),
    onAuthStateChange: vi.fn(() => () => {})
  };
}

function createSharedCrossTabHarness() {
  const heldLocks = new Set<string>();
  const channels = new Map<string, Set<(event: MessageEvent<unknown>) => void>>();

  const lockProvider: WebLockProvider = {
    async request<T>(
      name: string,
      options: { mode?: 'exclusive' | 'shared'; ifAvailable?: boolean },
      callback: (lock: unknown | null) => Promise<T>
    ): Promise<T> {
      if (heldLocks.has(name)) {
        if (options.ifAvailable) {
          return await callback(null);
        }
        throw new Error(`Lock '${name}' already held`);
      }
      heldLocks.add(name);
      try {
        return await callback({ name });
      } finally {
        heldLocks.delete(name);
      }
    }
  };

  const broadcastChannelFactory: BroadcastChannelFactory = (name: string): BroadcastChannelLike => {
    if (!channels.has(name)) {
      channels.set(name, new Set());
    }
    const channelListeners = channels.get(name)!;
    const activeListeners = new Set<(event: MessageEvent<unknown>) => void>();
    const instance: BroadcastChannelLike = {
      onmessage: null,
      addEventListener: (_type, fn) => {
        activeListeners.add(fn);
        channelListeners.add(fn);
      },
      removeEventListener: (_type, fn) => {
        activeListeners.delete(fn);
        channelListeners.delete(fn);
      },
      postMessage: (data) => {
        const event = { data } as MessageEvent<unknown>;
        for (const listener of Array.from(channelListeners)) {
          if (!activeListeners.has(listener)) {
            listener(event);
          }
        }
      },
      close: () => {
        for (const fn of activeListeners) {
          channelListeners.delete(fn);
        }
        activeListeners.clear();
      }
    };
    return instance;
  };

  return {
    lockProvider,
    broadcastChannelFactory,
    acquireExternalLock: (name: string) => heldLocks.add(name),
    releaseExternalLock: (name: string) => heldLocks.delete(name)
  };
}

function makeAccountOutboxPayload(accountId: string, userId = USER_A, name = 'Main Bank') {
  return {
    id: accountId,
    user_id: userId,
    name,
    account_type: 'bank',
    opening_balance_paise: 10000,
    currency: 'INR',
    is_archived: false,
    version: 1
  };
}

describe('Step 3: AutoSyncScheduler & Background Synchronization Lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1. debounces rapid post-commit local writes and never triggers mid-transaction', async () => {
    const commitNotifier = new LocalWriteCommitNotifier();
    const { outboxManager, unitOfWork, getRecords } = createInMemoryOutboxEnv([], commitNotifier);
    const lifecycle = createControlledLifecycle(true);
    const fakeTimers = createFakeTimerProvider();
    const cacheInvalidator: BackupCacheInvalidator = {
      invalidateUserCaches: vi.fn(async () => undefined)
    };

    const dispatchedIds: string[] = [];
    const coordinator = new ManualSyncCoordinator(
      {
        dispatch: vi.fn(async (entry: LocalOutboxRecord) => {
          dispatchedIds.push(entry.entityId);
          await outboxManager.markSuccess(entry.id!);
        })
      } as unknown as AccountSyncDispatcher,
      { dispatch: vi.fn() } as unknown as TransactionSyncDispatcher,
      outboxManager,
      createMockAuth({ id: USER_A, email: 'a@laxmilens.app' })
    );

    const runSpy = vi.spyOn(coordinator, 'run');

    const scheduler = new AutoSyncScheduler({
      userId: USER_A,
      sessionGeneration: 1,
      coordinator,
      outboxManager,
      commitNotifier,
      lifecycleAdapter: lifecycle.adapter,
      timerProvider: fakeTimers.timerProvider,
      cacheInvalidator,
      debounceMs: 1000
    });

    scheduler.start();
    await waitFor(() => {
      expect(runSpy).toHaveBeenCalledTimes(1);
      expect(scheduler.getState().status).toBe('successfully_synchronized');
    });
    runSpy.mockClear();

    // During an active Dexie transaction, AutoSyncScheduler must NOT trigger yet
    await unitOfWork.run(async () => {
      await outboxManager.enqueue({
        userId: USER_A,
        entity: 'accounts',
        entityId: ACC_1,
        operation: 'INSERT',
        payload: makeAccountOutboxPayload(ACC_1),
        idempotencyKey: `acc-${ACC_1}`
      });
      expect(fakeTimers.getPendingTimerCount()).toBe(0);
      expect(runSpy).not.toHaveBeenCalled();
    });

    // After first commit: honest 'Saved locally' & debounce timer armed for 1000ms
    expect(scheduler.getState().status).toBe('saved_locally');
    expect(scheduler.getState().label).toBe('Saved locally');
    expect(fakeTimers.getPendingTimerCount()).toBe(1);

    // Advance 500ms, perform another rapid write -> debounce resets so both coalesce
    await fakeTimers.advanceBy(500);
    expect(runSpy).not.toHaveBeenCalled();

    await unitOfWork.run(async () => {
      await outboxManager.enqueue({
        userId: USER_A,
        entity: 'accounts',
        entityId: ACC_2,
        operation: 'INSERT',
        payload: makeAccountOutboxPayload(ACC_2, USER_A, 'Savings'),
        idempotencyKey: `acc-${ACC_2}`
      });
    });

    await fakeTimers.advanceBy(600);
    expect(runSpy).not.toHaveBeenCalled();

    // Remaining 400ms hits 1000ms after second write -> single coalesced background sync
    await fakeTimers.advanceBy(400);
    await waitFor(() => {
      expect(runSpy).toHaveBeenCalledTimes(1);
      expect(runSpy).toHaveBeenCalledWith({ mode: 'background', retryFailed: false });
      expect(dispatchedIds).toEqual([ACC_1, ACC_2]);
      expect(getRecords()).toHaveLength(0);
      expect(scheduler.getState().status).toBe('successfully_synchronized');
      expect(scheduler.getState().label).toBe('Successfully synchronized');
    });
    expect(cacheInvalidator.invalidateUserCaches).toHaveBeenCalledWith(USER_A, {
      includeNotifications: true
    });

    scheduler.dispose();
  });

  it('2. does not trigger synchronization when a local Dexie transaction rolls back', async () => {
    const commitNotifier = new LocalWriteCommitNotifier();
    const { outboxManager, unitOfWork, getRecords } = createInMemoryOutboxEnv([], commitNotifier);
    const lifecycle = createControlledLifecycle(true);
    const fakeTimers = createFakeTimerProvider();

    const coordinator = new ManualSyncCoordinator(
      { dispatch: vi.fn() } as unknown as AccountSyncDispatcher,
      { dispatch: vi.fn() } as unknown as TransactionSyncDispatcher,
      outboxManager,
      createMockAuth({ id: USER_A, email: 'a@laxmilens.app' })
    );
    const runSpy = vi.spyOn(coordinator, 'run');

    const scheduler = new AutoSyncScheduler({
      userId: USER_A,
      sessionGeneration: 1,
      coordinator,
      outboxManager,
      commitNotifier,
      lifecycleAdapter: lifecycle.adapter,
      timerProvider: fakeTimers.timerProvider,
      debounceMs: 1000
    });

    scheduler.start();
    await waitFor(() => {
      expect(runSpy).toHaveBeenCalledTimes(1);
      expect(scheduler.getState().status).toBe('successfully_synchronized');
    });
    runSpy.mockClear();

    await expect(
      unitOfWork.run(async () => {
        await outboxManager.enqueue({
          userId: USER_A,
          entity: 'accounts',
          entityId: ACC_1,
          operation: 'INSERT',
          payload: makeAccountOutboxPayload(ACC_1),
          idempotencyKey: `acc-${ACC_1}`
        });
        throw new Error('Simulated mid-transaction constraint abort');
      })
    ).rejects.toThrow('Simulated mid-transaction constraint abort');

    expect(getRecords()).toHaveLength(0);
    expect(fakeTimers.getPendingTimerCount()).toBe(0);
    await fakeTimers.advanceBy(5000);
    expect(runSpy).not.toHaveBeenCalled();

    scheduler.dispose();
  });

  it('3. starts initial sync only AFTER database initialization and LegacyDatabaseMigrator complete', async () => {
    const lifecycle = createControlledLifecycle(true);
    const { db, outboxManager } = createInMemoryOutboxEnv();
    const dm = new DatabaseManager(
      createMockAuth({ id: USER_A, email: 'a@laxmilens.app' }),
      () => db,
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
      undefined,
      lifecycle.adapter
    );

    await dm.openForUser(USER_A);
    const repos = await dm.getActiveRepositories();
    const runSpy = vi.spyOn(repos.syncCoordinator, 'run').mockResolvedValue({
      totalPending: 0,
      totalProcessed: 0,
      syncedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      unsupportedCount: 0,
      stillPendingCount: 0,
      pulledCount: 0,
      skippedPausedCount: 0,
      skippedBackoffCount: 0,
      skippedAuthPaused: false,
      skippedLockContention: false,
      pagesProcessed: 0,
      authPaused: false,
      accounts: { syncedCount: 0, failedCount: 0, skippedCount: 0 },
      categories: { syncedCount: 0, failedCount: 0, skippedCount: 0 },
      budgets: {
        syncedCount: 0,
        failedCount: 0,
        skippedCount: 0,
        categoryBlockedCount: 0,
        conflictCount: 0,
        pulledCount: 0
      },
      transactions: {
        syncedCount: 0,
        failedCount: 0,
        skippedCount: 0,
        dependencyBlockedCount: 0,
        categoryBlockedCount: 0,
        conflictCount: 0
      },
      lenders: { syncedCount: 0, failedCount: 0, skippedCount: 0 },
      borrowings: { syncedCount: 0, failedCount: 0, skippedCount: 0, dependencyBlockedCount: 0 },
      borrowing_repayments: {
        syncedCount: 0,
        failedCount: 0,
        skippedCount: 0,
        dependencyBlockedCount: 0
      },
      errors: []
    });

    // Before LegacyDatabaseMigrator completes, scheduler must stay unstarted
    expect(repos.autoSyncScheduler.isStarted()).toBe(false);
    expect(runSpy).not.toHaveBeenCalled();

    // Now test AuthProvider sequencing: migration completes -> notifySessionReady triggers sync
    let resolveMigration!: () => void;
    const migrationGate = new Promise<void>((resolve) => {
      resolveMigration = resolve;
    });

    vi.spyOn(defaultDatabaseManager, 'openForUser').mockResolvedValue(db);
    vi.spyOn(defaultDatabaseManager, 'isUserActive').mockReturnValue(true);
    const notifyReadySpy = vi
      .spyOn(defaultDatabaseManager, 'notifySessionReady')
      .mockImplementation((uid) => {
        dm.notifySessionReady(uid);
      });

    vi.spyOn(defaultLegacyMigrator, 'migrate').mockImplementation(async () => {
      await migrationGate;
      return {
        userId: USER_A,
        accountsMigrated: 0,
        transactionsMigrated: 0,
        categoriesMigrated: 0,
        profilesMigrated: 0,
        outboxEntriesMigrated: 0,
        skippedForeignRecords: 0,
        skippedAmbiguousRecords: 0,
        alreadyMigratedRecords: 0,
        isComplete: true,
        errors: []
      };
    });

    const authAdapter = createMockAuth({ id: USER_A, email: 'a@laxmilens.app' });
    render(
      React.createElement(
        AuthProvider,
        { authAdapter },
        React.createElement('div', null, 'app')
      )
    );

    await Promise.resolve();
    await Promise.resolve();
    // Migration still pending -> scheduler still not started
    expect(notifyReadySpy).not.toHaveBeenCalled();
    expect(runSpy).not.toHaveBeenCalled();

    await act(async () => {
      resolveMigration();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(notifyReadySpy).toHaveBeenCalledWith(USER_A);
      expect(repos.autoSyncScheduler.isStarted()).toBe(true);
      expect(runSpy).toHaveBeenCalledTimes(1);
    });

    expect(outboxManager).toBeDefined();
    await dm.closeCurrentDatabase();
  });

  it('4. resumes eligible pending changes when connectivity returns via online event', async () => {
    const commitNotifier = new LocalWriteCommitNotifier();
    const { outboxManager, unitOfWork, getRecords } = createInMemoryOutboxEnv([], commitNotifier);
    const lifecycle = createControlledLifecycle(false); // initially offline
    const fakeTimers = createFakeTimerProvider();

    const dispatched: string[] = [];
    const coordinator = new ManualSyncCoordinator(
      {
        dispatch: vi.fn(async (e: LocalOutboxRecord) => {
          dispatched.push(e.entityId);
          await outboxManager.markSuccess(e.id!);
        })
      } as unknown as AccountSyncDispatcher,
      { dispatch: vi.fn() } as unknown as TransactionSyncDispatcher,
      outboxManager,
      createMockAuth({ id: USER_A, email: 'a@laxmilens.app' })
    );
    const networkRecoveredSpy = vi.spyOn(coordinator, 'notifyNetworkRecovered');

    const scheduler = new AutoSyncScheduler({
      userId: USER_A,
      sessionGeneration: 1,
      coordinator,
      outboxManager,
      commitNotifier,
      lifecycleAdapter: lifecycle.adapter,
      timerProvider: fakeTimers.timerProvider,
      debounceMs: 1000
    });

    scheduler.start();
    expect(scheduler.getState().status).toBe('waiting_for_internet');
    expect(scheduler.getState().label).toBe('Waiting for internet');

    await unitOfWork.run(async () => {
      await outboxManager.enqueue({
        userId: USER_A,
        entity: 'accounts',
        entityId: ACC_1,
        operation: 'INSERT',
        payload: makeAccountOutboxPayload(ACC_1),
        idempotencyKey: `acc-${ACC_1}`
      });
    });

    await fakeTimers.advanceBy(5000);
    expect(dispatched).toHaveLength(0);
    expect(getRecords()).toHaveLength(1);
    expect(scheduler.getState().status).toBe('waiting_for_internet');

    // Device comes back online -> resets transient backoff & syncs immediately
    lifecycle.emitOnline();
    await waitFor(() => {
      expect(networkRecoveredSpy).toHaveBeenCalledWith(USER_A);
      expect(dispatched).toEqual([ACC_1]);
      expect(getRecords()).toHaveLength(0);
      expect(scheduler.getState().status).toBe('successfully_synchronized');
    });

    scheduler.dispose();
  });

  it('5. applies foreground resume pull cooldown and prevents redundant tab-switch syncs', async () => {
    const { outboxManager } = createInMemoryOutboxEnv();
    const lifecycle = createControlledLifecycle(true);
    const fakeTimers = createFakeTimerProvider(500_000);

    const coordinator = new ManualSyncCoordinator(
      { dispatch: vi.fn() } as unknown as AccountSyncDispatcher,
      { dispatch: vi.fn() } as unknown as TransactionSyncDispatcher,
      outboxManager,
      createMockAuth({ id: USER_A, email: 'a@laxmilens.app' })
    );
    const runSpy = vi.spyOn(coordinator, 'run');

    const scheduler = new AutoSyncScheduler({
      userId: USER_A,
      sessionGeneration: 1,
      coordinator,
      outboxManager,
      lifecycleAdapter: lifecycle.adapter,
      timerProvider: fakeTimers.timerProvider,
      foregroundCooldownMs: 30_000
    });

    scheduler.start();
    await waitFor(() => expect(runSpy).toHaveBeenCalledTimes(1));

    // Quick visibility + focus switch after 5 seconds -> suppressed by 30s cooldown
    await fakeTimers.advanceBy(5_000);
    lifecycle.emitForeground();
    lifecycle.emitForeground();
    await Promise.resolve();
    expect(runSpy).toHaveBeenCalledTimes(1);

    // Advance past remaining 25s -> foreground triggers ONE pull even when visibilitychange + focus fire together
    await fakeTimers.advanceBy(26_000);
    lifecycle.emitForeground();
    lifecycle.emitForeground();
    await waitFor(() => expect(runSpy).toHaveBeenCalledTimes(2));

    scheduler.dispose();
  });

  it('6. schedules exponential backoff retries for transient failures and stops on permanent failure, offline, or disposal', async () => {
    const commitNotifier = new LocalWriteCommitNotifier();
    const { outboxManager, getRecords } = createInMemoryOutboxEnv(
      [
        {
          id: 1,
          userId: USER_A,
          entity: 'accounts',
          entityId: ACC_1,
          operation: 'INSERT',
          payload: makeAccountOutboxPayload(ACC_1),
          idempotencyKey: `acc-${ACC_1}`,
          attempts: 0,
          createdAt: '2026-11-27T00:00:00.000Z'
        }
      ],
      commitNotifier
    );
    const lifecycle = createControlledLifecycle(true);
    const fakeTimers = createFakeTimerProvider(100_000);

    let failMode: 'transient' | 'permanent' | 'succeed' = 'transient';
    const coordinator = new ManualSyncCoordinator(
      {
        dispatch: vi.fn(async (entry: LocalOutboxRecord) => {
          if (failMode === 'transient') {
            await outboxManager.markFailure(entry.id!, 'Failed to fetch');
            throw new TypeError('Failed to fetch');
          }
          if (failMode === 'permanent') {
            await outboxManager.markFailure(entry.id!, '42501 RLS permission denied');
            throw Object.assign(new Error('42501 RLS permission denied'), { code: '42501' });
          }
          await outboxManager.markSuccess(entry.id!);
        })
      } as unknown as AccountSyncDispatcher,
      { dispatch: vi.fn() } as unknown as TransactionSyncDispatcher,
      outboxManager,
      createMockAuth({ id: USER_A, email: 'a@laxmilens.app' }),
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
        nowMs: fakeTimers.timerProvider.nowMs,
        randomFn: () => 0.5, // zero jitter delta -> 1000ms first backoff, 2000ms second
        retryConfig: {
          maxRetries: 5,
          initialRetryDelayMs: 1000,
          maxRetryDelayMs: 60_000
        }
      }
    );
    const runSpy = vi.spyOn(coordinator, 'run');

    const scheduler = new AutoSyncScheduler({
      userId: USER_A,
      sessionGeneration: 1,
      coordinator,
      outboxManager,
      lifecycleAdapter: lifecycle.adapter,
      timerProvider: fakeTimers.timerProvider,
      retryConfig: {
        maxRetries: 5,
        initialRetryDelayMs: 1000,
        maxRetryDelayMs: 60_000
      },
      randomFn: () => 0.5
    });

    scheduler.start();
    await waitFor(() => expect(runSpy).toHaveBeenCalledTimes(1));

    // One transient failure -> single retry scheduled (~1000ms), no polling
    expect(fakeTimers.getPendingTimerCount()).toBe(1);
    expect(scheduler.getState().status).toBe('synchronization_failed');

    // Going offline cancels scheduled retry timer immediately
    lifecycle.emitOffline();
    expect(fakeTimers.getPendingTimerCount()).toBe(0);
    expect(scheduler.getState().status).toBe('waiting_for_internet');

    // Online resumes, fails transiently again (attempt 2 -> 2000ms backoff)
    lifecycle.emitOnline();
    await waitFor(() => expect(runSpy).toHaveBeenCalledTimes(2));
    expect(fakeTimers.getPendingTimerCount()).toBe(1);

    // Next retry hits permanent failure -> ZERO further retry timers
    failMode = 'permanent';
    await fakeTimers.advanceBy(2000);
    await waitFor(() => expect(runSpy).toHaveBeenCalledTimes(3));
    expect(fakeTimers.getPendingTimerCount()).toBe(0);
    expect(getRecords()).toHaveLength(1);

    await fakeTimers.advanceBy(120_000);
    expect(runSpy).toHaveBeenCalledTimes(3); // no continuous polling

    scheduler.dispose();
  });

  it('7. disposes scheduler cleanly on sign-out and user switch, detaching listeners and cancelling timers', async () => {
    const lifecycle = createControlledLifecycle(true);
    const { db: dbA, outboxManager: outboxA } = createInMemoryOutboxEnv();
    const { db: dbB } = createInMemoryOutboxEnv();

    let currentAuthUser: AuthUser | null = { id: USER_A, email: 'a@laxmilens.app' };
    const authPort = createMockAuth(currentAuthUser);
    (authPort.getCurrentUser as ReturnType<typeof vi.fn>).mockImplementation(
      async () => currentAuthUser
    );

    const dm = new DatabaseManager(
      authPort,
      (name) => (name.includes(USER_A) ? dbA : dbB),
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
      undefined,
      lifecycle.adapter
    );

    await dm.openForUser(USER_A);
    const reposA = await dm.getActiveRepositories();
    const runSpyA = vi.spyOn(reposA.syncCoordinator, 'run').mockResolvedValue({
      totalPending: 0,
      totalProcessed: 0,
      syncedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      unsupportedCount: 0,
      stillPendingCount: 0,
      pulledCount: 0,
      skippedPausedCount: 0,
      skippedBackoffCount: 0,
      skippedAuthPaused: false,
      skippedLockContention: false,
      pagesProcessed: 0,
      authPaused: false,
      accounts: { syncedCount: 0, failedCount: 0, skippedCount: 0 },
      categories: { syncedCount: 0, failedCount: 0, skippedCount: 0 },
      budgets: {
        syncedCount: 0,
        failedCount: 0,
        skippedCount: 0,
        categoryBlockedCount: 0,
        conflictCount: 0,
        pulledCount: 0
      },
      transactions: {
        syncedCount: 0,
        failedCount: 0,
        skippedCount: 0,
        dependencyBlockedCount: 0,
        categoryBlockedCount: 0,
        conflictCount: 0
      },
      lenders: { syncedCount: 0, failedCount: 0, skippedCount: 0 },
      borrowings: { syncedCount: 0, failedCount: 0, skippedCount: 0, dependencyBlockedCount: 0 },
      borrowing_repayments: {
        syncedCount: 0,
        failedCount: 0,
        skippedCount: 0,
        dependencyBlockedCount: 0
      },
      errors: []
    });

    dm.notifySessionReady(USER_A);
    await waitFor(() => expect(runSpyA).toHaveBeenCalledTimes(1));
    expect(lifecycle.getListenerCount()).toBe(1);

    // Enqueue write to arm debounce timer, then switch to USER_B before debounce fires
    await outboxA.enqueue({
      userId: USER_A,
      entity: 'accounts',
      entityId: ACC_1,
      operation: 'INSERT',
      payload: makeAccountOutboxPayload(ACC_1, USER_A),
      idempotencyKey: `acc-${ACC_1}`
    });

    currentAuthUser = { id: USER_B, email: 'b@laxmilens.app' };
    await dm.openForUser(USER_B);

    expect(reposA.autoSyncScheduler.isDisposed()).toBe(true);
    expect(lifecycle.getListenerCount()).toBe(0); // USER_B not notified ready yet

    dm.notifySessionReady(USER_B);
    const reposB = await dm.getActiveRepositories();
    vi.spyOn(reposB.syncCoordinator, 'run').mockResolvedValueOnce(await runSpyA.mock.results[0].value);
    expect(lifecycle.getListenerCount()).toBe(1);

    // Sign out clears everything
    currentAuthUser = null;
    await dm.closeCurrentDatabase();
    expect(reposB.autoSyncScheduler.isDisposed()).toBe(true);
    expect(lifecycle.getListenerCount()).toBe(0);
    expect(dm.getSyncState().userId).toBeNull();
  });

  it('8. enforces session-generation guard so stale user/session schedulers cannot sync', async () => {
    const { outboxManager } = createInMemoryOutboxEnv();
    const lifecycle = createControlledLifecycle(true);
    const fakeTimers = createFakeTimerProvider();

    let activeSession = true;
    const coordinator = new ManualSyncCoordinator(
      { dispatch: vi.fn() } as unknown as AccountSyncDispatcher,
      { dispatch: vi.fn() } as unknown as TransactionSyncDispatcher,
      outboxManager,
      createMockAuth({ id: USER_A, email: 'a@laxmilens.app' }),
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
      { sessionCheck: () => activeSession }
    );
    const runSpy = vi.spyOn(coordinator, 'run');

    const scheduler = new AutoSyncScheduler({
      userId: USER_A,
      sessionGeneration: 1,
      coordinator,
      outboxManager,
      sessionCheck: () => activeSession,
      lifecycleAdapter: lifecycle.adapter,
      timerProvider: fakeTimers.timerProvider,
      debounceMs: 500
    });

    scheduler.start();
    await waitFor(() => {
      expect(runSpy).toHaveBeenCalledTimes(1);
      expect(scheduler.getState().status).toBe('successfully_synchronized');
    });
    runSpy.mockClear();

    // Schedule local write, then invalidate session generation before debounce fires
    scheduler.notifyLocalWriteCommitted();
    expect(fakeTimers.getPendingTimerCount()).toBe(1);

    activeSession = false;
    await fakeTimers.advanceBy(1000);
    lifecycle.emitOnline();
    lifecycle.emitForeground();

    expect(runSpy).not.toHaveBeenCalled();

    scheduler.dispose();
  });

  it('9 & 10. blocks auto-sync during all 7 backup/restore phases and schedules sync only after restore with pending outbox unlocks', async () => {
    const commitNotifier = new LocalWriteCommitNotifier();
    const { db, outboxManager, unitOfWork, getRecords } = createInMemoryOutboxEnv([], commitNotifier);
    const lifecycle = createControlledLifecycle(true);
    const fakeTimers = createFakeTimerProvider();

    // Wire DexieBackupRepository compatible minimal storage for export/decrypt/preview/restore workflows
    const accountStore = new Map<string, Record<string, unknown>>();
    const outboxRef = { entries: [] as LocalOutboxRecord[] };
    const snapshotBase = {
      dexieSchemaVersion: 1,
      rawStoreData: {
        profile: null,
        accounts: [],
        categories: [],
        transactions: [],
        budgets: [],
        recurringRules: [],
        recurringOccurrences: [],
        lenders: [],
        borrowings: [],
        borrowingRepayments: [],
        notifications: [],
        notificationPreferences: null,
        categoryMappings: [],
        pendingOutbox: []
      },
      preExcludedQuarantinedCounts: {}
    };

    const storage = {
      getDexieSchemaVersion: () => 1,
      getDatabaseIdentity: () => `LaxmiLens_LocalDB_${USER_A}`,
      captureUserSnapshot: vi.fn(async () => ({
        ...snapshotBase,
        rawStoreData: {
          ...snapshotBase.rawStoreData,
          accounts: Array.from(accountStore.values())
        }
      })),
      getTargetRestoreSummary: vi.fn(async () => ({
        authenticatedUserId: USER_A,
        currentDexieSchemaVersion: 1,
        isTargetEmpty: accountStore.size === 0,
        existingCounts: {
          profile: 0,
          accounts: accountStore.size,
          categories: 0,
          transactions: 0,
          budgets: 0,
          recurringRules: 0,
          recurringOccurrences: 0,
          lenders: 0,
          borrowings: 0,
          borrowingRepayments: 0,
          notifications: 0,
          notificationPreferences: 0,
          categoryMappings: 0,
          pendingOutbox: getRecords().length
        },
        seededDefaultCategoryIds: [],
        referencedCategoryIds: [],
        existingCategories: []
      })),
      executeAtomicRestore: vi.fn(async (input: { archive: { data: { pendingOutbox: Array<Omit<LocalOutboxRecord, 'id' | 'attempts'>> } }; restorePendingOutbox: boolean }) => {
        if (input.restorePendingOutbox) {
          for (const e of input.archive.data.pendingOutbox) {
            await db.syncOutbox.add({ ...e, attempts: 0 } as LocalOutboxRecord);
            outboxRef.entries.push({ ...e, attempts: 0 } as LocalOutboxRecord);
          }
        }
        return {
          restoredCounts: {
            profile: 0,
            accounts: 0,
            categories: 0,
            transactions: 0,
            budgets: 0,
            recurringRules: 0,
            recurringOccurrences: 0,
            lenders: 0,
            borrowings: 0,
            borrowingRepayments: 0,
            notifications: 0,
            notificationPreferences: 0,
            categoryMappings: 0,
            pendingOutbox: input.restorePendingOutbox ? input.archive.data.pendingOutbox.length : 0
          },
          restoredOutboxCount: input.restorePendingOutbox
            ? input.archive.data.pendingOutbox.length
            : 0,
          replacedSeededDefaultCategoryIds: []
        };
      })
    };

    const coordinator = new ManualSyncCoordinator(
      {
        dispatch: vi.fn(async (entry: LocalOutboxRecord) => {
          await outboxManager.markSuccess(entry.id!);
        })
      } as unknown as AccountSyncDispatcher,
      { dispatch: vi.fn() } as unknown as TransactionSyncDispatcher,
      outboxManager,
      createMockAuth({ id: USER_A, email: 'a@laxmilens.app' })
    );
    const runSpy = vi.spyOn(coordinator, 'run');

    const scheduler = new AutoSyncScheduler({
      userId: USER_A,
      sessionGeneration: 1,
      coordinator,
      outboxManager,
      commitNotifier,
      lifecycleAdapter: lifecycle.adapter,
      timerProvider: fakeTimers.timerProvider,
      debounceMs: 500
    });

    scheduler.start();
    await waitFor(() => {
      expect(runSpy).toHaveBeenCalledTimes(1);
      expect(scheduler.getState().status).toBe('successfully_synchronized');
      expect(coordinator.isOperationInProgress()).toBe(false);
    });
    runSpy.mockClear();

    const registry = new SafetyBackupReceiptRegistry();
    const encryption = new BackupEncryptionService();
    const validator = new BackupValidationService();
    const exportUc = new ExportEncryptedBackupUseCase(
      createMockAuth({ id: USER_A, email: 'a@laxmilens.app' }),
      storage as never,
      coordinator,
      encryption,
      validator,
      undefined,
      USER_A,
      registry
    );
    const decryptUc = new DecryptBackupFileUseCase(
      createMockAuth({ id: USER_A, email: 'a@laxmilens.app' }),
      coordinator,
      encryption,
      USER_A
    );
    const previewUc = new GenerateRestorePreviewUseCase(
      createMockAuth({ id: USER_A, email: 'a@laxmilens.app' }),
      storage as never,
      coordinator,
      decryptUc,
      validator,
      USER_A
    );
    const restoreUc = new ExecuteBackupRestoreUseCase(
      createMockAuth({ id: USER_A, email: 'a@laxmilens.app' }),
      storage as never,
      coordinator,
      validator,
      undefined,
      USER_A,
      registry
    );

    // Pause during export/decrypt/preview/restore gates
    const passphrase = 'StrongTestPassphrase123!';
    const exported = await exportUc.execute({ passphrase, downloadFile: false });

    let releaseDecrypt: (() => void) | null = null;
    vi.spyOn(encryption, 'decryptEnvelope').mockImplementationOnce(async (env, pass) => {
      await new Promise<void>((resolve) => {
        releaseDecrypt = resolve;
      });
      return new BackupEncryptionService().decryptEnvelope(env, pass);
    });
    const decryptPromise = decryptUc.execute({ rawContent: exported.envelope, passphrase });
    await waitFor(() => {
      expect(releaseDecrypt).not.toBeNull();
    });

    expect(scheduler.getState().isExclusiveOperationInProgress).toBe(true);
    lifecycle.emitOnline();
    lifecycle.emitForeground();
    expect(runSpy).not.toHaveBeenCalled();

    releaseDecrypt!();
    const decrypted = await decryptPromise;

    // During restore preview: lock also excludes background sync
    let releasePreview: (() => void) | null = null;
    vi.spyOn(storage, 'getTargetRestoreSummary').mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        releasePreview = resolve;
      });
      return {
        authenticatedUserId: USER_A,
        currentDexieSchemaVersion: 1,
        isTargetEmpty: true,
        existingCounts: {
          profile: 0,
          accounts: 0,
          categories: 0,
          transactions: 0,
          budgets: 0,
          recurringRules: 0,
          recurringOccurrences: 0,
          lenders: 0,
          borrowings: 0,
          borrowingRepayments: 0,
          notifications: 0,
          notificationPreferences: 0,
          categoryMappings: 0,
          pendingOutbox: 0
        },
        seededDefaultCategoryIds: [],
        referencedCategoryIds: [],
        existingCategories: []
      };
    });
    const previewPromise = previewUc.execute({ archive: decrypted.archive, mode: 'empty' });
    await waitFor(() => {
      expect(releasePreview).not.toBeNull();
    });
    expect(scheduler.getState().isExclusiveOperationInProgress).toBe(true);
    expect(runSpy).not.toHaveBeenCalled();
    releasePreview!();
    await previewPromise;

    // Execute replace restore containing a pending outbox item:
    const archiveWithPending = await validator.buildSanitizedArchive({
      userId: USER_A,
      dexieSchemaVersion: 1,
      rawStoreData: {
        ...snapshotBase.rawStoreData,
        accounts: [
          {
            id: ACC_1,
            userId: USER_A,
            name: 'Main Bank',
            type: 'bank',
            accountType: 'bank',
            openingBalancePaise: 10000,
            openingBalanceInPaise: 10000,
            currency: 'INR',
            systemTag: null,
            status: 'active',
            isArchived: false,
            version: 1,
            createdAt: '2026-11-27T00:00:00.000Z',
            updatedAt: '2026-11-27T00:00:00.000Z'
          }
        ],
        pendingOutbox: [
          {
            id: 1,
            userId: USER_A,
            entity: 'accounts',
            entityId: ACC_1,
            operation: 'INSERT',
            payload: makeAccountOutboxPayload(ACC_1, USER_A),
            idempotencyKey: `restored-${ACC_1}`,
            attempts: 0,
            createdAt: '2026-11-27T00:00:00.000Z'
          }
        ]
      }
    });

    // Re-issue live safety receipt after capture
    const liveArchive = await validator.buildSanitizedArchive({
      userId: USER_A,
      dexieSchemaVersion: 1,
      rawStoreData: snapshotBase.rawStoreData
    });
    const digest = await computeLocalDatabaseStateDigest(snapshotBase, liveArchive);
    const freshReceipt = registry.issueReceipt({
      userId: USER_A,
      databaseIdentity: `LaxmiLens_LocalDB_${USER_A}`,
      stateDigestSha256Hex: digest
    });

    const restoreResult = await restoreUc.execute({
      archive: archiveWithPending,
      mode: 'replace',
      restorePendingOutbox: true,
      confirmationText: 'REPLACE',
      safetyBackupReceipt: freshReceipt
    });

    // Synchronous restore NEVER triggers cloud sync directly
    expect(restoreResult.autoSyncTriggered).toBe(false);
    expect(runSpy).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(scheduler.getState().status).toBe('saved_locally');
      expect(scheduler.getState().pendingCount).toBe(1);
    });

    // Once unlocked and post-exclusive timer fires, pending outbox syncs cleanly
    await fakeTimers.advanceBy(500);
    await waitFor(() => {
      expect(runSpy).toHaveBeenCalledTimes(1);
      expect(getRecords()).toHaveLength(0);
      expect(scheduler.getState().status).toBe('successfully_synchronized');
    });

    expect(unitOfWork).toBeDefined();
    scheduler.dispose();
  });

  it('11 & 12. respects cross-tab Web Lock contention and updates secondary tab state & caches via BroadcastChannel', async () => {
    const shared = createSharedCrossTabHarness();
    const { outboxManager: outbox1 } = createInMemoryOutboxEnv([
      {
        id: 1,
        userId: USER_A,
        entity: 'accounts',
        entityId: ACC_1,
        operation: 'INSERT',
        payload: makeAccountOutboxPayload(ACC_1),
        idempotencyKey: `k-${ACC_1}`,
        attempts: 0,
        createdAt: '2026-11-27T00:00:00.000Z'
      }
    ]);
    const { outboxManager: outbox2 } = createInMemoryOutboxEnv();

    const cacheInvalidator2: BackupCacheInvalidator = {
      invalidateUserCaches: vi.fn(async () => undefined)
    };

    let tab2Scheduler!: AutoSyncScheduler;

    const coord1 = new ManualSyncCoordinator(
      {
        dispatch: vi.fn(async (e: LocalOutboxRecord) => outbox1.markSuccess(e.id!))
      } as unknown as AccountSyncDispatcher,
      { dispatch: vi.fn() } as unknown as TransactionSyncDispatcher,
      outbox1,
      createMockAuth({ id: USER_A, email: 'a@laxmilens.app' }),
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
        webLockProvider: shared.lockProvider,
        broadcastChannelFactory: shared.broadcastChannelFactory,
        tabId: 'tab-1'
      }
    );

    const coord2 = new ManualSyncCoordinator(
      { dispatch: vi.fn() } as unknown as AccountSyncDispatcher,
      { dispatch: vi.fn() } as unknown as TransactionSyncDispatcher,
      outbox2,
      createMockAuth({ id: USER_A, email: 'a@laxmilens.app' }),
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
        webLockProvider: shared.lockProvider,
        broadcastChannelFactory: shared.broadcastChannelFactory,
        tabId: 'tab-2',
        onCrossTabEvent: (msg) => {
          void tab2Scheduler?.handleCrossTabMessage(msg);
        }
      }
    );

    const lifecycle2 = createControlledLifecycle(true);
    tab2Scheduler = new AutoSyncScheduler({
      userId: USER_A,
      sessionGeneration: 1,
      coordinator: coord2,
      outboxManager: outbox2,
      lifecycleAdapter: lifecycle2.adapter,
      cacheInvalidator: cacheInvalidator2,
      foregroundCooldownMs: 0
    });

    // External lock held by sibling tab -> Tab 2 background run skips cleanly without failing
    shared.acquireExternalLock(`laxmilens_sync_${USER_A}`);
    tab2Scheduler.start();
    await waitFor(() => {
      expect(tab2Scheduler.getState().lastResult?.skippedLockContention).toBe(true);
    });
    expect(tab2Scheduler.getState().status).toBe('saved_locally');
    shared.releaseExternalLock(`laxmilens_sync_${USER_A}`);

    // Now Tab 1 runs sync -> Broadcasts syncCompleted -> Tab 2 invalidates caches and transitions to Synchronized
    await coord1.run();
    await waitFor(() => {
      expect(cacheInvalidator2.invalidateUserCaches).toHaveBeenCalledWith(USER_A, {
        includeNotifications: true
      });
      expect(tab2Scheduler.getState().status).toBe('successfully_synchronized');
    });

    // Sibling tab restoreCompleted invalidates caches cleanly too
    await coord1.runExclusive('restore', async () => 'done');
    await waitFor(() => {
      expect(cacheInvalidator2.invalidateUserCaches).toHaveBeenCalledTimes(2);
    });

    tab2Scheduler.dispose();
    coord1.dispose();
    coord2.dispose();
  });

  it('13. prevents duplicate concurrent coordinator execution across overlapping triggers', async () => {
    const { outboxManager } = createInMemoryOutboxEnv();
    const lifecycle = createControlledLifecycle(true);
    const fakeTimers = createFakeTimerProvider();

    let releaseRun!: () => void;
    const coordinator = new ManualSyncCoordinator(
      { dispatch: vi.fn() } as unknown as AccountSyncDispatcher,
      { dispatch: vi.fn() } as unknown as TransactionSyncDispatcher,
      outboxManager,
      createMockAuth({ id: USER_A, email: 'a@laxmilens.app' })
    );

    const runSpy = vi.spyOn(coordinator, 'run').mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseRun = () =>
            resolve({
              totalPending: 0,
              totalProcessed: 0,
              syncedCount: 0,
              failedCount: 0,
              skippedCount: 0,
              unsupportedCount: 0,
              stillPendingCount: 0,
              pulledCount: 0,
              skippedPausedCount: 0,
              skippedBackoffCount: 0,
              skippedAuthPaused: false,
              skippedLockContention: false,
              pagesProcessed: 0,
              authPaused: false,
              accounts: { syncedCount: 0, failedCount: 0, skippedCount: 0 },
              categories: { syncedCount: 0, failedCount: 0, skippedCount: 0 },
              budgets: {
                syncedCount: 0,
                failedCount: 0,
                skippedCount: 0,
                categoryBlockedCount: 0,
                conflictCount: 0,
                pulledCount: 0
              },
              transactions: {
                syncedCount: 0,
                failedCount: 0,
                skippedCount: 0,
                dependencyBlockedCount: 0,
                categoryBlockedCount: 0,
                conflictCount: 0
              },
              lenders: { syncedCount: 0, failedCount: 0, skippedCount: 0 },
              borrowings: {
                syncedCount: 0,
                failedCount: 0,
                skippedCount: 0,
                dependencyBlockedCount: 0
              },
              borrowing_repayments: {
                syncedCount: 0,
                failedCount: 0,
                skippedCount: 0,
                dependencyBlockedCount: 0
              },
              errors: []
            });
        })
    );

    const scheduler = new AutoSyncScheduler({
      userId: USER_A,
      sessionGeneration: 1,
      coordinator,
      outboxManager,
      lifecycleAdapter: lifecycle.adapter,
      timerProvider: fakeTimers.timerProvider,
      foregroundCooldownMs: 0
    });

    scheduler.start();
    await Promise.resolve();
    expect(runSpy).toHaveBeenCalledTimes(1);

    // Triggering foreground/online while sync is in flight must NOT call coordinator.run concurrently
    lifecycle.emitForeground();
    lifecycle.emitOnline();
    expect(runSpy).toHaveBeenCalledTimes(1);

    releaseRun();
    await Promise.resolve();
    scheduler.dispose();
  });

  it('14 & 15. reports honest status on partial failure via useAutoSyncState and preserves manual Sync Now', async () => {
    const { outboxManager, getRecords } = createInMemoryOutboxEnv([
      {
        id: 1,
        userId: USER_A,
        entity: 'accounts',
        entityId: ACC_1,
        operation: 'INSERT',
        payload: makeAccountOutboxPayload(ACC_1, USER_A, 'Good Acc'),
        idempotencyKey: `k-${ACC_1}`,
        attempts: 0,
        createdAt: '2026-11-27T00:00:00.000Z'
      },
      {
        id: 2,
        userId: USER_A,
        entity: 'accounts',
        entityId: ACC_2,
        operation: 'INSERT',
        payload: makeAccountOutboxPayload(ACC_2, USER_A, 'Blocked Acc'),
        idempotencyKey: `k-${ACC_2}`,
        attempts: 0,
        createdAt: '2026-11-27T00:00:01.000Z'
      }
    ]);

    const cacheInvalidator: BackupCacheInvalidator = {
      invalidateUserCaches: vi.fn(async () => undefined)
    };
    const lifecycle = createControlledLifecycle(true);
    let blockAcc2 = true;

    const coordinator = new ManualSyncCoordinator(
      {
        dispatch: vi.fn(async (e: LocalOutboxRecord) => {
          if (e.entityId === ACC_2 && blockAcc2) {
            await outboxManager.markFailure(e.id!, '42501 RLS permission denied');
            throw Object.assign(new Error('42501 RLS permission denied'), { code: '42501' });
          }
          await outboxManager.markSuccess(e.id!);
        })
      } as unknown as AccountSyncDispatcher,
      { dispatch: vi.fn() } as unknown as TransactionSyncDispatcher,
      outboxManager,
      createMockAuth({ id: USER_A, email: 'a@laxmilens.app' })
    );

    const scheduler = new AutoSyncScheduler({
      userId: USER_A,
      sessionGeneration: 1,
      coordinator,
      outboxManager,
      lifecycleAdapter: lifecycle.adapter,
      cacheInvalidator
    });

    const observedStates: AutoSyncStateSnapshot[] = [];
    scheduler.subscribe((s) => observedStates.push(s));

    scheduler.start();
    await waitFor(() => {
      expect(scheduler.getState().status).toBe('synchronization_failed');
    });

    // Honest partial failure: ACC_1 synced, ACC_2 preserved safely, NOT 'successfully_synchronized'
    expect(scheduler.getState().label).toBe('Synchronization failed');
    expect(scheduler.getState().lastResult?.syncedCount).toBe(1);
    expect(scheduler.getState().lastResult?.failedCount).toBe(1);
    expect(getRecords()).toHaveLength(1);
    expect(getRecords()[0].entityId).toBe(ACC_2);
    expect(cacheInvalidator.invalidateUserCaches).toHaveBeenCalledWith(USER_A, {
      includeNotifications: false
    });

    // React subscription hook useAutoSyncState + explicit manual Sync Now compatibility via useAccountSync
    vi.spyOn(defaultDatabaseManager, 'getSyncState').mockImplementation(() => scheduler.getState());
    vi.spyOn(defaultDatabaseManager, 'subscribeSyncState').mockImplementation((listener) =>
      scheduler.subscribe(listener)
    );
    vi.spyOn(defaultDatabaseManager, 'getActiveSyncCoordinator').mockResolvedValue(coordinator);

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let triggerManual!: () => Promise<unknown>;

    const SyncProbe: React.FC = () => {
      const hookState = useAutoSyncState();
      const { syncNow, pendingCount } = useAccountSync(qc);
      triggerManual = syncNow;
      return React.createElement(
        'div',
        null,
        React.createElement('span', { 'data-testid': 'sync-label' }, hookState.label),
        React.createElement('span', { 'data-testid': 'pending-count' }, String(pendingCount))
      );
    };

    const authCtxValue: AuthContextType = {
      user: { id: USER_A, email: 'a@laxmilens.app' },
      isLoading: false,
      isAuthenticated: true,
      signIn: vi.fn(),
      signUp: vi.fn(),
      signInWithGoogle: vi.fn(),
      signOut: vi.fn(),
      resetPassword: vi.fn(),
      updatePassword: vi.fn()
    };

    render(
      React.createElement(
        AuthContext.Provider,
        { value: authCtxValue },
        React.createElement(QueryClientProvider, { client: qc }, React.createElement(SyncProbe))
      )
    );

    expect(screen.getByTestId('sync-label')).toHaveTextContent('Synchronization failed');

    // Manual Sync Now resolves cleanly even when background failed previously
    blockAcc2 = false;
    await act(async () => {
      await triggerManual();
    });

    await waitFor(() => {
      expect(scheduler.getState().status).toBe('successfully_synchronized');
      expect(screen.getByTestId('sync-label')).toHaveTextContent('Successfully synchronized');
    });

    expect(getRecords()).toHaveLength(0);
    qc.clear();
    scheduler.dispose();
  });
});

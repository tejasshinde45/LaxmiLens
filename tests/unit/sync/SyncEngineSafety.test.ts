import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SyncEngine, syncEngine as defaultSyncEngine } from '@/infrastructure/sync/SyncEngine';
import { OutboxManager } from '@/infrastructure/sync/OutboxManager';
import { LocalOutboxRecord } from '@/infrastructure/database/local/schema';
import { waitFor } from '@testing-library/react';

describe('SyncEngine Safety Guardrails (Hotfix Audit Verification)', () => {
  let mockOutboxManager: OutboxManager;
  let testEntries: LocalOutboxRecord[];
  let markSuccessSpy: ReturnType<typeof vi.fn>;
  let markFailureSpy: ReturnType<typeof vi.fn>;
  let testSyncEngine: SyncEngine;

  beforeEach(() => {
    // Clean up default module-level singleton to avoid duplicate window event handlers in test
    defaultSyncEngine.cleanup();

    // Initial sample outbox entries for financial operations
    testEntries = [
      {
        id: 1,
        entity: 'accounts',
        entityId: 'acc-uuid-1',
        operation: 'INSERT',
        payload: {
          id: 'acc-uuid-1',
          name: 'HDFC Salary Account',
          account_type: 'bank',
          opening_balance_paise: 5000000,
          currency: 'INR'
        },
        idempotencyKey: 'idemp-acc-001',
        attempts: 0,
        createdAt: '2026-11-21T10:00:00.000Z'
      },
      {
        id: 2,
        entity: 'transactions',
        entityId: 'tx-uuid-2',
        operation: 'INSERT',
        payload: {
          id: 'tx-uuid-2',
          amount_paise: 250000,
          type: 'expense',
          title: 'Grocery Store'
        },
        idempotencyKey: 'idemp-tx-002',
        attempts: 0,
        createdAt: '2026-11-21T10:05:00.000Z'
      },
      {
        id: 3,
        entity: 'categories',
        entityId: 'cat-uuid-3',
        operation: 'UPDATE',
        payload: {
          id: 'cat-uuid-3',
          name: 'Household & Groceries'
        },
        idempotencyKey: 'idemp-cat-003',
        attempts: 0,
        createdAt: '2026-11-21T10:10:00.000Z'
      }
    ];

    markSuccessSpy = vi.fn().mockImplementation(async (id: number) => {
      // If ever invoked, it would delete the entry
      testEntries = testEntries.filter((e) => e.id !== id);
    });

    markFailureSpy = vi.fn().mockImplementation(async (id: number, error: string) => {
      const entry = testEntries.find((e) => e.id === id);
      if (entry) {
        entry.attempts += 1;
        entry.lastError = error;
      }
    });

    mockOutboxManager = {
      getPendingCount: vi.fn().mockImplementation(async () => testEntries.length),
      getPendingEntries: vi.fn().mockImplementation(async () => [...testEntries]),
      markSuccess: markSuccessSpy,
      markFailure: markFailureSpy,
      enqueue: vi.fn().mockImplementation(async (entry) => {
        testEntries.push({
          id: testEntries.length + 1,
          ...entry,
          attempts: 0,
          createdAt: new Date().toISOString()
        });
      }),
      clearOutbox: vi.fn().mockImplementation(async () => {
        testEntries = [];
      }),
      processOutbox: vi.fn().mockResolvedValue({
        pushedCount: 0,
        pulledCount: 0,
        conflictsCount: 0,
        errors: []
      })
    } as unknown as OutboxManager;

    testSyncEngine = new SyncEngine(mockOutboxManager);
  });

  afterEach(() => {
    testSyncEngine.cleanup();
    vi.restoreAllMocks();
  });

  it('never deletes outbox events without a verified cloud operation when sync() is called', async () => {
    const initialCount = testEntries.length;
    expect(initialCount).toBe(3);

    // Trigger sync
    await testSyncEngine.sync();

    // 1. markSuccess must NEVER be called while cloud dispatchers are unimplemented
    expect(markSuccessSpy).not.toHaveBeenCalled();

    // 2. All pending entries must remain completely preserved in the outbox
    expect(testEntries.length).toBe(3);
    expect(testEntries[0].id).toBe(1);
    expect(testEntries[0].idempotencyKey).toBe('idemp-acc-001');
    expect(testEntries[1].id).toBe(2);
    expect(testEntries[1].idempotencyKey).toBe('idemp-tx-002');
    expect(testEntries[2].id).toBe(3);
    expect(testEntries[2].idempotencyKey).toBe('idemp-cat-003');

    // 3. Status must report all items still pending
    const status = await testSyncEngine.getStatus();
    expect(status.pendingOutboxCount).toBe(3);
    expect(status.isSyncing).toBe(false);

    // 4. lastSyncedAt must NOT be set to a false timestamp
    expect(status.lastSyncedAt).toBeNull();
  });

  it('preserves unsupported and pending entities across repeated sync invocations', async () => {
    // Call sync multiple consecutive times
    await testSyncEngine.sync();
    await testSyncEngine.sync();
    await testSyncEngine.sync();

    // Confirm zero deletions occurred
    expect(markSuccessSpy).not.toHaveBeenCalled();
    expect(testEntries.length).toBe(3);

    // Payloads and idempotency keys must remain completely intact
    expect(testEntries[0].payload).toEqual({
      id: 'acc-uuid-1',
      name: 'HDFC Salary Account',
      account_type: 'bank',
      opening_balance_paise: 5000000,
      currency: 'INR'
    });
    expect(testEntries[0].idempotencyKey).toBe('idemp-acc-001');
  });

  it('does not invoke unsafe synchronization when network transitions to online', async () => {
    const syncSpy = vi.spyOn(testSyncEngine, 'sync');

    // Simulate browser window online event
    window.dispatchEvent(new Event('online'));

    // Status updates to idle/online without executing unsafe sync()
    expect(syncSpy).not.toHaveBeenCalled();
    expect(markSuccessSpy).not.toHaveBeenCalled();
    expect(testEntries.length).toBe(3);
  });

  it('updates online/offline status correctly without data modification', async () => {
    let capturedStatus: unknown = null;
    const unsubscribe = testSyncEngine.subscribe((status) => {
      capturedStatus = status;
    });

    // Initial subscriber call
    await waitFor(() => {
      expect(capturedStatus).not.toBeNull();
    });

    // Simulate offline
    window.dispatchEvent(new Event('offline'));
    await waitFor(() => {
      expect(capturedStatus).toMatchObject({
        pendingOutboxCount: 3,
        isOnline: expect.any(Boolean)
      });
    });

    // Simulate online
    window.dispatchEvent(new Event('online'));
    await waitFor(() => {
      expect(capturedStatus).toMatchObject({
        pendingOutboxCount: 3
      });
    });

    // Verify outbox was never touched
    expect(markSuccessSpy).not.toHaveBeenCalled();
    expect(testEntries.length).toBe(3);

    unsubscribe();
  });

  it('disables periodic sync timer until real cloud dispatchers are implemented', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    testSyncEngine.startPeriodicSync();

    // Must not set an active interval timer
    expect(setIntervalSpy).not.toHaveBeenCalled();
  });
});

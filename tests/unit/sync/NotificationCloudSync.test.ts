import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  NotificationRowMapper,
  CloudNotificationRow
} from '@/infrastructure/database/cloud/mappers/NotificationRowMapper';
import {
  NotificationPreferenceRowMapper,
  CloudNotificationPreferenceRow
} from '@/infrastructure/database/cloud/mappers/NotificationPreferenceRowMapper';
import { SupabaseNotificationRepository } from '@/infrastructure/database/cloud/repositories/SupabaseNotificationRepository';
import { SupabaseNotificationPreferenceRepository } from '@/infrastructure/database/cloud/repositories/SupabaseNotificationPreferenceRepository';
import { NotificationSyncDispatcher } from '@/infrastructure/sync/dispatchers/NotificationSyncDispatcher';
import { NotificationPreferenceSyncDispatcher } from '@/infrastructure/sync/dispatchers/NotificationPreferenceSyncDispatcher';
import { NotificationReconciliationService } from '@/infrastructure/sync/NotificationReconciliationService';
import { ManualSyncCoordinator } from '@/infrastructure/sync/ManualSyncCoordinator';
import { SyncAuthError, SyncConflictError } from '@/infrastructure/sync/errors/SyncErrors';
import { AuthPort } from '@/application/ports/AuthPort';
import { OutboxManager } from '@/infrastructure/sync/OutboxManager';
import { AccountSyncDispatcher } from '@/infrastructure/sync/dispatchers/AccountSyncDispatcher';
import { TransactionSyncDispatcher } from '@/infrastructure/sync/dispatchers/TransactionSyncDispatcher';
import { LaxmiLensDB } from '@/infrastructure/database/local/DexieDatabase';
import {
  LocalNotificationPreferenceRecord,
  LocalNotificationRecord,
  LocalOutboxRecord
} from '@/infrastructure/database/local/schema';
import {
  buildBudgetNotificationDedupeKey,
  deriveDeterministicNotificationId
} from '@/domain/services/NotificationIdentityService';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const BUDGET_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_BUDGET_ID = '44444444-4444-4444-8444-444444444444';

function createMockCloudNotification(
  overrides: Partial<CloudNotificationRow> & { id: string }
): CloudNotificationRow {
  return {
    user_id: USER_A,
    category: 'budget_warning',
    severity: 'warning',
    status: 'unread',
    dedupe_key: buildBudgetNotificationDedupeKey(BUDGET_ID, '2026-05'),
    title: 'Budget approaching limit: Food',
    message: 'Food budget is 85% used.',
    entity_type: 'budget',
    entity_id: BUDGET_ID,
    trigger_date: '2026-05-15',
    action_route: '/budgets',
    metadata_json: {
      budgetId: BUDGET_ID,
      period: '2026-05',
      limitPaise: 1_000_000,
      spentPaise: 850_000,
      utilizationPercentage: 85
    },
    read_at: null,
    dismissed_at: null,
    version: 1,
    created_at: '2026-05-15T08:00:00.000Z',
    updated_at: '2026-05-15T08:00:00.000Z',
    deleted_at: null,
    ...overrides
  };
}

function createInMemorySupabaseClient() {
  const notifications = new Map<string, CloudNotificationRow>();
  const preferences = new Map<string, CloudNotificationPreferenceRow>();

  return {
    notifications,
    preferences,
    from: (table: string) => {
      if (table === 'notifications') {
        return {
          insert: (row: CloudNotificationRow) => ({
            select: () => ({
              single: async () => {
                if (notifications.has(row.id)) {
                  return {
                    data: null,
                    error: { code: '23505', message: 'duplicate key value violates unique constraint' }
                  };
                }
                const dupDedupe = Array.from(notifications.values()).find(
                  (n) => n.user_id === row.user_id && n.dedupe_key === row.dedupe_key
                );
                if (dupDedupe) {
                  return {
                    data: null,
                    error: { code: '23505', message: 'duplicate user_id + dedupe_key constraint' }
                  };
                }
                notifications.set(row.id, { ...row });
                return { data: { ...row }, error: null };
              }
            })
          }),
          update: (patch: Partial<CloudNotificationRow>) => {
            const filters: Array<(row: CloudNotificationRow) => boolean> = [];
            const builder = {
              eq: (col: keyof CloudNotificationRow, val: unknown) => {
                filters.push((r) => r[col] === val);
                return builder;
              },
              is: (col: keyof CloudNotificationRow, val: unknown) => {
                filters.push((r) => (r[col] ?? null) === val);
                return builder;
              },
              select: () => ({
                maybeSingle: async () => {
                  const matched = Array.from(notifications.values()).find((r) =>
                    filters.every((fn) => fn(r))
                  );
                  if (!matched) {
                    return { data: null, error: null };
                  }
                  const updated = { ...matched, ...patch };
                  notifications.set(matched.id, updated);
                  return { data: { ...updated }, error: null };
                }
              })
            };
            return builder;
          },
          select: (_cols: string) => {
            const filters: Array<(row: CloudNotificationRow) => boolean> = [];
            const builder = {
              eq: (col: keyof CloudNotificationRow, val: unknown) => {
                filters.push((r) => r[col] === val);
                return builder;
              },
              is: (col: keyof CloudNotificationRow, val: unknown) => {
                filters.push((r) => (r[col] ?? null) === val);
                return builder;
              },
              order: async () => ({
                data: Array.from(notifications.values())
                  .filter((r) => filters.every((fn) => fn(r)))
                  .map((r) => ({ ...r })),
                error: null
              }),
              maybeSingle: async () => {
                const found = Array.from(notifications.values()).find((r) =>
                  filters.every((fn) => fn(r))
                );
                return { data: found ? { ...found } : null, error: null };
              }
            };
            return builder;
          }
        };
      }

      if (table === 'notification_preferences') {
        return {
          insert: (row: CloudNotificationPreferenceRow) => ({
            select: () => ({
              single: async () => {
                if (preferences.has(row.user_id)) {
                  return {
                    data: null,
                    error: { code: '23505', message: 'duplicate primary key user_id' }
                  };
                }
                preferences.set(row.user_id, { ...row });
                return { data: { ...row }, error: null };
              }
            })
          }),
          update: (patch: Partial<CloudNotificationPreferenceRow>) => {
            const filters: Array<(row: CloudNotificationPreferenceRow) => boolean> = [];
            const builder = {
              eq: (col: keyof CloudNotificationPreferenceRow, val: unknown) => {
                filters.push((r) => r[col] === val);
                return builder;
              },
              select: () => ({
                maybeSingle: async () => {
                  const matched = Array.from(preferences.values()).find((r) =>
                    filters.every((fn) => fn(r))
                  );
                  if (!matched) {
                    return { data: null, error: null };
                  }
                  const updated = { ...matched, ...patch };
                  preferences.set(matched.user_id, updated);
                  return { data: { ...updated }, error: null };
                }
              })
            };
            return builder;
          },
          select: (_cols: string) => {
            const filters: Array<(row: CloudNotificationPreferenceRow) => boolean> = [];
            const builder = {
              eq: (col: keyof CloudNotificationPreferenceRow, val: unknown) => {
                filters.push((r) => r[col] === val);
                return builder;
              },
              maybeSingle: async () => {
                const found = Array.from(preferences.values()).find((r) =>
                  filters.every((fn) => fn(r))
                );
                return { data: found ? { ...found } : null, error: null };
              }
            };
            return builder;
          }
        };
      }

      throw new Error(`Unexpected table ${table}`);
    }
  };
}

class MockReconciliationDexieDB {
  public notificationsStorage = new Map<string, LocalNotificationRecord>();
  public preferencesStorage = new Map<string, LocalNotificationPreferenceRecord>();
  public outboxStorage: LocalOutboxRecord[] = [];

  public transaction = vi.fn(
    async <T>(_mode: string, _tables: unknown, scope: () => Promise<T>): Promise<T> => scope()
  );

  public notifications = {
    name: 'notifications',
    where: (index: string) => ({
      equals: (userId: string) => ({
        toArray: async () =>
          index === 'userId'
            ? Array.from(this.notificationsStorage.values()).filter((n) => n.userId === userId)
            : []
      })
    }),
    put: async (record: LocalNotificationRecord) => {
      this.notificationsStorage.set(record.id, { ...record });
      return record.id;
    }
  };

  public notificationPreferences = {
    name: 'notificationPreferences',
    get: async (userId: string) => this.preferencesStorage.get(userId) ?? null,
    put: async (record: LocalNotificationPreferenceRecord) => {
      this.preferencesStorage.set(record.userId, { ...record });
      return record.userId;
    }
  };

  public syncOutbox = {
    name: 'syncOutbox',
    where: (index: string) => ({
      equals: (userId: string) => ({
        toArray: async () =>
          index === 'userId'
            ? this.outboxStorage.filter((o) => o.userId === userId)
            : []
      })
    })
  };
}

describe('Phase 9 Stage 4: Cloud Mappers, Repositories & Bidirectional Sync', () => {
  let mockClient: ReturnType<typeof createInMemorySupabaseClient>;
  let notificationRepo: SupabaseNotificationRepository;
  let preferenceRepo: SupabaseNotificationPreferenceRepository;
  let authPort: AuthPort;
  let outboxEntries: LocalOutboxRecord[];
  let outboxManager: OutboxManager;

  beforeEach(() => {
    mockClient = createInMemorySupabaseClient();
    notificationRepo = new SupabaseNotificationRepository(mockClient as any);
    preferenceRepo = new SupabaseNotificationPreferenceRepository(mockClient as any);
    outboxEntries = [];

    authPort = {
      getCurrentUser: vi.fn(async () => ({
        id: USER_A,
        email: 'user@example.com',
        isAuthenticated: true
      })),
      getCurrentSession: vi.fn(async () => null),
      signOut: vi.fn(async () => {}),
      onAuthStateChange: vi.fn(() => () => {})
    } as unknown as AuthPort;

    outboxManager = {
      getPendingEntries: vi.fn(async (userId: string) =>
        outboxEntries.filter((e) => e.userId === userId)
      ),
      getPendingCount: vi.fn(async (userId: string) =>
        outboxEntries.filter((e) => e.userId === userId).length
      ),
      markSuccess: vi.fn(async (id: number) => {
        outboxEntries = outboxEntries.filter((e) => e.id !== id);
      }),
      markFailure: vi.fn(async (id: number, error: string) => {
        const found = outboxEntries.find((e) => e.id === id);
        if (found) {
          found.attempts += 1;
          found.lastError = error;
        }
      })
    } as unknown as OutboxManager;
  });

  it('maps notification and preference rows cleanly while rejecting malformed or float paise records', async () => {
    const id = await deriveDeterministicNotificationId(
      USER_A,
      buildBudgetNotificationDedupeKey(BUDGET_ID, '2026-05')
    );

    const cloudRow = createMockCloudNotification({ id });
    const domain = NotificationRowMapper.toDomain(cloudRow);
    const roundTripped = NotificationRowMapper.toCloud(domain);
    const localRec = NotificationRowMapper.toLocalRecord(roundTripped);

    expect(localRec.id).toBe(id);
    expect(localRec.status).toBe('unread');
    expect(JSON.parse(localRec.metadataJson).limitPaise).toBe(1_000_000);

    expect(() =>
      NotificationRowMapper.validateCloudRow({
        ...cloudRow,
        metadata_json: { limitPaise: 123.45 }
      })
    ).toThrow();

    expect(() =>
      NotificationRowMapper.validateCloudRow({
        ...cloudRow,
        trigger_date: '2026-02-29'
      })
    ).toThrow();

    const prefRow: CloudNotificationPreferenceRow = {
      user_id: USER_A,
      recurring_payment_enabled: true,
      budget_warning_enabled: false,
      budget_exceeded_enabled: true,
      upcoming_lead_days: 5,
      version: 1,
      created_at: '2026-05-01T00:00:00.000Z',
      updated_at: '2026-05-01T00:00:00.000Z'
    };
    const prefDomain = NotificationPreferenceRowMapper.toDomain(prefRow);
    expect(NotificationPreferenceRowMapper.toCloud(prefDomain)).toEqual(prefRow);

    expect(() =>
      NotificationPreferenceRowMapper.validateCloudRow({
        ...prefRow,
        upcoming_lead_days: 31
      })
    ).toThrow();
  });

  it('reconciles duplicate deterministic notification INSERTs without overwriting read/dismissed state and rejects incompatible conflicts', async () => {
    const dedupeKey = buildBudgetNotificationDedupeKey(BUDGET_ID, '2026-05');
    const id = await deriveDeterministicNotificationId(USER_A, dedupeKey);

    // Cloud already has the notification marked READ at v2
    const remoteRead = createMockCloudNotification({
      id,
      status: 'read',
      read_at: '2026-05-15T10:00:00.000Z',
      version: 2
    });
    mockClient.notifications.set(id, remoteRead);

    // Device B offline created the same deterministic notification as UNREAD v1
    const localInsert = createMockCloudNotification({
      id,
      status: 'unread',
      version: 1
    });
    const reconciled = await notificationRepo.insert(localInsert);
    expect(reconciled.status).toBe('read');
    expect(reconciled.read_at).toBe('2026-05-15T10:00:00.000Z');
    expect(reconciled.version).toBe(2);

    // If local INSERT also brings higher urgency (budget_exceeded), remote upgrades monotonically while staying READ
    const localExceededInsert = createMockCloudNotification({
      id,
      category: 'budget_exceeded',
      severity: 'critical',
      title: 'Budget exceeded: Food',
      message: 'Food exceeded its budget.',
      status: 'unread',
      version: 1
    });
    const escalated = await notificationRepo.insert(localExceededInsert);
    expect(escalated.category).toBe('budget_exceeded');
    expect(escalated.severity).toBe('critical');
    expect(escalated.status).toBe('read');
    expect(escalated.read_at).toBe('2026-05-15T10:00:00.000Z');
    expect(escalated.version).toBe(3);

    // Same dedupe_key with DIFFERENT ID must throw SyncConflictError
    const conflictingIdInsert = createMockCloudNotification({
      id: '99999999-9999-4999-8999-999999999999',
      dedupe_key: dedupeKey,
      entity_id: OTHER_BUDGET_ID
    });
    await expect(notificationRepo.insert(conflictingIdInsert)).rejects.toThrow(SyncConflictError);
  });

  it('enforces OCC version checks, exact idempotent retries, and divergence conflicts on UPDATE', async () => {
    const id = await deriveDeterministicNotificationId(
      USER_A,
      buildBudgetNotificationDedupeKey(BUDGET_ID, '2026-05')
    );
    await notificationRepo.insert(createMockCloudNotification({ id }));

    const updated = await notificationRepo.updatePartial(
      id,
      USER_A,
      {
        status: 'read',
        read_at: '2026-05-15T12:00:00.000Z',
        version: 2,
        updated_at: '2026-05-15T12:00:00.000Z'
      },
      1
    );
    expect(updated.version).toBe(2);
    expect(updated.status).toBe('read');

    // Exact idempotent retry of v1->v2 succeeds
    const retried = await notificationRepo.updatePartial(
      id,
      USER_A,
      {
        status: 'read',
        read_at: '2026-05-15T12:00:00.000Z',
        version: 2,
        updated_at: '2026-05-15T12:00:00.000Z'
      },
      1
    );
    expect(retried.version).toBe(2);

    // Divergent update at stale expectedVersion=1 throws SyncConflictError
    await expect(
      notificationRepo.updatePartial(
        id,
        USER_A,
        {
          category: 'budget_exceeded',
          severity: 'critical',
          version: 2
        },
        1
      )
    ).rejects.toThrow(SyncConflictError);
  });

  it('synchronizes preference INSERT and UPDATE cleanly and returns null without side effects when missing', async () => {
    expect(await preferenceRepo.findByUserId(USER_A)).toBeNull();

    const prefInsertEntry: LocalOutboxRecord = {
      id: 10,
      userId: USER_A,
      entity: 'notification_preferences',
      entityId: USER_A,
      operation: 'INSERT',
      payload: {
        user_id: USER_A,
        recurring_payment_enabled: true,
        budget_warning_enabled: true,
        budget_exceeded_enabled: true,
        upcoming_lead_days: 3,
        version: 1,
        created_at: '2026-05-01T00:00:00.000Z',
        updated_at: '2026-05-01T00:00:00.000Z'
      },
      idempotencyKey: 'pref-1',
      attempts: 0,
      createdAt: '2026-05-01T00:00:00.000Z'
    };

    const dispatcher = new NotificationPreferenceSyncDispatcher(
      preferenceRepo,
      authPort,
      outboxManager
    );
    await dispatcher.dispatch(prefInsertEntry);
    expect((await preferenceRepo.findByUserId(USER_A))?.upcoming_lead_days).toBe(3);

    await dispatcher.dispatch({
      id: 11,
      userId: USER_A,
      entity: 'notification_preferences',
      entityId: USER_A,
      operation: 'UPDATE',
      payload: {
        user_id: USER_A,
        upcoming_lead_days: 7,
        budget_warning_enabled: false,
        expected_version: 1,
        version: 2,
        updated_at: '2026-05-02T00:00:00.000Z'
      },
      idempotencyKey: 'pref-2',
      attempts: 0,
      createdAt: '2026-05-02T00:00:00.000Z'
    });

    const cloudPref = await preferenceRepo.findByUserId(USER_A);
    expect(cloudPref?.upcoming_lead_days).toBe(7);
    expect(cloudPref?.budget_warning_enabled).toBe(false);
    expect(cloudPref?.version).toBe(2);

    // Cross-user spoofed outbox entry rejected
    await expect(
      dispatcher.dispatch({
        ...prefInsertEntry,
        id: 12,
        entityId: USER_B,
        payload: { ...prefInsertEntry.payload, user_id: USER_B }
      })
    ).rejects.toThrow(SyncAuthError);
  });

  it('reconciles remote notifications and preferences safely into Dexie while protecting pending changes and monotonic state', async () => {
    const db = new MockReconciliationDexieDB();
    const idRemoteNew = await deriveDeterministicNotificationId(
      USER_A,
      buildBudgetNotificationDedupeKey(BUDGET_ID, '2026-05')
    );
    const idPendingLocal = await deriveDeterministicNotificationId(
      USER_A,
      buildBudgetNotificationDedupeKey(OTHER_BUDGET_ID, '2026-05')
    );

    // Remote has new budget_exceeded + pending local alert + non-monotonic downgrade test
    mockClient.notifications.set(
      idRemoteNew,
      createMockCloudNotification({
        id: idRemoteNew,
        category: 'budget_exceeded',
        severity: 'critical',
        title: 'Budget exceeded: Food',
        message: 'Spent 110%',
        status: 'read',
        read_at: '2026-05-16T08:00:00.000Z',
        version: 2
      })
    );
    mockClient.notifications.set(
      idPendingLocal,
      createMockCloudNotification({
        id: idPendingLocal,
        dedupe_key: buildBudgetNotificationDedupeKey(OTHER_BUDGET_ID, '2026-05'),
        entity_id: OTHER_BUDGET_ID,
        status: 'unread',
        version: 3
      })
    );

    // Local has pending local dismissal for idPendingLocal
    db.notificationsStorage.set(idPendingLocal, {
      id: idPendingLocal,
      userId: USER_A,
      category: 'budget_warning',
      severity: 'warning',
      status: 'dismissed',
      dedupeKey: buildBudgetNotificationDedupeKey(OTHER_BUDGET_ID, '2026-05'),
      title: 'Budget warning',
      message: '85% used',
      entityType: 'budget',
      entityId: OTHER_BUDGET_ID,
      triggerDate: '2026-05-15',
      actionRoute: '/budgets',
      metadataJson: '{}',
      dismissedAt: '2026-05-16T09:00:00.000Z',
      version: 2,
      createdAt: '2026-05-15T08:00:00.000Z',
      updatedAt: '2026-05-16T09:00:00.000Z'
    });
    db.outboxStorage.push({
      id: 99,
      userId: USER_A,
      entity: 'notifications',
      entityId: idPendingLocal,
      operation: 'UPDATE',
      payload: {
        id: idPendingLocal,
        user_id: USER_A,
        dedupe_key: buildBudgetNotificationDedupeKey(OTHER_BUDGET_ID, '2026-05'),
        status: 'dismissed',
        version: 2
      },
      idempotencyKey: 'pending-1',
      attempts: 0,
      createdAt: '2026-05-16T09:00:00.000Z'
    });

    const reconciler = new NotificationReconciliationService(
      db as unknown as LaxmiLensDB,
      notificationRepo,
      preferenceRepo,
      authPort
    );

    // Missing remote preferences must NOT create an implicit local row
    const pull1 = await reconciler.pullAndReconcile(USER_A);
    expect(pull1.pulledCount).toBe(1);
    expect(db.preferencesStorage.size).toBe(0);
    expect(db.notificationsStorage.get(idRemoteNew)?.category).toBe('budget_exceeded');
    expect(db.notificationsStorage.get(idRemoteNew)?.status).toBe('read');
    // Pending local dismissed record was protected
    expect(db.notificationsStorage.get(idPendingLocal)?.status).toBe('dismissed');
    expect(db.notificationsStorage.get(idPendingLocal)?.version).toBe(2);

    // Even if outbox cleared, a non-monotonic remote row trying to revert dismissed -> unread is rejected as conflict
    db.outboxStorage = [];
    const pull2 = await reconciler.pullAndReconcile(USER_A);
    expect(pull2.conflictCount).toBe(1);
    expect(db.notificationsStorage.get(idPendingLocal)?.status).toBe('dismissed');

    // Reconcile when remote preferences appear
    mockClient.preferences.set(USER_A, {
      user_id: USER_A,
      recurring_payment_enabled: false,
      budget_warning_enabled: true,
      budget_exceeded_enabled: true,
      upcoming_lead_days: 5,
      version: 1,
      created_at: '2026-05-01T00:00:00.000Z',
      updated_at: '2026-05-01T00:00:00.000Z'
    });
    await reconciler.pullAndReconcile(USER_A);
    expect(db.preferencesStorage.get(USER_A)?.recurringPaymentEnabled).toBe(false);
    expect(db.preferencesStorage.get(USER_A)?.upcomingLeadDays).toBe(5);
  });

  it('integrates notifications & preferences into ManualSyncCoordinator without interfering with financial sync stages', async () => {
    const order: string[] = [];
    const db = new MockReconciliationDexieDB();
    const id1 = await deriveDeterministicNotificationId(
      USER_A,
      buildBudgetNotificationDedupeKey(BUDGET_ID, '2026-05')
    );

    const accDispatcher = {
      dispatch: vi.fn(async (entry: LocalOutboxRecord) => {
        order.push('account');
        if (typeof entry.id === 'number') await outboxManager.markSuccess(entry.id);
      })
    } as unknown as AccountSyncDispatcher;

    const txDispatcher = {
      dispatch: vi.fn(async (entry: LocalOutboxRecord) => {
        order.push('transaction');
        if (typeof entry.id === 'number') await outboxManager.markSuccess(entry.id);
      })
    } as unknown as TransactionSyncDispatcher;

    const notifDispatcher = new NotificationSyncDispatcher(
      notificationRepo,
      authPort,
      outboxManager
    );
    const prefDispatcher = new NotificationPreferenceSyncDispatcher(
      preferenceRepo,
      authPort,
      outboxManager
    );
    const reconciler = new NotificationReconciliationService(
      db as unknown as LaxmiLensDB,
      notificationRepo,
      preferenceRepo,
      authPort
    );

    outboxEntries = [
      {
        id: 1,
        userId: USER_A,
        entity: 'notifications',
        entityId: id1,
        operation: 'INSERT',
        payload: {
          ...createMockCloudNotification({ id: id1 })
        },
        idempotencyKey: 'n1',
        attempts: 0,
        createdAt: '2026-05-15T08:00:00.000Z'
      },
      {
        id: 2,
        userId: USER_A,
        entity: 'accounts',
        entityId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        operation: 'INSERT',
        payload: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', user_id: USER_A },
        idempotencyKey: 'a1',
        attempts: 0,
        createdAt: '2026-05-15T08:00:00.000Z'
      },
      {
        id: 3,
        userId: USER_A,
        entity: 'notification_preferences',
        entityId: USER_A,
        operation: 'INSERT',
        payload: {
          user_id: USER_A,
          recurring_payment_enabled: true,
          budget_warning_enabled: true,
          budget_exceeded_enabled: true,
          upcoming_lead_days: 3,
          version: 1,
          created_at: '2026-05-15T08:00:00.000Z',
          updated_at: '2026-05-15T08:00:00.000Z'
        },
        idempotencyKey: 'p1',
        attempts: 0,
        createdAt: '2026-05-15T08:00:00.000Z'
      }
    ];

    const coordinator = new ManualSyncCoordinator(
      accDispatcher,
      txDispatcher,
      outboxManager,
      authPort,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      notifDispatcher,
      prefDispatcher,
      reconciler
    );

    const res = await coordinator.run();
    expect(order).toEqual(['account']);
    expect(res.accounts.syncedCount).toBe(1);
    expect(res.notifications?.syncedCount).toBe(1);
    expect(res.notification_preferences?.syncedCount).toBe(1);
    expect(res.stillPendingCount).toBe(0);
    expect(mockClient.notifications.has(id1)).toBe(true);
    expect(mockClient.preferences.has(USER_A)).toBe(true);
    expect(db.notificationsStorage.size).toBe(1);
    expect(db.preferencesStorage.size).toBe(1);
    expect(db.outboxStorage.length).toBe(0);
  });

  it('isolates notification sync failures from financial push stages and blocks cross-user reconciliation records', async () => {
    const dbUserA = new MockReconciliationDexieDB();
    const dbUserB = new MockReconciliationDexieDB();
    const id1 = await deriveDeterministicNotificationId(
      USER_A,
      buildBudgetNotificationDedupeKey(BUDGET_ID, '2026-05')
    );

    // Pre-insert conflicting tombstoned record remotely so notification INSERT fails
    mockClient.notifications.set(
      id1,
      createMockCloudNotification({
        id: id1,
        deleted_at: '2026-05-14T00:00:00.000Z'
      })
    );

    const accDispatcher = {
      dispatch: vi.fn(async (entry: LocalOutboxRecord) => {
        if (typeof entry.id === 'number') await outboxManager.markSuccess(entry.id);
      })
    } as unknown as AccountSyncDispatcher;
    const txDispatcher = {
      dispatch: vi.fn(async () => {})
    } as unknown as TransactionSyncDispatcher;

    const notifDispatcher = new NotificationSyncDispatcher(
      notificationRepo,
      authPort,
      outboxManager
    );
    const reconcilerA = new NotificationReconciliationService(
      dbUserA as unknown as LaxmiLensDB,
      notificationRepo,
      preferenceRepo,
      authPort
    );

    outboxEntries = [
      {
        id: 1,
        userId: USER_A,
        entity: 'accounts',
        entityId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        operation: 'INSERT',
        payload: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', user_id: USER_A },
        idempotencyKey: 'a-ok',
        attempts: 0,
        createdAt: '2026-05-15T08:00:00.000Z'
      },
      {
        id: 2,
        userId: USER_A,
        entity: 'notifications',
        entityId: id1,
        operation: 'INSERT',
        payload: { ...createMockCloudNotification({ id: id1 }) },
        idempotencyKey: 'n-fail',
        attempts: 0,
        createdAt: '2026-05-15T08:00:00.000Z'
      }
    ];

    const coordinator = new ManualSyncCoordinator(
      accDispatcher,
      txDispatcher,
      outboxManager,
      authPort,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      notifDispatcher,
      undefined,
      reconcilerA
    );

    const res = await coordinator.run();
    // Account push succeeded cleanly while notification INSERT failed safely without blocking accounts
    expect(res.accounts.syncedCount).toBe(1);
    expect(res.notifications?.failedCount).toBe(1);
    expect(res.notifications?.conflictCount).toBe(1);
    expect(dbUserB.notificationsStorage.size).toBe(0);

    // Cross-user safeguard: requesting another userId during pull throws SyncAuthError
    await expect(reconcilerA.pullAndReconcile(USER_B)).rejects.toThrow(SyncAuthError);
  });
});

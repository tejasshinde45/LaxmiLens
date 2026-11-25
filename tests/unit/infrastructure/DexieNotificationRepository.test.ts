import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LaxmiLensDB } from '@/infrastructure/database/local/DexieDatabase';
import { DexieUnitOfWork } from '@/infrastructure/database/local/DexieUnitOfWork';
import { DexieNotificationRepository } from '@/infrastructure/database/local/repositories/DexieNotificationRepository';
import { DexieNotificationPreferenceRepository } from '@/infrastructure/database/local/repositories/DexieNotificationPreferenceRepository';
import { Notification } from '@/domain/entities/Notification';
import { NotificationPreference } from '@/domain/entities/NotificationPreference';
import { DuplicateNotificationError } from '@/domain/errors/NotificationErrors';
import { UnauthorizedDatabaseAccessError } from '@/infrastructure/database/local/errors/DatabaseErrors';
import { deriveDeterministicNotificationId } from '@/domain/services/NotificationIdentityService';
import {
  LocalNotificationPreferenceRecord,
  LocalNotificationRecord
} from '@/infrastructure/database/local/schema';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const RULE_ID = '33333333-3333-4333-8333-333333333333';

class MockNotificationDexieDB {
  public notificationsStorage = new Map<string, LocalNotificationRecord>();
  public preferencesStorage = new Map<string, LocalNotificationPreferenceRecord>();
  private txTail: Promise<void> = Promise.resolve();

  public transaction = vi.fn(
    async <T>(_mode: string, _tables: unknown, scope: () => Promise<T>): Promise<T> => {
      const prev = this.txTail;
      let release!: () => void;
      this.txTail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await prev;
      try {
        return await scope();
      } finally {
        release();
      }
    }
  );

  public notifications = {
    name: 'notifications',
    get: vi.fn(async (id: string) => this.notificationsStorage.get(id) ?? null),
    put: vi.fn(async (record: LocalNotificationRecord) => {
      await Promise.resolve();
      this.notificationsStorage.set(record.id, { ...record });
      return record.id;
    }),
    bulkPut: vi.fn(async (records: LocalNotificationRecord[]) => {
      await Promise.resolve();
      for (const record of records) {
        this.notificationsStorage.set(record.id, { ...record });
      }
    }),
    where: vi.fn((index: string) => ({
      equals: (arg: unknown) => {
        const all = Array.from(this.notificationsStorage.values());
        if (index === 'userId') {
          const uId = arg as string;
          return {
            toArray: vi.fn(async () => all.filter((r) => r.userId === uId))
          };
        }
        if (index === '[userId+dedupeKey]') {
          const [uId, dedupeKey] = arg as [string, string];
          return {
            toArray: vi.fn(async () =>
              all.filter((r) => r.userId === uId && r.dedupeKey === dedupeKey)
            )
          };
        }
        if (index === '[userId+status]') {
          const [uId, status] = arg as [string, string];
          const matching = all.filter((r) => r.userId === uId && r.status === status);
          return {
            filter: (predicate: (r: LocalNotificationRecord) => boolean) => ({
              count: vi.fn(async () => matching.filter(predicate).length)
            })
          };
        }
        return { toArray: vi.fn(async () => []) };
      }
    }))
  };

  public notificationPreferences = {
    name: 'notificationPreferences',
    get: vi.fn(async (userId: string) => this.preferencesStorage.get(userId) ?? null),
    put: vi.fn(async (record: LocalNotificationPreferenceRecord) => {
      await Promise.resolve();
      this.preferencesStorage.set(record.userId, { ...record });
      return record.userId;
    })
  };
}

describe('Dexie Notification Persistence & Schema v8', () => {
  let mockDb: MockNotificationDexieDB;
  let notificationRepo: DexieNotificationRepository;
  let preferenceRepo: DexieNotificationPreferenceRepository;

  beforeEach(() => {
    mockDb = new MockNotificationDexieDB();
    notificationRepo = new DexieNotificationRepository(mockDb as unknown as LaxmiLensDB);
    preferenceRepo = new DexieNotificationPreferenceRepository(mockDb as unknown as LaxmiLensDB);
  });

  it('registers Dexie schema version 8 non-destructively while retaining existing financial stores', () => {
    const db = new LaxmiLensDB('LaxmiLensDB_Test_v8');
    const latestVersion = db.verno;
    expect(latestVersion).toBe(8);

    const storeNames = db.tables.map((t) => t.name);
    expect(storeNames).toContain('accounts');
    expect(storeNames).toContain('transactions');
    expect(storeNames).toContain('budgets');
    expect(storeNames).toContain('recurringRules');
    expect(storeNames).toContain('recurringOccurrences');
    expect(storeNames).toContain('syncOutbox');
    expect(storeNames).toContain('notifications');
    expect(storeNames).toContain('notificationPreferences');

    const unitOfWork = new DexieUnitOfWork(db) as unknown as {
      tables: Array<{ name: string }>;
    };
    const uowNames = unitOfWork.tables.map((t) => t.name);
    expect(uowNames).toContain('notifications');
    expect(uowNames).toContain('notificationPreferences');
    expect(uowNames).toContain('syncOutbox');
  });

  it('enforces (userId, dedupeKey) uniqueness inside rw transactions', async () => {
    const dedupeKey = `recurring_payment:${RULE_ID}:2026-05-10`;
    const deterministicId = await deriveDeterministicNotificationId(USER_A, dedupeKey);

    const first = new Notification({
      id: deterministicId,
      userId: USER_A,
      category: 'recurring_payment',
      severity: 'info',
      status: 'unread',
      dedupeKey,
      title: 'Upcoming rent',
      message: 'Rent due soon',
      entityType: 'recurring_rule',
      entityId: RULE_ID,
      triggerDate: '2026-05-10',
      actionRoute: '/recurring',
      version: 1,
      createdAt: '2026-05-08T00:00:00.000Z',
      updatedAt: '2026-05-08T00:00:00.000Z'
    });

    await notificationRepo.save(first);

    // Updating same ID + same dedupeKey succeeds
    const promoted = first.promoteAlert({
      category: 'recurring_payment',
      severity: 'warning',
      title: 'Rent due today',
      message: 'Rent due today',
      entityType: 'recurring_rule',
      entityId: RULE_ID,
      triggerDate: '2026-05-10',
      actionRoute: '/recurring'
    }).notification;
    await notificationRepo.save(promoted);

    // Inserting a different ID with the same (userId, dedupeKey) fails atomically
    const duplicateWithOtherId = new Notification({
      ...first.toProps(),
      id: '99999999-9999-4999-8999-999999999999'
    });
    await expect(notificationRepo.save(duplicateWithOtherId)).rejects.toThrow(
      DuplicateNotificationError
    );
  });

  it('enforces cross-user access isolation and counts unread accurately', async () => {
    const idA = await deriveDeterministicNotificationId(USER_A, 'budget_alert:b1:2026-05');
    const notifA = new Notification({
      id: idA,
      userId: USER_A,
      category: 'budget_warning',
      severity: 'warning',
      status: 'unread',
      dedupeKey: 'budget_alert:b1:2026-05',
      title: 'Budget warning',
      message: '85% used',
      entityType: 'budget',
      entityId: '44444444-4444-4444-8444-444444444444',
      triggerDate: '2026-05-12',
      actionRoute: '/budgets',
      version: 1,
      createdAt: '2026-05-12T00:00:00.000Z',
      updatedAt: '2026-05-12T00:00:00.000Z'
    });

    await notificationRepo.save(notifA);
    expect(await notificationRepo.countUnread(USER_A)).toBe(1);
    expect(await notificationRepo.countUnread(USER_B)).toBe(0);

    await expect(notificationRepo.findById(idA, USER_B)).rejects.toThrow(
      UnauthorizedDatabaseAccessError
    );

    const readA = notifA.markAsRead('2026-05-12T01:00:00.000Z');
    await notificationRepo.save(readA);
    expect(await notificationRepo.countUnread(USER_A)).toBe(0);
  });

  it('returns null without writing when notification preferences are absent', async () => {
    const missing = await preferenceRepo.findByUserId(USER_A);
    expect(missing).toBeNull();
    expect(mockDb.preferencesStorage.size).toBe(0);

    const savedPref = NotificationPreference.createDefault(USER_A).update({
      upcomingLeadDays: 5,
      budgetWarningEnabled: false
    });
    await preferenceRepo.save(savedPref);

    const loaded = await preferenceRepo.findByUserId(USER_A);
    expect(loaded?.upcomingLeadDays).toBe(5);
    expect(loaded?.budgetWarningEnabled).toBe(false);
  });
});

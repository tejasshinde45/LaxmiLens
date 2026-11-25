import { describe, it, expect } from 'vitest';
import { Notification } from '@/domain/entities/Notification';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NotificationPreference
} from '@/domain/entities/NotificationPreference';
import {
  InvalidNotificationError,
  InvalidNotificationPreferenceError
} from '@/domain/errors/NotificationErrors';
import {
  buildBudgetNotificationDedupeKey,
  buildRecurringNotificationDedupeKey,
  compareNotificationSeverity,
  deriveDeterministicNotificationId,
  isCompatibleNotificationCategoryProgression
} from '@/domain/services/NotificationIdentityService';
import { isValidUuid } from '@/domain/value-objects/Identifiers';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const RULE_ID = '33333333-3333-4333-8333-333333333333';
const BUDGET_ID = '44444444-4444-4444-8444-444444444444';

describe('Notification Domain & Identity', () => {
  describe('NotificationIdentityService (SHA-256 deterministic UUIDs)', () => {
    it('builds one stable dedupe key per recurring rule and occurrence date', () => {
      const key1 = buildRecurringNotificationDedupeKey(RULE_ID, '2026-05-10');
      const key2 = buildRecurringNotificationDedupeKey(` ${RULE_ID} `, '2026-05-10');
      expect(key1).toBe(`recurring_payment:${RULE_ID}:2026-05-10`);
      expect(key1).toBe(key2);

      expect(() => buildRecurringNotificationDedupeKey('', '2026-05-10')).toThrow(
        InvalidNotificationError
      );
      expect(() => buildRecurringNotificationDedupeKey(RULE_ID, '2026-02-30')).toThrow(
        InvalidNotificationError
      );
    });

    it('builds one stable dedupe key per budget and period', () => {
      const key = buildBudgetNotificationDedupeKey(BUDGET_ID, '2026-05');
      expect(key).toBe(`budget_alert:${BUDGET_ID}:2026-05`);

      expect(() => buildBudgetNotificationDedupeKey(BUDGET_ID, '2026-13')).toThrow(
        InvalidNotificationError
      );
    });

    it('derives deterministic RFC 9562 version 8 SHA-256 UUIDs invariant across invocations', async () => {
      const dedupeKey = buildRecurringNotificationDedupeKey(RULE_ID, '2026-05-10');
      const id1 = await deriveDeterministicNotificationId(USER_A, dedupeKey);
      const id2 = await deriveDeterministicNotificationId(USER_A.toUpperCase(), dedupeKey);
      const id3 = await deriveDeterministicNotificationId(USER_A, ` ${dedupeKey} `);

      expect(id1).toBe(id2);
      expect(id1).toBe(id3);
      expect(isValidUuid(id1)).toBe(true);
      expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      // RFC 9562 version 8 nibble and RFC variant bits (10xxxxxx -> 8, 9, a, or b)
      expect(id1[14]).toBe('8');
      expect(['8', '9', 'a', 'b']).toContain(id1[19]);
      expect(parseInt(id1[19]!, 16) & 0xc).toBe(0x8);
    });

    it('produces distinct UUIDs across different users and different dedupe keys', async () => {
      const recurringKeyA = buildRecurringNotificationDedupeKey(RULE_ID, '2026-05-10');
      const recurringKeyB = buildRecurringNotificationDedupeKey(RULE_ID, '2026-06-10');
      const budgetKey = buildBudgetNotificationDedupeKey(BUDGET_ID, '2026-05');

      const idUserA = await deriveDeterministicNotificationId(USER_A, recurringKeyA);
      const idUserB = await deriveDeterministicNotificationId(USER_B, recurringKeyA);
      const idOtherDate = await deriveDeterministicNotificationId(USER_A, recurringKeyB);
      const idBudget = await deriveDeterministicNotificationId(USER_A, budgetKey);

      expect(new Set([idUserA, idUserB, idOtherDate, idBudget]).size).toBe(4);
    });

    it('enforces severity ordering and monotonic category progression rules', () => {
      expect(compareNotificationSeverity('info', 'warning')).toBeLessThan(0);
      expect(compareNotificationSeverity('warning', 'critical')).toBeLessThan(0);
      expect(compareNotificationSeverity('critical', 'info')).toBeGreaterThan(0);

      expect(isCompatibleNotificationCategoryProgression('budget_warning', 'budget_exceeded')).toBe(
        true
      );
      expect(isCompatibleNotificationCategoryProgression('budget_exceeded', 'budget_warning')).toBe(
        false
      );
      expect(
        isCompatibleNotificationCategoryProgression('recurring_payment', 'budget_exceeded')
      ).toBe(false);
    });
  });

  describe('Notification entity monotonic promotion & validation', () => {
    it('promotes recurring severity info -> warning -> critical while keeping identity and timestamps', async () => {
      const dedupeKey = buildRecurringNotificationDedupeKey(RULE_ID, '2026-05-10');
      const id = await deriveDeterministicNotificationId(USER_A, dedupeKey);

      const initial = new Notification({
        id,
        userId: USER_A,
        category: 'recurring_payment',
        severity: 'info',
        status: 'unread',
        dedupeKey,
        title: 'Upcoming payment: Internet',
        message: 'Internet is due in 2 days.',
        entityType: 'recurring_rule',
        entityId: RULE_ID,
        triggerDate: '2026-05-10',
        actionRoute: '/recurring',
        metadata: { recurringRuleId: RULE_ID, occurrenceDate: '2026-05-10', amountPaise: 99900 },
        version: 1,
        createdAt: '2026-05-08T08:00:00.000Z',
        updatedAt: '2026-05-08T08:00:00.000Z'
      });

      const { notification: dueToday, changed: c1 } = initial.promoteAlert({
        category: 'recurring_payment',
        severity: 'warning',
        title: 'Payment due today: Internet',
        message: 'Internet is due today.',
        entityType: 'recurring_rule',
        entityId: RULE_ID,
        triggerDate: '2026-05-10',
        actionRoute: '/recurring',
        metadata: { recurringRuleId: RULE_ID, occurrenceDate: '2026-05-10', amountPaise: 99900 },
        now: '2026-05-10T08:00:00.000Z'
      });

      expect(c1).toBe(true);
      expect(dueToday.id).toBe(initial.id);
      expect(dueToday.dedupeKey).toBe(initial.dedupeKey);
      expect(dueToday.severity).toBe('warning');
      expect(dueToday.version).toBe(2);
      expect(dueToday.createdAt).toBe(initial.createdAt);

      const { notification: overdue, changed: c2 } = dueToday.promoteAlert({
        category: 'recurring_payment',
        severity: 'critical',
        title: 'Overdue payment: Internet',
        message: 'Internet was due 1 day ago.',
        entityType: 'recurring_rule',
        entityId: RULE_ID,
        triggerDate: '2026-05-10',
        actionRoute: '/recurring',
        metadata: { recurringRuleId: RULE_ID, occurrenceDate: '2026-05-10', amountPaise: 99900 },
        now: '2026-05-11T08:00:00.000Z'
      });

      expect(c2).toBe(true);
      expect(overdue.severity).toBe('critical');
      expect(overdue.version).toBe(3);

      // Never downgrade critical back to warning/info
      const { notification: blockedDowngrade, changed: c3 } = overdue.promoteAlert({
        category: 'recurring_payment',
        severity: 'warning',
        title: 'Payment due today: Internet',
        message: 'Attempted downgrade.',
        entityType: 'recurring_rule',
        entityId: RULE_ID,
        triggerDate: '2026-05-10',
        actionRoute: '/recurring',
        now: '2026-05-12T08:00:00.000Z'
      });

      expect(c3).toBe(false);
      expect(blockedDowngrade.severity).toBe('critical');
      expect(blockedDowngrade.version).toBe(3);
    });

    it('promotes budget_warning -> budget_exceeded without downgrading and preserves read/dismissed status', async () => {
      const dedupeKey = buildBudgetNotificationDedupeKey(BUDGET_ID, '2026-05');
      const id = await deriveDeterministicNotificationId(USER_A, dedupeKey);

      const warning = new Notification({
        id,
        userId: USER_A,
        category: 'budget_warning',
        severity: 'warning',
        status: 'read',
        readAt: '2026-05-15T10:00:00.000Z',
        dedupeKey,
        title: 'Budget approaching limit: Food',
        message: 'Food budget is 85% used.',
        entityType: 'budget',
        entityId: BUDGET_ID,
        triggerDate: '2026-05-15',
        actionRoute: '/budgets',
        metadata: { budgetId: BUDGET_ID, period: '2026-05', limitPaise: 100000, spentPaise: 85000 },
        version: 2,
        createdAt: '2026-05-15T09:00:00.000Z',
        updatedAt: '2026-05-15T10:00:00.000Z'
      });

      const { notification: exceeded, changed } = warning.promoteAlert({
        category: 'budget_exceeded',
        severity: 'critical',
        title: 'Budget exceeded: Food',
        message: 'Food budget exceeded limit.',
        entityType: 'budget',
        entityId: BUDGET_ID,
        triggerDate: '2026-05-16',
        actionRoute: '/budgets',
        metadata: { budgetId: BUDGET_ID, period: '2026-05', limitPaise: 100000, spentPaise: 112000 },
        now: '2026-05-16T09:00:00.000Z'
      });

      expect(changed).toBe(true);
      expect(exceeded.category).toBe('budget_exceeded');
      expect(exceeded.severity).toBe('critical');
      // Must preserve read status and readAt timestamp
      expect(exceeded.status).toBe('read');
      expect(exceeded.readAt).toBe('2026-05-15T10:00:00.000Z');

      // Cannot downgrade back to budget_warning
      const { notification: noDowngrade, changed: cDowngrade } = exceeded.promoteAlert({
        category: 'budget_warning',
        severity: 'warning',
        title: 'Budget approaching limit: Food',
        message: 'Should stay exceeded.',
        entityType: 'budget',
        entityId: BUDGET_ID,
        triggerDate: '2026-05-17',
        actionRoute: '/budgets'
      });
      expect(cDowngrade).toBe(false);
      expect(noDowngrade.category).toBe('budget_exceeded');

      // Dismiss preserves readAt and prevents reverting back to unread/read
      const dismissed = exceeded.dismiss('2026-05-17T11:00:00.000Z');
      expect(dismissed.status).toBe('dismissed');
      expect(dismissed.dismissedAt).toBe('2026-05-17T11:00:00.000Z');
      expect(dismissed.readAt).toBe('2026-05-15T10:00:00.000Z');
      expect(dismissed.markAsRead('2026-05-18T11:00:00.000Z')).toBe(dismissed);
    });

    it('rejects non-integer paise metadata, unsafe routes, and invalid status invariants', async () => {
      const id = await deriveDeterministicNotificationId(USER_A, 'test:key');
      expect(
        () =>
          new Notification({
            id,
            userId: USER_A,
            category: 'budget_warning',
            severity: 'warning',
            status: 'unread',
            dedupeKey: 'test:key',
            title: 'Invalid money',
            message: 'Float paise should fail',
            entityType: 'budget',
            entityId: BUDGET_ID,
            triggerDate: '2026-05-15',
            actionRoute: '/budgets',
            metadata: { spentPaise: 123.45 },
            version: 1,
            createdAt: '2026-05-15T00:00:00.000Z',
            updatedAt: '2026-05-15T00:00:00.000Z'
          })
      ).toThrow(InvalidNotificationError);

      expect(
        () =>
          new Notification({
            id,
            userId: USER_A,
            category: 'budget_warning',
            severity: 'warning',
            status: 'unread',
            dedupeKey: 'test:key',
            title: 'External URL blocked',
            message: 'Must be internal route',
            entityType: 'budget',
            entityId: BUDGET_ID,
            triggerDate: '2026-05-15',
            actionRoute: 'https://evil.example',
            version: 1,
            createdAt: '2026-05-15T00:00:00.000Z',
            updatedAt: '2026-05-15T00:00:00.000Z'
          })
      ).toThrow(InvalidNotificationError);
    });
  });

  describe('NotificationPreference entity', () => {
    it('creates safe defaults and validates upcomingLeadDays bounds 0..30', () => {
      const defaults = NotificationPreference.createDefault(USER_A);
      expect(defaults.recurringPaymentEnabled).toBe(
        DEFAULT_NOTIFICATION_PREFERENCES.recurringPaymentEnabled
      );
      expect(defaults.budgetWarningEnabled).toBe(
        DEFAULT_NOTIFICATION_PREFERENCES.budgetWarningEnabled
      );
      expect(defaults.budgetExceededEnabled).toBe(
        DEFAULT_NOTIFICATION_PREFERENCES.budgetExceededEnabled
      );
      expect(defaults.upcomingLeadDays).toBe(3);

      const updated = defaults.update({ upcomingLeadDays: 7, budgetWarningEnabled: false });
      expect(updated.upcomingLeadDays).toBe(7);
      expect(updated.budgetWarningEnabled).toBe(false);
      expect(updated.version).toBe(2);

      expect(() => defaults.update({ upcomingLeadDays: -1 })).toThrow(
        InvalidNotificationPreferenceError
      );
      expect(() => defaults.update({ upcomingLeadDays: 31 })).toThrow(
        InvalidNotificationPreferenceError
      );
      expect(() => defaults.update({ upcomingLeadDays: 2.5 })).toThrow(
        InvalidNotificationPreferenceError
      );
    });
  });
});

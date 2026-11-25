import { describe, it, expect } from 'vitest';
import {
  RECURRENCE_FREQUENCIES,
  addDaysToLocalDate,
  addMonthsPreservingAnchorDay,
  buildRecurringOccurrenceIdempotencyKey,
  calculateNextOccurrenceDate,
  compareLocalDates,
  differenceInCalendarDays,
  getDaysInMonth,
  getLocalTodayDateString,
  isLeapYear,
  isValidLocalCalendarDate,
  parseLocalCalendarDate,
  previewUpcomingScheduleDates,
  toLocalTransactionIsoTimestamp
} from '@/domain/services/RecurrenceScheduleService';
import { RecurringRule } from '@/domain/entities/RecurringRule';
import { RecurringOccurrence } from '@/domain/entities/RecurringOccurrence';
import { Money } from '@/domain/value-objects/Money';
import {
  createAccountId,
  createCategoryId,
  createRecurringOccurrenceId,
  createRecurringRuleId,
  createTransactionId,
  createUserId
} from '@/domain/value-objects/Identifiers';
import {
  InvalidRecurringDateError,
  InvalidRecurrenceScheduleError,
  RecurringOccurrenceAlreadyResolvedError
} from '@/domain/errors/RecurringErrors';

describe('Phase 8 Domain: RecurrenceScheduleService & Entities', () => {
  const userId = createUserId('11111111-1111-4111-8111-111111111111');
  const accountId = createAccountId('22222222-2222-4222-8222-222222222222');
  const categoryId = createCategoryId('33333333-3333-4333-8333-333333333333');
  const ruleId = createRecurringRuleId('44444444-4444-4444-8444-444444444444');
  const occId = createRecurringOccurrenceId('55555555-5555-4555-8555-555555555555');
  const txId = createTransactionId('66666666-6666-4666-8666-666666666666');

  describe('Calendar Validation, Leap Years & Month-End Preservation', () => {
    it('supports all 5 canonical recurrence frequencies', () => {
      expect(RECURRENCE_FREQUENCIES).toEqual([
        'daily',
        'weekly',
        'monthly',
        'quarterly',
        'yearly'
      ]);
    });

    it('detects leap years and month lengths accurately', () => {
      expect(isLeapYear(2024)).toBe(true);
      expect(isLeapYear(2026)).toBe(false);
      expect(isLeapYear(2000)).toBe(true);
      expect(isLeapYear(1900)).toBe(false);

      expect(getDaysInMonth(2026, 2)).toBe(28);
      expect(getDaysInMonth(2028, 2)).toBe(29);
      expect(getDaysInMonth(2026, 4)).toBe(30);
      expect(getDaysInMonth(2026, 1)).toBe(31);
    });

    it('rejects impossible calendar dates such as non-leap Feb 29 and Apr 31', () => {
      expect(isValidLocalCalendarDate('2028-02-29')).toBe(true);
      expect(isValidLocalCalendarDate('2026-02-29')).toBe(false);
      expect(isValidLocalCalendarDate('2026-04-31')).toBe(false);
      expect(isValidLocalCalendarDate('2026-13-01')).toBe(false);
      expect(() => parseLocalCalendarDate('2026-02-29')).toThrow(InvalidRecurringDateError);
    });

    it('preserves month-end anchor day 31 across Feb (non-leap & leap), Apr, May', () => {
      // Non-leap 2026
      const feb2026 = calculateNextOccurrenceDate('2026-01-31', 'monthly', 1, 31);
      expect(feb2026).toBe('2026-02-28');
      const mar2026 = calculateNextOccurrenceDate(feb2026, 'monthly', 1, 31);
      expect(mar2026).toBe('2026-03-31');
      const apr2026 = calculateNextOccurrenceDate(mar2026, 'monthly', 1, 31);
      expect(apr2026).toBe('2026-04-30');
      const may2026 = calculateNextOccurrenceDate(apr2026, 'monthly', 1, 31);
      expect(may2026).toBe('2026-05-31');

      // Leap year 2028
      const feb2028 = calculateNextOccurrenceDate('2028-01-31', 'monthly', 1, 31);
      expect(feb2028).toBe('2028-02-29');
      const mar2028 = calculateNextOccurrenceDate(feb2028, 'monthly', 1, 31);
      expect(mar2028).toBe('2028-03-31');
    });

    it('computes daily, weekly, quarterly, and yearly leap progressions without UTC shift', () => {
      expect(calculateNextOccurrenceDate('2026-11-28', 'daily', 3, 28)).toBe('2026-12-01');
      expect(calculateNextOccurrenceDate('2026-11-25', 'weekly', 2, 25)).toBe('2026-12-09');
      expect(calculateNextOccurrenceDate('2026-11-30', 'quarterly', 1, 31)).toBe('2027-02-28');
      expect(calculateNextOccurrenceDate('2027-02-28', 'quarterly', 1, 31)).toBe('2027-05-31');
      expect(calculateNextOccurrenceDate('2028-02-29', 'yearly', 1, 29)).toBe('2029-02-28');
      expect(calculateNextOccurrenceDate('2031-02-28', 'yearly', 1, 29)).toBe('2032-02-29');
    });

    it('keeps local calendar day invariant when converting to transaction ISO timestamp', () => {
      const iso = toLocalTransactionIsoTimestamp('2026-11-30');
      expect(getLocalTodayDateString(new Date(iso))).toBe('2026-11-30');
    });

    it('computes calendar day deltas, shifts, and date previews cleanly', () => {
      expect(compareLocalDates('2026-11-20', '2026-11-25')).toBe(-1);
      expect(differenceInCalendarDays('2026-11-20', '2026-11-25')).toBe(5);
      expect(addDaysToLocalDate('2026-02-27', 3)).toBe('2026-03-02');
      expect(addMonthsPreservingAnchorDay('2026-01-30', 1, 30)).toBe('2026-02-28');

      const preview = previewUpcomingScheduleDates({
        nextDueDate: '2026-01-31',
        endDate: '2026-04-30',
        frequency: 'monthly',
        interval: 1,
        anchorDay: 31,
        horizonEndDate: '2026-12-31'
      });
      expect(preview).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    });
  });

  describe('RecurringRule & RecurringOccurrence Entity Invariants', () => {
    it('advances monthly schedule preserving anchorDay and transitions to completed past endDate', () => {
      const rule = new RecurringRule({
        id: ruleId,
        userId,
        title: 'Home Rent',
        type: 'expense',
        amount: Money.fromPaise(2500000, 'INR'),
        accountId,
        categoryId,
        frequency: 'monthly',
        interval: 1,
        startDate: '2026-01-31',
        endDate: '2026-03-31',
        nextDueDate: '2026-01-31'
      });

      expect(rule.anchorDayOfMonth).toBe(31);
      expect(rule.requiresUserConfirmation).toBe(true);

      rule.advanceAfterOccurrence('2026-01-31', true);
      expect(rule.nextDueDate).toBe('2026-02-28');
      expect(rule.lastGeneratedDate).toBe('2026-01-31');
      expect(rule.status).toBe('active');
      expect(rule.version).toBe(2);

      rule.advanceAfterOccurrence('2026-02-28', true);
      expect(rule.nextDueDate).toBe('2026-03-31');
      expect(rule.status).toBe('active');

      rule.advanceAfterOccurrence('2026-03-31', true);
      expect(rule.status).toBe('completed');
    });

    it('rejects end date earlier than start date and non-positive amounts', () => {
      expect(
        () =>
          new RecurringRule({
            id: ruleId,
            userId,
            title: 'Bad',
            type: 'expense',
            amount: Money.fromPaise(1000, 'INR'),
            accountId,
            frequency: 'monthly',
            interval: 1,
            startDate: '2026-05-10',
            endDate: '2026-05-01',
            nextDueDate: '2026-05-10'
          })
      ).toThrow(InvalidRecurrenceScheduleError);

      expect(
        () =>
          new RecurringRule({
            id: ruleId,
            userId,
            title: 'Zero',
            type: 'expense',
            amount: Money.fromPaise(0, 'INR'),
            accountId,
            frequency: 'monthly',
            interval: 1,
            startDate: '2026-05-10',
            nextDueDate: '2026-05-10'
          })
      ).toThrow(InvalidRecurrenceScheduleError);
    });

    it('enforces occurrence state transitions and blocks double resolution', () => {
      const occ = new RecurringOccurrence({
        id: occId,
        userId,
        recurringRuleId: ruleId,
        occurrenceDate: '2026-11-25'
      });

      expect(occ.idempotencyKey).toBe(
        buildRecurringOccurrenceIdempotencyKey(ruleId, '2026-11-25')
      );
      expect(occ.effectiveDueDate).toBe('2026-11-25');

      occ.snooze('2026-11-28');
      expect(occ.status).toBe('snoozed');
      expect(occ.effectiveDueDate).toBe('2026-11-28');
      expect(occ.version).toBe(2);

      occ.confirm(txId);
      expect(occ.status).toBe('confirmed');
      expect(occ.transactionId).toBe(txId);
      expect(occ.snoozedUntilDate).toBeNull();
      expect(occ.version).toBe(3);

      expect(() => occ.skip()).toThrow(RecurringOccurrenceAlreadyResolvedError);
      expect(() => occ.confirm(txId)).toThrow(RecurringOccurrenceAlreadyResolvedError);
    });
  });
});

import { InvalidRecurringDateError, InvalidRecurrenceScheduleError } from '../errors/RecurringErrors';

export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export const RECURRENCE_FREQUENCIES: readonly RecurrenceFrequency[] = [
  'daily',
  'weekly',
  'monthly',
  'quarterly',
  'yearly'
] as const;

export const LOCAL_DATE_REGEX = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function getDaysInMonth(year: number, month: number): number {
  switch (month) {
    case 2:
      return isLeapYear(year) ? 29 : 28;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    default:
      return 31;
  }
}

export function formatLocalCalendarDate(year: number, month: number, day: number): string {
  const y = String(year).padStart(4, '0');
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Validates that a string is strictly YYYY-MM-DD and represents a real Gregorian calendar day
 * (e.g. rejects 2026-02-29, allows 2028-02-29, rejects 2026-04-31).
 */
export function isValidLocalCalendarDate(dateStr: unknown): dateStr is string {
  if (typeof dateStr !== 'string') return false;
  const trimmed = dateStr.trim();
  const match = LOCAL_DATE_REGEX.exec(trimmed);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isSafeInteger(year) || !Number.isSafeInteger(month) || !Number.isSafeInteger(day)) {
    return false;
  }

  return day >= 1 && day <= getDaysInMonth(year, month);
}

/**
 * Parses and validates a local YYYY-MM-DD string. Throws InvalidRecurringDateError if malformed.
 */
export function parseLocalCalendarDate(dateStr: string): {
  year: number;
  month: number;
  day: number;
  normalized: string;
} {
  const trimmed = (dateStr || '').trim();
  if (!isValidLocalCalendarDate(trimmed)) {
    throw new InvalidRecurringDateError(
      `Invalid recurring calendar date '${dateStr}'. Expected a real date formatted as YYYY-MM-DD.`
    );
  }
  const [y, m, d] = trimmed.split('-').map(Number);
  return {
    year: y,
    month: m,
    day: d,
    normalized: trimmed
  };
}

/**
 * Converts a JS Date (or ISO date-only prefix / current clock) into local YYYY-MM-DD without UTC drift.
 */
export function getLocalTodayDateString(now: Date = new Date()): string {
  return formatLocalCalendarDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/**
 * Extracts a canonical YYYY-MM-DD local calendar string from either YYYY-MM-DD or an ISO datetime.
 */
export function normalizeToLocalDateString(input: string): string {
  const trimmed = (input || '').trim();
  if (isValidLocalCalendarDate(trimmed)) {
    return trimmed;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new InvalidRecurringDateError(`Cannot normalize invalid date '${input}'.`);
  }
  return getLocalTodayDateString(parsed);
}

/**
 * Compares two validated local YYYY-MM-DD calendar strings.
 * Returns -1 if a < b, 0 if equal, 1 if a > b.
 */
export function compareLocalDates(a: string, b: string): number {
  const parsedA = parseLocalCalendarDate(a).normalized;
  const parsedB = parseLocalCalendarDate(b).normalized;
  if (parsedA < parsedB) return -1;
  if (parsedA > parsedB) return 1;
  return 0;
}

/**
 * Exact signed calendar-day difference (toDate - fromDate) without DST distortion.
 */
export function differenceInCalendarDays(fromDateStr: string, toDateStr: string): number {
  const from = parseLocalCalendarDate(fromDateStr);
  const to = parseLocalCalendarDate(toDateStr);
  const utcFrom = Date.UTC(from.year, from.month - 1, from.day);
  const utcTo = Date.UTC(to.year, to.month - 1, to.day);
  return Math.round((utcTo - utcFrom) / 86_400_000);
}

/**
 * Shifts a local calendar date by exact calendar days using local noon to eliminate DST jumps.
 */
export function addDaysToLocalDate(dateStr: string, days: number): string {
  if (!Number.isSafeInteger(days)) {
    throw new InvalidRecurrenceScheduleError(`Day delta must be a safe integer. Received '${days}'.`);
  }
  const { year, month, day } = parseLocalCalendarDate(dateStr);
  const shifted = new Date(year, month - 1, day + days, 12, 0, 0, 0);
  return getLocalTodayDateString(shifted);
}

/**
 * Advances a calendar date by N months while preserving the schedule's original anchorDay (e.g. 31st).
 * Clamps safely for shorter months (e.g. Feb 28/29, Apr 30) and restores to 31 when moving to 31-day months.
 */
export function addMonthsPreservingAnchorDay(
  dateStr: string,
  months: number,
  anchorDay: number
): string {
  if (!Number.isSafeInteger(months) || months < 0) {
    throw new InvalidRecurrenceScheduleError(`Month offset must be a non-negative integer. Received '${months}'.`);
  }
  if (!Number.isSafeInteger(anchorDay) || anchorDay < 1 || anchorDay > 31) {
    throw new InvalidRecurrenceScheduleError(`Anchor day must be between 1 and 31. Received '${anchorDay}'.`);
  }

  const { year, month } = parseLocalCalendarDate(dateStr);
  const totalZeroBasedMonths = (year * 12 + (month - 1)) + months;
  const targetYear = Math.floor(totalZeroBasedMonths / 12);
  const targetMonth = (totalZeroBasedMonths % 12) + 1;
  const clampedDay = Math.min(anchorDay, getDaysInMonth(targetYear, targetMonth));

  return formatLocalCalendarDate(targetYear, targetMonth, clampedDay);
}

/**
 * Calculates the next scheduled local calendar date given current date, frequency, interval, and anchorDay.
 */
export function calculateNextOccurrenceDate(
  currentDateStr: string,
  frequency: RecurrenceFrequency,
  interval: number,
  anchorDay?: number
): string {
  if (!Number.isSafeInteger(interval) || interval < 1) {
    throw new InvalidRecurrenceScheduleError(`Recurrence interval must be at least 1. Received '${interval}'.`);
  }

  const parsed = parseLocalCalendarDate(currentDateStr);
  const resolvedAnchorDay = anchorDay ?? parsed.day;

  switch (frequency) {
    case 'daily':
      return addDaysToLocalDate(parsed.normalized, interval);
    case 'weekly':
      return addDaysToLocalDate(parsed.normalized, interval * 7);
    case 'monthly':
      return addMonthsPreservingAnchorDay(parsed.normalized, interval, resolvedAnchorDay);
    case 'quarterly':
      return addMonthsPreservingAnchorDay(parsed.normalized, interval * 3, resolvedAnchorDay);
    case 'yearly':
      return addMonthsPreservingAnchorDay(parsed.normalized, interval * 12, resolvedAnchorDay);
  }
}

/**
 * Computes a local-noon ISO 8601 timestamp for ledger transaction creation from a YYYY-MM-DD occurrence date,
 * guaranteeing local calendar day invariance across timezones when rendered via Date.
 */
export function toLocalTransactionIsoTimestamp(dateStr: string): string {
  const { year, month, day } = parseLocalCalendarDate(dateStr);
  return new Date(year, month - 1, day, 12, 0, 0, 0).toISOString();
}

/**
 * Builds deterministic preview dates up to horizonEndDate or maxCount (whichever comes first) without
 * creating ledger records or mutating state.
 */
export function previewUpcomingScheduleDates(params: {
  nextDueDate: string;
  endDate?: string | null;
  frequency: RecurrenceFrequency;
  interval: number;
  anchorDay: number;
  horizonEndDate: string;
  maxCount?: number;
}): string[] {
  const {
    nextDueDate,
    endDate,
    frequency,
    interval,
    anchorDay,
    horizonEndDate,
    maxCount = 24
  } = params;

  const results: string[] = [];
  let cursor = parseLocalCalendarDate(nextDueDate).normalized;

  while (results.length < maxCount) {
    if (compareLocalDates(cursor, horizonEndDate) > 0) {
      break;
    }
    if (endDate && compareLocalDates(cursor, endDate) > 0) {
      break;
    }
    results.push(cursor);
    const nextCursor = calculateNextOccurrenceDate(cursor, frequency, interval, anchorDay);
    if (nextCursor === cursor) {
      break;
    }
    cursor = nextCursor;
  }

  return results;
}

/**
 * Deterministic idempotency key per (recurringRuleId, occurrenceDate) slot.
 */
export function buildRecurringOccurrenceIdempotencyKey(
  recurringRuleId: string,
  occurrenceDate: string
): string {
  const normalizedDate = parseLocalCalendarDate(occurrenceDate).normalized;
  return `recurring:${recurringRuleId.trim()}:${normalizedDate}`;
}

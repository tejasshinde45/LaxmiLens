import { TransactionResponseDTO } from '@/application/dto/TransactionDTO';
import { RecurringReminderDTO, RecurringRuleResponseDTO } from '@/application/dto/RecurringDTO';
import {
  RecurrenceFrequency,
  compareLocalDates,
  formatLocalCalendarDate,
  getDaysInMonth,
  getLocalTodayDateString,
  normalizeToLocalDateString,
  parseLocalCalendarDate,
  previewUpcomingScheduleDates
} from '@/domain/services/RecurrenceScheduleService';
import { formatPaiseToINR } from '@/utils/formatters';

export const CALENDAR_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
] as const;

export interface CalendarDayCell {
  dateKey: string; // YYYY-MM-DD local calendar
  year: number;
  month: number; // 1..12
  day: number; // 1..31
  isCurrentMonth: boolean;
  isToday: boolean;
}

export interface CalendarMonthGrid {
  year: number;
  month: number; // 1..12
  monthKey: string; // YYYY-MM
  monthStartDateKey: string;
  monthEndDateKey: string;
  label: string;
  daysInMonth: number;
  cells: CalendarDayCell[];
}

export interface DailyLedgerSummary {
  dateKey: string;
  totalIncomePaise: number;
  totalExpensePaise: number;
  netCashFlowPaise: number; // Income - Expense (transfers strictly excluded)
  transactionCount: number; // All non-deleted transactions (including transfers)
  transferCount: number;
  transactions: TransactionResponseDTO[];
}

export type CalendarRecurringStatus =
  | 'overdue'
  | 'due_today'
  | 'snoozed'
  | 'upcoming'
  | 'projected';

export interface CalendarRecurringItem {
  id: string;
  recurringRuleId: string;
  occurrenceId?: string;
  title: string;
  type: 'income' | 'expense';
  amountPaise: number;
  amountFormatted: string;
  accountId: string;
  accountName: string;
  categoryId?: string;
  categoryName?: string;
  frequency: RecurrenceFrequency;
  interval: number;
  scheduledDate: string; // YYYY-MM-DD
  effectiveDate: string; // YYYY-MM-DD (reflects snooze target when snoozed)
  status: CalendarRecurringStatus;
  isProjected: boolean;
}

export interface MonthlyCalendarSummary {
  monthKey: string;
  totalIncomePaise: number;
  totalExpensePaise: number;
  netCashFlowPaise: number;
  transactionCount: number;
  transferCount: number;
  activeDaysCount: number;
  scheduledIncomePaise: number;
  scheduledExpensePaise: number;
  scheduledCount: number;
}

/**
 * Formats YYYY-MM for a calendar year and 1-based month.
 */
export function formatMonthKey(year: number, month: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

/**
 * Shifts a (year, month [1..12]) pair by delta months cleanly across year boundaries.
 */
export function shiftCalendarMonth(
  year: number,
  month: number,
  deltaMonths: number
): { year: number; month: number } {
  const zeroBased = year * 12 + (month - 1) + deltaMonths;
  const targetYear = Math.floor(zeroBased / 12);
  const targetMonth = (((zeroBased % 12) + 12) % 12) + 1;
  return { year: targetYear, month: targetMonth };
}

/**
 * Formats a YYYY-MM-DD local calendar string into a readable local display heading
 * without UTC day shifts.
 */
export function formatLocalDateHeading(dateKey: string): string {
  const { year, month, day } = parseLocalCalendarDate(dateKey);
  const localNoon = new Date(year, month - 1, day, 12, 0, 0, 0);
  const weekday = localNoon.toLocaleDateString('en-US', { weekday: 'long' });
  const shortMonth = MONTH_NAMES[month - 1]?.slice(0, 3) ?? '';
  return `${weekday}, ${day} ${shortMonth} ${year}`;
}

/**
 * Builds an aligned Sunday..Saturday monthly grid (complete 7-day rows) using local dates.
 */
export function buildCalendarMonthGrid(
  year: number,
  month: number,
  todayDateKey: string = getLocalTodayDateString()
): CalendarMonthGrid {
  if (!Number.isSafeInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`Invalid calendar month '${month}'. Expected 1..12.`);
  }

  const daysInMonth = getDaysInMonth(year, month);
  const monthKey = formatMonthKey(year, month);
  const monthStartDateKey = formatLocalCalendarDate(year, month, 1);
  const monthEndDateKey = formatLocalCalendarDate(year, month, daysInMonth);
  const label = `${MONTH_NAMES[month - 1]} ${year}`;

  // Use local noon to avoid DST midnight anomalies when determining weekday alignment
  const firstWeekday = new Date(year, month - 1, 1, 12, 0, 0, 0).getDay(); // 0 (Sun)..6 (Sat)
  const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;

  const prev = shiftCalendarMonth(year, month, -1);
  const prevDays = getDaysInMonth(prev.year, prev.month);
  const next = shiftCalendarMonth(year, month, 1);

  const cells: CalendarDayCell[] = [];

  for (let i = 0; i < firstWeekday; i++) {
    const day = prevDays - firstWeekday + 1 + i;
    const dateKey = formatLocalCalendarDate(prev.year, prev.month, day);
    cells.push({
      dateKey,
      year: prev.year,
      month: prev.month,
      day,
      isCurrentMonth: false,
      isToday: dateKey === todayDateKey
    });
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateKey = formatLocalCalendarDate(year, month, day);
    cells.push({
      dateKey,
      year,
      month,
      day,
      isCurrentMonth: true,
      isToday: dateKey === todayDateKey
    });
  }

  const trailingCount = totalCells - cells.length;
  for (let day = 1; day <= trailingCount; day++) {
    const dateKey = formatLocalCalendarDate(next.year, next.month, day);
    cells.push({
      dateKey,
      year: next.year,
      month: next.month,
      day,
      isCurrentMonth: false,
      isToday: dateKey === todayDateKey
    });
  }

  return {
    year,
    month,
    monthKey,
    monthStartDateKey,
    monthEndDateKey,
    label,
    daysInMonth,
    cells
  };
}

/**
 * Resolves a transaction's persisted timestamp or YYYY-MM-DD value into its local calendar YYYY-MM-DD key.
 */
export function resolveTransactionLocalDate(rawDate?: string | null): string | null {
  if (!rawDate || typeof rawDate !== 'string') return null;
  try {
    return normalizeToLocalDateString(rawDate);
  } catch {
    return null;
  }
}

/**
 * Aggregates persisted non-deleted transactions by local YYYY-MM-DD date in integer paise.
 * Adheres strictly to LedgerRules: transfers do not affect income, expense, or net cashflow totals.
 */
export function buildDailyLedgerMap(
  transactions: readonly TransactionResponseDTO[]
): Map<string, DailyLedgerSummary> {
  const map = new Map<string, DailyLedgerSummary>();

  for (const tx of transactions) {
    if (tx.isDeleted || tx.deletedAt !== null) {
      continue;
    }

    const dateKey = resolveTransactionLocalDate(tx.transactionDate);
    if (!dateKey) {
      continue;
    }

    const paise = Number.isSafeInteger(tx.amountPaise)
      ? tx.amountPaise
      : Math.round(Number(tx.amountPaise) || 0);

    let summary = map.get(dateKey);
    if (!summary) {
      summary = {
        dateKey,
        totalIncomePaise: 0,
        totalExpensePaise: 0,
        netCashFlowPaise: 0,
        transactionCount: 0,
        transferCount: 0,
        transactions: []
      };
      map.set(dateKey, summary);
    }

    summary.transactionCount += 1;
    summary.transactions.push(tx);

    if (tx.type === 'income') {
      summary.totalIncomePaise += paise;
    } else if (tx.type === 'expense') {
      summary.totalExpensePaise += paise;
    } else if (tx.type === 'transfer') {
      summary.transferCount += 1;
    }

    summary.netCashFlowPaise = summary.totalIncomePaise - summary.totalExpensePaise;
  }

  for (const daySummary of map.values()) {
    daySummary.transactions.sort((a, b) => b.transactionDate.localeCompare(a.transactionDate));
  }

  return map;
}

/**
 * Builds read-only calendar entries for persisted recurring reminders and projected upcoming schedule dates
 * across the visible calendar grid without mutating any recurring schedules or occurrences.
 */
export function buildGridRecurringMap(params: {
  gridStartDateKey: string;
  gridEndDateKey: string;
  todayDateKey: string;
  overdue?: readonly RecurringReminderDTO[];
  dueToday?: readonly RecurringReminderDTO[];
  upcoming?: readonly RecurringReminderDTO[];
  snoozed?: readonly RecurringReminderDTO[];
  recentlyGenerated?: readonly RecurringReminderDTO[];
  schedules?: readonly RecurringRuleResponseDTO[];
}): Map<string, CalendarRecurringItem[]> {
  const {
    gridStartDateKey,
    gridEndDateKey,
    todayDateKey,
    overdue = [],
    dueToday = [],
    upcoming = [],
    snoozed = [],
    recentlyGenerated = [],
    schedules = []
  } = params;

  const map = new Map<string, CalendarRecurringItem[]>();
  const seenRuleScheduledPairs = new Set<string>();
  const seenRuleEffectivePairs = new Set<string>();
  const resolvedRuleScheduledPairs = new Set<string>();

  const pushItem = (dateKey: string, item: CalendarRecurringItem) => {
    const list = map.get(dateKey);
    if (list) {
      list.push(item);
    } else {
      map.set(dateKey, [item]);
    }
  };

  for (const confirmed of recentlyGenerated) {
    resolvedRuleScheduledPairs.add(`${confirmed.recurringRuleId}:${confirmed.occurrenceDate}`);
  }

  const actionableGroups: ReadonlyArray<{
    items: readonly RecurringReminderDTO[];
    status: CalendarRecurringStatus;
  }> = [
    { items: overdue, status: 'overdue' },
    { items: dueToday, status: 'due_today' },
    { items: snoozed, status: 'snoozed' },
    { items: upcoming, status: 'upcoming' }
  ];

  for (const group of actionableGroups) {
    for (const reminder of group.items) {
      const scheduledPairKey = `${reminder.recurringRuleId}:${reminder.occurrenceDate}`;
      const effectivePairKey = `${reminder.recurringRuleId}:${reminder.effectiveDueDate}`;

      seenRuleScheduledPairs.add(scheduledPairKey);
      seenRuleEffectivePairs.add(effectivePairKey);

      if (
        compareLocalDates(reminder.effectiveDueDate, gridStartDateKey) < 0 ||
        compareLocalDates(reminder.effectiveDueDate, gridEndDateKey) > 0
      ) {
        continue;
      }

      pushItem(reminder.effectiveDueDate, {
        id: `${reminder.recurringRuleId}:${reminder.occurrenceDate}:${reminder.effectiveDueDate}`,
        recurringRuleId: reminder.recurringRuleId,
        occurrenceId: reminder.occurrenceId,
        title: reminder.title,
        type: reminder.type,
        amountPaise: reminder.amountPaise,
        amountFormatted: reminder.amountFormatted || formatPaiseToINR(reminder.amountPaise),
        accountId: reminder.accountId,
        accountName: reminder.accountName,
        categoryId: reminder.categoryId,
        categoryName: reminder.categoryName,
        frequency: reminder.frequency,
        interval: reminder.interval,
        scheduledDate: reminder.occurrenceDate,
        effectiveDate: reminder.effectiveDueDate,
        status: group.status,
        isProjected: false
      });
    }
  }

  for (const schedule of schedules) {
    if (schedule.status !== 'active') continue;

    try {
      if (compareLocalDates(schedule.nextDueDate, gridEndDateKey) > 0) {
        continue;
      }

      const projectedDates = previewUpcomingScheduleDates({
        nextDueDate: schedule.nextDueDate,
        endDate: schedule.endDate,
        frequency: schedule.frequency,
        interval: schedule.interval,
        anchorDay: schedule.anchorDayOfMonth,
        horizonEndDate: gridEndDateKey,
        maxCount: 64
      });

      for (const dateKey of projectedDates) {
        if (compareLocalDates(dateKey, gridStartDateKey) < 0) continue;
        if (compareLocalDates(dateKey, gridEndDateKey) > 0) continue;

        const pairKey = `${schedule.id}:${dateKey}`;
        if (
          seenRuleScheduledPairs.has(pairKey) ||
          seenRuleEffectivePairs.has(pairKey) ||
          resolvedRuleScheduledPairs.has(pairKey)
        ) {
          continue;
        }

        const isTodayDate = dateKey === todayDateKey;
        pushItem(dateKey, {
          id: `${schedule.id}:${dateKey}:projected`,
          recurringRuleId: schedule.id,
          title: schedule.title,
          type: schedule.type,
          amountPaise: schedule.amountPaise,
          amountFormatted: schedule.amountFormatted || formatPaiseToINR(schedule.amountPaise),
          accountId: schedule.accountId,
          accountName: schedule.accountName,
          categoryId: schedule.categoryId,
          categoryName: schedule.categoryName,
          frequency: schedule.frequency,
          interval: schedule.interval,
          scheduledDate: dateKey,
          effectiveDate: dateKey,
          status: isTodayDate ? 'due_today' : 'projected',
          isProjected: true
        });
      }
    } catch {
      // Skip malformed schedules safely without throwing or synthesizing dates
      continue;
    }
  }

  return map;
}

/**
 * Aggregates monthly ledger + scheduled totals strictly for the displayed YYYY-MM calendar month.
 */
export function computeMonthlyCalendarSummary(
  monthKey: string,
  dailyLedgerMap: ReadonlyMap<string, DailyLedgerSummary>,
  recurringMap: ReadonlyMap<string, readonly CalendarRecurringItem[]>
): MonthlyCalendarSummary {
  const monthPrefix = `${monthKey}-`;

  let totalIncomePaise = 0;
  let totalExpensePaise = 0;
  let transactionCount = 0;
  let transferCount = 0;
  let activeDaysCount = 0;

  for (const [dateKey, day] of dailyLedgerMap.entries()) {
    if (!dateKey.startsWith(monthPrefix)) continue;
    totalIncomePaise += day.totalIncomePaise;
    totalExpensePaise += day.totalExpensePaise;
    transactionCount += day.transactionCount;
    transferCount += day.transferCount;
    if (day.transactionCount > 0) {
      activeDaysCount += 1;
    }
  }

  let scheduledIncomePaise = 0;
  let scheduledExpensePaise = 0;
  let scheduledCount = 0;

  for (const [dateKey, items] of recurringMap.entries()) {
    if (!dateKey.startsWith(monthPrefix)) continue;
    for (const item of items) {
      scheduledCount += 1;
      if (item.type === 'income') {
        scheduledIncomePaise += item.amountPaise;
      } else {
        scheduledExpensePaise += item.amountPaise;
      }
    }
  }

  return {
    monthKey,
    totalIncomePaise,
    totalExpensePaise,
    netCashFlowPaise: totalIncomePaise - totalExpensePaise,
    transactionCount,
    transferCount,
    activeDaysCount,
    scheduledIncomePaise,
    scheduledExpensePaise,
    scheduledCount
  };
}

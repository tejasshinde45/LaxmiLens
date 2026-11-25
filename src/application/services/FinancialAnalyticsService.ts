import { differenceInCalendarDays, subDays } from 'date-fns';
import { Category } from '@/domain/entities/Category';
import { DateRange } from '@/domain/value-objects/DateRange';
import { validateUserId } from '@/domain/value-objects/Identifiers';
import { Money } from '@/domain/value-objects/Money';
import {
  InvalidDateRangeError,
  InvalidTransactionAmountError,
  UnauthorizedEntityAccessError
} from '@/domain/errors/DomainErrors';
import { formatDate, formatPaiseToINR } from '@/utils/formatters';

export type AnalyticsDatePreset =
  | 'this_month'
  | 'last_month'
  | 'last_3_months'
  | 'last_6_months'
  | 'this_year'
  | 'all_time'
  | 'custom';

export interface CustomDateRangeInput {
  startDate: string; // YYYY-MM-DD in local calendar
  endDate: string; // YYYY-MM-DD in local calendar
}

export interface AnalyticsTransactionRecord {
  id: string;
  userId: string;
  type: 'income' | 'expense' | 'transfer';
  amountPaise: number;
  categoryId?: string;
  title: string;
  transactionDate: Date | string;
  deletedAt?: Date | string | null;
  isDeleted?: boolean;
}

export interface ResolvedAnalyticsPeriod {
  preset: AnalyticsDatePreset;
  range: DateRange;
  previousRange: DateRange | null;
  label: string;
  startInput: string;
  endInput: string;
  granularity: 'daily' | 'monthly';
}

export interface AnalyticsSummaryMetrics {
  totalIncomePaise: number;
  totalIncomeFormatted: string;
  totalExpensePaise: number;
  totalExpenseFormatted: string;
  netCashFlowPaise: number;
  netCashFlowFormatted: string;
  savingsRatePercent: number | null; // null when income === 0
  savingsRateFormatted: string;
  activeTransactionCount: number;
  incomeCount: number;
  expenseCount: number;
  transferCount: number;
}

export interface AnalyticsTrendPoint {
  bucketKey: string; // YYYY-MM-DD or YYYY-MM
  label: string;
  incomePaise: number;
  expensePaise: number;
  netPaise: number;
  incomeRupees: number; // Chart plotting convenience derived strictly from integer paise
  expenseRupees: number;
  incomeFormatted: string;
  expenseFormatted: string;
}

export interface ExpenseCategoryBreakdownItem {
  categoryId: string;
  categoryName: string;
  categoryIcon?: string;
  categoryColor: string;
  totalPaise: number;
  totalFormatted: string;
  percentageOfExpenses: number;
  transactionCount: number;
}

export interface CategorySpendingIncrease {
  categoryId: string;
  categoryName: string;
  currentPaise: number;
  previousPaise: number;
  deltaPaise: number;
  deltaFormatted: string;
  percentageChange: number | null;
}

export interface SpendingTrendComparison {
  currentExpensePaise: number;
  currentExpenseFormatted: string;
  previousExpensePaise: number | null;
  previousExpenseFormatted: string | null;
  deltaPaise: number | null;
  deltaFormatted: string | null;
  percentageChange: number | null;
  direction: 'increase' | 'decrease' | 'flat' | 'unavailable';
  comparisonAvailable: boolean;
  insufficientDataReason?: string;
}

export interface FinancialActivityInsight {
  id: string;
  type:
    | 'top_category'
    | 'largest_expense'
    | 'highest_month'
    | 'period_change'
    | 'category_increase';
  title: string;
  description: string;
  tone: 'positive' | 'negative' | 'warning' | 'neutral';
}

export interface FinancialAnalyticsResult {
  period: ResolvedAnalyticsPeriod;
  summary: AnalyticsSummaryMetrics;
  timeSeries: AnalyticsTrendPoint[];
  hasTimeSeriesData: boolean;
  expenseBreakdown: ExpenseCategoryBreakdownItem[];
  spendingTrend: SpendingTrendComparison;
  categoryIncreases: CategorySpendingIncrease[];
  insights: FinancialActivityInsight[];
}

const FALLBACK_CATEGORY_COLORS = [
  '#D6AD60',
  '#D9827C',
  '#82A9CF',
  '#72B895',
  '#E4B66D',
  '#B9B4AA'
] as const;

const DATE_INPUT_REGEX = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MAX_DAILY_BUCKET_SPAN = 45;

export function safeAddAnalyticsPaise(a: number, b: number): number {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) {
    throw new InvalidTransactionAmountError(
      `Invalid monetary amount in analytics aggregation: expected safe integers, received ${a} and ${b}.`
    );
  }
  const sum = a + b;
  if (!Number.isSafeInteger(sum)) {
    throw new InvalidTransactionAmountError('Aggregated amount exceeds Number.MAX_SAFE_INTEGER.');
  }
  return sum;
}

/**
 * Formats a Date into YYYY-MM-DD using local calendar components (never UTC shift).
 */
export function formatLocalDateInput(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Formats a Date into YYYY-MM using local calendar components.
 */
export function formatLocalMonthKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * Parses a YYYY-MM-DD string strictly into local midnight Date, validating calendar round-trip.
 */
export function parseLocalDateInput(raw: string): Date {
  const trimmed = (raw || '').trim();
  if (!DATE_INPUT_REGEX.test(trimmed)) {
    throw new Error(`Invalid local date '${raw}'. Expected YYYY-MM-DD.`);
  }
  const [yStr, mStr, dStr] = trimmed.split('-');
  const year = Number(yStr);
  const month = Number(mStr);
  const day = Number(dStr);
  const parsed = new Date(year, month - 1, day, 0, 0, 0, 0);
  parsed.setFullYear(year);

  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    throw new Error(`Calendar date '${raw}' does not exist.`);
  }
  return parsed;
}

function startOfLocalDay(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  d.setFullYear(date.getFullYear());
  return d;
}

function endOfLocalDay(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
  d.setFullYear(date.getFullYear());
  return d;
}

function monthRange(year: number, monthIndex: number): DateRange {
  const start = new Date(year, monthIndex, 1, 0, 0, 0, 0);
  const end = new Date(year, monthIndex + 1, 0, 23, 59, 59, 999);
  return new DateRange(start, end);
}

function parseTransactionDate(raw: Date | string, txId: string): Date {
  const d = raw instanceof Date ? raw : new Date(raw);
  if (isNaN(d.getTime())) {
    throw new Error(`Transaction '${txId}' has an invalid transactionDate.`);
  }
  return d;
}

function isSoftDeletedTx(tx: AnalyticsTransactionRecord): boolean {
  return Boolean(tx.isDeleted) || (tx.deletedAt !== null && tx.deletedAt !== undefined);
}

/**
 * Resolves local calendar DateRange, previous equivalent period, and chart granularity.
 */
export function resolveAnalyticsDateRange(
  preset: AnalyticsDatePreset,
  now: Date = new Date(),
  customRange?: CustomDateRangeInput,
  activeTransactions: readonly AnalyticsTransactionRecord[] = []
): ResolvedAnalyticsPeriod {
  const y = now.getFullYear();
  const m = now.getMonth();

  let range: DateRange;
  let previousRange: DateRange | null = null;
  let label: string;

  switch (preset) {
    case 'this_month': {
      range = monthRange(y, m);
      previousRange = monthRange(y, m - 1);
      label = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(
        range.startDate
      );
      break;
    }
    case 'last_month': {
      range = monthRange(y, m - 1);
      previousRange = monthRange(y, m - 2);
      label = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(
        range.startDate
      );
      break;
    }
    case 'last_3_months': {
      const start = new Date(y, m - 2, 1, 0, 0, 0, 0);
      const end = new Date(y, m + 1, 0, 23, 59, 59, 999);
      range = new DateRange(start, end);
      previousRange = new DateRange(
        new Date(y, m - 5, 1, 0, 0, 0, 0),
        new Date(y, m - 2, 0, 23, 59, 59, 999)
      );
      label = `${formatDate(start, 'MMM yyyy')} – ${formatDate(end, 'MMM yyyy')}`;
      break;
    }
    case 'last_6_months': {
      const start = new Date(y, m - 5, 1, 0, 0, 0, 0);
      const end = new Date(y, m + 1, 0, 23, 59, 59, 999);
      range = new DateRange(start, end);
      previousRange = new DateRange(
        new Date(y, m - 11, 1, 0, 0, 0, 0),
        new Date(y, m - 5, 0, 23, 59, 59, 999)
      );
      label = `${formatDate(start, 'MMM yyyy')} – ${formatDate(end, 'MMM yyyy')}`;
      break;
    }
    case 'this_year': {
      const start = new Date(y, 0, 1, 0, 0, 0, 0);
      const end = new Date(y, 11, 31, 23, 59, 59, 999);
      range = new DateRange(start, end);
      previousRange = new DateRange(
        new Date(y - 1, 0, 1, 0, 0, 0, 0),
        new Date(y - 1, 11, 31, 23, 59, 59, 999)
      );
      label = `${y}`;
      break;
    }
    case 'custom': {
      if (!customRange || !customRange.startDate || !customRange.endDate) {
        range = monthRange(y, m);
        previousRange = monthRange(y, m - 1);
        label = 'Custom Range';
        break;
      }
      const start = parseLocalDateInput(customRange.startDate);
      const endStart = parseLocalDateInput(customRange.endDate);
      if (start.getTime() > endStart.getTime()) {
        throw new InvalidDateRangeError(start, endStart);
      }
      const end = endOfLocalDay(endStart);
      range = new DateRange(start, end);

      const daySpan = differenceInCalendarDays(endStart, start) + 1;
      const prevEndDay = subDays(start, 1);
      const prevStartDay = subDays(start, daySpan);
      previousRange = new DateRange(startOfLocalDay(prevStartDay), endOfLocalDay(prevEndDay));
      label = `${formatDate(start, 'dd MMM yyyy')} – ${formatDate(endStart, 'dd MMM yyyy')}`;
      break;
    }
    case 'all_time': {
      let earliest = startOfLocalDay(new Date(y, m, 1));
      let latest = endOfLocalDay(now);

      const dates = activeTransactions
        .filter((tx) => !isSoftDeletedTx(tx))
        .map((tx) => parseTransactionDate(tx.transactionDate, tx.id));

      if (dates.length > 0) {
        let minTime = dates[0].getTime();
        let maxTime = dates[0].getTime();
        for (const d of dates) {
          const t = d.getTime();
          if (t < minTime) minTime = t;
          if (t > maxTime) maxTime = t;
        }
        earliest = startOfLocalDay(new Date(minTime));
        const maxDayEnd = endOfLocalDay(new Date(maxTime));
        if (maxDayEnd.getTime() > latest.getTime()) {
          latest = maxDayEnd;
        }
      }

      range = new DateRange(earliest, latest);
      previousRange = null;
      label = 'All Time';
      break;
    }
  }

  const totalDays = differenceInCalendarDays(range.endDate, range.startDate) + 1;
  const granularity: 'daily' | 'monthly' =
    preset === 'this_month' || preset === 'last_month' || totalDays <= MAX_DAILY_BUCKET_SPAN
      ? 'daily'
      : 'monthly';

  return {
    preset,
    range,
    previousRange,
    label,
    startInput: formatLocalDateInput(range.startDate),
    endInput: formatLocalDateInput(range.endDate),
    granularity
  };
}

/**
 * FinancialAnalyticsService
 *
 * Read-only application analytics service deriving summaries, time-series trends,
 * category expense breakdowns, historical comparisons, and deterministic insights
 * strictly in integer paise from verified ledger transactions.
 */
export class FinancialAnalyticsService {
  public static analyze(params: {
    userId: string;
    transactions: readonly AnalyticsTransactionRecord[];
    categories: readonly Category[];
    preset: AnalyticsDatePreset;
    customRange?: CustomDateRangeInput;
    now?: Date;
  }): FinancialAnalyticsResult {
    const validatedUserId = validateUserId(params.userId);
    const now = params.now ?? new Date();

    // 1. Verify tenant ownership & financial validity once before filtering
    const activeOwnedTxs: Array<{
      record: AnalyticsTransactionRecord;
      date: Date;
    }> = [];

    for (const tx of params.transactions) {
      if (tx.userId !== validatedUserId) {
        throw new UnauthorizedEntityAccessError('Transaction', tx.id);
      }

      if (isSoftDeletedTx(tx)) {
        continue;
      }

      const money = Money.fromPaise(tx.amountPaise, 'INR');
      if (!money.isPositive()) {
        throw new InvalidTransactionAmountError(
          `Transaction '${tx.id}' has non-positive amountPaise '${tx.amountPaise}'.`
        );
      }

      const parsedDate = parseTransactionDate(tx.transactionDate, tx.id);
      activeOwnedTxs.push({ record: tx, date: parsedDate });
    }

    // Build category map (only categories owned by user or default categories)
    const categoryMap = new Map<string, Category>();
    for (const cat of params.categories) {
      if (cat.userId === validatedUserId || cat.isDefault) {
        categoryMap.set(cat.id, cat);
      }
    }

    // 2. Resolve period & previous period using local calendar boundaries
    const period = resolveAnalyticsDateRange(
      params.preset,
      now,
      params.customRange,
      activeOwnedTxs.map((t) => t.record)
    );

    // 3. Partition transactions for current period and previous period
    let totalIncomePaise = 0;
    let totalExpensePaise = 0;
    let incomeCount = 0;
    let expenseCount = 0;
    let transferCount = 0;

    let largestExpense: { title: string; amountPaise: number; date: Date } | null = null;
    const categoryTotals = new Map<string, { paise: number; count: number }>();
    const monthlyExpenseTotals = new Map<string, number>();

    // Seed continuous empty buckets across current range
    const bucketOrder: string[] = [];
    const bucketMap = new Map<
      string,
      { label: string; incomePaise: number; expensePaise: number }
    >();

    if (period.granularity === 'daily') {
      const cursor = startOfLocalDay(period.range.startDate);
      const endDay = startOfLocalDay(period.range.endDate);
      while (cursor.getTime() <= endDay.getTime()) {
        const key = formatLocalDateInput(cursor);
        bucketOrder.push(key);
        bucketMap.set(key, {
          label: formatDate(cursor, 'dd MMM'),
          incomePaise: 0,
          expensePaise: 0
        });
        cursor.setDate(cursor.getDate() + 1);
      }
    } else {
      const cursor = new Date(
        period.range.startDate.getFullYear(),
        period.range.startDate.getMonth(),
        1
      );
      const endMonth = new Date(
        period.range.endDate.getFullYear(),
        period.range.endDate.getMonth(),
        1
      );
      while (cursor.getTime() <= endMonth.getTime()) {
        const key = formatLocalMonthKey(cursor);
        bucketOrder.push(key);
        bucketMap.set(key, {
          label: formatDate(cursor, 'MMM yyyy'),
          incomePaise: 0,
          expensePaise: 0
        });
        cursor.setMonth(cursor.getMonth() + 1);
      }
    }

    // Aggregate current period transactions
    for (const { record: tx, date } of activeOwnedTxs) {
      if (!period.range.contains(date)) continue;

      if (tx.type === 'transfer') {
        transferCount++;
        continue;
      }

      const bucketKey =
        period.granularity === 'daily'
          ? formatLocalDateInput(date)
          : formatLocalMonthKey(date);

      const bucket = bucketMap.get(bucketKey);

      if (tx.type === 'income') {
        totalIncomePaise = safeAddAnalyticsPaise(totalIncomePaise, tx.amountPaise);
        incomeCount++;
        if (bucket) {
          bucket.incomePaise = safeAddAnalyticsPaise(bucket.incomePaise, tx.amountPaise);
        }
      } else if (tx.type === 'expense') {
        totalExpensePaise = safeAddAnalyticsPaise(totalExpensePaise, tx.amountPaise);
        expenseCount++;
        if (bucket) {
          bucket.expensePaise = safeAddAnalyticsPaise(bucket.expensePaise, tx.amountPaise);
        }

        // Track monthly expense totals for highest-spending month insight
        const monthKey = formatLocalMonthKey(date);
        monthlyExpenseTotals.set(
          monthKey,
          safeAddAnalyticsPaise(monthlyExpenseTotals.get(monthKey) ?? 0, tx.amountPaise)
        );

        // Track largest single expense
        if (!largestExpense || tx.amountPaise > largestExpense.amountPaise) {
          largestExpense = {
            title: tx.title,
            amountPaise: tx.amountPaise,
            date
          };
        }

        // Category breakdown: guard against income category references
        const matchedCat = tx.categoryId ? categoryMap.get(tx.categoryId) : undefined;
        const effectiveCatId =
          matchedCat && matchedCat.type === 'expense' ? matchedCat.id : 'uncategorized';

        const prevCat = categoryTotals.get(effectiveCatId) ?? { paise: 0, count: 0 };
        categoryTotals.set(effectiveCatId, {
          paise: safeAddAnalyticsPaise(prevCat.paise, tx.amountPaise),
          count: prevCat.count + 1
        });
      }
    }

    const netCashFlowPaise = totalIncomePaise - totalExpensePaise;
    let savingsRatePercent: number | null = null;
    let savingsRateFormatted = '—';

    if (totalIncomePaise > 0) {
      savingsRatePercent =
        Math.round(((totalIncomePaise - totalExpensePaise) / totalIncomePaise) * 1000) / 10;
      savingsRateFormatted = `${savingsRatePercent.toFixed(1).replace(/\.0$/, '')}%`;
    }

    const summary: AnalyticsSummaryMetrics = {
      totalIncomePaise,
      totalIncomeFormatted: formatPaiseToINR(totalIncomePaise),
      totalExpensePaise,
      totalExpenseFormatted: formatPaiseToINR(totalExpensePaise),
      netCashFlowPaise,
      netCashFlowFormatted: formatPaiseToINR(netCashFlowPaise),
      savingsRatePercent,
      savingsRateFormatted,
      activeTransactionCount: incomeCount + expenseCount + transferCount,
      incomeCount,
      expenseCount,
      transferCount
    };

    // 4. Time series points
    const timeSeries: AnalyticsTrendPoint[] = bucketOrder.map((key) => {
      const b = bucketMap.get(key)!;
      const net = b.incomePaise - b.expensePaise;
      return {
        bucketKey: key,
        label: b.label,
        incomePaise: b.incomePaise,
        expensePaise: b.expensePaise,
        netPaise: net,
        incomeRupees: b.incomePaise / 100,
        expenseRupees: b.expensePaise / 100,
        incomeFormatted: formatPaiseToINR(b.incomePaise),
        expenseFormatted: formatPaiseToINR(b.expensePaise)
      };
    });

    const hasTimeSeriesData = timeSeries.some(
      (pt) => pt.incomePaise > 0 || pt.expensePaise > 0
    );

    // 5. Category Expense Breakdown
    const rawCategories = Array.from(categoryTotals.entries()).map(([catId, agg]) => {
      const cat = catId !== 'uncategorized' ? categoryMap.get(catId) : undefined;
      return {
        categoryId: catId,
        categoryName: cat?.name ?? 'Uncategorized',
        categoryIcon: cat?.icon,
        explicitColor: cat?.color,
        totalPaise: agg.paise,
        transactionCount: agg.count
      };
    });

    rawCategories.sort((a, b) => {
      if (b.totalPaise !== a.totalPaise) return b.totalPaise - a.totalPaise;
      return a.categoryName.localeCompare(b.categoryName);
    });

    const expenseBreakdown: ExpenseCategoryBreakdownItem[] = rawCategories.map((item, idx) => ({
      categoryId: item.categoryId,
      categoryName: item.categoryName,
      categoryIcon: item.categoryIcon,
      categoryColor:
        item.explicitColor ||
        FALLBACK_CATEGORY_COLORS[idx % FALLBACK_CATEGORY_COLORS.length],
      totalPaise: item.totalPaise,
      totalFormatted: formatPaiseToINR(item.totalPaise),
      percentageOfExpenses:
        totalExpensePaise > 0
          ? Math.round((item.totalPaise / totalExpensePaise) * 1000) / 10
          : 0,
      transactionCount: item.transactionCount
    }));

    // 6. Previous Equivalent Period Comparison & Category Increases
    let previousExpensePaise = 0;
    let previousActiveCount = 0;
    const previousCategoryTotals = new Map<string, number>();

    if (period.previousRange) {
      for (const { record: tx, date } of activeOwnedTxs) {
        if (!period.previousRange.contains(date)) continue;
        if (tx.type !== 'transfer') {
          previousActiveCount++;
        }
        if (tx.type !== 'expense') continue;

        previousExpensePaise = safeAddAnalyticsPaise(previousExpensePaise, tx.amountPaise);

        const matchedCat = tx.categoryId ? categoryMap.get(tx.categoryId) : undefined;
        const effectiveCatId =
          matchedCat && matchedCat.type === 'expense' ? matchedCat.id : 'uncategorized';

        previousCategoryTotals.set(
          effectiveCatId,
          safeAddAnalyticsPaise(previousCategoryTotals.get(effectiveCatId) ?? 0, tx.amountPaise)
        );
      }
    }

    let spendingTrend: SpendingTrendComparison;
    if (!period.previousRange) {
      spendingTrend = {
        currentExpensePaise: totalExpensePaise,
        currentExpenseFormatted: formatPaiseToINR(totalExpensePaise),
        previousExpensePaise: null,
        previousExpenseFormatted: null,
        deltaPaise: null,
        deltaFormatted: null,
        percentageChange: null,
        direction: 'unavailable',
        comparisonAvailable: false,
        insufficientDataReason: 'No prior equivalent period exists for All Time.'
      };
    } else if (previousActiveCount === 0 || previousExpensePaise === 0) {
      spendingTrend = {
        currentExpensePaise: totalExpensePaise,
        currentExpenseFormatted: formatPaiseToINR(totalExpensePaise),
        previousExpensePaise: null,
        previousExpenseFormatted: null,
        deltaPaise: null,
        deltaFormatted: null,
        percentageChange: null,
        direction: 'unavailable',
        comparisonAvailable: false,
        insufficientDataReason:
          'Insufficient historical expense data in the previous period to calculate a meaningful trend comparison.'
      };
    } else {
      const deltaPaise = totalExpensePaise - previousExpensePaise;
      const pctChange = Math.round((deltaPaise / previousExpensePaise) * 1000) / 10;
      spendingTrend = {
        currentExpensePaise: totalExpensePaise,
        currentExpenseFormatted: formatPaiseToINR(totalExpensePaise),
        previousExpensePaise,
        previousExpenseFormatted: formatPaiseToINR(previousExpensePaise),
        deltaPaise,
        deltaFormatted: `${deltaPaise > 0 ? '+' : ''}${formatPaiseToINR(deltaPaise)}`,
        percentageChange: pctChange,
        direction: deltaPaise > 0 ? 'increase' : deltaPaise < 0 ? 'decrease' : 'flat',
        comparisonAvailable: true
      };
    }

    const categoryIncreases: CategorySpendingIncrease[] = [];
    if (spendingTrend.comparisonAvailable) {
      for (const item of expenseBreakdown) {
        const prevCatPaise = previousCategoryTotals.get(item.categoryId) ?? 0;
        if (prevCatPaise > 0 && item.totalPaise > prevCatPaise) {
          const deltaPaise = item.totalPaise - prevCatPaise;
          const pct = Math.round((deltaPaise / prevCatPaise) * 1000) / 10;
          categoryIncreases.push({
            categoryId: item.categoryId,
            categoryName: item.categoryName,
            currentPaise: item.totalPaise,
            previousPaise: prevCatPaise,
            deltaPaise,
            deltaFormatted: `+${formatPaiseToINR(deltaPaise)}`,
            percentageChange: pct
          });
        }
      }
      categoryIncreases.sort((a, b) => b.deltaPaise - a.deltaPaise);
    }

    // 7. Deterministic Financial Activity Insights
    const insights: FinancialActivityInsight[] = [];

    if (expenseBreakdown.length > 0) {
      const top = expenseBreakdown[0];
      insights.push({
        id: 'top-category',
        type: 'top_category',
        title: 'Highest-Spending Category',
        description: `${top.categoryName} led expenses at ${top.totalFormatted} (${top.percentageOfExpenses}% of period spending).`,
        tone: 'neutral'
      });
    }

    if (largestExpense) {
      insights.push({
        id: 'largest-expense',
        type: 'largest_expense',
        title: 'Largest Single Expense',
        description: `${largestExpense.title} (${formatPaiseToINR(largestExpense.amountPaise)}) on ${formatDate(largestExpense.date, 'dd MMM yyyy')}.`,
        tone: 'neutral'
      });
    }

    if (monthlyExpenseTotals.size >= 2) {
      let topMonthKey: string | null = null;
      let topMonthPaise = 0;
      for (const [mKey, mPaise] of monthlyExpenseTotals.entries()) {
        if (mPaise > topMonthPaise) {
          topMonthPaise = mPaise;
          topMonthKey = mKey;
        }
      }
      if (topMonthKey && topMonthPaise > 0) {
        const [yrStr, moStr] = topMonthKey.split('-');
        const monthDate = new Date(Number(yrStr), Number(moStr) - 1, 1);
        const monthLabel = new Intl.DateTimeFormat('en-IN', {
          month: 'long',
          year: 'numeric'
        }).format(monthDate);
        insights.push({
          id: 'highest-month',
          type: 'highest_month',
          title: 'Highest Spending Month',
          description: `${monthLabel} had the highest expenses in this range at ${formatPaiseToINR(topMonthPaise)}.`,
          tone: 'neutral'
        });
      }
    }

    if (spendingTrend.comparisonAvailable && spendingTrend.percentageChange !== null) {
      const absDelta = formatPaiseToINR(Math.abs(spendingTrend.deltaPaise ?? 0));
      if (spendingTrend.direction === 'increase') {
        insights.push({
          id: 'period-change',
          type: 'period_change',
          title: 'Spending Up vs. Previous Period',
          description: `Total expenses rose ${spendingTrend.percentageChange}% (+${absDelta}) compared to ${spendingTrend.previousExpenseFormatted}.`,
          tone: 'warning'
        });
      } else if (spendingTrend.direction === 'decrease') {
        insights.push({
          id: 'period-change',
          type: 'period_change',
          title: 'Spending Down vs. Previous Period',
          description: `Total expenses decreased ${Math.abs(spendingTrend.percentageChange)}% (-${absDelta}) compared to ${spendingTrend.previousExpenseFormatted}.`,
          tone: 'positive'
        });
      } else {
        insights.push({
          id: 'period-change',
          type: 'period_change',
          title: 'Spending Unchanged vs. Previous Period',
          description: `Total expenses matched the previous period at ${spendingTrend.currentExpenseFormatted}.`,
          tone: 'neutral'
        });
      }
    }

    if (categoryIncreases.length > 0) {
      const topInc = categoryIncreases[0];
      insights.push({
        id: 'category-increase',
        type: 'category_increase',
        title: 'Notable Category Increase',
        description: `${topInc.categoryName} increased by ${topInc.deltaFormatted} (+${topInc.percentageChange}%) versus the prior period.`,
        tone: 'warning'
      });
    }

    return {
      period,
      summary,
      timeSeries,
      hasTimeSeriesData,
      expenseBreakdown,
      spendingTrend,
      categoryIncreases,
      insights
    };
  }
}

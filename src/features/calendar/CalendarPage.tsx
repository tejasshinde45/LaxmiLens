import React, { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  Calendar as CalendarIcon,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  RefreshCw,
  Repeat,
  Wallet
} from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/feedback/EmptyState';
import { useTransactions } from '@/features/transactions/hooks/useTransactions';
import { useAccounts } from '@/features/accounts/hooks/useAccounts';
import { useCategories } from '@/features/categories/hooks/useCategories';
import { useRecurring } from '@/features/recurring/hooks/useRecurring';
import { CategoryIcon } from '@/features/categories/components/CategoryIcon';
import { TransactionDetailModal } from '@/features/transactions/components/TransactionDetailModal';
import { TransactionResponseDTO } from '@/application/dto/TransactionDTO';
import { AccountWithBalanceDTO } from '@/application/dto/AccountDTO';
import { Category } from '@/domain/entities/Category';
import {
  getDaysInMonth,
  getLocalTodayDateString,
  parseLocalCalendarDate
} from '@/domain/services/RecurrenceScheduleService';
import { formatPaiseToINR } from '@/utils/formatters';
import { cn } from '@/utils/cn';
import {
  CALENDAR_WEEKDAYS,
  CalendarDayCell,
  CalendarRecurringItem,
  CalendarRecurringStatus,
  DailyLedgerSummary,
  buildCalendarMonthGrid,
  buildDailyLedgerMap,
  buildGridRecurringMap,
  computeMonthlyCalendarSummary,
  formatLocalDateHeading,
  shiftCalendarMonth
} from './calendarService';

const RECURRING_STATUS_META: Record<
  CalendarRecurringStatus,
  { label: string; variant: 'expense' | 'gold' | 'warning' | 'neutral' }
> = {
  overdue: { label: 'Overdue', variant: 'expense' },
  due_today: { label: 'Due Today', variant: 'gold' },
  snoozed: { label: 'Snoozed', variant: 'warning' },
  upcoming: { label: 'Due Soon', variant: 'neutral' },
  projected: { label: 'Scheduled', variant: 'neutral' }
};

export const CalendarPage: React.FC = () => {
  const navigate = useNavigate();

  // Anchor "today" to the user's local calendar date
  const todayDateKey = getLocalTodayDateString();
  const initialToday = parseLocalCalendarDate(todayDateKey);

  const [displayedMonth, setDisplayedMonth] = useState<{ year: number; month: number }>({
    year: initialToday.year,
    month: initialToday.month
  });
  const [selectedDateKey, setSelectedDateKey] = useState<string>(todayDateKey);
  const [selectedDetailTx, setSelectedDetailTx] = useState<TransactionResponseDTO | null>(null);
  const calendarGridRef = useRef<HTMLDivElement>(null);

  const {
    transactions,
    pendingTxIdSet,
    isLoading: isTransactionsLoading,
    isError: isTransactionsError,
    error: transactionsError,
    refetch: refetchTransactions
  } = useTransactions();

  const { accounts, isLoading: isAccountsLoading } = useAccounts();
  const { categories } = useCategories();

  const {
    overdue,
    dueToday,
    upcoming,
    snoozed,
    recentlyGenerated,
    schedules,
    isLoading: isRecurringLoading
  } = useRecurring(todayDateKey);

  // Fast lookup maps for selected-day item rendering
  const accountMap = useMemo(
    () => new Map<string, AccountWithBalanceDTO>(accounts.map((acc) => [acc.id, acc])),
    [accounts]
  );
  const categoryMap = useMemo(
    () => new Map<string, Category>(categories.map((cat) => [cat.id, cat])),
    [categories]
  );

  // Memoize grid and O(N) daily ledger map cleanly
  const monthGrid = useMemo(
    () => buildCalendarMonthGrid(displayedMonth.year, displayedMonth.month, todayDateKey),
    [displayedMonth.year, displayedMonth.month, todayDateKey]
  );

  const dailyLedgerMap = useMemo(
    () => buildDailyLedgerMap(transactions),
    [transactions]
  );

  const gridRecurringMap = useMemo(() => {
    const firstCell = monthGrid.cells[0]?.dateKey ?? monthGrid.monthStartDateKey;
    const lastCell = monthGrid.cells[monthGrid.cells.length - 1]?.dateKey ?? monthGrid.monthEndDateKey;
    return buildGridRecurringMap({
      gridStartDateKey: firstCell,
      gridEndDateKey: lastCell,
      todayDateKey,
      overdue,
      dueToday,
      upcoming,
      snoozed,
      recentlyGenerated,
      schedules
    });
  }, [
    monthGrid,
    todayDateKey,
    overdue,
    dueToday,
    upcoming,
    snoozed,
    recentlyGenerated,
    schedules
  ]);

  const monthSummary = useMemo(
    () => computeMonthlyCalendarSummary(monthGrid.monthKey, dailyLedgerMap, gridRecurringMap),
    [monthGrid.monthKey, dailyLedgerMap, gridRecurringMap]
  );

  const selectedDayLedger: DailyLedgerSummary = dailyLedgerMap.get(selectedDateKey) ?? {
    dateKey: selectedDateKey,
    totalIncomePaise: 0,
    totalExpensePaise: 0,
    netCashFlowPaise: 0,
    transactionCount: 0,
    transferCount: 0,
    transactions: []
  };

  const selectedDayRecurring: readonly CalendarRecurringItem[] =
    gridRecurringMap.get(selectedDateKey) ?? [];

  const handleShiftMonth = (delta: number) => {
    const shifted = shiftCalendarMonth(displayedMonth.year, displayedMonth.month, delta);
    setDisplayedMonth(shifted);

    // Keep day-of-month aligned smoothly when moving across months (clamped safely e.g. 31 -> Feb 28/29)
    const parsedSelected = parseLocalCalendarDate(selectedDateKey);
    const maxDay = getDaysInMonth(shifted.year, shifted.month);
    const nextDay = Math.min(parsedSelected.day, maxDay);
    setSelectedDateKey(
      `${String(shifted.year).padStart(4, '0')}-${String(shifted.month).padStart(2, '0')}-${String(nextDay).padStart(2, '0')}`
    );
  };

  const handleGoToday = () => {
    const freshTodayKey = getLocalTodayDateString();
    const parsed = parseLocalCalendarDate(freshTodayKey);
    setDisplayedMonth({ year: parsed.year, month: parsed.month });
    setSelectedDateKey(freshTodayKey);
  };

  const handleSelectCell = (cell: CalendarDayCell) => {
    setSelectedDateKey(cell.dateKey);
    if (!cell.isCurrentMonth) {
      setDisplayedMonth({ year: cell.year, month: cell.month });
    }
  };

  const monthWeeks = useMemo(() => {
    const weeks: CalendarDayCell[][] = [];
    for (let i = 0; i < monthGrid.cells.length; i += 7) {
      weeks.push(monthGrid.cells.slice(i, i + 7));
    }
    return weeks;
  }, [monthGrid.cells]);

  const handleGridCellKeyDown = (e: KeyboardEvent<HTMLButtonElement>, cellIndex: number) => {
    let targetIndex: number | null = null;
    if (e.key === 'ArrowRight') targetIndex = cellIndex + 1;
    else if (e.key === 'ArrowLeft') targetIndex = cellIndex - 1;
    else if (e.key === 'ArrowDown') targetIndex = cellIndex + 7;
    else if (e.key === 'ArrowUp') targetIndex = cellIndex - 7;
    else if (e.key === 'Home') targetIndex = Math.floor(cellIndex / 7) * 7;
    else if (e.key === 'End') targetIndex = Math.min(monthGrid.cells.length - 1, Math.floor(cellIndex / 7) * 7 + 6);

    if (targetIndex === null) return;
    if (targetIndex < 0 || targetIndex >= monthGrid.cells.length) return;

    e.preventDefault();
    const targetCell = monthGrid.cells[targetIndex];
    if (!targetCell) return;

    handleSelectCell(targetCell);
    requestAnimationFrame(() => {
      const btn = calendarGridRef.current?.querySelector<HTMLButtonElement>(
        `button[data-date="${targetCell.dateKey}"]`
      );
      btn?.focus();
    });
  };

  const isViewingCurrentMonth =
    displayedMonth.year === initialToday.year && displayedMonth.month === initialToday.month;
  const isInitialLoading = (isTransactionsLoading || isAccountsLoading) && transactions.length === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Calendar"
        description="Local-time monthly view of recorded cash flow, internal transfers, and scheduled commitments."
        badge={
          monthSummary.scheduledCount > 0 ? (
            <Badge variant="gold" size="sm">
              {monthSummary.scheduledCount} Scheduled
            </Badge>
          ) : undefined
        }
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              type="button"
              variant="outline"
              size="sm"
              leftIcon={<Repeat className="h-3.5 w-3.5" aria-hidden="true" />}
              onClick={() => navigate('/recurring')}
            >
              Recurring Schedules
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => navigate('/transactions')}
            >
              View Ledger
            </Button>
          </div>
        }
      />

      {isTransactionsError && (
        <Card className="border-[#D9827C]/30 bg-[#D9827C]/10 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-start gap-2.5 text-xs text-[#D9827C]">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <p className="font-semibold text-[#F5F1E8]">Unable to load ledger activity</p>
              <p className="text-[#B9B4AA] mt-0.5">
                {transactionsError instanceof Error
                  ? transactionsError.message
                  : 'Local database query failed while loading transactions.'}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void refetchTransactions()}
            leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
          >
            Retry
          </Button>
        </Card>
      )}

      {/* Monthly KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4 border-[#303030] bg-[#1B1B1B] space-y-1">
          <p className="text-xs font-medium text-[#B9B4AA] uppercase tracking-wider">
            Month Income
          </p>
          {isInitialLoading ? (
            <Skeleton className="h-7 w-28" />
          ) : (
            <p className="text-xl font-bold font-tabular text-[#72B895]">
              +{formatPaiseToINR(monthSummary.totalIncomePaise)}
            </p>
          )}
          <p className="text-[11px] text-[#858078]">{monthGrid.label}</p>
        </Card>

        <Card className="p-4 border-[#303030] bg-[#1B1B1B] space-y-1">
          <p className="text-xs font-medium text-[#B9B4AA] uppercase tracking-wider">
            Month Expenses
          </p>
          {isInitialLoading ? (
            <Skeleton className="h-7 w-28" />
          ) : (
            <p className="text-xl font-bold font-tabular text-[#D9827C]">
              -{formatPaiseToINR(monthSummary.totalExpensePaise)}
            </p>
          )}
          <p className="text-[11px] text-[#858078]">
            {monthSummary.activeDaysCount} active day{monthSummary.activeDaysCount === 1 ? '' : 's'}
          </p>
        </Card>

        <Card className="p-4 border-[#303030] bg-[#1B1B1B] space-y-1">
          <p className="text-xs font-medium text-[#B9B4AA] uppercase tracking-wider">
            Net Cash Flow
          </p>
          {isInitialLoading ? (
            <Skeleton className="h-7 w-28" />
          ) : (
            <p
              className={cn(
                'text-xl font-bold font-tabular',
                monthSummary.netCashFlowPaise >= 0 ? 'text-[#F5F1E8]' : 'text-[#D9827C]'
              )}
            >
              {monthSummary.netCashFlowPaise > 0 ? '+' : ''}
              {formatPaiseToINR(monthSummary.netCashFlowPaise)}
            </p>
          )}
          <p className="text-[11px] text-[#858078]">
            {monthSummary.transferCount > 0
              ? `${monthSummary.transferCount} transfer${monthSummary.transferCount === 1 ? '' : 's'} excluded`
              : `${monthSummary.transactionCount} recorded ${monthSummary.transactionCount === 1 ? 'entry' : 'entries'}`}
          </p>
        </Card>

        <Card className="p-4 border-[#303030] bg-[#1B1B1B] space-y-1">
          <p className="text-xs font-medium text-[#B9B4AA] uppercase tracking-wider">
            Scheduled Commitments
          </p>
          {isRecurringLoading ? (
            <Skeleton className="h-7 w-28" />
          ) : (
            <p className="text-xl font-bold font-tabular text-[#D6AD60]">
              {monthSummary.scheduledCount}
            </p>
          )}
          <p className="text-[11px] text-[#858078]">
            {monthSummary.scheduledExpensePaise > 0
              ? `Est. outflow ${formatPaiseToINR(monthSummary.scheduledExpensePaise)}`
              : 'Read-only recurring schedule view'}
          </p>
        </Card>
      </div>

      {/* Main Split Workspace: Monthly Calendar Grid + Selected Date Ledger Drawer */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Monthly Grid */}
        <Card className="lg:col-span-8 p-4 sm:p-5 border-[#303030] bg-[#1B1B1B] space-y-4">
          {/* Calendar Toolbar */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-[#303030]">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#242424] border border-[#303030] text-[#D6AD60]">
                <CalendarDays className="h-4 w-4" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-lg font-bold tracking-tight text-[#F5F1E8] font-display">
                  {monthGrid.label}
                </h2>
                <p className="text-[11px] text-[#858078]">
                  {monthGrid.daysInMonth} days • Local time
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="Previous month"
                onClick={() => handleShiftMonth(-1)}
                leftIcon={<ChevronLeft className="h-4 w-4" aria-hidden="true" />}
              >
                <span className="sr-only sm:not-sr-only">Prev</span>
              </Button>

              <Button
                type="button"
                variant={isViewingCurrentMonth && selectedDateKey === todayDateKey ? 'secondary' : 'gold-subtle'}
                size="sm"
                onClick={handleGoToday}
              >
                Today
              </Button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="Next month"
                onClick={() => handleShiftMonth(1)}
                rightIcon={<ChevronRight className="h-4 w-4" aria-hidden="true" />}
              >
                <span className="sr-only sm:not-sr-only">Next</span>
              </Button>
            </div>
          </div>

          {/* Activity Legend */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-[#858078]">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[#72B895]" aria-hidden="true" />
              Income
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[#D9827C]" aria-hidden="true" />
              Expense
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[#82A9CF]" aria-hidden="true" />
              Transfer
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[#D6AD60]" aria-hidden="true" />
              Scheduled
            </span>
          </div>

          {/* Weekday Headers */}
          <div className="sr-only" aria-live="polite">
            {monthGrid.label}, selected date {formatLocalDateHeading(selectedDateKey)}
          </div>
          <div
            ref={calendarGridRef}
            role="grid"
            aria-label={`${monthGrid.label} Financial Calendar`}
            className="space-y-1.5"
          >
            <div role="row" className="grid grid-cols-7 gap-1 sm:gap-2">
              {CALENDAR_WEEKDAYS.map((weekday) => (
                <div
                  key={weekday}
                  role="columnheader"
                  className="py-1.5 text-center text-[11px] font-semibold uppercase tracking-wider text-[#858078]"
                >
                  {weekday}
                </div>
              ))}
            </div>

            {/* Weeks Matrix */}
            <div className="space-y-1 sm:space-y-2">
              {monthWeeks.map((week, weekIdx) => (
                <div key={`week-${weekIdx}`} role="row" className="grid grid-cols-7 gap-1 sm:gap-2">
                  {week.map((cell, dayOffset) => {
                    const cellIndex = weekIdx * 7 + dayOffset;
                    const dayLedger = dailyLedgerMap.get(cell.dateKey);
                    const dayRecurring = gridRecurringMap.get(cell.dateKey) ?? [];
                    const isSelected = cell.dateKey === selectedDateKey;
                    const hasIncome = (dayLedger?.totalIncomePaise ?? 0) > 0;
                    const hasExpense = (dayLedger?.totalExpensePaise ?? 0) > 0;
                    const hasTransfer = (dayLedger?.transferCount ?? 0) > 0;
                    const hasRecurring = dayRecurring.length > 0;
                    const totalEntries = dayLedger?.transactionCount ?? 0;

                    return (
                      <button
                        key={cell.dateKey}
                        type="button"
                        role="gridcell"
                        aria-selected={isSelected}
                        aria-current={cell.isToday ? 'date' : undefined}
                        aria-label={`${cell.dateKey}${cell.isToday ? ' (Today)' : ''}${
                          totalEntries > 0 ? `, ${totalEntries} transaction${totalEntries === 1 ? '' : 's'}` : ''
                        }${
                          dayRecurring.length > 0
                            ? `, ${dayRecurring.length} scheduled`
                            : ''
                        }`}
                        onClick={() => handleSelectCell(cell)}
                        onKeyDown={(e) => handleGridCellKeyDown(e, cellIndex)}
                        data-date={cell.dateKey}
                        className={cn(
                          'group relative flex min-h-[60px] sm:min-h-[84px] flex-col justify-between rounded-[10px] border p-1.5 sm:p-2 text-left transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D6AD60]',
                          cell.isCurrentMonth
                            ? 'bg-[#141414] border-[#303030] text-[#F5F1E8] hover:border-[#454545] hover:bg-[#1E1E1E]'
                            : 'bg-[#101010]/60 border-[#242424] text-[#858078]/60 hover:text-[#B9B4AA]',
                          cell.isToday &&
                            !isSelected &&
                            'border-[#D6AD60]/50 bg-[#D6AD60]/[0.04]',
                          isSelected &&
                            'border-[#D6AD60] bg-[#D6AD60]/10 ring-1 ring-[#D6AD60]'
                        )}
                      >
                        {/* Date Number + Today Indicator */}
                        <div className="flex items-center justify-between gap-1 w-full">
                          <span
                            className={cn(
                              'text-xs font-semibold font-tabular leading-none',
                              isSelected
                                ? 'text-[#D6AD60]'
                                : cell.isToday
                                ? 'text-[#E2BE7D]'
                                : cell.isCurrentMonth
                                ? 'text-[#F5F1E8]'
                                : 'text-[#858078]/70'
                            )}
                          >
                            {cell.day}
                          </span>

                          {cell.isToday && (
                            <span className="hidden sm:inline-block rounded bg-[#D6AD60]/20 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#D6AD60]">
                              Today
                            </span>
                          )}
                          {cell.isToday && (
                            <span
                              className="sm:hidden h-1.5 w-1.5 rounded-full bg-[#D6AD60]"
                              aria-hidden="true"
                            />
                          )}
                        </div>

                        {/* Desktop Daily Amount Micro-summary */}
                        <div className="hidden sm:flex flex-col gap-0.5 w-full overflow-hidden">
                          {hasIncome && (
                            <span className="truncate text-[10px] font-medium font-tabular text-[#72B895]">
                              +{formatPaiseToINR(dayLedger!.totalIncomePaise, { showDecimals: false })}
                            </span>
                          )}
                          {hasExpense && (
                            <span className="truncate text-[10px] font-medium font-tabular text-[#D9827C]">
                              -{formatPaiseToINR(dayLedger!.totalExpensePaise, { showDecimals: false })}
                            </span>
                          )}
                          {!hasIncome && !hasExpense && hasTransfer && (
                            <span className="truncate text-[10px] font-medium text-[#82A9CF]">
                              {dayLedger!.transferCount} transfer{dayLedger!.transferCount === 1 ? '' : 's'}
                            </span>
                          )}
                          {hasRecurring && !hasIncome && !hasExpense && !hasTransfer && (
                            <span className="truncate text-[10px] font-medium text-[#D6AD60]">
                              {dayRecurring.length} due
                            </span>
                          )}
                        </div>

                        {/* Dot Indicators Row (Always visible on mobile & desktop) */}
                        {(hasIncome || hasExpense || hasTransfer || hasRecurring) && (
                          <div className="flex items-center gap-1 pt-0.5">
                            {hasIncome && (
                              <span className="h-1.5 w-1.5 rounded-full bg-[#72B895]" aria-hidden="true" />
                            )}
                            {hasExpense && (
                              <span className="h-1.5 w-1.5 rounded-full bg-[#D9827C]" aria-hidden="true" />
                            )}
                            {hasTransfer && (
                              <span className="h-1.5 w-1.5 rounded-full bg-[#82A9CF]" aria-hidden="true" />
                            )}
                            {hasRecurring && (
                              <span className="h-1.5 w-1.5 rounded-full bg-[#D6AD60]" aria-hidden="true" />
                            )}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* Selected-Day Activity Drawer */}
        <Card className="lg:col-span-4 p-4 sm:p-5 border-[#303030] bg-[#1B1B1B] space-y-5">
          {/* Selected Date Header */}
          <div className="flex items-start justify-between gap-2 border-b border-[#303030] pb-3">
            <div className="space-y-0.5 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-bold text-[#F5F1E8] font-display">
                  {formatLocalDateHeading(selectedDateKey)}
                </h2>
                {selectedDateKey === todayDateKey && (
                  <Badge variant="gold" size="sm">
                    Today
                  </Badge>
                )}
              </div>
              <p className="text-xs text-[#858078] font-mono">{selectedDateKey}</p>
            </div>
          </div>

          {/* Daily Financial Totals */}
          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-lg border border-[#303030] bg-[#141414] p-3 space-y-0.5">
              <span className="text-[11px] text-[#858078]">Daily Income</span>
              <p className="text-sm font-bold font-tabular text-[#72B895]">
                +{formatPaiseToINR(selectedDayLedger.totalIncomePaise)}
              </p>
            </div>

            <div className="rounded-lg border border-[#303030] bg-[#141414] p-3 space-y-0.5">
              <span className="text-[11px] text-[#858078]">Daily Expenses</span>
              <p className="text-sm font-bold font-tabular text-[#D9827C]">
                -{formatPaiseToINR(selectedDayLedger.totalExpensePaise)}
              </p>
            </div>

            <div className="rounded-lg border border-[#303030] bg-[#141414] p-3 space-y-0.5">
              <span className="text-[11px] text-[#858078]">Daily Net</span>
              <p
                className={cn(
                  'text-sm font-bold font-tabular',
                  selectedDayLedger.netCashFlowPaise >= 0 ? 'text-[#F5F1E8]' : 'text-[#D9827C]'
                )}
              >
                {selectedDayLedger.netCashFlowPaise > 0 ? '+' : ''}
                {formatPaiseToINR(selectedDayLedger.netCashFlowPaise)}
              </p>
            </div>

            <div className="rounded-lg border border-[#303030] bg-[#141414] p-3 space-y-0.5">
              <span className="text-[11px] text-[#858078]">Transactions</span>
              <p className="text-sm font-bold font-tabular text-[#F5F1E8]">
                {selectedDayLedger.transactionCount}
              </p>
            </div>
          </div>

          {/* Persisted Transactions List */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#B9B4AA]">
                Recorded Activity
              </h3>
              {selectedDayLedger.transferCount > 0 && (
                <span className="text-[11px] text-[#82A9CF]">
                  Transfers excluded from totals
                </span>
              )}
            </div>

            {selectedDayLedger.transactions.length === 0 ? (
              selectedDayRecurring.length === 0 ? (
                <EmptyState
                  icon={CalendarIcon}
                  title="No transactions on this date"
                  description="Select another highlighted day or record a transaction from Quick Add or the Transactions ledger."
                  actionLabel="Open Transactions"
                  onAction={() => navigate('/transactions')}
                />
              ) : (
                <div className="rounded-lg border border-dashed border-[#303030] bg-[#141414]/60 p-4 text-center text-xs text-[#858078]">
                  No recorded ledger transactions on {selectedDateKey}. See upcoming commitments below.
                </div>
              )
            ) : (
              <div className="space-y-2">
                {selectedDayLedger.transactions.map((tx) => {
                  const sourceAcc = accountMap.get(tx.accountId);
                  const destAcc = tx.destinationAccountId
                    ? accountMap.get(tx.destinationAccountId)
                    : undefined;
                  const category = tx.categoryId ? categoryMap.get(tx.categoryId) : undefined;
                  const isIncome = tx.type === 'income';
                  const isExpense = tx.type === 'expense';
                  const isTransfer = tx.type === 'transfer';

                  return (
                    <button
                      key={tx.id}
                      type="button"
                      onClick={() => setSelectedDetailTx(tx)}
                      className="w-full text-left rounded-lg border border-[#303030] bg-[#141414] p-3 transition-colors hover:border-[#454545] hover:bg-[#1E1E1E] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D6AD60]"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-semibold text-[#F5F1E8] truncate">
                              {tx.title || 'Untitled Transaction'}
                            </span>
                            <Badge
                              variant={
                                isIncome ? 'income' : isExpense ? 'expense' : 'transfer'
                              }
                              size="sm"
                            >
                              {isIncome ? 'Income' : isExpense ? 'Expense' : 'Transfer'}
                            </Badge>
                          </div>

                          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-[#858078]">
                            <span className="inline-flex items-center gap-1">
                              <Wallet className="h-3 w-3" aria-hidden="true" />
                              {isTransfer ? (
                                <span className="inline-flex items-center gap-1">
                                  <span>{sourceAcc?.name ?? 'Unknown Account'}</span>
                                  <ArrowRight className="h-2.5 w-2.5 text-[#82A9CF]" aria-hidden="true" />
                                  <span>{destAcc?.name ?? 'Unknown Account'}</span>
                                </span>
                              ) : (
                                <span>{sourceAcc?.name ?? 'Unknown Account'}</span>
                              )}
                            </span>

                            {!isTransfer && category && (
                              <span className="inline-flex items-center gap-1 text-[#B9B4AA]">
                                <CategoryIcon
                                  name={category.icon}
                                  color={category.color}
                                  className="h-3 w-3"
                                />
                                <span>{category.name}</span>
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="text-right shrink-0 space-y-1">
                          <p
                            className={cn(
                              'text-xs font-bold font-tabular',
                              isIncome
                                ? 'text-[#72B895]'
                                : isExpense
                                ? 'text-[#D9827C]'
                                : 'text-[#82A9CF]'
                            )}
                          >
                            {isIncome ? '+' : isExpense ? '-' : ''}
                            {formatPaiseToINR(tx.amountPaise)}
                          </p>
                          <div className="inline-flex items-center gap-1 text-[10px] text-[#858078]">
                            {isIncome ? (
                              <ArrowUpRight className="h-3 w-3 text-[#72B895]" aria-hidden="true" />
                            ) : isExpense ? (
                              <ArrowDownLeft className="h-3 w-3 text-[#D9827C]" aria-hidden="true" />
                            ) : (
                              <ArrowLeftRight className="h-3 w-3 text-[#82A9CF]" aria-hidden="true" />
                            )}
                            <span>{pendingTxIdSet.has(tx.id) ? 'Saved Locally' : 'Details'}</span>
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Read-Only Scheduled / Recurring Projections */}
          {selectedDayRecurring.length > 0 && (
            <div className="space-y-2.5 border-t border-[#303030] pt-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[#D6AD60] flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Scheduled Commitments</span>
                </h3>
                <Link to="/recurring" className="text-[11px] text-[#D6AD60] hover:underline">
                  Manage
                </Link>
              </div>

              <div className="space-y-2">
                {selectedDayRecurring.map((item) => {
                  const statusMeta = RECURRING_STATUS_META[item.status];
                  const isIncome = item.type === 'income';
                  return (
                    <div
                      key={item.id}
                      className="rounded-lg border border-[#D6AD60]/25 bg-[#D6AD60]/[0.05] p-3 space-y-1.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-semibold text-[#F5F1E8] truncate">
                              {item.title}
                            </span>
                            <Badge variant={statusMeta.variant} size="sm">
                              {statusMeta.label}
                            </Badge>
                          </div>
                          <p className="text-[11px] text-[#858078]">
                            {item.accountName}
                            {item.categoryName ? ` • ${item.categoryName}` : ''}
                            {` • ${item.frequency}`}
                          </p>
                        </div>

                        <p
                          className={cn(
                            'text-xs font-bold font-tabular shrink-0',
                            isIncome ? 'text-[#72B895]' : 'text-[#D9827C]'
                          )}
                        >
                          {isIncome ? '+' : '-'}
                          {item.amountFormatted}
                        </p>
                      </div>
                      <p className="text-[10px] text-[#858078]">
                        {item.isProjected
                          ? 'Projected schedule occurrence (read-only until confirmed on Recurring)'
                          : 'Awaiting manual confirmation on Recurring & Reminders'}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Transaction Detail Inspection Modal */}
      <TransactionDetailModal
        isOpen={Boolean(selectedDetailTx)}
        onClose={() => setSelectedDetailTx(null)}
        transaction={selectedDetailTx}
        accounts={accounts}
        categories={categories}
        isPendingSync={selectedDetailTx ? pendingTxIdSet.has(selectedDetailTx.id) : false}
        onEdit={() => {
          setSelectedDetailTx(null);
          navigate('/transactions');
        }}
        onDelete={() => {
          setSelectedDetailTx(null);
          navigate('/transactions');
        }}
      />
    </div>
  );
};

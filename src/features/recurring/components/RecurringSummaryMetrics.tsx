import React from 'react';
import { AlertTriangle, BellRing, CalendarClock, Repeat } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { RecurringOverviewSummaryDTO } from '@/application/dto/RecurringDTO';
import { cn } from '@/utils/cn';

export interface RecurringSummaryMetricsProps {
  summary: RecurringOverviewSummaryDTO;
  isLoading?: boolean;
}

export const RecurringSummaryMetrics: React.FC<RecurringSummaryMetricsProps> = ({
  summary,
  isLoading = false
}) => {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} variant="surface" className="p-4 space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-28" />
            <Skeleton className="h-3 w-32" />
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* 1. Overdue Reminders */}
      <Card
        variant="surface"
        className={cn(
          'p-4 space-y-2',
          summary.overdueCount > 0 && 'border-[#D9827C]/40'
        )}
      >
        <div className="flex items-center justify-between text-[#858078]">
          <span className="text-xs font-medium uppercase tracking-wider">Overdue</span>
          <AlertTriangle
            className={cn(
              'h-4 w-4',
              summary.overdueCount > 0 ? 'text-[#D9827C]' : 'text-[#858078]'
            )}
          />
        </div>
        <div className="space-y-0.5">
          <div
            className={cn(
              'text-2xl font-bold font-tabular',
              summary.overdueCount > 0 ? 'text-[#D9827C]' : 'text-[#F5F1E8]'
            )}
          >
            {summary.totalOverdueAmountFormatted}
          </div>
          <p className="text-[11px] text-[#858078]">
            {summary.overdueCount === 0
              ? 'No overdue reminders'
              : summary.overdueCount === 1
              ? '1 payment awaiting confirmation'
              : `${summary.overdueCount} payments awaiting confirmation`}
          </p>
        </div>
      </Card>

      {/* 2. Due Today */}
      <Card
        variant="surface"
        className={cn(
          'p-4 space-y-2',
          summary.dueTodayCount > 0 && 'border-[#D6AD60]/40'
        )}
      >
        <div className="flex items-center justify-between text-[#858078]">
          <span className="text-xs font-medium uppercase tracking-wider">Due Today</span>
          <BellRing
            className={cn(
              'h-4 w-4',
              summary.dueTodayCount > 0 ? 'text-[#D6AD60]' : 'text-[#858078]'
            )}
          />
        </div>
        <div className="space-y-0.5">
          <div className="text-2xl font-bold font-tabular text-[#E4B66D]">
            {summary.totalDueTodayAmountFormatted}
          </div>
          <p className="text-[11px] text-[#858078]">
            {summary.dueTodayCount === 0
              ? 'Nothing due today'
              : `${summary.dueTodayCount} due today`}
          </p>
        </div>
      </Card>

      {/* 3. Next 30 Days Projected Outflows */}
      <Card variant="surface" className="p-4 space-y-2">
        <div className="flex items-center justify-between text-[#858078]">
          <span className="text-xs font-medium uppercase tracking-wider">Upcoming 30d Bills</span>
          <CalendarClock className="h-4 w-4 text-[#D6AD60]" />
        </div>
        <div className="space-y-0.5">
          <div className="text-2xl font-bold font-tabular text-[#F5F1E8]">
            {summary.totalUpcoming30DaysExpenseFormatted}
          </div>
          <p className="text-[11px] text-[#858078]">
            Expected inflows: {summary.totalUpcoming30DaysIncomeFormatted}
          </p>
        </div>
      </Card>

      {/* 4. Active Schedules */}
      <Card variant="surface" className="p-4 space-y-2">
        <div className="flex items-center justify-between text-[#858078]">
          <span className="text-xs font-medium uppercase tracking-wider">Schedules</span>
          <Repeat className="h-4 w-4 text-[#72B895]" />
        </div>
        <div className="space-y-0.5">
          <div className="text-2xl font-bold font-tabular text-[#72B895]">
            {summary.activeSchedulesCount}
          </div>
          <p className="text-[11px] text-[#858078]">
            {summary.pausedSchedulesCount} paused · {summary.snoozedCount} snoozed
          </p>
        </div>
      </Card>
    </div>
  );
};

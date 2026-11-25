import React from 'react';
import { PiggyBank, ArrowDownLeft, CheckCircle2, Gauge } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { BudgetsOverviewSummaryDTO } from '@/application/dto/BudgetDTO';
import { cn } from '@/utils/cn';

export interface BudgetSummaryMetricsProps {
  summary: BudgetsOverviewSummaryDTO;
  isLoading?: boolean;
}

export const BudgetSummaryMetrics: React.FC<BudgetSummaryMetricsProps> = ({
  summary,
  isLoading = false
}) => {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} variant="surface" className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-4 w-4 rounded-full" />
            </div>
            <Skeleton className="h-7 w-28" />
            <Skeleton className="h-3 w-32" />
          </Card>
        ))}
      </div>
    );
  }

  const utilizationPct = summary.overallUtilizationPercentage;
  const clampedWidth = Math.min(100, Math.max(0, utilizationPct));
  const isOverBudget =
    summary.totalBudgetLimitPaise > 0 &&
    summary.totalSpentPaise >= summary.totalBudgetLimitPaise;
  const isWarning = !isOverBudget && utilizationPct >= 80;

  const utilizationColor = isOverBudget
    ? 'text-[#D9827C]'
    : isWarning
    ? 'text-[#E4B66D]'
    : 'text-[#72B895]';

  const barColor = isOverBudget
    ? 'bg-[#D9827C]'
    : isWarning
    ? 'bg-[#E4B66D]'
    : 'bg-[#72B895]';

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* 1. Total Budgeted */}
      <Card variant="surface" className="p-4 space-y-2">
        <div className="flex items-center justify-between text-[#858078]">
          <span className="text-xs font-medium uppercase tracking-wider">Total Budgeted</span>
          <PiggyBank className="h-4 w-4 text-[#D6AD60]" />
        </div>
        <div className="space-y-0.5">
          <div className="text-2xl font-bold font-tabular text-[#F5F1E8]">
            {summary.totalBudgetLimitFormatted}
          </div>
          <p className="text-[11px] text-[#858078]">
            {summary.budgetCount === 1
              ? '1 category budget'
              : `${summary.budgetCount} category budgets`}
          </p>
        </div>
      </Card>

      {/* 2. Total Spent */}
      <Card variant="surface" className="p-4 space-y-2">
        <div className="flex items-center justify-between text-[#858078]">
          <span className="text-xs font-medium uppercase tracking-wider">Total Spent</span>
          <ArrowDownLeft className="h-4 w-4 text-[#D9827C]" />
        </div>
        <div className="space-y-0.5">
          <div className="text-2xl font-bold font-tabular text-[#D9827C]">
            {summary.totalSpentFormatted}
          </div>
          <p className="text-[11px] text-[#858078]">Budgeted category expenses</p>
        </div>
      </Card>

      {/* 3. Remaining Budget */}
      <Card variant="surface" className="p-4 space-y-2">
        <div className="flex items-center justify-between text-[#858078]">
          <span className="text-xs font-medium uppercase tracking-wider">Remaining Budget</span>
          <CheckCircle2
            className={cn(
              'h-4 w-4',
              summary.totalRemainingPaise > 0 ? 'text-[#72B895]' : 'text-[#E4B66D]'
            )}
          />
        </div>
        <div className="space-y-0.5">
          <div
            className={cn(
              'text-2xl font-bold font-tabular',
              summary.totalRemainingPaise > 0 ? 'text-[#72B895]' : 'text-[#E4B66D]'
            )}
          >
            {summary.totalRemainingFormatted}
          </div>
          <p className="text-[11px] text-[#858078]">
            {summary.exceededCount > 0
              ? `${summary.exceededCount} category limit${summary.exceededCount > 1 ? 's' : ''} exceeded`
              : 'Available within limits'}
          </p>
        </div>
      </Card>

      {/* 4. Overall Utilization */}
      <Card variant="surface" className="p-4 space-y-2">
        <div className="flex items-center justify-between text-[#858078]">
          <span className="text-xs font-medium uppercase tracking-wider">Utilization</span>
          <Gauge className={cn('h-4 w-4', utilizationColor)} />
        </div>
        <div className="space-y-2">
          <div className={cn('text-2xl font-bold font-tabular', utilizationColor)}>
            {utilizationPct}%
          </div>
          <div className="h-1.5 w-full rounded-full bg-[#242424] overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all duration-300', barColor)}
              style={{ width: `${clampedWidth}%` }}
            />
          </div>
        </div>
      </Card>
    </div>
  );
};

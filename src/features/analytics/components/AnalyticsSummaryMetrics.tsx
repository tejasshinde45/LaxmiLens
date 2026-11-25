import React from 'react';
import {
  ArrowUpRight,
  ArrowDownLeft,
  TrendingUp,
  TrendingDown,
  Percent
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { AnalyticsSummaryMetrics as AnalyticsSummaryDTO } from '@/application/services/FinancialAnalyticsService';
import { cn } from '@/utils/cn';

export interface AnalyticsSummaryMetricsProps {
  summary: AnalyticsSummaryDTO;
  isLoading?: boolean;
}

export const AnalyticsSummaryMetrics: React.FC<AnalyticsSummaryMetricsProps> = ({
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

  const isNetPositive = summary.netCashFlowPaise >= 0;
  const savingsTone =
    summary.savingsRatePercent === null
      ? 'text-[#858078]'
      : summary.savingsRatePercent >= 20
      ? 'text-[#72B895]'
      : summary.savingsRatePercent >= 0
      ? 'text-[#D6AD60]'
      : 'text-[#D9827C]';

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* 1. Total Income */}
      <Card variant="surface" className="p-4 space-y-2">
        <div className="flex items-center justify-between text-[#858078]">
          <span className="text-xs font-medium uppercase tracking-wider">Total Income</span>
          <ArrowUpRight className="h-4 w-4 text-[#72B895]" />
        </div>
        <div className="space-y-0.5">
          <div className="text-2xl font-bold font-tabular text-[#72B895]">
            {summary.totalIncomeFormatted}
          </div>
          <p className="text-[11px] text-[#858078]">
            {summary.incomeCount} income transaction{summary.incomeCount === 1 ? '' : 's'}
          </p>
        </div>
      </Card>

      {/* 2. Total Expenses */}
      <Card variant="surface" className="p-4 space-y-2">
        <div className="flex items-center justify-between text-[#858078]">
          <span className="text-xs font-medium uppercase tracking-wider">Total Expenses</span>
          <ArrowDownLeft className="h-4 w-4 text-[#D9827C]" />
        </div>
        <div className="space-y-0.5">
          <div className="text-2xl font-bold font-tabular text-[#D9827C]">
            {summary.totalExpenseFormatted}
          </div>
          <p className="text-[11px] text-[#858078]">
            {summary.expenseCount} expense transaction{summary.expenseCount === 1 ? '' : 's'}
          </p>
        </div>
      </Card>

      {/* 3. Net Cash Flow */}
      <Card variant="surface" className="p-4 space-y-2">
        <div className="flex items-center justify-between text-[#858078]">
          <span className="text-xs font-medium uppercase tracking-wider">Net Cash Flow</span>
          {isNetPositive ? (
            <TrendingUp className="h-4 w-4 text-[#72B895]" />
          ) : (
            <TrendingDown className="h-4 w-4 text-[#D9827C]" />
          )}
        </div>
        <div className="space-y-0.5">
          <div
            className={cn(
              'text-2xl font-bold font-tabular',
              isNetPositive ? 'text-[#72B895]' : 'text-[#D9827C]'
            )}
          >
            {summary.netCashFlowFormatted}
          </div>
          <p className="text-[11px] text-[#858078]">
            Transfers excluded ({summary.transferCount})
          </p>
        </div>
      </Card>

      {/* 4. Savings Rate */}
      <Card variant="surface" className="p-4 space-y-2">
        <div className="flex items-center justify-between text-[#858078]">
          <span className="text-xs font-medium uppercase tracking-wider">Savings Rate</span>
          <Percent className="h-4 w-4 text-[#D6AD60]" />
        </div>
        <div className="space-y-0.5">
          <div className={cn('text-2xl font-bold font-tabular', savingsTone)}>
            {summary.savingsRateFormatted}
          </div>
          <p className="text-[11px] text-[#858078]">
            {summary.savingsRatePercent === null
              ? 'No income recorded in period'
              : '(Income − Expenses) ÷ Income'}
          </p>
        </div>
      </Card>
    </div>
  );
};

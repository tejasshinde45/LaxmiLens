import React from 'react';
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, TrendingUp, TrendingDown } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { TransactionSummary } from '../hooks/useTransactions';

export interface TransactionSummaryMetricsProps {
  summary: TransactionSummary;
  isLoading?: boolean;
}

export const TransactionSummaryMetrics: React.FC<TransactionSummaryMetricsProps> = ({
  summary,
  isLoading = false
}) => {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} variant="surface" className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <Skeleton className="h-3 w-20" />
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

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* 1. Transaction Count */}
      <Card variant="surface" className="p-4 space-y-2">
        <div className="flex items-center justify-between text-[#858078]">
          <span className="text-xs font-medium uppercase tracking-wider">Entries</span>
          <ArrowLeftRight className="h-4 w-4 text-[#D6AD60]" />
        </div>
        <div className="space-y-0.5">
          <div className="text-2xl font-bold font-tabular text-[#F5F1E8]">
            {summary.totalCount}
          </div>
          <p className="text-[11px] text-[#858078]">Matching current view filter</p>
        </div>
      </Card>

      {/* 2. Total Inflows (Income) */}
      <Card variant="surface" className="p-4 space-y-2">
        <div className="flex items-center justify-between text-[#858078]">
          <span className="text-xs font-medium uppercase tracking-wider">Total Income</span>
          <ArrowUpRight className="h-4 w-4 text-[#72B895]" />
        </div>
        <div className="space-y-0.5">
          <div className="text-2xl font-bold font-tabular text-[#72B895]">
            {summary.totalIncomeFormatted}
          </div>
          <p className="text-[11px] text-[#858078]">External inflows (transfers excluded)</p>
        </div>
      </Card>

      {/* 3. Total Outflows (Expenses) */}
      <Card variant="surface" className="p-4 space-y-2">
        <div className="flex items-center justify-between text-[#858078]">
          <span className="text-xs font-medium uppercase tracking-wider">Total Expenses</span>
          <ArrowDownLeft className="h-4 w-4 text-[#D9827C]" />
        </div>
        <div className="space-y-0.5">
          <div className="text-2xl font-bold font-tabular text-[#D9827C]">
            {summary.totalExpenseFormatted}
          </div>
          <p className="text-[11px] text-[#858078]">External expenditures</p>
        </div>
      </Card>

      {/* 4. Net Cash Flow */}
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
            className={`text-2xl font-bold font-tabular ${
              isNetPositive ? 'text-[#72B895]' : 'text-[#D9827C]'
            }`}
          >
            {summary.netCashFlowFormatted}
          </div>
          <p className="text-[11px] text-[#858078]">
            {isNetPositive ? 'Net positive savings' : 'Net cash deficit'}
          </p>
        </div>
      </Card>
    </div>
  );
};

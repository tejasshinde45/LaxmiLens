import React from 'react';
import { PieChart, AlertCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/common/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/feedback/EmptyState';
import { AnalyticsSummaryMetrics as AnalyticsSummaryDTO } from '@/application/services/FinancialAnalyticsService';
import { useAnalytics } from './hooks/useAnalytics';
import { AnalyticsFilters } from './components/AnalyticsFilters';
import { AnalyticsSummaryMetrics } from './components/AnalyticsSummaryMetrics';
import { IncomeExpenseTrendChart } from './components/IncomeExpenseTrendChart';
import { ExpenseBreakdownChart } from './components/ExpenseBreakdownChart';
import { SpendingTrendsAndInsights } from './components/SpendingTrendsAndInsights';

const EMPTY_SUMMARY: AnalyticsSummaryDTO = {
  totalIncomePaise: 0,
  totalIncomeFormatted: '₹0.00',
  totalExpensePaise: 0,
  totalExpenseFormatted: '₹0.00',
  netCashFlowPaise: 0,
  netCashFlowFormatted: '₹0.00',
  savingsRatePercent: null,
  savingsRateFormatted: '—',
  activeTransactionCount: 0,
  incomeCount: 0,
  expenseCount: 0,
  transferCount: 0
};

export const AnalyticsPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    preset,
    setPreset,
    customRange,
    setCustomRange,
    dateRangeError,
    analytics,
    isLoading,
    isError,
    error,
    refetch
  } = useAnalytics();

  const summary = analytics?.summary ?? EMPTY_SUMMARY;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Financial Insights & Analytics"
        description="Read-only cash flow, category spending breakdown, period trends, and deterministic financial insights."
        badge={
          <Badge variant="gold" size="sm" dot>
            Offline-Ready
          </Badge>
        }
      />

      <AnalyticsFilters
        preset={preset}
        onPresetChange={setPreset}
        customRange={customRange}
        onCustomRangeChange={setCustomRange}
        periodLabel={analytics?.period.label}
        startInput={analytics?.period.startInput}
        endInput={analytics?.period.endInput}
        dateRangeError={dateRangeError}
      />

      {isLoading ? (
        <div className="space-y-6" aria-label="Loading analytics">
          <AnalyticsSummaryMetrics summary={EMPTY_SUMMARY} isLoading />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {[1, 2].map((i) => (
              <Card key={i} variant="surface" className="p-5 space-y-4">
                <Skeleton className="h-4 w-44" />
                <Skeleton className="h-64 w-full rounded-[10px]" />
              </Card>
            ))}
          </div>
        </div>
      ) : isError ? (
        <Card variant="surface" className="p-8 text-center border-[#D9827C]/30 bg-[#1B1B1B]">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[#D9827C]/10 text-[#D9827C] mb-4">
            <AlertCircle className="h-6 w-6" />
          </div>
          <h3 className="text-base font-semibold text-[#F5F1E8] mb-1">
            Failed to Load Analytics
          </h3>
          <p className="text-sm text-[#858078] max-w-md mx-auto mb-5">
            {error instanceof Error
              ? error.message
              : 'An unexpected error occurred while reading local financial records.'}
          </p>
          <Button variant="secondary" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </Card>
      ) : !analytics ? (
        <EmptyState
          icon={PieChart}
          title={dateRangeError ? 'Adjust Custom Date Range' : 'No Financial Data Available'}
          description={
            dateRangeError
              ? dateRangeError
              : 'Select a valid date range or record ledger transactions to inspect spending patterns.'
          }
          actionLabel={preset === 'custom' ? 'Switch to This Month' : 'Go to Transactions'}
          onAction={() =>
            preset === 'custom' ? setPreset('this_month') : navigate('/transactions')
          }
        />
      ) : (
        <div className="space-y-6">
          <AnalyticsSummaryMetrics summary={summary} />

          {summary.activeTransactionCount === 0 ? (
            <EmptyState
              icon={PieChart}
              title={`No financial activity for ${analytics.period.label}`}
              description="No income, expense, or transfer records were found in this local date window. Switch to another period or record a transaction."
              actionLabel={preset !== 'all_time' ? 'View All Time' : 'Record Transaction'}
              onAction={() =>
                preset !== 'all_time' ? setPreset('all_time') : navigate('/transactions')
              }
            />
          ) : (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <IncomeExpenseTrendChart
                  data={analytics.timeSeries}
                  hasData={analytics.hasTimeSeriesData}
                  granularity={analytics.period.granularity}
                />
                <ExpenseBreakdownChart
                  breakdown={analytics.expenseBreakdown}
                  totalExpenseFormatted={summary.totalExpenseFormatted}
                />
              </div>

              <SpendingTrendsAndInsights
                spendingTrend={analytics.spendingTrend}
                categoryIncreases={analytics.categoryIncreases}
                insights={analytics.insights}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
};

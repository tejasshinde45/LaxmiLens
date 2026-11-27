import React, { useMemo } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip
} from 'recharts';
import {
  ArrowUpRight,
  ArrowDownLeft,
  ArrowLeftRight,
  TrendingUp,
  TrendingDown,
  Percent,
  FileBarChart2
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/feedback/EmptyState';
import {
  FinancialSummaryReportDTO,
  ReportMetricComparisonDTO,
  SummaryPeriodBucketDTO
} from '@/application/dto/ReportDTO';
import { formatPaiseToINR } from '@/utils/formatters';
import { cn } from '@/utils/cn';

export interface FinancialSummaryReportViewProps {
  report: FinancialSummaryReportDTO;
  hasActiveFilters: boolean;
  onResetFilters: () => void;
}

interface ChartBucketPoint extends SummaryPeriodBucketDTO {
  incomeRupees: number;
  expenseRupees: number;
}

const SummaryTrendTooltip: React.FC<{
  active?: boolean;
  payload?: Array<{ payload: ChartBucketPoint }>;
}> = ({ active, payload }) => {
  if (!active || !payload || payload.length === 0) return null;
  const pt = payload[0].payload;

  return (
    <div className="rounded-[10px] border border-[#303030] bg-[#161616] p-3 text-xs shadow-xl shadow-black/60 space-y-1.5">
      <p className="font-semibold text-[#F5F1E8]">{pt.label}</p>
      <div className="flex items-center justify-between gap-4">
        <span className="text-[#72B895]">Income:</span>
        <span className="font-bold font-tabular text-[#72B895]">{pt.incomeFormatted}</span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-[#D9827C]">Expenses:</span>
        <span className="font-bold font-tabular text-[#D9827C]">{pt.expenseFormatted}</span>
      </div>
      <div className="flex items-center justify-between gap-4 pt-1 border-t border-[#303030]/60">
        <span className="text-[#858078]">Net Cash Flow:</span>
        <span className="font-semibold font-tabular text-[#F5F1E8]">
          {pt.netCashFlowFormatted}
        </span>
      </div>
    </div>
  );
};

function renderComparisonPill(comparison: ReportMetricComparisonDTO) {
  if (comparison.direction === 'unavailable' || comparison.deltaFormatted === null) {
    return null;
  }
  const pctLabel =
    comparison.percentageChange !== null
      ? ` (${comparison.percentageChange > 0 ? '+' : ''}${comparison.percentageChange}%)`
      : '';
  return (
    <span className="text-[11px] font-tabular text-[#858078] report-print-muted">
      vs prior: {comparison.deltaFormatted}
      {pctLabel}
    </span>
  );
}

export const FinancialSummaryReportView: React.FC<FinancialSummaryReportViewProps> = ({
  report,
  hasActiveFilters,
  onResetFilters
}) => {
  const { metrics, comparison, period, periodBreakdown, appliedFilters } = report;
  const isAccountFilterActive = appliedFilters.accountIds.length > 0;

  const chartData = useMemo<ChartBucketPoint[]>(
    () =>
      periodBreakdown.map((bucket) => ({
        ...bucket,
        incomeRupees: bucket.incomePaise / 100,
        expenseRupees: bucket.expensePaise / 100
      })),
    [periodBreakdown]
  );

  const hasChartActivity = useMemo(
    () => periodBreakdown.some((b) => b.incomePaise > 0 || b.expensePaise > 0),
    [periodBreakdown]
  );

  if (report.isEmpty) {
    return (
      <EmptyState
        icon={FileBarChart2}
        title="No matching activity for this summary"
        description={`No income, expense, or transfer transactions matched ${period.label} under the active filters.`}
        actionLabel={hasActiveFilters ? 'Reset Filters' : undefined}
        onAction={hasActiveFilters ? onResetFilters : undefined}
      />
    );
  }

  const isNetPositive = metrics.netCashFlowPaise >= 0;

  return (
    <div className="space-y-6">
      {/* Primary KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card variant="surface" className="p-4 space-y-2 report-print-card">
          <div className="flex items-center justify-between text-[#858078] report-print-muted">
            <span className="text-xs font-medium uppercase tracking-wider">Total Income</span>
            <ArrowUpRight className="h-4 w-4 text-[#72B895]" />
          </div>
          <div
            data-tone="income"
            className="text-2xl font-bold font-tabular text-[#72B895]"
          >
            {metrics.totalIncomeFormatted}
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] text-[#858078] report-print-muted">
              {metrics.incomeCount} income transaction{metrics.incomeCount === 1 ? '' : 's'}
            </span>
            {renderComparisonPill(comparison.income)}
          </div>
        </Card>

        <Card variant="surface" className="p-4 space-y-2 report-print-card">
          <div className="flex items-center justify-between text-[#858078] report-print-muted">
            <span className="text-xs font-medium uppercase tracking-wider">Total Expenses</span>
            <ArrowDownLeft className="h-4 w-4 text-[#D9827C]" />
          </div>
          <div
            data-tone="expense"
            className="text-2xl font-bold font-tabular text-[#D9827C]"
          >
            {metrics.totalExpenseFormatted}
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] text-[#858078] report-print-muted">
              {metrics.expenseCount} expense transaction{metrics.expenseCount === 1 ? '' : 's'}
            </span>
            {renderComparisonPill(comparison.expense)}
          </div>
        </Card>

        <Card variant="surface" className="p-4 space-y-2 report-print-card">
          <div className="flex items-center justify-between text-[#858078] report-print-muted">
            <span className="text-xs font-medium uppercase tracking-wider">Net Cash Flow</span>
            {isNetPositive ? (
              <TrendingUp className="h-4 w-4 text-[#72B895]" />
            ) : (
              <TrendingDown className="h-4 w-4 text-[#D9827C]" />
            )}
          </div>
          <div
            data-tone={isNetPositive ? 'income' : 'expense'}
            className={cn(
              'text-2xl font-bold font-tabular',
              isNetPositive ? 'text-[#72B895]' : 'text-[#D9827C]'
            )}
          >
            {metrics.netCashFlowFormatted}
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] text-[#858078] report-print-muted">
              Excludes transfers
            </span>
            {renderComparisonPill(comparison.netCashFlow)}
          </div>
        </Card>

        <Card variant="surface" className="p-4 space-y-2 report-print-card">
          <div className="flex items-center justify-between text-[#858078] report-print-muted">
            <span className="text-xs font-medium uppercase tracking-wider">Savings Rate</span>
            <Percent className="h-4 w-4 text-[#D6AD60]" />
          </div>
          <div className="text-2xl font-bold font-tabular text-[#D6AD60]">
            {metrics.savingsRateFormatted}
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] text-[#858078] report-print-muted">
              {metrics.savingsRatePercent === null
                ? 'Requires positive income'
                : 'Share of income retained'}
            </span>
            {comparison.savingsRate.direction !== 'unavailable' &&
              comparison.savingsRate.deltaFormatted && (
                <span className="text-[11px] font-tabular text-[#858078] report-print-muted">
                  vs prior: {comparison.savingsRate.deltaFormatted}
                </span>
              )}
          </div>
        </Card>
      </div>

      {/* Account-Scoped Transfer KPIs (shown prominently when an account filter is active) */}
      {isAccountFilterActive ? (
        <Card
          variant="surface"
          className="p-5 space-y-3 border-[#82A9CF]/30 report-print-card"
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <ArrowLeftRight className="h-4 w-4 text-[#82A9CF]" />
              <h2 className="text-sm font-semibold text-[#F5F1E8] font-display">
                Account Transfers (Excluded from Cash Flow)
              </h2>
            </div>
            <Badge variant="transfer" size="sm">
              {metrics.transferCount} transfer{metrics.transferCount === 1 ? '' : 's'}
            </Badge>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-[10px] border border-[#303030] bg-[#161616] p-3 report-print-card">
              <div className="text-[11px] text-[#858078] report-print-muted">Transfers In</div>
              <div
                data-tone="income"
                className="text-lg font-bold font-tabular text-[#72B895] mt-0.5"
              >
                {metrics.transfersInFormatted}
              </div>
            </div>
            <div className="rounded-[10px] border border-[#303030] bg-[#161616] p-3 report-print-card">
              <div className="text-[11px] text-[#858078] report-print-muted">Transfers Out</div>
              <div
                data-tone="expense"
                className="text-lg font-bold font-tabular text-[#D9827C] mt-0.5"
              >
                {metrics.transfersOutFormatted}
              </div>
            </div>
            <div className="rounded-[10px] border border-[#303030] bg-[#161616] p-3 report-print-card">
              <div className="text-[11px] text-[#858078] report-print-muted">Net Transfers</div>
              <div
                data-tone="transfer"
                className={cn(
                  'text-lg font-bold font-tabular mt-0.5',
                  metrics.netTransfersPaise >= 0 ? 'text-[#82A9CF]' : 'text-[#D9827C]'
                )}
              >
                {metrics.netTransfersFormatted}
              </div>
            </div>
            <div className="rounded-[10px] border border-[#303030] bg-[#161616] p-3 report-print-card">
              <div className="text-[11px] text-[#858078] report-print-muted">
                Total Transfer Volume
              </div>
              <div
                data-tone="transfer"
                className="text-lg font-bold font-tabular text-[#F5F1E8] mt-0.5"
              >
                {metrics.totalTransferVolumeFormatted}
              </div>
            </div>
          </div>
        </Card>
      ) : (
        metrics.transferCount > 0 && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-[#303030] bg-[#161616] px-4 py-2.5 text-xs text-[#B9B4AA] report-print-card">
            <div className="flex items-center gap-2">
              <ArrowLeftRight className="h-3.5 w-3.5 text-[#82A9CF] shrink-0" />
              <span>
                {metrics.transferCount} internal transfer{metrics.transferCount === 1 ? '' : 's'} (
                <span className="font-tabular font-semibold text-[#F5F1E8]">
                  {metrics.totalTransferVolumeFormatted}
                </span>
                ) excluded from Income, Expenses, and Net Cash Flow.
              </span>
            </div>
            <Badge variant="transfer" size="sm">
              Transfer Neutral
            </Badge>
          </div>
        )
      )}

      {/* Interactive Trend Chart (screen only; print outputs tabular breakdown below) */}
      <Card variant="surface" className="p-5 space-y-4 print:hidden">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-[#D6AD60]" />
            <h2 className="text-sm font-semibold text-[#F5F1E8] font-display">
              Income & Expense Cashflow Trend
            </h2>
          </div>
          <Badge variant="neutral" size="sm">
            {period.granularity === 'daily' ? 'Daily' : 'Monthly'}
          </Badge>
        </div>

        {!hasChartActivity ? (
          <div className="flex h-52 items-center justify-center rounded-[10px] border border-dashed border-[#303030] bg-[#101010]/60 p-6 text-center">
            <p className="text-xs text-[#858078]">
              Only transfer activity matched this period; no income or expense bars to plot.
            </p>
          </div>
        ) : (
          <div
            className="h-60 w-full"
            role="img"
            aria-label={`Financial summary ${period.granularity} income versus expenses chart`}
          >
            <ResponsiveContainer
              width="100%"
              height="100%"
              initialDimension={{ width: 520, height: 240 }}
            >
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#303030" vertical={false} />
                <XAxis
                  dataKey="label"
                  stroke="#858078"
                  fontSize={11}
                  tickLine={false}
                  axisLine={{ stroke: '#303030' }}
                  minTickGap={16}
                />
                <YAxis
                  stroke="#858078"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  width={72}
                  tickFormatter={(val: number) =>
                    formatPaiseToINR(Math.round(val * 100), { showDecimals: false })
                  }
                />
                <Tooltip
                  content={<SummaryTrendTooltip />}
                  cursor={{ fill: '#242424', opacity: 0.45 }}
                />
                <Bar
                  dataKey="incomeRupees"
                  name="Income"
                  fill="#72B895"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={32}
                />
                <Bar
                  dataKey="expenseRupees"
                  name="Expenses"
                  fill="#D9827C"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={32}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {/* Previous-Period Comparison Matrix */}
      <Card variant="surface" className="p-5 space-y-4 report-print-card">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="text-sm font-semibold text-[#F5F1E8] font-display">
            Previous Period Comparison
          </h2>
          {period.previousRange && (
            <span className="text-xs text-[#858078] report-print-muted">
              Compared against equivalent prior span
            </span>
          )}
        </div>

        {!comparison.comparisonAvailable ? (
          <p className="text-xs text-[#858078] report-print-muted">
            {comparison.insufficientDataReason || 'Prior-period comparison is unavailable for this range.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs" aria-label="Previous period comparison">
              <thead>
                <tr className="border-b border-[#303030] text-[#858078]">
                  <th scope="col" className="py-2 pr-4 font-semibold">Metric</th>
                  <th scope="col" className="py-2 px-3 font-semibold text-right">Current Period</th>
                  <th scope="col" className="py-2 px-3 font-semibold text-right">Previous Period</th>
                  <th scope="col" className="py-2 px-3 font-semibold text-right">Delta</th>
                  <th scope="col" className="py-2 pl-3 font-semibold text-right">Change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#303030]/60">
                <tr>
                  <td className="py-2.5 pr-4 font-medium text-[#F5F1E8]">Income</td>
                  <td data-tone="income" className="py-2.5 px-3 text-right font-tabular text-[#72B895]">
                    {comparison.income.currentFormatted}
                  </td>
                  <td className="py-2.5 px-3 text-right font-tabular text-[#B9B4AA]">
                    {comparison.income.previousFormatted ?? '—'}
                  </td>
                  <td className="py-2.5 px-3 text-right font-tabular text-[#F5F1E8]">
                    {comparison.income.deltaFormatted ?? '—'}
                  </td>
                  <td className="py-2.5 pl-3 text-right font-tabular text-[#B9B4AA]">
                    {comparison.income.percentageChange !== null
                      ? `${comparison.income.percentageChange > 0 ? '+' : ''}${comparison.income.percentageChange}%`
                      : '—'}
                  </td>
                </tr>
                <tr>
                  <td className="py-2.5 pr-4 font-medium text-[#F5F1E8]">Expenses</td>
                  <td data-tone="expense" className="py-2.5 px-3 text-right font-tabular text-[#D9827C]">
                    {comparison.expense.currentFormatted}
                  </td>
                  <td className="py-2.5 px-3 text-right font-tabular text-[#B9B4AA]">
                    {comparison.expense.previousFormatted ?? '—'}
                  </td>
                  <td className="py-2.5 px-3 text-right font-tabular text-[#F5F1E8]">
                    {comparison.expense.deltaFormatted ?? '—'}
                  </td>
                  <td className="py-2.5 pl-3 text-right font-tabular text-[#B9B4AA]">
                    {comparison.expense.percentageChange !== null
                      ? `${comparison.expense.percentageChange > 0 ? '+' : ''}${comparison.expense.percentageChange}%`
                      : '—'}
                  </td>
                </tr>
                <tr>
                  <td className="py-2.5 pr-4 font-medium text-[#F5F1E8]">Net Cash Flow</td>
                  <td
                    data-tone={isNetPositive ? 'income' : 'expense'}
                    className={cn(
                      'py-2.5 px-3 text-right font-tabular',
                      isNetPositive ? 'text-[#72B895]' : 'text-[#D9827C]'
                    )}
                  >
                    {comparison.netCashFlow.currentFormatted}
                  </td>
                  <td className="py-2.5 px-3 text-right font-tabular text-[#B9B4AA]">
                    {comparison.netCashFlow.previousFormatted ?? '—'}
                  </td>
                  <td className="py-2.5 px-3 text-right font-tabular text-[#F5F1E8]">
                    {comparison.netCashFlow.deltaFormatted ?? '—'}
                  </td>
                  <td className="py-2.5 pl-3 text-right font-tabular text-[#B9B4AA]">
                    {comparison.netCashFlow.percentageChange !== null
                      ? `${comparison.netCashFlow.percentageChange > 0 ? '+' : ''}${comparison.netCashFlow.percentageChange}%`
                      : '—'}
                  </td>
                </tr>
                <tr>
                  <td className="py-2.5 pr-4 font-medium text-[#F5F1E8]">Savings Rate</td>
                  <td className="py-2.5 px-3 text-right font-tabular text-[#D6AD60]">
                    {comparison.savingsRate.currentFormatted}
                  </td>
                  <td className="py-2.5 px-3 text-right font-tabular text-[#B9B4AA]">
                    {comparison.savingsRate.previousFormatted}
                  </td>
                  <td className="py-2.5 px-3 text-right font-tabular text-[#F5F1E8]">
                    {comparison.savingsRate.deltaFormatted ?? '—'}
                  </td>
                  <td className="py-2.5 pl-3 text-right font-tabular text-[#B9B4AA]">
                    {comparison.savingsRate.direction !== 'unavailable'
                      ? comparison.savingsRate.direction
                      : '—'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Period Breakdown Table */}
      <Card variant="surface" className="p-5 space-y-4 report-print-card">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[#F5F1E8] font-display">
            Period Cash Flow Schedule
          </h2>
          <span className="text-xs text-[#858078] report-print-muted">
            {periodBreakdown.filter((b) => b.transactionCount > 0).length} active {period.granularity === 'daily' ? 'days' : 'months'}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs" aria-label="Period cash flow schedule">
            <thead>
              <tr className="border-b border-[#303030] text-[#858078]">
                <th scope="col" className="py-2 pr-4 font-semibold">Period</th>
                <th scope="col" className="py-2 px-3 font-semibold text-right">Income</th>
                <th scope="col" className="py-2 px-3 font-semibold text-right">Expenses</th>
                <th scope="col" className="py-2 px-3 font-semibold text-right">Net Cash Flow</th>
                <th scope="col" className="py-2 px-3 font-semibold text-right">Transfers In</th>
                <th scope="col" className="py-2 px-3 font-semibold text-right">Transfers Out</th>
                <th scope="col" className="py-2 pl-3 font-semibold text-right">Txns</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#303030]/60">
              {periodBreakdown
                .filter((b) => b.transactionCount > 0)
                .map((bucket) => (
                  <tr key={bucket.bucketKey}>
                    <td className="py-2 pr-4 font-medium text-[#F5F1E8] whitespace-nowrap">
                      {bucket.label}
                    </td>
                    <td data-tone="income" className="py-2 px-3 text-right font-tabular text-[#72B895]">
                      {bucket.incomeFormatted}
                    </td>
                    <td data-tone="expense" className="py-2 px-3 text-right font-tabular text-[#D9827C]">
                      {bucket.expenseFormatted}
                    </td>
                    <td
                      data-tone={bucket.netCashFlowPaise >= 0 ? 'income' : 'expense'}
                      className={cn(
                        'py-2 px-3 text-right font-tabular font-semibold',
                        bucket.netCashFlowPaise >= 0 ? 'text-[#72B895]' : 'text-[#D9827C]'
                      )}
                    >
                      {bucket.netCashFlowFormatted}
                    </td>
                    <td className="py-2 px-3 text-right font-tabular text-[#82A9CF]">
                      {bucket.transfersInFormatted}
                    </td>
                    <td className="py-2 px-3 text-right font-tabular text-[#82A9CF]">
                      {bucket.transfersOutFormatted}
                    </td>
                    <td className="py-2 pl-3 text-right font-tabular text-[#B9B4AA]">
                      {bucket.transactionCount}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};

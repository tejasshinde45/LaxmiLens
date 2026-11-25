import React from 'react';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Sparkles,
  Info,
  AlertTriangle,
  CheckCircle2
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import {
  SpendingTrendComparison,
  CategorySpendingIncrease,
  FinancialActivityInsight
} from '@/application/services/FinancialAnalyticsService';
import { cn } from '@/utils/cn';

export interface SpendingTrendsAndInsightsProps {
  spendingTrend: SpendingTrendComparison;
  categoryIncreases: CategorySpendingIncrease[];
  insights: FinancialActivityInsight[];
}

export const SpendingTrendsAndInsights: React.FC<SpendingTrendsAndInsightsProps> = ({
  spendingTrend,
  categoryIncreases,
  insights
}) => {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Spending Trends Comparison */}
      <Card variant="surface" className="p-5 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {spendingTrend.direction === 'increase' ? (
              <TrendingUp className="h-4 w-4 text-[#D9827C]" />
            ) : spendingTrend.direction === 'decrease' ? (
              <TrendingDown className="h-4 w-4 text-[#72B895]" />
            ) : (
              <Minus className="h-4 w-4 text-[#858078]" />
            )}
            <h2 className="text-sm font-semibold text-[#F5F1E8] font-display">
              Spending Trends
            </h2>
          </div>

          {spendingTrend.comparisonAvailable && spendingTrend.percentageChange !== null ? (
            <Badge
              variant={
                spendingTrend.direction === 'increase'
                  ? 'expense'
                  : spendingTrend.direction === 'decrease'
                  ? 'income'
                  : 'neutral'
              }
              size="sm"
            >
              {spendingTrend.percentageChange > 0 ? '+' : ''}
              {spendingTrend.percentageChange}% vs previous period
            </Badge>
          ) : (
            <Badge variant="neutral" size="sm">
              Insufficient History
            </Badge>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-[10px] border border-[#303030] bg-[#141414] p-3 space-y-1">
            <span className="text-[11px] uppercase tracking-wider text-[#858078]">
              Selected Period
            </span>
            <p className="text-lg font-bold font-tabular text-[#F5F1E8]">
              {spendingTrend.currentExpenseFormatted}
            </p>
          </div>

          <div className="rounded-[10px] border border-[#303030] bg-[#141414] p-3 space-y-1">
            <span className="text-[11px] uppercase tracking-wider text-[#858078]">
              Previous Equivalent
            </span>
            <p className="text-lg font-bold font-tabular text-[#B9B4AA]">
              {spendingTrend.comparisonAvailable && spendingTrend.previousExpenseFormatted
                ? spendingTrend.previousExpenseFormatted
                : '—'}
            </p>
          </div>
        </div>

        {!spendingTrend.comparisonAvailable ? (
          <div
            role="status"
            className="flex items-start gap-2 rounded-[10px] border border-[#303030] bg-[#141414] p-3 text-xs text-[#858078]"
          >
            <Info className="h-4 w-4 shrink-0 text-[#D6AD60] mt-0.5" />
            <span>
              {spendingTrend.insufficientDataReason ||
                'Insufficient historical data from the previous period for comparison.'}
            </span>
          </div>
        ) : (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-xs rounded-[10px] border border-[#303030] bg-[#141414] px-3 py-2">
              <span className="text-[#858078]">Net Expense Change</span>
              <span
                className={cn(
                  'font-bold font-tabular',
                  spendingTrend.direction === 'increase'
                    ? 'text-[#D9827C]'
                    : spendingTrend.direction === 'decrease'
                    ? 'text-[#72B895]'
                    : 'text-[#B9B4AA]'
                )}
              >
                {spendingTrend.deltaFormatted}
              </span>
            </div>

            {categoryIncreases.length > 0 && (
              <div className="space-y-1.5 pt-1">
                <p className="text-[11px] font-medium uppercase tracking-wider text-[#858078]">
                  Categories with Increased Spending
                </p>
                <div className="space-y-1">
                  {categoryIncreases.slice(0, 3).map((cat) => (
                    <div
                      key={cat.categoryId}
                      className="flex items-center justify-between text-xs py-1 px-2 rounded bg-[#141414]"
                    >
                      <span className="text-[#F5F1E8] truncate">{cat.categoryName}</span>
                      <span className="font-tabular font-semibold text-[#E4B66D] shrink-0">
                        {cat.deltaFormatted}
                        {cat.percentageChange !== null ? ` (+${cat.percentageChange}%)` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Deterministic Financial Activity Insights */}
      <Card variant="surface" className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[#D6AD60]" />
          <h2 className="text-sm font-semibold text-[#F5F1E8] font-display">
            Financial Activity Insights
          </h2>
        </div>

        {insights.length === 0 ? (
          <div className="flex h-44 items-center justify-center rounded-[10px] border border-dashed border-[#303030] bg-[#101010]/60 p-6 text-center">
            <p className="text-xs text-[#858078] max-w-xs">
              Record transactions within this date range to generate deterministic cashflow and
              category insights.
            </p>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {insights.map((insight) => {
              const IconComp =
                insight.tone === 'positive'
                  ? CheckCircle2
                  : insight.tone === 'warning' || insight.tone === 'negative'
                  ? AlertTriangle
                  : Info;

              const iconColor =
                insight.tone === 'positive'
                  ? 'text-[#72B895]'
                  : insight.tone === 'warning'
                  ? 'text-[#E4B66D]'
                  : insight.tone === 'negative'
                  ? 'text-[#D9827C]'
                  : 'text-[#D6AD60]';

              return (
                <li
                  key={insight.id}
                  className="flex items-start gap-3 rounded-[10px] border border-[#303030] bg-[#141414] p-3"
                >
                  <IconComp className={cn('h-4 w-4 shrink-0 mt-0.5', iconColor)} />
                  <div className="space-y-0.5 min-w-0">
                    <p className="text-xs font-semibold text-[#F5F1E8]">{insight.title}</p>
                    <p className="text-xs text-[#B9B4AA] leading-relaxed">{insight.description}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
};

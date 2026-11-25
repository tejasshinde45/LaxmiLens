import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  PiggyBank,
  AlertTriangle,
  ArrowRight,
  AlertCircle,
  Gauge
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/feedback/EmptyState';
import { CategoryIcon } from '@/features/categories/components/CategoryIcon';
import {
  BudgetOverviewItemDTO,
  BudgetsOverviewSummaryDTO
} from '@/application/dto/BudgetDTO';
import { getBudgetUtilizationStatus } from '@/features/budgets/hooks/useBudgets';
import { formatBudgetPeriodLabel } from '@/features/budgets/schemas/budgetSchemas';
import { formatPaiseToINR } from '@/utils/formatters';
import { cn } from '@/utils/cn';

const MAX_DASHBOARD_CATEGORY_ITEMS = 4;

export interface DashboardBudgetSectionProps {
  period: string;
  summary: BudgetsOverviewSummaryDTO;
  budgets: BudgetOverviewItemDTO[];
  isLoading?: boolean;
  isError?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  onNavigateToBudgets: () => void;
}

const STATUS_STYLES = {
  normal: {
    label: 'Normal',
    badgeVariant: 'income' as const,
    barClass: 'bg-[#72B895]',
    textClass: 'text-[#72B895]'
  },
  warning: {
    label: 'Warning',
    badgeVariant: 'warning' as const,
    barClass: 'bg-[#E4B66D]',
    textClass: 'text-[#E4B66D]'
  },
  exceeded: {
    label: 'Exceeded',
    badgeVariant: 'expense' as const,
    barClass: 'bg-[#D9827C]',
    textClass: 'text-[#D9827C]'
  }
};

export const DashboardBudgetSection: React.FC<DashboardBudgetSectionProps> = ({
  period,
  summary,
  budgets,
  isLoading = false,
  isError = false,
  error = null,
  onRetry,
  onNavigateToBudgets
}) => {
  const periodLabel = useMemo(() => formatBudgetPeriodLabel(period), [period]);

  // Prioritize exceeded and warning categories on the compact dashboard view
  const highlightedBudgets = useMemo(() => {
    const rank = { exceeded: 0, warning: 1, normal: 2 };
    return [...budgets]
      .sort((a, b) => {
        const statusA = getBudgetUtilizationStatus(a.utilizationPercentage, a.isExceeded);
        const statusB = getBudgetUtilizationStatus(b.utilizationPercentage, b.isExceeded);
        if (rank[statusA] !== rank[statusB]) {
          return rank[statusA] - rank[statusB];
        }
        if (b.utilizationPercentage !== a.utilizationPercentage) {
          return b.utilizationPercentage - a.utilizationPercentage;
        }
        return a.categoryName.localeCompare(b.categoryName);
      })
      .slice(0, MAX_DASHBOARD_CATEGORY_ITEMS);
  }, [budgets]);

  const warningCount = useMemo(
    () =>
      budgets.filter(
        (b) => getBudgetUtilizationStatus(b.utilizationPercentage, b.isExceeded) === 'warning'
      ).length,
    [budgets]
  );

  const exceededCountActual = useMemo(
    () =>
      budgets.filter(
        (b) => getBudgetUtilizationStatus(b.utilizationPercentage, b.isExceeded) === 'exceeded'
      ).length,
    [budgets]
  );

  const effectiveExceededCount = Math.max(summary.exceededCount, exceededCountActual);
  const overallStatus = getBudgetUtilizationStatus(
    summary.overallUtilizationPercentage,
    summary.totalBudgetLimitPaise > 0 && summary.totalSpentPaise > summary.totalBudgetLimitPaise
  );
  const overallStyles = STATUS_STYLES[overallStatus];
  const overallWidth = Math.min(100, Math.max(0, summary.overallUtilizationPercentage));
  const totalOverspentPaise =
    summary.totalSpentPaise > summary.totalBudgetLimitPaise
      ? summary.totalSpentPaise - summary.totalBudgetLimitPaise
      : 0;

  return (
    <section aria-labelledby="dashboard-budget-overview-heading" className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 flex-wrap">
          <h2
            id="dashboard-budget-overview-heading"
            className="text-sm font-bold text-[#F5F1E8] font-display uppercase tracking-wider"
          >
            Budget Overview
          </h2>
          <Badge variant="gold" size="sm">
            {periodLabel}
          </Badge>
          {!isLoading && !isError && summary.budgetCount > 0 && (
            <Badge variant="neutral" size="sm">
              {summary.budgetCount === 1
                ? '1 budget configured'
                : `${summary.budgetCount} budgets configured`}
            </Badge>
          )}
          {!isLoading && !isError && effectiveExceededCount > 0 && (
            <Badge variant="expense" size="sm" dot>
              {effectiveExceededCount} exceeded
            </Badge>
          )}
        </div>

        <Link
          to="/budgets"
          className="inline-flex items-center gap-1 text-xs font-medium text-[#D6AD60] hover:underline"
        >
          <span>View All Budgets</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {isLoading ? (
        <Card variant="surface" className="p-5 space-y-4" aria-label="Loading budget overview">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-6 w-28" />
              </div>
            ))}
          </div>
          <div className="space-y-2 pt-2 border-t border-[#303030]/60">
            <Skeleton className="h-10 w-full rounded-[10px]" />
            <Skeleton className="h-10 w-full rounded-[10px]" />
          </div>
        </Card>
      ) : isError ? (
        <Card variant="surface" className="p-5 border-[#D9827C]/30 bg-[#1B1B1B]">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#D9827C]/10 text-[#D9827C]">
                <AlertCircle className="h-5 w-5" />
              </div>
              <div className="space-y-0.5">
                <h3 className="text-sm font-semibold text-[#F5F1E8]">
                  Unable to load monthly budget overview
                </h3>
                <p className="text-xs text-[#858078]">
                  {error?.message || 'Could not read local budget metrics.'}
                </p>
              </div>
            </div>
            {onRetry && (
              <Button variant="secondary" size="sm" onClick={onRetry}>
                Retry
              </Button>
            )}
          </div>
        </Card>
      ) : budgets.length === 0 ? (
        <EmptyState
          icon={PiggyBank}
          title={`No monthly budgets for ${periodLabel}`}
          description="Set monthly spending limits for expense categories to catch overspending early, protect cash flow, and monitor INR headroom at a glance."
          actionLabel="Set Up Budget"
          onAction={onNavigateToBudgets}
        />
      ) : (
        <Card variant="surface" className="p-5 space-y-5">
          {/* Aggregate Budget Summary */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 pb-4 border-b border-[#303030]/60">
            <div className="space-y-1">
              <span className="text-[11px] font-medium uppercase tracking-wider text-[#858078]">
                Total Monthly Budget
              </span>
              <div className="text-xl font-bold font-tabular text-[#F5F1E8]">
                {summary.totalBudgetLimitFormatted}
              </div>
              <p className="text-[11px] text-[#858078]">
                {summary.budgetCount === 1
                  ? '1 category limit active'
                  : `${summary.budgetCount} category limits active`}
              </p>
            </div>

            <div className="space-y-1">
              <span className="text-[11px] font-medium uppercase tracking-wider text-[#858078]">
                Spent Against Budget
              </span>
              <div className="text-xl font-bold font-tabular text-[#D9827C]">
                {summary.totalSpentFormatted}
              </div>
              <p className="text-[11px] text-[#858078]">Budgeted category outflows</p>
            </div>

            <div className="space-y-1">
              <span className="text-[11px] font-medium uppercase tracking-wider text-[#858078]">
                {totalOverspentPaise > 0 ? 'Over Budget' : 'Remaining Budget'}
              </span>
              <div
                className={cn(
                  'text-xl font-bold font-tabular',
                  totalOverspentPaise > 0
                    ? 'text-[#D9827C]'
                    : summary.totalRemainingPaise > 0
                    ? 'text-[#72B895]'
                    : 'text-[#E4B66D]'
                )}
              >
                {totalOverspentPaise > 0
                  ? formatPaiseToINR(totalOverspentPaise)
                  : summary.totalRemainingFormatted}
              </div>
              <p className="text-[11px] text-[#858078]">
                {totalOverspentPaise > 0
                  ? `Remaining: ${summary.totalRemainingFormatted}`
                  : effectiveExceededCount > 0
                  ? `${effectiveExceededCount} category exceeded`
                  : 'Within monthly limits'}
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[#858078]">
                <span className="text-[11px] font-medium uppercase tracking-wider">
                  Overall Utilization
                </span>
                <Gauge className={cn('h-3.5 w-3.5', overallStyles.textClass)} />
              </div>
              <div className="flex items-center gap-2">
                <span className={cn('text-xl font-bold font-tabular', overallStyles.textClass)}>
                  {summary.overallUtilizationPercentage}%
                </span>
                <Badge variant={overallStyles.badgeVariant} size="sm">
                  {overallStyles.label}
                </Badge>
              </div>
              <div className="h-1.5 w-full rounded-full bg-[#242424] overflow-hidden">
                <div
                  className={cn('h-full rounded-full transition-all duration-300', overallStyles.barClass)}
                  style={{ width: `${overallWidth}%` }}
                />
              </div>
            </div>
          </div>

          {/* Non-intrusive Warning / Exceeded Insight Banner */}
          {(effectiveExceededCount > 0 || warningCount > 0) && (
            <div
              role="status"
              className={cn(
                'flex items-center justify-between gap-3 rounded-[10px] border px-3.5 py-2.5 text-xs',
                effectiveExceededCount > 0
                  ? 'border-[#D9827C]/35 bg-[#D9827C]/10 text-[#F5F1E8]'
                  : 'border-[#E4B66D]/35 bg-[#E4B66D]/10 text-[#F5F1E8]'
              )}
            >
              <div className="flex items-center gap-2">
                <AlertTriangle
                  className={cn(
                    'h-4 w-4 shrink-0',
                    effectiveExceededCount > 0 ? 'text-[#D9827C]' : 'text-[#E4B66D]'
                  )}
                />
                <span>
                  {effectiveExceededCount > 0 &&
                    `${effectiveExceededCount} category budget${effectiveExceededCount > 1 ? 's' : ''} exceeded`}
                  {effectiveExceededCount > 0 && warningCount > 0 ? ' • ' : ''}
                  {warningCount > 0 &&
                    `${warningCount} category budget${warningCount > 1 ? 's' : ''} at 80%+ threshold`}
                </span>
              </div>
              <Link
                to="/budgets"
                className="text-xs font-semibold text-[#D6AD60] hover:underline shrink-0"
              >
                Review
              </Link>
            </div>
          )}

          {/* Compact Category-wise Budget Insights */}
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-[#858078]">
              <span className="font-medium uppercase tracking-wider text-[11px]">
                Category Insights
              </span>
              {budgets.length > MAX_DASHBOARD_CATEGORY_ITEMS && (
                <span>
                  Showing top {MAX_DASHBOARD_CATEGORY_ITEMS} of {budgets.length} budgets
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {highlightedBudgets.map((budget) => {
                const status = getBudgetUtilizationStatus(
                  budget.utilizationPercentage,
                  budget.isExceeded
                );
                const styles = STATUS_STYLES[status];
                const accentColor = budget.categoryColor || '#D6AD60';
                const clampedWidth = Math.min(100, Math.max(0, budget.utilizationPercentage));
                const overspentPaise =
                  budget.spentPaise > budget.limitPaise
                    ? budget.spentPaise - budget.limitPaise
                    : 0;

                return (
                  <div
                    key={budget.budgetId}
                    className={cn(
                      'rounded-[10px] border bg-[#141414] p-3.5 space-y-2.5',
                      status === 'exceeded'
                        ? 'border-[#D9827C]/35'
                        : status === 'warning'
                        ? 'border-[#E4B66D]/30'
                        : 'border-[#303030]'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px]"
                          style={{
                            backgroundColor: `${accentColor}1A`,
                            border: `1px solid ${accentColor}38`
                          }}
                        >
                          <CategoryIcon
                            name={budget.categoryIcon}
                            color={accentColor}
                            className="h-4 w-4"
                          />
                        </div>
                        <span className="text-xs font-semibold text-[#F5F1E8] truncate">
                          {budget.categoryName}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span className={cn('text-xs font-bold font-tabular', styles.textClass)}>
                          {budget.utilizationPercentage}%
                        </span>
                        <Badge variant={styles.badgeVariant} size="sm" dot>
                          {styles.label}
                        </Badge>
                      </div>
                    </div>

                    <div
                      role="progressbar"
                      aria-label={`${budget.categoryName} dashboard budget utilization`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={budget.utilizationPercentage}
                      className="h-1.5 w-full rounded-full bg-[#242424] overflow-hidden"
                    >
                      <div
                        className={cn('h-full rounded-full transition-all duration-300', styles.barClass)}
                        style={{ width: `${clampedWidth}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-[11px] gap-2">
                      <span className="text-[#858078] font-tabular">
                        {budget.spentFormatted} / {budget.limitFormatted}
                      </span>
                      <span
                        className={cn(
                          'font-semibold font-tabular',
                          overspentPaise > 0 ? 'text-[#D9827C]' : 'text-[#72B895]'
                        )}
                      >
                        {overspentPaise > 0
                          ? `Over by ${formatPaiseToINR(overspentPaise)}`
                          : `Remaining ${budget.remainingFormatted}`}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      )}
    </section>
  );
};

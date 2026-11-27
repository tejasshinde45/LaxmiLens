import React from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  PieChart
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/feedback/EmptyState';
import { CategoryIcon } from '@/features/categories/components/CategoryIcon';
import {
  CategoryBreakdownRowDTO,
  CategoryReportDTO,
  CategoryReportSummaryDTO
} from '@/application/dto/ReportDTO';
import { cn } from '@/utils/cn';

export interface CategoryReportViewProps {
  report: CategoryReportDTO;
  hasActiveFilters: boolean;
  onResetFilters: () => void;
}

function formatComparisonDelta(summary: CategoryReportSummaryDTO): string | null {
  if (summary.deltaFormatted === null) return null;
  const pct =
    summary.percentageChange !== null
      ? ` (${summary.percentageChange > 0 ? '+' : ''}${summary.percentageChange}%)`
      : '';
  return `vs prior: ${summary.deltaFormatted}${pct}`;
}

interface BreakdownSectionProps {
  title: string;
  emptyText: string;
  tone: 'expense' | 'income';
  summary: CategoryReportSummaryDTO;
  rows: readonly CategoryBreakdownRowDTO[];
  comparisonAvailable: boolean;
}

const CategoryBreakdownSection: React.FC<BreakdownSectionProps> = ({
  title,
  emptyText,
  tone,
  summary,
  rows,
  comparisonAvailable
}) => {
  return (
    <Card variant="surface" className="p-5 space-y-4 report-print-card">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          {tone === 'expense' ? (
            <ArrowDownLeft className="h-4 w-4 text-[#D9827C]" />
          ) : (
            <ArrowUpRight className="h-4 w-4 text-[#72B895]" />
          )}
          <h2 className="text-sm font-semibold text-[#F5F1E8] font-display">{title}</h2>
          <Badge variant="neutral" size="sm">
            {summary.categoryCount} categor{summary.categoryCount === 1 ? 'y' : 'ies'}
          </Badge>
          {summary.archivedCategoryCount > 0 && (
            <Badge variant="warning" size="sm">
              {summary.archivedCategoryCount} Archived
            </Badge>
          )}
        </div>

        <div className="text-right">
          <div
            data-tone={tone}
            className={cn(
              'text-base font-bold font-tabular',
              tone === 'expense' ? 'text-[#D9827C]' : 'text-[#72B895]'
            )}
          >
            {summary.totalFormatted}
          </div>
          {comparisonAvailable && formatComparisonDelta(summary) && (
            <div className="text-[11px] text-[#858078] report-print-muted">
              {formatComparisonDelta(summary)}
            </div>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-[10px] border border-dashed border-[#303030] bg-[#161616]/60 p-6 text-center text-xs text-[#858078]">
          {emptyText}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs" aria-label={title}>
            <thead>
              <tr className="border-b border-[#303030] text-[#858078]">
                <th scope="col" className="py-2 pr-4 font-semibold">Category</th>
                <th scope="col" className="py-2 px-3 font-semibold text-right">Txns</th>
                <th scope="col" className="py-2 px-3 font-semibold text-right">Amount</th>
                <th scope="col" className="py-2 px-3 font-semibold text-right">Share</th>
                {comparisonAvailable && (
                  <>
                    <th scope="col" className="py-2 px-3 font-semibold text-right">Prior Period</th>
                    <th scope="col" className="py-2 pl-3 font-semibold text-right">Change</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#303030]/60">
              {rows.map((row) => {
                const isUncategorized = row.categoryId === 'uncategorized';
                return (
                  <tr key={`${row.type}-${row.categoryId}`}>
                    <td className="py-2.5 pr-4">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px]"
                          style={{
                            backgroundColor: `${row.categoryColor}1A`,
                            border: `1px solid ${row.categoryColor}40`
                          }}
                        >
                          <CategoryIcon
                            name={row.categoryIcon}
                            color={row.categoryColor}
                            className="h-3.5 w-3.5"
                          />
                        </span>
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-medium text-[#F5F1E8]">
                              {row.categoryName}
                            </span>
                            {row.isArchived && (
                              <Badge variant="warning" size="sm">
                                Archived
                              </Badge>
                            )}
                            {isUncategorized && (
                              <Badge variant="outline" size="sm">
                                Uncategorized
                              </Badge>
                            )}
                          </div>
                          <div className="h-1 w-28 rounded-full bg-[#242424] overflow-hidden print:hidden">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${Math.min(100, Math.max(0, row.percentageShare))}%`,
                                backgroundColor: row.categoryColor
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right font-tabular text-[#B9B4AA]">
                      {row.transactionCount}
                    </td>
                    <td
                      data-tone={tone}
                      className={cn(
                        'py-2.5 px-3 text-right font-tabular font-semibold whitespace-nowrap',
                        tone === 'expense' ? 'text-[#D9827C]' : 'text-[#72B895]'
                      )}
                    >
                      {row.totalFormatted}
                    </td>
                    <td className="py-2.5 px-3 text-right font-tabular text-[#F5F1E8]">
                      {row.percentageShare}%
                    </td>
                    {comparisonAvailable && (
                      <>
                        <td className="py-2.5 px-3 text-right font-tabular text-[#B9B4AA] whitespace-nowrap">
                          {row.previousFormatted ?? '—'}
                        </td>
                        <td className="py-2.5 pl-3 text-right font-tabular whitespace-nowrap">
                          {row.direction === 'new' ? (
                            <Badge variant="gold" size="sm">
                              New
                            </Badge>
                          ) : row.deltaFormatted ? (
                            <span className="text-[#F5F1E8]">
                              {row.deltaFormatted}
                              {row.percentageChange !== null
                                ? ` (${row.percentageChange > 0 ? '+' : ''}${row.percentageChange}%)`
                                : ''}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
};

export const CategoryReportView: React.FC<CategoryReportViewProps> = ({
  report,
  hasActiveFilters,
  onResetFilters
}) => {
  const {
    expenseSummary,
    incomeSummary,
    expenseBreakdown,
    incomeBreakdown,
    comparisonAvailable,
    excludedTransferCount,
    period
  } = report;

  if (report.isEmpty) {
    return (
      <EmptyState
        icon={PieChart}
        title="No categorized income or expenses in this period"
        description={`No income or expense transactions matched ${period.label} under the active filters.${excludedTransferCount > 0 ? ` (${excludedTransferCount} transfer transaction${excludedTransferCount === 1 ? ' was' : 's were'} excluded.)` : ''}`}
        actionLabel={hasActiveFilters ? 'Reset Filters' : undefined}
        onAction={hasActiveFilters ? onResetFilters : undefined}
      />
    );
  }

  return (
    <div className="space-y-6">
      {excludedTransferCount > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-[#303030] bg-[#161616] px-4 py-2.5 text-xs text-[#B9B4AA] report-print-card">
          <div className="flex items-center gap-2">
            <ArrowLeftRight className="h-3.5 w-3.5 text-[#82A9CF] shrink-0" />
            <span>
              {excludedTransferCount} transfer transaction{excludedTransferCount === 1 ? ' is' : 's are'}{' '}
              excluded from Category Reports to prevent double-counting internal movements.
            </span>
          </div>
          <Badge variant="transfer" size="sm">
            Transfers Excluded
          </Badge>
        </div>
      )}

      <CategoryBreakdownSection
        title="Expense Categories"
        emptyText="No expense transactions matched this period and filter scope."
        tone="expense"
        summary={expenseSummary}
        rows={expenseBreakdown}
        comparisonAvailable={comparisonAvailable}
      />

      <CategoryBreakdownSection
        title="Income Categories"
        emptyText="No income transactions matched this period and filter scope."
        tone="income"
        summary={incomeSummary}
        rows={incomeBreakdown}
        comparisonAvailable={comparisonAvailable}
      />
    </div>
  );
};

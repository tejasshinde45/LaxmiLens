import React from 'react';
import { FinancialReportDTO } from '@/application';
import { AccountWithBalanceDTO } from '@/application/dto/AccountDTO';
import { Category } from '@/domain/entities/Category';
import { formatDate } from '@/utils/formatters';

export interface PrintableReportHeaderProps {
  report: FinancialReportDTO;
  accounts: readonly AccountWithBalanceDTO[];
  categories: readonly Category[];
}

function getReportTitle(report: FinancialReportDTO): string {
  switch (report.reportType) {
    case 'summary':
      return 'Financial Summary Report';
    case 'statement':
      return `Account Statement — ${report.account.name}`;
    case 'category':
      return 'Category Income & Expense Report';
  }
}

export const PrintableReportHeader: React.FC<PrintableReportHeaderProps> = ({
  report,
  accounts,
  categories
}) => {
  const { appliedFilters, period } = report;

  const accountScopeLabel =
    report.reportType === 'statement'
      ? `${report.account.name} (${report.account.accountType}${report.account.isArchived ? ' • Archived' : ''}${report.account.isSystemAccount ? ' • Liability / System' : ''})`
      : appliedFilters.accountIds.length > 0
      ? appliedFilters.accountIds
          .map((id) => accounts.find((a) => a.id === id)?.name ?? id)
          .join(', ')
      : 'All Accounts';

  const typeLabel =
    appliedFilters.types.length > 0 ? appliedFilters.types.join(', ') : 'All Types';

  const categoryLabel =
    appliedFilters.categoryIds.length > 0
      ? appliedFilters.categoryIds
          .map((id) =>
            id === 'uncategorized'
              ? 'Uncategorized'
              : categories.find((c) => c.id === id)?.name ?? id
          )
          .join(', ')
      : 'All Categories';

  const currencyLabel =
    report.reportType === 'statement' ? report.account.currency : 'INR';

  return (
    <div className="hidden print:block border-b-2 border-[#111111] pb-4 mb-5 space-y-2 text-[#111111]">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-[#52525b]">
            LaxmiLens Personal Finance
          </p>
          <h1 className="text-xl font-bold text-[#111111] font-display">
            {getReportTitle(report)}
          </h1>
        </div>
        <div className="text-right text-[11px] text-[#3f3f46]">
          <div>Currency: {currencyLabel}</div>
          <div>Generated: {formatDate(new Date(), 'dd MMM yyyy, hh:mm a')}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-[#3f3f46] pt-1">
        <div>
          <span className="font-semibold text-[#111111]">Period:</span> {period.label} ({period.startInput} to {period.endInput})
        </div>
        <div>
          <span className="font-semibold text-[#111111]">Account:</span> {accountScopeLabel}
        </div>
        <div>
          <span className="font-semibold text-[#111111]">Type:</span> {typeLabel}
        </div>
        <div>
          <span className="font-semibold text-[#111111]">Category:</span> {categoryLabel}
          {!appliedFilters.includeArchivedCategories ? ' (Active only)' : ''}
          {appliedFilters.searchQuery ? ` • Search: "${appliedFilters.searchQuery}"` : ''}
        </div>
      </div>
    </div>
  );
};

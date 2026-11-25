import React, { useEffect, useState } from 'react';
import {
  Landmark,
  AlertCircle,
  Info,
  ChevronLeft,
  ChevronRight,
  ScrollText
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/feedback/EmptyState';
import { AccountStatementReportDTO } from '@/application/dto/ReportDTO';
import { formatDate } from '@/utils/formatters';
import { cn } from '@/utils/cn';

export interface AccountStatementViewProps {
  report: AccountStatementReportDTO;
  hasActiveFilters: boolean;
  onResetFilters: () => void;
}

const STATEMENT_PAGE_SIZE = 50;

export const AccountStatementView: React.FC<AccountStatementViewProps> = ({
  report,
  hasActiveFilters,
  onResetFilters
}) => {
  const { account, balances, entries, period } = report;
  const [currentPage, setCurrentPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(entries.length / STATEMENT_PAGE_SIZE));

  useEffect(() => {
    setCurrentPage(1);
  }, [report]);

  const pageStart = (currentPage - 1) * STATEMENT_PAGE_SIZE;
  const pageEnd = pageStart + STATEMENT_PAGE_SIZE;

  return (
    <div className="space-y-6">
      {/* Account Metadata & Statement Overview Card */}
      <Card variant="surface" className="p-5 space-y-4 report-print-card">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[#242424] border border-[#303030] text-[#D6AD60] print:hidden">
              <Landmark className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-bold text-[#F5F1E8] font-display">
                  {account.name}
                </h2>
                <Badge variant="gold" size="sm">
                  {account.accountType}
                </Badge>
                {account.isArchived && (
                  <Badge variant="warning" size="sm">
                    Archived
                  </Badge>
                )}
                {account.isSystemAccount && (
                  <Badge variant="transfer" size="sm">
                    Liability / System
                  </Badge>
                )}
                {balances.isCreditCardLiability && (
                  <Badge variant="expense" size="sm">
                    Amount Owed
                  </Badge>
                )}
              </div>
              <p className="text-xs text-[#858078] report-print-muted">
                {account.institutionName ? `${account.institutionName} • ` : ''}
                Currency: {account.currency} • Statement Period: {period.startInput} to{' '}
                {period.endInput}
              </p>
            </div>
          </div>

          <div className="text-left sm:text-right">
            <div className="text-[11px] uppercase tracking-wider text-[#858078] report-print-muted">
              Current Live Balance
            </div>
            <div
              data-tone={balances.currentLiveBalancePaise >= 0 ? 'income' : 'expense'}
              className={cn(
                'text-lg font-bold font-tabular',
                balances.currentLiveBalancePaise >= 0 ? 'text-[#F5F1E8]' : 'text-[#D9827C]'
              )}
            >
              {balances.currentLiveBalanceFormatted}
            </div>
          </div>
        </div>

        {/* Balance Reconciliation Summary Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t border-[#303030]/60">
          <div className="rounded-[10px] border border-[#303030] bg-[#161616] p-3 space-y-0.5 report-print-card">
            <div className="text-[11px] text-[#858078] report-print-muted">
              Opening Balance ({period.startInput})
            </div>
            <div className="text-lg font-bold font-tabular text-[#F5F1E8]">
              {balances.periodOpeningBalanceFormatted}
            </div>
            <div className="text-[11px] text-[#858078] report-print-muted">
              Inception: {balances.inceptionOpeningBalanceFormatted}
              {balances.prePeriodTransactionCount > 0
                ? ` (${balances.prePeriodDeltaFormatted} prior)`
                : ''}
            </div>
          </div>

          <div className="rounded-[10px] border border-[#303030] bg-[#161616] p-3 space-y-0.5 report-print-card">
            <div className="text-[11px] text-[#858078] report-print-muted">Total Credits</div>
            <div
              data-tone="income"
              className="text-lg font-bold font-tabular text-[#72B895]"
            >
              {balances.totalCreditsFormatted}
            </div>
            <div className="text-[11px] text-[#858078] report-print-muted">
              Income: {balances.totalIncomeCreditsFormatted} • Transfers In:{' '}
              {balances.totalTransferCreditsFormatted}
            </div>
          </div>

          <div className="rounded-[10px] border border-[#303030] bg-[#161616] p-3 space-y-0.5 report-print-card">
            <div className="text-[11px] text-[#858078] report-print-muted">Total Debits</div>
            <div
              data-tone="expense"
              className="text-lg font-bold font-tabular text-[#D9827C]"
            >
              {balances.totalDebitsFormatted}
            </div>
            <div className="text-[11px] text-[#858078] report-print-muted">
              Expenses: {balances.totalExpenseDebitsFormatted} • Transfers Out:{' '}
              {balances.totalTransferDebitsFormatted}
            </div>
          </div>

          <div className="rounded-[10px] border border-[#D6AD60]/40 bg-[#161616] p-3 space-y-0.5 report-print-card">
            <div className="text-[11px] text-[#D6AD60] report-print-muted font-medium">
              Period Closing Balance ({period.endInput})
            </div>
            <div
              data-tone={balances.periodClosingBalancePaise >= 0 ? 'income' : 'expense'}
              className={cn(
                'text-lg font-bold font-tabular',
                balances.periodClosingBalancePaise >= 0 ? 'text-[#F5F1E8]' : 'text-[#D9827C]'
              )}
            >
              {balances.periodClosingBalanceFormatted}
            </div>
            <div className="text-[11px] text-[#858078] report-print-muted">
              Net Period Change: {balances.netPeriodChangeFormatted}
            </div>
          </div>
        </div>

        {/* Distinct Current Live Balance / Post-Period Activity / Credit Card Note */}
        {(balances.closingDiffersFromLiveBalance || balances.balanceSemanticsNote) && (
          <div className="flex items-start gap-2.5 rounded-[10px] border border-[#82A9CF]/30 bg-[#82A9CF]/10 px-3.5 py-2.5 text-xs text-[#F5F1E8] report-print-card">
            <Info className="h-4 w-4 text-[#82A9CF] shrink-0 mt-0.5" />
            <div className="space-y-1">
              {balances.closingDiffersFromLiveBalance && (
                <p>
                  Period Closing Balance on <span className="font-semibold">{period.endInput}</span>{' '}
                  is <span className="font-tabular font-semibold">{balances.periodClosingBalanceFormatted}</span>,
                  whereas Current Live Balance today is{' '}
                  <span className="font-tabular font-semibold">{balances.currentLiveBalanceFormatted}</span>{' '}
                  (post-period net change: {balances.postPeriodNetDeltaFormatted}).
                </p>
              )}
              {balances.balanceSemanticsNote && (
                <p className="text-[#B9B4AA] report-print-muted">
                  {balances.balanceSemanticsNote}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Sub-Filtering Integrity Notice */}
        {report.isSubFiltered && (
          <div
            role="note"
            className="flex items-start gap-2.5 rounded-[10px] border border-[#E4B66D]/40 bg-[#E4B66D]/10 px-3.5 py-2.5 text-xs text-[#F5F1E8] report-print-card"
          >
            <AlertCircle className="h-4 w-4 text-[#E4B66D] shrink-0 mt-0.5" />
            <span>
              Displayed ledger rows are sub-filtered ({report.displayedEntryCount} of{' '}
              {report.totalPeriodEntryCount} period entries shown). Opening balance, closing
              balance, and each row&apos;s running balance reflect the full account-period statement.
            </span>
          </div>
        )}
      </Card>

      {/* Chronological Statement Table */}
      {report.isEmpty ? (
        <EmptyState
          icon={ScrollText}
          title="No statement entries in this period"
          description={
            report.isSubFiltered
              ? `No transactions on ${account.name} matched your active type, category, or search filters.`
              : `No transactions occurred on ${account.name} between ${period.startInput} and ${period.endInput}.`
          }
          actionLabel={hasActiveFilters ? 'Reset Filters' : undefined}
          onAction={hasActiveFilters ? onResetFilters : undefined}
        />
      ) : (
        <Card variant="surface" className="p-5 space-y-4 report-print-card">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-[#F5F1E8] font-display">
              Chronological Ledger
            </h3>
            <span className="text-xs text-[#858078] report-print-muted">
              Showing {entries.length} entr{entries.length === 1 ? 'y' : 'ies'} (oldest to newest)
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#303030] text-[#858078]">
                  <th className="py-2 pr-3 font-semibold whitespace-nowrap">Date</th>
                  <th className="py-2 px-3 font-semibold">Description & Details</th>
                  <th className="py-2 px-3 font-semibold">Type</th>
                  <th className="py-2 px-3 font-semibold text-right">Credit (+)</th>
                  <th className="py-2 px-3 font-semibold text-right">Debit (-)</th>
                  <th className="py-2 pl-3 font-semibold text-right">Running Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#303030]/60">
                {entries.map((entry, idx) => {
                  const isVisibleOnPage = idx >= pageStart && idx < pageEnd;
                  return (
                    <tr
                      key={entry.transactionId}
                      className={isVisibleOnPage ? '' : 'hidden print:table-row'}
                    >
                      <td className="py-2.5 pr-3 font-tabular text-[#B9B4AA] whitespace-nowrap align-top">
                        {formatDate(entry.transactionDateLocal)}
                      </td>
                      <td className="py-2.5 px-3 align-top">
                        <div className="font-medium text-[#F5F1E8]">{entry.title}</div>
                        <div className="flex items-center gap-1.5 flex-wrap mt-0.5 text-[11px] text-[#858078] report-print-muted">
                          {entry.type === 'transfer' ? (
                            <span>
                              {entry.transferDirection === 'outgoing'
                                ? `Transfer to ${entry.counterpartyAccountName ?? 'Unknown Account'}`
                                : `Transfer from ${entry.counterpartyAccountName ?? 'Unknown Account'}`}
                            </span>
                          ) : (
                            <span>{entry.categoryName ?? 'Uncategorized'}</span>
                          )}
                          {entry.categoryArchived && (
                            <Badge variant="warning" size="sm">
                              Archived Category
                            </Badge>
                          )}
                          {entry.note && <span>• {entry.note}</span>}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 align-top">
                        <Badge
                          variant={
                            entry.type === 'income'
                              ? 'income'
                              : entry.type === 'expense'
                              ? 'expense'
                              : 'transfer'
                          }
                          size="sm"
                        >
                          {entry.type}
                        </Badge>
                      </td>
                      <td
                        data-tone="income"
                        className="py-2.5 px-3 text-right font-tabular text-[#72B895] whitespace-nowrap align-top"
                      >
                        {entry.creditFormatted || '—'}
                      </td>
                      <td
                        data-tone="expense"
                        className="py-2.5 px-3 text-right font-tabular text-[#D9827C] whitespace-nowrap align-top"
                      >
                        {entry.debitFormatted || '—'}
                      </td>
                      <td
                        data-tone={entry.runningBalancePaise >= 0 ? 'income' : 'expense'}
                        className={cn(
                          'py-2.5 pl-3 text-right font-tabular font-semibold whitespace-nowrap align-top',
                          entry.runningBalancePaise >= 0 ? 'text-[#F5F1E8]' : 'text-[#D9827C]'
                        )}
                      >
                        {entry.runningBalanceFormatted}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Screen Pagination Controls (hidden when printing so all rows output in PDF) */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-3 border-t border-[#303030]/60 text-xs print:hidden">
              <span className="text-[#858078]">
                Page {currentPage} of {totalPages} ({entries.length} entries)
              </span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  leftIcon={<ChevronLeft className="h-3.5 w-3.5" />}
                >
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  rightIcon={<ChevronRight className="h-3.5 w-3.5" />}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
};

import React from 'react';
import { AlertCircle, Calendar, RotateCcw } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { SearchInput } from '@/components/ui/SearchInput';
import { ReportTabType } from '@/application/dto/ReportDTO';
import { AccountWithBalanceDTO } from '@/application/dto/AccountDTO';
import {
  AnalyticsDatePreset,
  CustomDateRangeInput
} from '@/application/services/FinancialAnalyticsService';
import { Category } from '@/domain/entities/Category';
import { cn } from '@/utils/cn';
import { ReportTransactionTypeFilter } from '../hooks/useReports';

export interface ReportFiltersBarProps {
  activeTab: ReportTabType;
  preset: AnalyticsDatePreset;
  onPresetChange: (preset: AnalyticsDatePreset) => void;
  customRange: CustomDateRangeInput;
  onCustomRangeChange: (next: CustomDateRangeInput) => void;
  dateRangeError?: string | null;
  periodLabel?: string;
  startInput?: string;
  endInput?: string;
  accounts: readonly AccountWithBalanceDTO[];
  selectedAccountId: string;
  onAccountChange: (accountId: string) => void;
  effectiveStatementAccountId: string;
  onStatementAccountChange: (accountId: string) => void;
  categories: readonly Category[];
  selectedCategoryId: string;
  onCategoryChange: (categoryId: string) => void;
  typeFilter: ReportTransactionTypeFilter;
  onTypeFilterChange: (next: ReportTransactionTypeFilter) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  includeArchivedCategories: boolean;
  onIncludeArchivedCategoriesChange: (include: boolean) => void;
  hasActiveFilters: boolean;
  onResetFilters: () => void;
}

const DATE_PRESET_OPTIONS: ReadonlyArray<{ id: AnalyticsDatePreset; label: string }> = [
  { id: 'this_month', label: 'This Month' },
  { id: 'last_month', label: 'Last Month' },
  { id: 'last_3_months', label: 'Last 3 Months' },
  { id: 'last_6_months', label: 'Last 6 Months' },
  { id: 'this_year', label: 'This Year' },
  { id: 'all_time', label: 'All Time' },
  { id: 'custom', label: 'Custom Range' }
];

function formatAccountOptionLabel(acc: AccountWithBalanceDTO): string {
  const tags: string[] = [acc.accountType];
  if (acc.systemTag) {
    tags.push('Liability / System');
  }
  if (acc.isArchived) {
    tags.push('Archived');
  }
  return `${acc.name} (${tags.join(' • ')})`;
}

export const ReportFiltersBar: React.FC<ReportFiltersBarProps> = ({
  activeTab,
  preset,
  onPresetChange,
  customRange,
  onCustomRangeChange,
  dateRangeError,
  periodLabel,
  startInput,
  endInput,
  accounts,
  selectedAccountId,
  onAccountChange,
  effectiveStatementAccountId,
  onStatementAccountChange,
  categories,
  selectedCategoryId,
  onCategoryChange,
  typeFilter,
  onTypeFilterChange,
  searchQuery,
  onSearchChange,
  includeArchivedCategories,
  onIncludeArchivedCategoriesChange,
  hasActiveFilters,
  onResetFilters
}) => {
  const visibleCategories = categories.filter((c) => {
    if (!includeArchivedCategories && c.isArchived) return false;
    if (typeFilter === 'income') return c.type === 'income';
    if (typeFilter === 'expense') return c.type === 'expense';
    return true;
  });

  const activeAccountSelectionId =
    activeTab === 'statement' ? effectiveStatementAccountId : selectedAccountId;
  const selectedAccount =
    activeAccountSelectionId && activeAccountSelectionId !== 'all'
      ? accounts.find((a) => a.id === activeAccountSelectionId)
      : undefined;

  const selectedCategory =
    selectedCategoryId !== 'all' && selectedCategoryId !== 'uncategorized'
      ? categories.find((c) => c.id === selectedCategoryId)
      : undefined;

  return (
    <div className="rounded-xl border border-[#303030] bg-[#161616] p-4 space-y-4 print:hidden">
      {/* Row 1: Date Presets & Period Badge */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div
          role="group"
          aria-label="Report date range presets"
          className="flex items-center gap-1.5 flex-wrap"
        >
          {DATE_PRESET_OPTIONS.map((option) => {
            const isActive = preset === option.id;
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={isActive}
                onClick={() => onPresetChange(option.id)}
                className={cn(
                  'px-3 py-1.5 rounded-[8px] text-xs font-medium transition-colors cursor-pointer',
                  isActive
                    ? 'bg-[#D6AD60] text-[#101010] font-semibold shadow-sm'
                    : 'bg-[#1B1B1B] text-[#B9B4AA] border border-[#303030] hover:text-[#F5F1E8] hover:border-[#454545]'
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        {periodLabel && (
          <div className="flex items-center gap-2 shrink-0 text-xs text-[#858078]">
            <Calendar className="h-3.5 w-3.5 text-[#D6AD60]" />
            <Badge variant="gold" size="sm">
              {periodLabel}
            </Badge>
            {startInput && endInput && (
              <span className="font-tabular text-[11px]">
                ({startInput} to {endInput})
              </span>
            )}
          </div>
        )}
      </div>

      {/* Custom Date Range Inputs */}
      {preset === 'custom' && (
        <div className="pt-3 border-t border-[#303030]/60 flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="space-y-1">
            <label htmlFor="report-start-date" className="block text-xs font-medium text-[#B9B4AA]">
              From Date
            </label>
            <input
              id="report-start-date"
              type="date"
              value={customRange.startDate}
              onChange={(e) =>
                onCustomRangeChange({ ...customRange, startDate: e.target.value })
              }
              className="h-9 rounded-[8px] border border-[#303030] bg-[#1B1B1B] px-3 text-xs text-[#F5F1E8] focus-visible:outline-none focus-visible:border-[#D6AD60]"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="report-end-date" className="block text-xs font-medium text-[#B9B4AA]">
              To Date
            </label>
            <input
              id="report-end-date"
              type="date"
              value={customRange.endDate}
              onChange={(e) =>
                onCustomRangeChange({ ...customRange, endDate: e.target.value })
              }
              className="h-9 rounded-[8px] border border-[#303030] bg-[#1B1B1B] px-3 text-xs text-[#F5F1E8] focus-visible:outline-none focus-visible:border-[#D6AD60]"
            />
          </div>

          {dateRangeError && (
            <div
              role="alert"
              className="flex items-center gap-1.5 text-xs text-[#D9827C] pb-1.5"
            >
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{dateRangeError}</span>
            </div>
          )}
        </div>
      )}

      {/* Row 2: Account, Type, Category, Search, Archive Toggle, Reset */}
      <div className="pt-3 border-t border-[#303030]/60 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
        {/* Account Select */}
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="report-account-filter" className="block text-xs font-medium text-[#B9B4AA]">
              {activeTab === 'statement' ? 'Statement Account' : 'Account Scope'}
            </label>
            {selectedAccount && (
              <div className="flex items-center gap-1">
                {selectedAccount.isArchived && (
                  <Badge variant="warning" size="sm">
                    Archived
                  </Badge>
                )}
                {selectedAccount.systemTag && (
                  <Badge variant="transfer" size="sm">
                    Liability / System
                  </Badge>
                )}
              </div>
            )}
          </div>
          {activeTab === 'statement' ? (
            <select
              id="report-account-filter"
              aria-label="Statement Account"
              value={effectiveStatementAccountId}
              onChange={(e) => onStatementAccountChange(e.target.value)}
              disabled={accounts.length === 0}
              className="h-9 w-full rounded-[8px] border border-[#303030] bg-[#1B1B1B] px-2.5 text-xs text-[#F5F1E8] focus:border-[#D6AD60] focus:outline-none disabled:opacity-50"
            >
              {accounts.length === 0 ? (
                <option value="">No accounts available</option>
              ) : (
                accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {formatAccountOptionLabel(acc)}
                  </option>
                ))
              )}
            </select>
          ) : (
            <select
              id="report-account-filter"
              aria-label="Account Scope"
              value={selectedAccountId}
              onChange={(e) => onAccountChange(e.target.value)}
              className="h-9 w-full rounded-[8px] border border-[#303030] bg-[#1B1B1B] px-2.5 text-xs text-[#F5F1E8] focus:border-[#D6AD60] focus:outline-none"
            >
              <option value="all">All Accounts</option>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {formatAccountOptionLabel(acc)}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Transaction Type Select */}
        <div className="space-y-1">
          <label htmlFor="report-type-filter" className="block text-xs font-medium text-[#B9B4AA]">
            Transaction Type
          </label>
          <select
            id="report-type-filter"
            aria-label="Transaction Type"
            value={typeFilter}
            onChange={(e) => onTypeFilterChange(e.target.value as ReportTransactionTypeFilter)}
            className="h-9 w-full rounded-[8px] border border-[#303030] bg-[#1B1B1B] px-2.5 text-xs text-[#F5F1E8] focus:border-[#D6AD60] focus:outline-none"
          >
            <option value="all">All Types</option>
            <option value="income">Income Only</option>
            <option value="expense">Expenses Only</option>
            <option value="transfer">Transfers Only</option>
          </select>
        </div>

        {/* Category Select */}
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="report-category-filter" className="block text-xs font-medium text-[#B9B4AA]">
              Category
            </label>
            {selectedCategory?.isArchived && (
              <Badge variant="warning" size="sm">
                Archived
              </Badge>
            )}
          </div>
          <select
            id="report-category-filter"
            aria-label="Category Filter"
            value={selectedCategoryId}
            onChange={(e) => onCategoryChange(e.target.value)}
            disabled={typeFilter === 'transfer'}
            className="h-9 w-full rounded-[8px] border border-[#303030] bg-[#1B1B1B] px-2.5 text-xs text-[#F5F1E8] focus:border-[#D6AD60] focus:outline-none disabled:opacity-50"
          >
            <option value="all">
              {typeFilter === 'transfer' ? 'N/A for Transfers' : 'All Categories'}
            </option>
            <option value="uncategorized">Uncategorized</option>
            {visibleCategories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name} ({cat.type}
                {cat.isArchived ? ' • Archived' : ''})
              </option>
            ))}
          </select>
        </div>

        {/* Search Input */}
        <div className="space-y-1">
          <label htmlFor="report-search-filter" className="block text-xs font-medium text-[#B9B4AA]">
            Search Ledger
          </label>
          <SearchInput
            id="report-search-filter"
            aria-label="Search report transactions"
            placeholder="Title or note..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onClear={() => onSearchChange('')}
            className="h-9 text-xs"
          />
        </div>
      </div>

      {/* Row 3: Archived Categories Visibility & Reset */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs">
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 text-[#B9B4AA] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeArchivedCategories}
              onChange={(e) => onIncludeArchivedCategoriesChange(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-[#454545] bg-[#1B1B1B] accent-[#D6AD60]"
            />
            <span>Include archived categories in historical totals</span>
          </label>

          {activeTab === 'category' && typeFilter === 'transfer' && (
            <Badge variant="transfer" size="sm">
              Transfers are excluded from category breakdowns
            </Badge>
          )}
        </div>

        {hasActiveFilters && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onResetFilters}
            leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
            className="h-8 text-xs text-[#D9827C] hover:text-[#D9827C] hover:bg-[#D9827C]/10"
          >
            Reset Filters
          </Button>
        )}
      </div>
    </div>
  );
};

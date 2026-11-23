import React from 'react';
import { X, ArrowUpDown } from 'lucide-react';
import { SearchInput } from '@/components/ui/SearchInput';
import { Button } from '@/components/ui/Button';
import { AccountWithBalanceDTO } from '@/application/dto/AccountDTO';
import { Category } from '@/domain/entities/Category';
import { cn } from '@/utils/cn';

export type TransactionFilterType = 'all' | 'expense' | 'income' | 'transfer';
export type DateFilterPreset = 'all' | 'this_month' | 'last_30_days' | 'this_year';
export type SortDirection = 'desc' | 'asc';
export type SortField = 'date' | 'amount';

export interface TransactionFiltersProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  typeFilter: TransactionFilterType;
  onTypeFilterChange: (type: TransactionFilterType) => void;
  selectedAccountId: string;
  onAccountChange: (accountId: string) => void;
  selectedCategoryId: string;
  onCategoryChange: (categoryId: string) => void;
  dateFilter: DateFilterPreset;
  onDateFilterChange: (datePreset: DateFilterPreset) => void;
  sortBy?: SortField;
  onSortByChange?: (field: SortField) => void;
  sortDirection: SortDirection;
  onToggleSortDirection: () => void;
  onResetFilters: () => void;
  accounts: AccountWithBalanceDTO[];
  categories: Category[];
}

export const TransactionFilters: React.FC<TransactionFiltersProps> = ({
  searchQuery,
  onSearchChange,
  typeFilter,
  onTypeFilterChange,
  selectedAccountId,
  onAccountChange,
  selectedCategoryId,
  onCategoryChange,
  dateFilter,
  onDateFilterChange,
  sortBy = 'date',
  onSortByChange,
  sortDirection,
  onToggleSortDirection,
  onResetFilters,
  accounts,
  categories
}) => {
  const hasActiveFilters =
    searchQuery.trim().length > 0 ||
    typeFilter !== 'all' ||
    selectedAccountId !== 'all' ||
    selectedCategoryId !== 'all' ||
    dateFilter !== 'all' ||
    sortBy !== 'date' ||
    sortDirection !== 'desc';

  // Filter categories displayed in dropdown based on active typeFilter
  const visibleCategories = categories.filter((c) => {
    if (typeFilter === 'income') return c.type === 'income';
    if (typeFilter === 'expense') return c.type === 'expense';
    return true;
  });

  return (
    <div className="space-y-3">
      {/* Top Row: Search and Type Tabs */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="w-full sm:max-w-xs">
          <SearchInput
            placeholder="Search by title or note..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onClear={() => onSearchChange('')}
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
          {[
            { id: 'all', label: 'All' },
            { id: 'expense', label: 'Expenses' },
            { id: 'income', label: 'Income' },
            { id: 'transfer', label: 'Transfers' }
          ].map((tab) => {
            const isActive = typeFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onTypeFilterChange(tab.id as TransactionFilterType)}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-medium whitespace-nowrap transition-colors duration-150 cursor-pointer',
                  isActive
                    ? 'bg-[#D6AD60] text-[#101010] font-semibold shadow-sm'
                    : 'bg-[#1B1B1B] text-[#B9B4AA] hover:bg-[#242424] hover:text-[#F5F1E8] border border-[#303030]'
                )}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Bottom Row: Account, Category, Date Preset, Sort Order, and Reset */}
      <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
        {/* Account Filter Dropdown */}
        <div className="flex items-center gap-1.5">
          <select
            value={selectedAccountId}
            onChange={(e) => onAccountChange(e.target.value)}
            className="h-8 rounded-[8px] border border-[#303030] bg-[#181818] px-2.5 text-xs text-[#F5F1E8] focus:border-[#D6AD60] focus:outline-none transition-colors"
          >
            <option value="all">All Accounts</option>
            {accounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.name} ({acc.accountType})
              </option>
            ))}
          </select>
        </div>

        {/* Category Filter Dropdown (disabled if transfers selected) */}
        {typeFilter !== 'transfer' && (
          <div className="flex items-center gap-1.5">
            <select
              value={selectedCategoryId}
              onChange={(e) => onCategoryChange(e.target.value)}
              className="h-8 rounded-[8px] border border-[#303030] bg-[#181818] px-2.5 text-xs text-[#F5F1E8] focus:border-[#D6AD60] focus:outline-none transition-colors"
            >
              <option value="all">All Categories</option>
              {visibleCategories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name} ({cat.type})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Date Filter Dropdown */}
        <div className="flex items-center gap-1.5">
          <select
            value={dateFilter}
            onChange={(e) => onDateFilterChange(e.target.value as DateFilterPreset)}
            className="h-8 rounded-[8px] border border-[#303030] bg-[#181818] px-2.5 text-xs text-[#F5F1E8] focus:border-[#D6AD60] focus:outline-none transition-colors"
          >
            <option value="all">All Time</option>
            <option value="this_month">This Month</option>
            <option value="last_30_days">Last 30 Days</option>
            <option value="this_year">This Year</option>
          </select>
        </div>

        {/* Sort By Dropdown */}
        <div className="flex items-center gap-1.5">
          <select
            value={sortBy}
            onChange={(e) => onSortByChange?.(e.target.value as SortField)}
            className="h-8 rounded-[8px] border border-[#303030] bg-[#181818] px-2.5 text-xs text-[#F5F1E8] focus:border-[#D6AD60] focus:outline-none transition-colors"
          >
            <option value="date">Sort by Date</option>
            <option value="amount">Sort by Amount</option>
          </select>
        </div>

        {/* Sort Direction Toggle */}
        <Button
          variant="outline"
          size="sm"
          onClick={onToggleSortDirection}
          className="h-8 text-xs font-normal text-[#858078] hover:text-[#F5F1E8]"
          title="Toggle sort order"
        >
          <ArrowUpDown className="h-3.5 w-3.5 mr-1" />
          {sortBy === 'amount'
            ? sortDirection === 'desc'
              ? 'Highest amount'
              : 'Lowest amount'
            : sortDirection === 'desc'
            ? 'Newest first'
            : 'Oldest first'}
        </Button>

        {/* Reset Filter Button */}
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onResetFilters}
            className="h-8 text-xs text-[#D9827C] hover:text-[#D9827C] hover:bg-[#D9827C]/10"
          >
            <X className="h-3.5 w-3.5 mr-1" />
            Reset filters
          </Button>
        )}
      </div>
    </div>
  );
};

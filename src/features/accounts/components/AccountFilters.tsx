import React from 'react';
import { SearchInput } from '@/components/ui/SearchInput';
import { cn } from '@/utils/cn';

export type AccountFilterTab = 'all' | 'bank_savings' | 'cash_wallet' | 'credit' | 'archived';

export interface AccountFilterCounts {
  all: number;
  bank_savings: number;
  cash_wallet: number;
  credit: number;
  archived: number;
}

export interface AccountFiltersProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  activeTab: AccountFilterTab;
  onTabChange: (tab: AccountFilterTab) => void;
  counts: AccountFilterCounts;
}

export const AccountFilters: React.FC<AccountFiltersProps> = ({
  searchQuery,
  onSearchChange,
  activeTab,
  onTabChange,
  counts
}) => {
  const tabs: Array<{ id: AccountFilterTab; label: string; count: number }> = [
    { id: 'all', label: 'All Accounts', count: counts.all },
    { id: 'bank_savings', label: 'Bank & Savings', count: counts.bank_savings },
    { id: 'cash_wallet', label: 'Cash & Wallets', count: counts.cash_wallet },
    { id: 'credit', label: 'Credit Cards', count: counts.credit },
    { id: 'archived', label: 'Archived', count: counts.archived }
  ];

  return (
    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3.5">
      {/* Filter Tabs / Pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={cn(
                'inline-flex items-center gap-2 px-3 py-1.5 rounded-[8px] text-xs font-medium whitespace-nowrap transition-colors duration-150',
                isActive
                  ? 'bg-[#D6AD60] text-[#101010] font-semibold shadow-sm'
                  : 'bg-[#1B1B1B] text-[#B9B4AA] hover:bg-[#242424] hover:text-[#F5F1E8] border border-[#303030]'
              )}
            >
              <span>{tab.label}</span>
              <span
                className={cn(
                  'px-1.5 py-0.2 rounded-full text-[10px] font-bold tabular-nums',
                  isActive
                    ? 'bg-[#101010]/20 text-[#101010]'
                    : 'bg-[#242424] text-[#858078]'
                )}
              >
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search Bar */}
      <div className="w-full sm:w-64 shrink-0">
        <SearchInput
          placeholder="Search accounts or bank..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          onClear={() => onSearchChange('')}
        />
      </div>
    </div>
  );
};

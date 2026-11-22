import React from 'react';
import { Landmark, TrendingUp, CreditCard, Layers } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { AccountsSummary } from '../hooks/useAccounts';

export interface AccountSummaryMetricsProps {
  summary: AccountsSummary;
}

export const AccountSummaryMetrics: React.FC<AccountSummaryMetricsProps> = ({ summary }) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Total Net Worth */}
      <Card variant="elevated" className="p-4 border-[#303030] bg-[#1B1B1B] relative overflow-hidden">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-[#858078] uppercase tracking-wider">
            Net Worth
          </span>
          <div className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-[#D6AD60]/10 text-[#D6AD60]">
            <TrendingUp className="h-4 w-4" />
          </div>
        </div>
        <div className="text-xl sm:text-2xl font-bold font-display text-[#F5F1E8] tracking-tight">
          {summary.totalNetWorthFormatted}
        </div>
        <div className="text-[11px] text-[#B9B4AA] mt-1 flex items-center gap-1.5">
          <span>Assets minus liabilities</span>
        </div>
      </Card>

      {/* Total Assets */}
      <Card variant="surface" className="p-4 border-[#303030] bg-[#1B1B1B]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-[#858078] uppercase tracking-wider">
            Total Assets
          </span>
          <div className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-[#72B895]/10 text-[#72B895]">
            <Landmark className="h-4 w-4" />
          </div>
        </div>
        <div className="text-xl sm:text-2xl font-bold font-display text-[#72B895] tracking-tight">
          {summary.totalAssetsFormatted}
        </div>
        <div className="text-[11px] text-[#858078] mt-1">
          Bank, cash & wallet reserves
        </div>
      </Card>

      {/* Total Liabilities */}
      <Card variant="surface" className="p-4 border-[#303030] bg-[#1B1B1B]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-[#858078] uppercase tracking-wider">
            Liabilities
          </span>
          <div className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-[#D9827C]/10 text-[#D9827C]">
            <CreditCard className="h-4 w-4" />
          </div>
        </div>
        <div className="text-xl sm:text-2xl font-bold font-display text-[#D9827C] tracking-tight">
          {summary.totalLiabilitiesFormatted}
        </div>
        <div className="text-[11px] text-[#858078] mt-1">
          Credit cards & overdraft debt
        </div>
      </Card>

      {/* Active Accounts Count */}
      <Card variant="surface" className="p-4 border-[#303030] bg-[#1B1B1B]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-[#858078] uppercase tracking-wider">
            Accounts
          </span>
          <div className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-[#82A9CF]/10 text-[#82A9CF]">
            <Layers className="h-4 w-4" />
          </div>
        </div>
        <div className="text-xl sm:text-2xl font-bold font-display text-[#F5F1E8] tracking-tight">
          {summary.activeAccountsCount}
        </div>
        <div className="text-[11px] text-[#858078] mt-1">
          {summary.archivedAccountsCount > 0
            ? `${summary.archivedAccountsCount} archived account${summary.archivedAccountsCount > 1 ? 's' : ''}`
            : 'All accounts active'}
        </div>
      </Card>
    </div>
  );
};

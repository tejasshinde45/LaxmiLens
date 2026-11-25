import React from 'react';
import { HandCoins, ArrowDownLeft, ArrowUpRight, Users } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { BorrowingsSummaryDTO } from '@/application/dto/BorrowingDTO';

export interface BorrowingsSummaryMetricsProps {
  summary: BorrowingsSummaryDTO;
  isLoading: boolean;
}

export const BorrowingsSummaryMetrics: React.FC<BorrowingsSummaryMetricsProps> = ({
  summary,
  isLoading
}) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* 1. Total Outstanding Debt */}
      <Card variant="surface" className="space-y-2 border-[#D6AD60]/20 bg-[#161616]">
        <div className="flex items-center justify-between text-[#858078]">
          <span className="text-xs font-medium">Total Outstanding</span>
          <HandCoins className="h-4 w-4 text-[#D6AD60]" />
        </div>
        <div className="space-y-0.5">
          {isLoading ? (
            <Skeleton className="h-8 w-28 my-0.5" />
          ) : (
            <div className="text-2xl font-bold font-tabular text-[#D6AD60]">
              {summary.totalOutstandingFormatted}
            </div>
          )}
          <p className="text-[11px] text-[#858078]">
            {summary.activeLendersCount > 0
              ? `Owed across ${summary.activeLendersCount} active lender${summary.activeLendersCount > 1 ? 's' : ''}`
              : 'No active personal borrowings'}
          </p>
        </div>
      </Card>

      {/* 2. Total Borrowed */}
      <Card variant="surface" className="space-y-2">
        <div className="flex items-center justify-between text-[#858078]">
          <span className="text-xs font-medium">Total Borrowed</span>
          <ArrowDownLeft className="h-4 w-4 text-[#82A9CF]" />
        </div>
        <div className="space-y-0.5">
          {isLoading ? (
            <Skeleton className="h-8 w-24 my-0.5" />
          ) : (
            <div className="text-2xl font-bold font-tabular text-[#F5F1E8]">
              {summary.totalBorrowedFormatted}
            </div>
          )}
          <p className="text-[11px] text-[#858078]">
            {summary.totalBorrowingsCount > 0
              ? `Lifetime principal across ${summary.totalBorrowingsCount} record${summary.totalBorrowingsCount > 1 ? 's' : ''}`
              : 'Cumulative borrowed amount'}
          </p>
        </div>
      </Card>

      {/* 3. Total Repaid */}
      <Card variant="surface" className="space-y-2">
        <div className="flex items-center justify-between text-[#858078]">
          <span className="text-xs font-medium">Total Repaid</span>
          <ArrowUpRight className="h-4 w-4 text-[#72B895]" />
        </div>
        <div className="space-y-0.5">
          {isLoading ? (
            <Skeleton className="h-8 w-24 my-0.5" />
          ) : (
            <div className="text-2xl font-bold font-tabular text-[#72B895]">
              {summary.totalRepaidFormatted}
            </div>
          )}
          <p className="text-[11px] text-[#858078]">
            {summary.totalBorrowedPaise > 0
              ? `${Math.round((summary.totalRepaidPaise / summary.totalBorrowedPaise) * 100)}% of principal returned`
              : 'Principal returned to lenders'}
          </p>
        </div>
      </Card>

      {/* 4. Active Lenders */}
      <Card variant="surface" className="space-y-2">
        <div className="flex items-center justify-between text-[#858078]">
          <span className="text-xs font-medium">Active Lenders</span>
          <Users className="h-4 w-4 text-[#B9B4AA]" />
        </div>
        <div className="space-y-0.5">
          {isLoading ? (
            <Skeleton className="h-8 w-16 my-0.5" />
          ) : (
            <div className="text-2xl font-bold font-tabular text-[#F5F1E8]">
              {summary.activeLendersCount}
              <span className="text-xs font-normal text-[#858078] ml-1.5">
                / {summary.totalLendersCount} total
              </span>
            </div>
          )}
          <p className="text-[11px] text-[#858078]">
            {summary.activeBorrowingsCount} active borrowing contract{summary.activeBorrowingsCount !== 1 ? 's' : ''}
          </p>
        </div>
      </Card>
    </div>
  );
};

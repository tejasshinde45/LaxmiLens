import React from 'react';
import { Users, ChevronRight, CheckCircle2 } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/feedback/EmptyState';
import { LenderDTO } from '@/application/dto/BorrowingDTO';
import { cn } from '@/utils/cn';

export interface LenderTableProps {
  lenders: LenderDTO[];
  onSelectLender: (lender: LenderDTO) => void;
  onRepayLender: (lender: LenderDTO) => void;
  onAddBorrowing: () => void;
}

export const LenderTable: React.FC<LenderTableProps> = ({
  lenders,
  onSelectLender,
  onRepayLender,
  onAddBorrowing
}) => {
  if (lenders.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="No personal borrowings tracked yet"
        description="Track money borrowed from multiple friends, relatives, or individuals under one aggregate liability account."
        actionLabel="Add First Borrowing"
        onAction={onAddBorrowing}
      />
    );
  }

  return (
    <Card variant="surface" className="overflow-hidden border-[#303030]">
      {/* Table Header */}
      <div className="hidden sm:grid sm:grid-cols-12 px-5 py-3 border-b border-[#303030] bg-[#141414] text-[11px] font-bold uppercase tracking-wider text-[#858078]">
        <div className="col-span-4">Lender</div>
        <div className="col-span-2 text-right">Borrowed</div>
        <div className="col-span-2 text-right">Repaid</div>
        <div className="col-span-2 text-right">Outstanding</div>
        <div className="col-span-2 text-right">Actions</div>
      </div>

      {/* Rows */}
      <div className="divide-y divide-[#262626]">
        {lenders.map((lender) => {
          const isFullyRepaid = lender.outstandingPaise === 0;

          return (
            <div
              key={lender.id}
              className={cn(
                'px-5 py-4 transition-colors hover:bg-[#1A1A1A] flex flex-col sm:grid sm:grid-cols-12 sm:items-center gap-3 sm:gap-0',
                isFullyRepaid && 'opacity-70 bg-[#121212]/50'
              )}
            >
              {/* Lender Name & Status */}
              <div className="col-span-4 flex items-center gap-3">
                <div
                  className={cn(
                    'h-9 w-9 rounded-full flex items-center justify-center font-bold text-xs shrink-0',
                    isFullyRepaid
                      ? 'bg-[#72B895]/15 text-[#72B895]'
                      : 'bg-[#D6AD60]/15 text-[#D6AD60]'
                  )}
                >
                  {isFullyRepaid ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    lender.name.slice(0, 2).toUpperCase()
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-[#F5F1E8] truncate">
                      {lender.name}
                    </span>
                    {isFullyRepaid ? (
                      <Badge variant="income" size="sm">
                        Fully Repaid
                      </Badge>
                    ) : (
                      <Badge variant="warning" size="sm">
                        Active
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-[#858078] truncate">
                    {lender.borrowingsCount} borrowing{lender.borrowingsCount !== 1 ? 's' : ''}
                    {lender.repaymentsCount > 0 && ` • ${lender.repaymentsCount} repayment${lender.repaymentsCount !== 1 ? 's' : ''}`}
                  </p>
                </div>
              </div>

              {/* Borrowed Amount */}
              <div className="col-span-2 sm:text-right flex sm:block justify-between items-center text-xs">
                <span className="sm:hidden text-[#858078]">Borrowed:</span>
                <span className="font-medium text-[#F5F1E8] font-tabular">
                  {lender.totalBorrowedFormatted}
                </span>
              </div>

              {/* Repaid Amount */}
              <div className="col-span-2 sm:text-right flex sm:block justify-between items-center text-xs">
                <span className="sm:hidden text-[#858078]">Repaid:</span>
                <span className="font-medium text-[#72B895] font-tabular">
                  {lender.totalRepaidFormatted}
                </span>
              </div>

              {/* Outstanding Balance */}
              <div className="col-span-2 sm:text-right flex sm:block justify-between items-center text-xs">
                <span className="sm:hidden text-[#858078]">Outstanding:</span>
                <span
                  className={cn(
                    'font-bold font-tabular text-sm',
                    isFullyRepaid ? 'text-[#72B895]' : 'text-[#D6AD60]'
                  )}
                >
                  {lender.outstandingFormatted}
                </span>
              </div>

              {/* Actions */}
              <div className="col-span-2 flex items-center justify-end gap-2 pt-2 sm:pt-0 border-t border-[#262626] sm:border-0">
                {!isFullyRepaid && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs text-[#D6AD60] border-[#D6AD60]/40 hover:bg-[#D6AD60]/10"
                    onClick={() => onRepayLender(lender)}
                  >
                    Repay
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs text-[#858078] hover:text-[#F5F1E8]"
                  onClick={() => onSelectLender(lender)}
                >
                  Details
                  <ChevronRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
};

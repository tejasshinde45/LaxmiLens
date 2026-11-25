import React from 'react';
import { ArrowDownLeft, Calendar, Landmark } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/feedback/EmptyState';
import { BorrowingDTO } from '@/application/dto/BorrowingDTO';
import { formatDate } from '@/utils/formatters';
import { cn } from '@/utils/cn';

export interface BorrowingHistoryTableProps {
  borrowings: BorrowingDTO[];
  onSelectBorrowing: (borrowing: BorrowingDTO) => void;
  onRepayBorrowing: (borrowing: BorrowingDTO) => void;
  onAddBorrowing: () => void;
}

export const BorrowingHistoryTable: React.FC<BorrowingHistoryTableProps> = ({
  borrowings,
  onSelectBorrowing,
  onRepayBorrowing,
  onAddBorrowing
}) => {
  if (borrowings.length === 0) {
    return (
      <EmptyState
        icon={ArrowDownLeft}
        title="No borrowings history"
        description="Records of all principal received from lenders will appear here."
        actionLabel="Add Borrowing"
        onAction={onAddBorrowing}
      />
    );
  }

  return (
    <Card variant="surface" className="overflow-hidden border-[#303030]">
      <div className="hidden sm:grid sm:grid-cols-12 px-5 py-3 border-b border-[#303030] bg-[#141414] text-[11px] font-bold uppercase tracking-wider text-[#858078]">
        <div className="col-span-3">Lender & Date</div>
        <div className="col-span-3">Receiving Account</div>
        <div className="col-span-2 text-right">Principal</div>
        <div className="col-span-2 text-right">Outstanding</div>
        <div className="col-span-2 text-right">Status / Actions</div>
      </div>

      <div className="divide-y divide-[#262626]">
        {borrowings.map((b) => {
          const isFullyRepaid = b.status === 'repaid' || b.outstandingPaise === 0;

          return (
            <div
              key={b.id}
              className={cn(
                'px-5 py-4 transition-colors hover:bg-[#1A1A1A] flex flex-col sm:grid sm:grid-cols-12 sm:items-center gap-2 sm:gap-0',
                isFullyRepaid && 'opacity-70 bg-[#121212]/50'
              )}
            >
              {/* Lender & Date */}
              <div className="col-span-3 min-w-0">
                <p className="font-semibold text-sm text-[#F5F1E8] truncate">
                  {b.lenderName}
                </p>
                <div className="flex items-center gap-1.5 text-xs text-[#858078] mt-0.5">
                  <Calendar className="h-3 w-3" />
                  <span>{formatDate(b.borrowingDate, 'dd MMM yyyy')}</span>
                  {b.dueDate && (
                    <span className="text-[#B9B4AA]">
                      • Due {formatDate(b.dueDate, 'dd MMM')}
                    </span>
                  )}
                </div>
              </div>

              {/* Receiving Account */}
              <div className="col-span-3 flex items-center gap-1.5 text-xs text-[#B9B4AA]">
                <Landmark className="h-3.5 w-3.5 text-[#858078] shrink-0" />
                <span className="truncate">{b.receivingAccountName || 'Account'}</span>
              </div>

              {/* Principal */}
              <div className="col-span-2 sm:text-right flex sm:block justify-between items-center text-xs">
                <span className="sm:hidden text-[#858078]">Principal:</span>
                <span className="font-medium text-[#F5F1E8] font-tabular">
                  {b.amountFormatted}
                </span>
              </div>

              {/* Outstanding */}
              <div className="col-span-2 sm:text-right flex sm:block justify-between items-center text-xs">
                <span className="sm:hidden text-[#858078]">Outstanding:</span>
                <span
                  className={cn(
                    'font-bold font-tabular text-sm',
                    isFullyRepaid ? 'text-[#72B895]' : 'text-[#D6AD60]'
                  )}
                >
                  {b.outstandingFormatted}
                </span>
              </div>

              {/* Status & Actions */}
              <div className="col-span-2 flex items-center justify-end gap-2 pt-2 sm:pt-0 border-t border-[#262626] sm:border-0">
                {isFullyRepaid ? (
                  <Badge variant="income" size="sm">
                    Repaid
                  </Badge>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs text-[#D6AD60] border-[#D6AD60]/40 hover:bg-[#D6AD60]/10"
                    onClick={() => onRepayBorrowing(b)}
                  >
                    Repay
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs text-[#858078] hover:text-[#F5F1E8]"
                  onClick={() => onSelectBorrowing(b)}
                >
                  View
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
};

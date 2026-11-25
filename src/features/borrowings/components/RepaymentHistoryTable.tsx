import React from 'react';
import { ArrowUpRight, Calendar, Landmark } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/feedback/EmptyState';
import { BorrowingRepaymentDTO } from '@/application/dto/BorrowingDTO';
import { formatDate } from '@/utils/formatters';

export interface RepaymentHistoryTableProps {
  repayments: BorrowingRepaymentDTO[];
  onRecordRepayment?: () => void;
}

export const RepaymentHistoryTable: React.FC<RepaymentHistoryTableProps> = ({
  repayments,
  onRecordRepayment
}) => {
  if (repayments.length === 0) {
    return (
      <EmptyState
        icon={ArrowUpRight}
        title="No repayment history"
        description="Records of all repayments made to lenders will appear here."
        actionLabel={onRecordRepayment ? 'Record Repayment' : undefined}
        onAction={onRecordRepayment}
      />
    );
  }

  return (
    <Card variant="surface" className="overflow-hidden border-[#303030]">
      <div className="hidden sm:grid sm:grid-cols-12 px-5 py-3 border-b border-[#303030] bg-[#141414] text-[11px] font-bold uppercase tracking-wider text-[#858078]">
        <div className="col-span-4">Lender & Date</div>
        <div className="col-span-4">Paid From Account</div>
        <div className="col-span-4 text-right">Repaid Amount</div>
      </div>

      <div className="divide-y divide-[#262626]">
        {repayments.map((r) => (
          <div
            key={r.id}
            className="px-5 py-4 transition-colors hover:bg-[#1A1A1A] flex flex-col sm:grid sm:grid-cols-12 sm:items-center gap-2 sm:gap-0"
          >
            {/* Lender & Date */}
            <div className="col-span-4 min-w-0">
              <p className="font-semibold text-sm text-[#F5F1E8] truncate">
                {r.lenderName}
              </p>
              <div className="flex items-center gap-1.5 text-xs text-[#858078] mt-0.5">
                <Calendar className="h-3 w-3" />
                <span>{formatDate(r.repaymentDate, 'dd MMM yyyy')}</span>
                {r.notes && (
                  <span className="text-[#858078] truncate">• {r.notes}</span>
                )}
              </div>
            </div>

            {/* Paid From Account */}
            <div className="col-span-4 flex items-center gap-1.5 text-xs text-[#B9B4AA]">
              <Landmark className="h-3.5 w-3.5 text-[#858078] shrink-0" />
              <span className="truncate">{r.paymentAccountName || 'Account'}</span>
            </div>

            {/* Repaid Amount */}
            <div className="col-span-4 sm:text-right flex sm:block justify-between items-center text-xs">
              <span className="sm:hidden text-[#858078]">Amount:</span>
              <span className="font-bold text-[#72B895] font-tabular text-sm">
                {r.amountFormatted}
              </span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
};

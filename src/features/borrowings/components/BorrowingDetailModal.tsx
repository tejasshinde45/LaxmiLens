import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { BorrowingDTO, LenderDTO } from '@/application/dto/BorrowingDTO';
import { formatDate } from '@/utils/formatters';

export interface BorrowingDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  borrowing?: BorrowingDTO | null;
  lender?: LenderDTO | null;
  onRepay: () => void;
}

export const BorrowingDetailModal: React.FC<BorrowingDetailModalProps> = ({
  isOpen,
  onClose,
  borrowing,
  lender,
  onRepay
}) => {
  if (!borrowing && !lender) return null;

  const isLenderView = !borrowing && !!lender;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md w-full bg-[#161616] border border-[#303030] text-[#F5F1E8]">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="text-lg font-display font-bold text-[#F5F1E8]">
              {isLenderView ? lender?.name : `Borrowing: ${borrowing?.lenderName}`}
            </DialogTitle>
            {isLenderView ? (
              lender?.outstandingPaise === 0 ? (
                <Badge variant="income" size="sm">
                  Fully Repaid
                </Badge>
              ) : (
                <Badge variant="warning" size="sm">
                  Active
                </Badge>
              )
            ) : borrowing?.status === 'repaid' || borrowing?.outstandingPaise === 0 ? (
              <Badge variant="income" size="sm">
                Fully Repaid
              </Badge>
            ) : (
              <Badge variant="warning" size="sm">
                Active
              </Badge>
            )}
          </div>
          <DialogDescription className="text-xs text-[#858078]">
            {isLenderView
              ? 'Lender summary and sub-ledger details'
              : 'Individual borrowing record and repayment audit trail'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Financial Breakdown Card */}
          <Card variant="surface" className="p-4 bg-[#1B1B1B] border-[#303030] space-y-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-[10px] uppercase font-bold text-[#858078]">Borrowed</p>
                <p className="text-sm font-bold font-tabular text-[#F5F1E8] mt-0.5">
                  {isLenderView ? lender?.totalBorrowedFormatted : borrowing?.amountFormatted}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase font-bold text-[#858078]">Repaid</p>
                <p className="text-sm font-bold font-tabular text-[#72B895] mt-0.5">
                  {isLenderView ? lender?.totalRepaidFormatted : borrowing?.repaidFormatted}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase font-bold text-[#858078]">Outstanding</p>
                <p className="text-sm font-bold font-tabular text-[#D6AD60] mt-0.5">
                  {isLenderView ? lender?.outstandingFormatted : borrowing?.outstandingFormatted}
                </p>
              </div>
            </div>
          </Card>

          {/* Details Metadata */}
          {!isLenderView && borrowing && (
            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1.5 border-b border-[#262626]">
                <span className="text-[#858078]">Borrowing Date</span>
                <span className="text-[#F5F1E8]">
                  {formatDate(borrowing.borrowingDate, 'dd MMMM yyyy')}
                </span>
              </div>
              {borrowing.dueDate && (
                <div className="flex justify-between py-1.5 border-b border-[#262626]">
                  <span className="text-[#858078]">Due Date</span>
                  <span className="text-[#D6AD60]">
                    {formatDate(borrowing.dueDate, 'dd MMMM yyyy')}
                  </span>
                </div>
              )}
              <div className="flex justify-between py-1.5 border-b border-[#262626]">
                <span className="text-[#858078]">Receiving Account</span>
                <span className="text-[#F5F1E8]">{borrowing.receivingAccountName}</span>
              </div>
              {borrowing.notes && (
                <div className="py-1.5 border-b border-[#262626]">
                  <span className="text-[#858078] block mb-0.5">Note</span>
                  <span className="text-[#F5F1E8]">{borrowing.notes}</span>
                </div>
              )}
            </div>
          )}

          {/* Repayments Sub-list for this borrowing */}
          {!isLenderView && borrowing && (
            <div className="space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-[#858078]">
                Repayments ({borrowing.repayments.length})
              </h4>
              {borrowing.repayments.length === 0 ? (
                <p className="text-xs text-[#858078] italic">No repayments recorded yet.</p>
              ) : (
                <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                  {borrowing.repayments.map((r) => (
                    <div
                      key={r.id}
                      className="p-2 rounded bg-[#1B1B1B] border border-[#262626] flex items-center justify-between text-xs"
                    >
                      <div>
                        <span className="text-[#F5F1E8] font-medium font-tabular">
                          {r.amountFormatted}
                        </span>
                        <span className="text-[#858078] ml-2">
                          via {r.paymentAccountName}
                        </span>
                      </div>
                      <span className="text-[11px] text-[#858078]">
                        {formatDate(r.repaymentDate, 'dd MMM yyyy')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <DialogFooter className="pt-2 flex justify-between items-center sm:justify-between">
            <Button variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
            {((isLenderView && (lender?.outstandingPaise ?? 0) > 0) ||
              (!isLenderView && (borrowing?.outstandingPaise ?? 0) > 0)) && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  onClose();
                  onRepay();
                }}
              >
                Record Repayment
              </Button>
            )}
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
};

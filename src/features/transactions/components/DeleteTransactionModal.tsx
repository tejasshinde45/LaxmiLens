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
import { TransactionResponseDTO } from '@/application/dto/TransactionDTO';
import { formatDate } from '@/utils/formatters';
import { AlertTriangle } from 'lucide-react';

export interface DeleteTransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  transaction: TransactionResponseDTO | null;
  onConfirmDelete: (id: string) => Promise<void>;
  isLoading?: boolean;
}

export const DeleteTransactionModal: React.FC<DeleteTransactionModalProps> = ({
  isOpen,
  onClose,
  transaction,
  onConfirmDelete,
  isLoading = false
}) => {
  if (!transaction) return null;

  const handleDelete = async () => {
    await onConfirmDelete(transaction.id);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isLoading && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2 text-[#D9827C] mb-1">
            <AlertTriangle className="h-5 w-5" />
            <DialogTitle className="text-lg font-semibold text-[#F5F1E8]">
              Delete Transaction
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-[#858078]">
            This action will soft-delete the transaction from your active ledger.
          </DialogDescription>
        </DialogHeader>

        {/* Transaction Summary Preview */}
        <div className="rounded-[8px] bg-[#141414] border border-[#2B2B2B] p-3 space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-medium text-[#F5F1E8] truncate max-w-[200px]">
              {transaction.title || 'Untitled Transaction'}
            </span>
            <Badge
              variant={
                transaction.type === 'income'
                  ? 'income'
                  : transaction.type === 'expense'
                  ? 'expense'
                  : 'transfer'
              }
              size="sm"
            >
              {transaction.type.toUpperCase()}
            </Badge>
          </div>

          <div className="flex items-center justify-between text-[#858078]">
            <span>{formatDate(transaction.transactionDate, 'dd MMM yyyy')}</span>
            <span className="font-bold font-tabular text-sm text-[#F5F1E8]">
              {transaction.amountFormatted}
            </span>
          </div>
        </div>

        <p className="text-xs text-[#858078] leading-relaxed">
          The transaction will be flagged as deleted in local storage and queued for soft-deletion
          in cloud sync. Related account balances will update mathematically immediately.
        </p>

        <DialogFooter className="pt-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            onClick={handleDelete}
            isLoading={isLoading}
          >
            Delete Transaction
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

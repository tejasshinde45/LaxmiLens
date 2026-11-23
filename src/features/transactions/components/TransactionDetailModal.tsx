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
import { AccountWithBalanceDTO } from '@/application/dto/AccountDTO';
import { Category } from '@/domain/entities/Category';
import { formatDate } from '@/utils/formatters';
import { CategoryIcon } from '@/features/categories/components/CategoryIcon';
import {
  Edit2,
  Trash2,
  Calendar,
  Wallet,
  ArrowRight,
  FileText
} from 'lucide-react';
import { cn } from '@/utils/cn';

export interface TransactionDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  transaction: TransactionResponseDTO | null;
  accounts: AccountWithBalanceDTO[];
  categories: Category[];
  isPendingSync: boolean;
  onEdit: (tx: TransactionResponseDTO) => void;
  onDelete: (tx: TransactionResponseDTO) => void;
}

export const TransactionDetailModal: React.FC<TransactionDetailModalProps> = ({
  isOpen,
  onClose,
  transaction,
  accounts,
  categories,
  isPendingSync,
  onEdit,
  onDelete
}) => {
  if (!transaction) return null;

  const sourceAccount = accounts.find((a) => a.id === transaction.accountId);
  const destAccount = transaction.destinationAccountId
    ? accounts.find((a) => a.id === transaction.destinationAccountId)
    : undefined;
  const category = transaction.categoryId
    ? categories.find((c) => c.id === transaction.categoryId)
    : undefined;

  const isIncome = transaction.type === 'income';
  const isExpense = transaction.type === 'expense';
  const isTransfer = transaction.type === 'transfer';

  const amountColor = isIncome
    ? 'text-[#72B895]'
    : isExpense
    ? 'text-[#D9827C]'
    : 'text-[#82A9CF]';

  const amountSign = isIncome ? '+' : isExpense ? '-' : '';

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <Badge
              variant={isIncome ? 'income' : isExpense ? 'expense' : 'transfer'}
              size="sm"
            >
              {transaction.type.toUpperCase()}
            </Badge>

            {isPendingSync ? (
              <Badge variant="warning" size="sm" dot>
                Saved Locally
              </Badge>
            ) : (
              <Badge variant="neutral" size="sm" dot>
                Synced to Cloud
              </Badge>
            )}

            <span className="text-xs text-[#858078] ml-auto">
              v{transaction.version}
            </span>
          </div>

          <DialogTitle className="text-xl font-display font-semibold text-[#F5F1E8]">
            {transaction.title || 'Untitled Transaction'}
          </DialogTitle>
          <DialogDescription className="text-xs text-[#858078]">
            Recorded on {formatDate(transaction.transactionDate, 'dd MMMM yyyy')}
          </DialogDescription>
        </DialogHeader>

        {/* Big Amount Card */}
        <div className="rounded-[10px] bg-[#141414] border border-[#2B2B2B] p-4 text-center space-y-1">
          <span className="text-xs text-[#858078] uppercase tracking-wider font-medium">
            Transaction Amount
          </span>
          <div className={cn('text-3xl font-bold font-tabular tracking-tight', amountColor)}>
            {amountSign}
            {transaction.amountFormatted}
          </div>
          <p className="text-[11px] text-[#858078]">
            {isTransfer
              ? 'Inter-account liquidity reallocation'
              : `${transaction.currency} ${transaction.amountPaise} integer paise`}
          </p>
        </div>

        {/* Detailed Breakdown */}
        <div className="space-y-3 py-2 text-xs">
          {/* Account / Flow */}
          <div className="flex items-center justify-between border-b border-[#262626] pb-2">
            <div className="flex items-center gap-1.5 text-[#858078]">
              <Wallet className="h-3.5 w-3.5" />
              <span>{isTransfer ? 'Transfer Path' : 'Account'}</span>
            </div>
            {isTransfer ? (
              <div className="flex items-center gap-1.5 font-medium text-[#F5F1E8]">
                <span>{sourceAccount?.name || 'Unknown Account'}</span>
                <ArrowRight className="h-3 w-3 text-[#82A9CF]" />
                <span>{destAccount?.name || 'Unknown Account'}</span>
              </div>
            ) : (
              <span className="font-medium text-[#F5F1E8]">
                {sourceAccount?.name || 'Unknown Account'} ({sourceAccount?.accountType || 'Asset'})
              </span>
            )}
          </div>

          {/* Category (if not transfer) */}
          {!isTransfer && (
            <div className="flex items-center justify-between border-b border-[#262626] pb-2">
              <span className="text-[#858078]">Category</span>
              {category ? (
                <div className="flex items-center gap-1.5">
                  <CategoryIcon name={category.icon} color={category.color} className="h-3.5 w-3.5" />
                  <span className="font-medium text-[#F5F1E8]">{category.name}</span>
                </div>
              ) : (
                <span className="text-[#858078] italic">Uncategorized</span>
              )}
            </div>
          )}

          {/* Date */}
          <div className="flex items-center justify-between border-b border-[#262626] pb-2">
            <div className="flex items-center gap-1.5 text-[#858078]">
              <Calendar className="h-3.5 w-3.5" />
              <span>Date</span>
            </div>
            <span className="font-medium text-[#F5F1E8]">
              {formatDate(transaction.transactionDate, 'dd MMM yyyy')}
            </span>
          </div>

          {/* Notes */}
          {transaction.note && (
            <div className="border-b border-[#262626] pb-2 space-y-1">
              <div className="flex items-center gap-1.5 text-[#858078]">
                <FileText className="h-3.5 w-3.5" />
                <span>Notes</span>
              </div>
              <p className="text-xs text-[#B9B4AA] whitespace-pre-wrap pl-5 bg-[#141414] p-2 rounded-[6px] border border-[#242424]">
                {transaction.note}
              </p>
            </div>
          )}

          {/* Idempotency Key & Sync Diagnostics */}
          <div className="pt-1 text-[10px] text-[#858078] space-y-1">
            <div className="flex justify-between">
              <span>Transaction ID:</span>
              <span className="font-mono text-[#B9B4AA]">{transaction.id}</span>
            </div>
            <div className="flex justify-between">
              <span>Idempotency Key:</span>
              <span className="font-mono text-[#B9B4AA] truncate max-w-[200px]" title={transaction.idempotencyKey}>
                {transaction.idempotencyKey}
              </span>
            </div>
          </div>
        </div>

        <DialogFooter className="flex flex-row justify-between items-center pt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onClose();
              onDelete(transaction);
            }}
            className="text-[#D9827C] hover:text-[#D9827C] hover:bg-[#D9827C]/10"
          >
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            Delete
          </Button>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                onClose();
                onEdit(transaction);
              }}
            >
              <Edit2 className="h-3.5 w-3.5 mr-1" />
              Edit
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

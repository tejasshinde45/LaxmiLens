import React, { useState, useEffect } from 'react';
import { AlertTriangle, AlertCircle } from 'lucide-react';
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
import { BudgetOverviewItemDTO } from '@/application/dto/BudgetDTO';
import { formatBudgetPeriodLabel } from '../schemas/budgetSchemas';

export interface DeleteBudgetModalProps {
  isOpen: boolean;
  onClose: () => void;
  budget: BudgetOverviewItemDTO | null;
  onConfirmDelete: (budgetId: string) => Promise<void>;
  isLoading?: boolean;
}

export const DeleteBudgetModal: React.FC<DeleteBudgetModalProps> = ({
  isOpen,
  onClose,
  budget,
  onConfirmDelete,
  isLoading = false
}) => {
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isSubmittingLocal, setIsSubmittingLocal] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setDeleteError(null);
      setIsSubmittingLocal(false);
    }
  }, [isOpen, budget]);

  if (!budget) return null;

  const isBusy = isLoading || isSubmittingLocal;

  const handleConfirm = async () => {
    if (isBusy) return;
    setDeleteError(null);
    setIsSubmittingLocal(true);
    try {
      await onConfirmDelete(budget.budgetId);
      onClose();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Could not delete budget.');
    } finally {
      setIsSubmittingLocal(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isBusy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2 text-[#D9827C] mb-1">
            <AlertTriangle className="h-5 w-5" />
            <DialogTitle className="text-lg font-semibold text-[#F5F1E8]">
              Delete Budget
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-[#858078]">
            Remove this monthly budget threshold for {formatBudgetPeriodLabel(budget.period)}.
          </DialogDescription>
        </DialogHeader>

        {deleteError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-[10px] border border-[#D9827C]/40 bg-[#D9827C]/10 p-3 text-xs text-[#D9827C]"
          >
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{deleteError}</span>
          </div>
        )}

        <div className="rounded-[8px] bg-[#141414] border border-[#2B2B2B] p-3 space-y-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-[#F5F1E8] truncate">
              {budget.categoryName}
            </span>
            <Badge variant="gold" size="sm">
              {budget.period}
            </Badge>
          </div>
          <div className="flex items-center justify-between text-[#858078]">
            <span>Spent: {budget.spentFormatted}</span>
            <span className="font-bold font-tabular text-sm text-[#F5F1E8]">
              Limit: {budget.limitFormatted}
            </span>
          </div>
        </div>

        <p className="text-xs text-[#858078] leading-relaxed">
          Deleting a budget does not delete historical transactions. Your expense records remain
          intact in the ledger, and a tombstone deletion will be queued for cloud synchronization.
        </p>

        <DialogFooter className="pt-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={isBusy}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            onClick={handleConfirm}
            isLoading={isBusy}
            disabled={isBusy}
          >
            Delete Budget
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

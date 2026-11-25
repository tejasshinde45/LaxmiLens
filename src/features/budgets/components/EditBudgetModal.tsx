import React, { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { AlertCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { CategoryIcon } from '@/features/categories/components/CategoryIcon';
import { BudgetOverviewItemDTO } from '@/application/dto/BudgetDTO';
import { zodResolver } from '@/utils/zodResolver';
import {
  editBudgetSchema,
  EditBudgetFormValues,
  formatPaiseForInput,
  formatBudgetPeriodLabel
} from '../schemas/budgetSchemas';

export interface EditBudgetModalProps {
  isOpen: boolean;
  onClose: () => void;
  budget: BudgetOverviewItemDTO | null;
  onSubmit: (values: EditBudgetFormValues) => Promise<unknown>;
  isLoading?: boolean;
}

export const EditBudgetModal: React.FC<EditBudgetModalProps> = ({
  isOpen,
  onClose,
  budget,
  onSubmit,
  isLoading = false
}) => {
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting }
  } = useForm<EditBudgetFormValues>({
    resolver: zodResolver(editBudgetSchema),
    defaultValues: {
      id: '',
      limit: ''
    }
  });

  useEffect(() => {
    if (!isOpen || !budget) return;
    setSubmitError(null);
    reset({
      id: budget.budgetId,
      limit: formatPaiseForInput(budget.limitPaise)
    });
  }, [isOpen, budget, reset]);

  if (!budget) return null;

  const isBusy = isLoading || isSubmitting;
  const accentColor = budget.categoryColor || '#D6AD60';

  const handleFormSubmit = async (values: EditBudgetFormValues) => {
    if (isBusy) return;
    setSubmitError(null);

    try {
      await onSubmit({
        id: budget.budgetId,
        limit: values.limit
      });
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not update budget limit.');
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isBusy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Budget Limit</DialogTitle>
          <DialogDescription>
            Update the monthly spending limit. Category and billing period remain locked to preserve
            ledger integrity and concurrency version {budget.version}.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4 pt-1" noValidate>
          <input type="hidden" {...register('id')} />

          {submitError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-[10px] border border-[#D9827C]/40 bg-[#D9827C]/10 p-3 text-xs text-[#D9827C]"
            >
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{submitError}</span>
            </div>
          )}

          {/* Read-only Category and Period Identity */}
          <div className="rounded-[10px] border border-[#303030] bg-[#141414] p-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px]"
                style={{
                  backgroundColor: `${accentColor}1A`,
                  border: `1px solid ${accentColor}38`
                }}
              >
                <CategoryIcon name={budget.categoryIcon} color={accentColor} className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#F5F1E8] truncate">
                  {budget.categoryName}
                </p>
                <p className="text-xs text-[#858078]">
                  {formatBudgetPeriodLabel(budget.period)} ({budget.period})
                </p>
              </div>
            </div>
            <span className="text-[11px] font-tabular text-[#858078] shrink-0">
              v{budget.version}
            </span>
          </div>

          <Input
            id="edit-budget-limit"
            label="Monthly Budget Limit (INR)"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            disabled={isBusy}
            prefixIcon={<span className="text-xs font-bold text-[#D6AD60]">₹</span>}
            helperText={`Current spend in ${budget.period}: ${budget.spentFormatted}`}
            error={errors.limit?.message}
            {...register('limit')}
          />

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
              type="submit"
              variant="primary"
              size="sm"
              isLoading={isBusy}
              disabled={isBusy}
            >
              Save Changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

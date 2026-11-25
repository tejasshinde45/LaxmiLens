import React, { useEffect, useMemo, useState } from 'react';
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
import { Category } from '@/domain/entities/Category';
import { zodResolver } from '@/utils/zodResolver';
import {
  createBudgetSchema,
  CreateBudgetFormValues,
  formatBudgetPeriodLabel
} from '../schemas/budgetSchemas';

export interface CreateBudgetModalProps {
  isOpen: boolean;
  onClose: () => void;
  period: string;
  categories: Category[];
  existingCategoryIds: string[];
  onSubmit: (values: CreateBudgetFormValues) => Promise<unknown>;
  isLoading?: boolean;
}

export const CreateBudgetModal: React.FC<CreateBudgetModalProps> = ({
  isOpen,
  onClose,
  period,
  categories,
  existingCategoryIds,
  onSubmit,
  isLoading = false
}) => {
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Strict domain boundary: only active expense categories can receive a monthly budget
  const activeExpenseCategories = useMemo(
    () => categories.filter((c) => c.type === 'expense' && !c.isArchived),
    [categories]
  );

  const budgetedSet = useMemo(
    () => new Set(existingCategoryIds),
    [existingCategoryIds]
  );

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting }
  } = useForm<CreateBudgetFormValues>({
    resolver: zodResolver(createBudgetSchema),
    defaultValues: {
      categoryId: '',
      period,
      limit: ''
    }
  });

  useEffect(() => {
    if (!isOpen) return;
    setSubmitError(null);
    const firstAvailable = activeExpenseCategories.find((c) => !budgetedSet.has(c.id))?.id ?? '';
    reset({
      categoryId: firstAvailable,
      period,
      limit: ''
    });
  }, [isOpen, period, activeExpenseCategories, budgetedSet, reset]);

  const isBusy = isLoading || isSubmitting;

  const handleFormSubmit = async (values: CreateBudgetFormValues) => {
    if (isBusy) return;
    setSubmitError(null);

    if (budgetedSet.has(values.categoryId)) {
      const cat = activeExpenseCategories.find((c) => c.id === values.categoryId);
      setSubmitError(
        `A budget already exists for "${cat?.name ?? 'this category'}" in ${period}.`
      );
      return;
    }

    try {
      await onSubmit(values);
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not create budget.');
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isBusy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Monthly Budget</DialogTitle>
          <DialogDescription>
            Set a monthly spending limit in INR for {formatBudgetPeriodLabel(period)} ({period}).
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4 pt-1" noValidate>
          <input type="hidden" {...register('period')} />

          {submitError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-[10px] border border-[#D9827C]/40 bg-[#D9827C]/10 p-3 text-xs text-[#D9827C]"
            >
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{submitError}</span>
            </div>
          )}

          {/* Active Expense Category Selector */}
          <div className="space-y-1.5">
            <label htmlFor="budget-categoryId" className="block text-xs font-medium text-[#B9B4AA]">
              Expense Category
            </label>
            <select
              id="budget-categoryId"
              disabled={isBusy}
              className="flex h-10 w-full rounded-[10px] border border-[#303030] bg-[#1B1B1B] px-3.5 py-2 text-sm text-[#F5F1E8] focus-visible:outline-none focus-visible:border-[#D6AD60] focus-visible:ring-1 focus-visible:ring-[#D6AD60] disabled:opacity-50"
              {...register('categoryId')}
            >
              <option value="">Select an expense category</option>
              {activeExpenseCategories.map((category) => {
                const alreadyBudgeted = budgetedSet.has(category.id);
                return (
                  <option key={category.id} value={category.id}>
                    {category.name}
                    {alreadyBudgeted ? ' (Already budgeted)' : ''}
                  </option>
                );
              })}
            </select>
            {errors.categoryId?.message && (
              <p className="text-xs text-[#D9827C]">{errors.categoryId.message}</p>
            )}
            {activeExpenseCategories.length === 0 && (
              <p className="text-xs text-[#E4B66D]">
                No active expense categories available. Create or restore an expense category first.
              </p>
            )}
          </div>

          {/* Monthly Budget Limit (INR) */}
          <Input
            id="budget-limit"
            label="Monthly Budget Limit (INR)"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            disabled={isBusy}
            prefixIcon={<span className="text-xs font-bold text-[#D6AD60]">₹</span>}
            helperText="Enter a positive INR amount (stored accurately in integer paise)."
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
              Create Budget
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

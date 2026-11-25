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
import { AccountWithBalanceDTO } from '@/application';
import { Category } from '@/domain/entities/Category';
import { RecurringRuleResponseDTO } from '@/application/dto/RecurringDTO';
import { zodResolver } from '@/utils/zodResolver';
import {
  formatRecurringPaiseForInput,
  getDefaultRecurringFormValues,
  RecurringRuleFormValues,
  recurringRuleFormSchema
} from '../schemas/recurringSchemas';

export interface RecurringRuleFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: AccountWithBalanceDTO[];
  categories: Category[];
  scheduleToEdit?: RecurringRuleResponseDTO | null;
  onSubmit: (values: RecurringRuleFormValues, editRuleId?: string) => Promise<unknown>;
  isLoading?: boolean;
}

export const RecurringRuleFormModal: React.FC<RecurringRuleFormModalProps> = ({
  isOpen,
  onClose,
  accounts,
  categories,
  scheduleToEdit = null,
  onSubmit,
  isLoading = false
}) => {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const isEditMode = Boolean(scheduleToEdit);

  const activeAccounts = useMemo(
    () => accounts.filter((a) => !a.isArchived),
    [accounts]
  );

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting }
  } = useForm<RecurringRuleFormValues>({
    resolver: zodResolver(recurringRuleFormSchema),
    defaultValues: getDefaultRecurringFormValues()
  });

  const watchedType = watch('type');
  const watchedCategoryId = watch('categoryId');

  const filteredCategories = useMemo(
    () => categories.filter((c) => !c.isArchived && c.type === watchedType),
    [categories, watchedType]
  );

  useEffect(() => {
    if (!isOpen) return;
    setSubmitError(null);
    if (scheduleToEdit) {
      reset({
        title: scheduleToEdit.title,
        description: scheduleToEdit.description ?? '',
        type: scheduleToEdit.type,
        amount: formatRecurringPaiseForInput(scheduleToEdit.amountPaise),
        accountId: scheduleToEdit.accountId,
        categoryId: scheduleToEdit.categoryId ?? '',
        frequency: scheduleToEdit.frequency,
        interval: String(scheduleToEdit.interval),
        startDate: scheduleToEdit.startDate,
        endDate: scheduleToEdit.endDate ?? ''
      });
    } else {
      const defaults = getDefaultRecurringFormValues();
      defaults.accountId = activeAccounts[0]?.id ?? '';
      reset(defaults);
    }
  }, [isOpen, scheduleToEdit, activeAccounts, reset]);

  // Reset category when user toggles expense vs income on creation
  useEffect(() => {
    if (!isOpen || isEditMode || !watchedCategoryId) return;
    const match = filteredCategories.find((c) => c.id === watchedCategoryId);
    if (!match) {
      setValue('categoryId', '');
    }
  }, [isOpen, isEditMode, watchedType, watchedCategoryId, filteredCategories, setValue]);

  const isBusy = isLoading || isSubmitting;

  const handleFormSubmit = async (values: RecurringRuleFormValues) => {
    if (isBusy) return;
    setSubmitError(null);
    try {
      await onSubmit(values, scheduleToEdit?.id);
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not save recurring schedule.');
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditMode ? 'Edit Recurring Schedule' : 'Create Recurring Schedule'}
          </DialogTitle>
          <DialogDescription>
            Define recurring bills, subscriptions, or income. Actual transactions are created only
            after your explicit confirmation.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
          {submitError && (
            <div className="flex items-start gap-2 rounded-[10px] border border-[#D9827C]/40 bg-[#D9827C]/10 p-3 text-xs text-[#D9827C]">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{submitError}</span>
            </div>
          )}

          {/* Type Selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#B9B4AA]">Transaction Type</label>
            <div className="grid grid-cols-2 gap-2">
              {(['expense', 'income'] as const).map((t) => {
                const selected = watchedType === t;
                return (
                  <button
                    key={t}
                    type="button"
                    disabled={isEditMode || isBusy}
                    onClick={() => setValue('type', t)}
                    className={`h-9 rounded-[10px] border text-xs font-semibold capitalize transition-colors ${
                      selected
                        ? 'border-[#D6AD60] bg-[#D6AD60]/15 text-[#F5F1E8]'
                        : 'border-[#303030] bg-[#161616] text-[#858078] hover:text-[#F5F1E8]'
                    } ${isEditMode ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    {t === 'expense' ? 'Recurring Expense' : 'Recurring Income'}
                  </button>
                );
              })}
            </div>
          </div>

          <Input
            id="recurring-title-input"
            label="Title"
            placeholder="e.g. Apartment Rent, Netflix, Monthly Salary"
            error={errors.title?.message}
            disabled={isBusy}
            {...register('title')}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              id="recurring-amount-input"
              label="Amount (INR)"
              placeholder="e.g. 15000"
              inputMode="decimal"
              error={errors.amount?.message}
              disabled={isBusy}
              {...register('amount')}
            />

            <div className="space-y-1.5">
              <label
                htmlFor="recurring-account-select"
                className="text-xs font-medium text-[#B9B4AA]"
              >
                Account
              </label>
              <select
                id="recurring-account-select"
                disabled={isBusy}
                {...register('accountId')}
                className="h-10 w-full rounded-[10px] border border-[#303030] bg-[#161616] px-3 text-sm text-[#F5F1E8] focus-visible:outline-none focus-visible:border-[#D6AD60]"
              >
                <option value="">Select account...</option>
                {activeAccounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name}
                  </option>
                ))}
              </select>
              {errors.accountId?.message && (
                <p className="text-[11px] text-[#D9827C]">{errors.accountId.message}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label
                htmlFor="recurring-category-select"
                className="text-xs font-medium text-[#B9B4AA]"
              >
                Category (Optional)
              </label>
              <select
                id="recurring-category-select"
                disabled={isBusy}
                {...register('categoryId')}
                className="h-10 w-full rounded-[10px] border border-[#303030] bg-[#161616] px-3 text-sm text-[#F5F1E8] focus-visible:outline-none focus-visible:border-[#D6AD60]"
              >
                <option value="">Uncategorized</option>
                {filteredCategories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <label
                  htmlFor="recurring-frequency-select"
                  className="text-xs font-medium text-[#B9B4AA]"
                >
                  Frequency
                </label>
                <select
                  id="recurring-frequency-select"
                  disabled={isBusy}
                  {...register('frequency')}
                  className="h-10 w-full rounded-[10px] border border-[#303030] bg-[#161616] px-2.5 text-sm text-[#F5F1E8] focus-visible:outline-none focus-visible:border-[#D6AD60]"
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>

              <Input
                id="recurring-interval-input"
                label="Every (Interval)"
                type="number"
                min={1}
                max={365}
                error={errors.interval?.message}
                disabled={isBusy}
                {...register('interval')}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              id="recurring-start-date-input"
              label="Start Date"
              type="date"
              disabled={isEditMode || isBusy}
              error={errors.startDate?.message}
              {...register('startDate')}
            />
            <Input
              id="recurring-end-date-input"
              label="End Date (Optional)"
              type="date"
              disabled={isBusy}
              error={errors.endDate?.message}
              {...register('endDate')}
            />
          </div>

          <Input
            id="recurring-description-input"
            label="Description / Notes (Optional)"
            placeholder="e.g. Auto-debit mandate reminder or payee reference"
            error={errors.description?.message}
            disabled={isBusy}
            {...register('description')}
          />

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isBusy}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" isLoading={isBusy}>
              {isEditMode ? 'Save Changes' : 'Create Schedule'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

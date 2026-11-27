import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Calendar, AlertCircle } from 'lucide-react';
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
import { zodResolver } from '@/utils/zodResolver';
import { cn } from '@/utils/cn';
import { useAccounts } from '@/features/accounts/hooks/useAccounts';
import { useCategories } from '@/features/categories/hooks/useCategories';
import { useTransactions } from '@/features/transactions/hooks/useTransactions';
import {
  createTransactionSchema,
  CreateTransactionFormValues
} from '@/features/transactions/schemas/transactionSchemas';
import { formatLocalDateInput } from '@/application/services/FinancialAnalyticsService';

export interface QuickAddModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const QuickAddModal: React.FC<QuickAddModalProps> = ({ isOpen, onClose }) => {
  const { accounts, isLoading: isAccountsLoading } = useAccounts();
  const { incomeCategories, expenseCategories, isLoading: isCategoriesLoading } = useCategories();
  const { createTransaction, isCreating } = useTransactions(undefined, {
    enableTransactions: false,
    enablePendingOutbox: false
  });

  const [submitError, setSubmitError] = useState<string | null>(null);
  const isSubmittingRef = useRef(false);
  const wasOpenRef = useRef(false);

  // Only active (non-archived) accounts can be selected for new transactions
  const activeAccounts = useMemo(
    () => accounts.filter((account) => !account.isArchived),
    [accounts]
  );

  const buildDefaultValues = (
    defaultType: CreateTransactionFormValues['type'] = 'expense'
  ): CreateTransactionFormValues => {
    const defaultCategoryId =
      defaultType === 'income'
        ? incomeCategories[0]?.id || ''
        : defaultType === 'expense'
        ? expenseCategories[0]?.id || ''
        : '';

    return {
      type: defaultType,
      amount: '',
      title: '',
      accountId: activeAccounts[0]?.id || '',
      destinationAccountId: '',
      categoryId: defaultCategoryId,
      transactionDate: formatLocalDateInput(new Date()),
      note: ''
    };
  };

  const {
    control,
    register,
    handleSubmit,
    watch,
    setValue,
    clearErrors,
    setError,
    reset,
    formState: { errors, isSubmitting }
  } = useForm<CreateTransactionFormValues>({
    resolver: zodResolver(createTransactionSchema),
    defaultValues: buildDefaultValues('expense')
  });

  const selectedType = watch('type');
  const selectedAccountId = watch('accountId');
  const selectedCategoryId = watch('categoryId');
  const isBusy = isSubmitting || isCreating;

  const eligibleCategories = useMemo(() => {
    if (selectedType === 'income') return incomeCategories;
    if (selectedType === 'expense') return expenseCategories;
    return [];
  }, [selectedType, incomeCategories, expenseCategories]);

  // Reset form cleanly when opening the modal (fresh open transition only)
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      wasOpenRef.current = true;
      setSubmitError(null);
      reset(buildDefaultValues('expense'));
    } else if (!isOpen && wasOpenRef.current) {
      wasOpenRef.current = false;
      setSubmitError(null);
    }
  }, [isOpen]);

  // Populate initial account once active accounts finish loading while modal is open
  useEffect(() => {
    if (!isOpen) return;
    if (activeAccounts.length > 0 && !selectedAccountId) {
      setValue('accountId', activeAccounts[0].id, { shouldValidate: false });
    }
  }, [isOpen, activeAccounts, selectedAccountId, setValue]);

  // Populate default category once eligible categories finish loading (non-transfer only)
  useEffect(() => {
    if (!isOpen || selectedType === 'transfer') return;
    if (eligibleCategories.length > 0 && !selectedCategoryId) {
      setValue('categoryId', eligibleCategories[0].id, { shouldValidate: false });
    }
  }, [isOpen, selectedType, eligibleCategories, selectedCategoryId, setValue]);

  const handleTypeChange = (nextType: CreateTransactionFormValues['type']) => {
    if (isBusy || nextType === selectedType) return;

    setSubmitError(null);
    setValue('type', nextType, { shouldValidate: false });

    if (nextType === 'transfer') {
      setValue('categoryId', '', { shouldValidate: false });
      clearErrors(['categoryId', 'title']);
      return;
    }

    setValue('destinationAccountId', '', { shouldValidate: false });
    clearErrors(['destinationAccountId']);

    const nextCategories = nextType === 'income' ? incomeCategories : expenseCategories;
    const isCurrentValid = nextCategories.some((c) => c.id === selectedCategoryId);
    if (!isCurrentValid) {
      setValue('categoryId', nextCategories[0]?.id || '', { shouldValidate: false });
    }
  };

  const onSubmit = async (values: CreateTransactionFormValues) => {
    if (isSubmittingRef.current || isCreating) {
      return;
    }

    setSubmitError(null);

    // Defensive domain check against stale/archived account selection
    if (!activeAccounts.some((a) => a.id === values.accountId)) {
      setError('accountId', { type: 'manual', message: 'Please select an active account' });
      return;
    }

    if (values.type === 'transfer') {
      if (
        !values.destinationAccountId ||
        !activeAccounts.some((a) => a.id === values.destinationAccountId)
      ) {
        setError('destinationAccountId', {
          type: 'manual',
          message: 'Destination account is required for transfers'
        });
        return;
      }
      if (values.accountId === values.destinationAccountId) {
        setError('destinationAccountId', {
          type: 'manual',
          message: 'Destination account must be different from source account'
        });
        return;
      }
    } else if (
      values.categoryId &&
      !eligibleCategories.some((c) => c.id === values.categoryId)
    ) {
      setError('categoryId', {
        type: 'manual',
        message: 'Please select an eligible category for this transaction type'
      });
      return;
    }

    isSubmittingRef.current = true;
    try {
      await createTransaction({
        type: values.type,
        amount: values.amount.trim(),
        title: values.title?.trim() ?? '',
        accountId: values.accountId,
        destinationAccountId:
          values.type === 'transfer' ? values.destinationAccountId : undefined,
        categoryId:
          values.type !== 'transfer' ? values.categoryId || '' : undefined,
        transactionDate: values.transactionDate,
        note: values.note?.trim() ?? ''
      });

      reset(buildDefaultValues('expense'));
      setSubmitError(null);
      onClose();
    } catch (err) {
      const message =
        err instanceof Error && err.message.trim().length > 0
          ? err.message
          : 'Failed to save transaction. Please verify your entries and try again.';
      setSubmitError(message);
    } finally {
      isSubmittingRef.current = false;
    }
  };

  const handleCancel = () => {
    if (isBusy) return;
    setSubmitError(null);
    reset(buildDefaultValues('expense'));
    onClose();
  };

  const hasSingleAccountTransferLimit =
    selectedType === 'transfer' && !isAccountsLoading && activeAccounts.length < 2;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isBusy && handleCancel()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Quick Record Transaction</DialogTitle>
          <DialogDescription>
            Log an expense, income, or internal account-to-account transfer directly to your local ledger.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-1" noValidate>
          {submitError && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-[10px] border border-[#D9827C]/30 bg-[#D9827C]/10 px-3 py-2.5 text-xs text-[#D9827C]"
            >
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{submitError}</span>
            </div>
          )}

          {!isAccountsLoading && activeAccounts.length === 0 && (
            <div
              role="status"
              className="flex items-start gap-2.5 rounded-[10px] border border-[#D6AD60]/30 bg-[#D6AD60]/10 px-3 py-2.5 text-xs text-[#D6AD60]"
            >
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>
                No active accounts available. Create an active account before recording a transaction.
              </span>
            </div>
          )}

          {/* Transaction Type Segmented Switcher */}
          <Controller
            name="type"
            control={control}
            render={({ field }) => (
              <div
                role="radiogroup"
                aria-label="Transaction Type"
                className="grid grid-cols-3 gap-1 rounded-[10px] border border-[#303030] bg-[#101010] p-1"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={field.value === 'expense'}
                  disabled={isBusy}
                  onClick={() => handleTypeChange('expense')}
                  className={cn(
                    'flex min-h-[40px] items-center justify-center gap-1.5 rounded-[8px] py-1.5 text-xs font-semibold transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D6AD60]',
                    field.value === 'expense'
                      ? 'bg-[#D9827C]/15 text-[#D9827C] border border-[#D9827C]/30 shadow-sm'
                      : 'text-[#858078] hover:text-[#B9B4AA]'
                  )}
                >
                  <ArrowDownLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Expense</span>
                </button>

                <button
                  type="button"
                  role="radio"
                  aria-checked={field.value === 'income'}
                  disabled={isBusy}
                  onClick={() => handleTypeChange('income')}
                  className={cn(
                    'flex min-h-[40px] items-center justify-center gap-1.5 rounded-[8px] py-1.5 text-xs font-semibold transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D6AD60]',
                    field.value === 'income'
                      ? 'bg-[#72B895]/15 text-[#72B895] border border-[#72B895]/30 shadow-sm'
                      : 'text-[#858078] hover:text-[#B9B4AA]'
                  )}
                >
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Income</span>
                </button>

                <button
                  type="button"
                  role="radio"
                  aria-checked={field.value === 'transfer'}
                  disabled={isBusy}
                  onClick={() => handleTypeChange('transfer')}
                  className={cn(
                    'flex min-h-[40px] items-center justify-center gap-1.5 rounded-[8px] py-1.5 text-xs font-semibold transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D6AD60]',
                    field.value === 'transfer'
                      ? 'bg-[#82A9CF]/15 text-[#82A9CF] border border-[#82A9CF]/30 shadow-sm'
                      : 'text-[#858078] hover:text-[#B9B4AA]'
                  )}
                >
                  <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Transfer</span>
                </button>
              </div>
            )}
          />

          {/* Amount Input with Prominent Rupee Symbol */}
          <div className="space-y-1">
            <label htmlFor="quick-add-amount" className="block text-xs font-medium text-[#B9B4AA]">
              Amount (INR)
            </label>
            <div className="relative flex items-center">
              <span className="pointer-events-none absolute left-3.5 text-lg font-bold text-[#D6AD60] font-tabular">
                ₹
              </span>
              <input
                id="quick-add-amount"
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                disabled={isBusy}
                aria-invalid={Boolean(errors.amount)}
                aria-describedby={errors.amount ? 'quick-add-amount-error' : undefined}
                {...register('amount', {
                  onChange: () => setSubmitError(null)
                })}
                className={cn(
                  'flex h-12 w-full rounded-[10px] border border-[#303030] bg-[#242424] pl-9 pr-3 text-lg font-bold font-tabular text-[#F5F1E8] placeholder:text-[#858078] transition-colors focus-visible:outline-none focus-visible:border-[#D6AD60] focus-visible:ring-1 focus-visible:ring-[#D6AD60] disabled:opacity-50',
                  errors.amount && 'border-[#D9827C]'
                )}
              />
            </div>
            {errors.amount?.message && (
              <p id="quick-add-amount-error" role="alert" className="text-xs text-[#D9827C]">
                {errors.amount.message}
              </p>
            )}
          </div>

          {/* Title / Description */}
          <Input
            id="quick-add-title"
            label={selectedType === 'transfer' ? 'Title (Optional)' : 'Title / Description'}
            placeholder={
              selectedType === 'transfer'
                ? 'Account Transfer'
                : selectedType === 'income'
                ? 'e.g. Monthly Salary, Freelance Invoice'
                : 'e.g. Swiggy Lunch, Electricity Bill'
            }
            disabled={isBusy}
            aria-invalid={Boolean(errors.title)}
            error={errors.title?.message}
            {...register('title', {
              onChange: () => setSubmitError(null)
            })}
          />

          {/* Account & Category / Destination Selectors */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="quick-add-account" className="block text-xs font-medium text-[#B9B4AA]">
                {selectedType === 'transfer' ? 'Source Account' : 'Account'}
              </label>
              <select
                id="quick-add-account"
                required
                aria-required="true"
                disabled={isBusy || isAccountsLoading}
                aria-invalid={Boolean(errors.accountId)}
                aria-describedby={errors.accountId ? 'quick-add-account-error' : undefined}
                {...register('accountId', {
                  onChange: () => setSubmitError(null)
                })}
                className={cn(
                  'flex h-10 w-full rounded-[10px] border border-[#303030] bg-[#1B1B1B] px-3 py-2 text-xs text-[#F5F1E8] focus-visible:outline-none focus-visible:border-[#D6AD60] focus-visible:ring-1 focus-visible:ring-[#D6AD60] cursor-pointer disabled:opacity-50',
                  errors.accountId && 'border-[#D9827C]'
                )}
              >
                <option value="">
                  {isAccountsLoading ? 'Loading accounts...' : 'Select an account'}
                </option>
                {activeAccounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name} ({acc.accountType})
                  </option>
                ))}
              </select>
              {errors.accountId?.message && (
                <p id="quick-add-account-error" role="alert" className="text-xs text-[#D9827C]">
                  {errors.accountId.message}
                </p>
              )}
            </div>

            {selectedType === 'transfer' ? (
              <div className="space-y-1">
                <label
                  htmlFor="quick-add-destination-account"
                  className="block text-xs font-medium text-[#B9B4AA]"
                >
                  Destination Account
                </label>
                <select
                  id="quick-add-destination-account"
                  required
                  aria-required="true"
                  disabled={isBusy || isAccountsLoading}
                  aria-invalid={Boolean(errors.destinationAccountId)}
                  aria-describedby={
                    errors.destinationAccountId ? 'quick-add-destination-account-error' : undefined
                  }
                  {...register('destinationAccountId', {
                    onChange: () => setSubmitError(null)
                  })}
                  className={cn(
                    'flex h-10 w-full rounded-[10px] border border-[#303030] bg-[#1B1B1B] px-3 py-2 text-xs text-[#F5F1E8] focus-visible:outline-none focus-visible:border-[#D6AD60] focus-visible:ring-1 focus-visible:ring-[#D6AD60] cursor-pointer disabled:opacity-50',
                    errors.destinationAccountId && 'border-[#D9827C]'
                  )}
                >
                  <option value="">
                    {isAccountsLoading ? 'Loading accounts...' : 'Select destination...'}
                  </option>
                  {activeAccounts.map((acc) => {
                    const isSameAsSource = acc.id === selectedAccountId;
                    return (
                      <option key={acc.id} value={acc.id} disabled={isSameAsSource}>
                        {acc.name} ({acc.accountType})
                        {isSameAsSource ? ' — Same as source' : ''}
                      </option>
                    );
                  })}
                </select>
                {errors.destinationAccountId?.message && (
                  <p
                    id="quick-add-destination-account-error"
                    role="alert"
                    className="text-xs text-[#D9827C]"
                  >
                    {errors.destinationAccountId.message}
                  </p>
                )}
                {hasSingleAccountTransferLimit && (
                  <p className="text-[11px] text-[#E4B66D]">
                    Add a second active account to execute transfers.
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-1">
                <label
                  htmlFor="quick-add-category"
                  className="block text-xs font-medium text-[#B9B4AA]"
                >
                  Category
                </label>
                <select
                  id="quick-add-category"
                  disabled={isBusy || isCategoriesLoading}
                  aria-invalid={Boolean(errors.categoryId)}
                  aria-describedby={errors.categoryId ? 'quick-add-category-error' : undefined}
                  {...register('categoryId', {
                    onChange: () => setSubmitError(null)
                  })}
                  className={cn(
                    'flex h-10 w-full rounded-[10px] border border-[#303030] bg-[#1B1B1B] px-3 py-2 text-xs text-[#F5F1E8] focus-visible:outline-none focus-visible:border-[#D6AD60] focus-visible:ring-1 focus-visible:ring-[#D6AD60] cursor-pointer disabled:opacity-50',
                    errors.categoryId && 'border-[#D9827C]'
                  )}
                >
                  <option value="">
                    {isCategoriesLoading ? 'Loading categories...' : 'Uncategorized'}
                  </option>
                  {eligibleCategories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
                {errors.categoryId?.message && (
                  <p id="quick-add-category-error" role="alert" className="text-xs text-[#D9827C]">
                    {errors.categoryId.message}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Transaction Date */}
          <div className="space-y-1">
            <label htmlFor="quick-add-date" className="block text-xs font-medium text-[#B9B4AA]">
              Transaction Date
            </label>
            <div className="relative flex items-center">
              <Calendar
                className="pointer-events-none absolute left-3.5 h-4 w-4 text-[#858078]"
                aria-hidden="true"
              />
              <input
                id="quick-add-date"
                type="date"
                required
                aria-required="true"
                disabled={isBusy}
                aria-invalid={Boolean(errors.transactionDate)}
                aria-describedby={errors.transactionDate ? 'quick-add-date-error' : undefined}
                {...register('transactionDate', {
                  onChange: () => setSubmitError(null)
                })}
                className={cn(
                  'flex h-10 w-full rounded-[10px] border border-[#303030] bg-[#1B1B1B] pl-9.5 pr-3 py-2 text-xs text-[#F5F1E8] focus-visible:outline-none focus-visible:border-[#D6AD60] focus-visible:ring-1 focus-visible:ring-[#D6AD60] disabled:opacity-50',
                  errors.transactionDate && 'border-[#D9827C]'
                )}
              />
            </div>
            {errors.transactionDate?.message && (
              <p id="quick-add-date-error" role="alert" className="text-xs text-[#D9827C]">
                {errors.transactionDate.message}
              </p>
            )}
          </div>

          {/* Optional Note */}
          <div className="space-y-1">
            <label htmlFor="quick-add-note" className="block text-xs font-medium text-[#B9B4AA]">
              Notes (Optional)
            </label>
            <textarea
              id="quick-add-note"
              rows={2}
              disabled={isBusy}
              placeholder="Additional context, merchant memo, or reference..."
              aria-invalid={Boolean(errors.note)}
              aria-describedby={errors.note ? 'quick-add-note-error' : undefined}
              {...register('note', {
                onChange: () => setSubmitError(null)
              })}
              className={cn(
                'flex w-full rounded-[10px] border border-[#303030] bg-[#1B1B1B] px-3 py-2 text-xs text-[#F5F1E8] placeholder:text-[#858078] focus-visible:outline-none focus-visible:border-[#D6AD60] focus-visible:ring-1 focus-visible:ring-[#D6AD60] transition-colors resize-none disabled:opacity-50',
                errors.note && 'border-[#D9827C]'
              )}
            />
            {errors.note?.message && (
              <p id="quick-add-note-error" role="alert" className="text-xs text-[#D9827C]">
                {errors.note.message}
              </p>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={handleCancel}
              disabled={isBusy}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              isLoading={isBusy}
              disabled={isBusy || activeAccounts.length === 0}
            >
              Save Transaction
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

import React, { useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
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
import { Badge } from '@/components/ui/Badge';
import { zodResolver } from '@/utils/zodResolver';
import {
  createTransactionSchema,
  editTransactionSchema,
  CreateTransactionFormValues,
  EditTransactionFormValues
} from '../schemas/transactionSchemas';
import { TransactionResponseDTO } from '@/application/dto/TransactionDTO';
import { AccountWithBalanceDTO } from '@/application/dto/AccountDTO';
import { Category } from '@/domain/entities/Category';
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight } from 'lucide-react';
import { cn } from '@/utils/cn';

export interface TransactionFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: 'create' | 'edit';
  transaction?: TransactionResponseDTO | null;
  accounts: AccountWithBalanceDTO[];
  categories: Category[];
  onSubmitCreate: (values: CreateTransactionFormValues) => Promise<any>;
  onSubmitEdit: (values: EditTransactionFormValues) => Promise<any>;
  isLoading?: boolean;
}

export const TransactionFormModal: React.FC<TransactionFormModalProps> = ({
  isOpen,
  onClose,
  mode,
  transaction,
  accounts,
  categories,
  onSubmitCreate,
  onSubmitEdit,
  isLoading = false
}) => {
  const isEdit = mode === 'edit';
  const todayStr = new Date().toISOString().split('T')[0];

  // Active accounts: for new transactions, archived accounts cannot be selected
  const activeAccounts = accounts.filter((a) => !a.isArchived);

  // In edit mode, if the existing transaction refers to an archived account, include it
  const availableSourceAccounts = isEdit && transaction
    ? accounts.filter((a) => !a.isArchived || a.id === transaction.accountId)
    : activeAccounts;

  const availableDestAccounts = isEdit && transaction
    ? accounts.filter((a) => !a.isArchived || a.id === transaction.destinationAccountId)
    : activeAccounts;

  const {
    register,
    handleSubmit,
    control,
    reset,
    watch,
    setValue,
    formState: { errors }
  } = useForm<CreateTransactionFormValues & { id?: string }>({
    resolver: isEdit ? zodResolver(editTransactionSchema) : zodResolver(createTransactionSchema),
    defaultValues: {
      type: 'expense',
      amount: '',
      title: '',
      accountId: '',
      destinationAccountId: '',
      categoryId: '',
      transactionDate: todayStr,
      note: ''
    }
  });

  const selectedType = watch('type');
  const selectedAccountId = watch('accountId');

  // Filter categories matching current transaction type
  const availableCategories = categories.filter((c) => {
    if (selectedType === 'income') return c.type === 'income' && !c.isArchived;
    if (selectedType === 'expense') return c.type === 'expense' && !c.isArchived;
    return false;
  });

  // Populate or reset form values on open/mode switch
  useEffect(() => {
    if (!isOpen) return;

    if (isEdit && transaction) {
      const rupeesStr = (transaction.amountPaise / 100).toFixed(2).replace(/\.00$/, '');
      const txDateStr = transaction.transactionDate.split('T')[0];

      reset({
        id: transaction.id,
        type: transaction.type,
        amount: rupeesStr,
        title: transaction.title || '',
        accountId: transaction.accountId,
        destinationAccountId: transaction.destinationAccountId || '',
        categoryId: transaction.categoryId || '',
        transactionDate: txDateStr,
        note: transaction.note || ''
      });
    } else {
      // Default initial account
      const firstActiveAccount = activeAccounts[0]?.id || '';

      // Default category for default type (expense)
      const firstExpenseCat = categories.find((c) => c.type === 'expense')?.id || '';

      reset({
        type: 'expense',
        amount: '',
        title: '',
        accountId: firstActiveAccount,
        destinationAccountId: '',
        categoryId: firstExpenseCat,
        transactionDate: todayStr,
        note: ''
      });
    }
  }, [isOpen, isEdit, transaction, reset]);

  const handleFormSubmit = async (values: CreateTransactionFormValues & { id?: string }) => {
    if (isEdit && transaction) {
      await onSubmitEdit({
        id: transaction.id,
        type: transaction.type,
        amount: values.amount,
        title: values.title,
        accountId: values.accountId,
        destinationAccountId: values.type === 'transfer' ? values.destinationAccountId : undefined,
        categoryId: values.type !== 'transfer' ? values.categoryId : undefined,
        transactionDate: values.transactionDate,
        note: values.note
      });
    } else {
      await onSubmitCreate({
        type: values.type,
        amount: values.amount,
        title: values.title,
        accountId: values.accountId,
        destinationAccountId: values.type === 'transfer' ? values.destinationAccountId : undefined,
        categoryId: values.type !== 'transfer' ? values.categoryId : undefined,
        transactionDate: values.transactionDate,
        note: values.note
      });
    }
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isLoading && onClose()}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? 'Edit Transaction' : 'Record Transaction'}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Update ledger entry while preserving financial versioning and idempotency.'
              : 'Log cash outflow, inflow, or internal account-to-account transfer.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4 pt-1">
          {/* Transaction Type Selection */}
          {!isEdit ? (
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-[#B9B4AA]">Transaction Type</label>
              <Controller
                name="type"
                control={control}
                render={({ field }) => (
                  <div className="grid grid-cols-3 gap-1 rounded-[10px] border border-[#303030] bg-[#141414] p-1">
                    <button
                      type="button"
                      onClick={() => {
                        field.onChange('expense');
                        const defaultExp = categories.find((c) => c.type === 'expense')?.id || '';
                        setValue('categoryId', defaultExp);
                      }}
                      className={cn(
                        'flex items-center justify-center gap-1.5 rounded-[8px] py-1.5 text-xs font-medium transition-all',
                        field.value === 'expense'
                          ? 'bg-[#D9827C]/20 text-[#D9827C] border border-[#D9827C]/40 shadow-sm'
                          : 'text-[#858078] hover:text-[#F5F1E8]'
                      )}
                    >
                      <ArrowDownLeft className="h-3.5 w-3.5" />
                      Expense
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        field.onChange('income');
                        const defaultInc = categories.find((c) => c.type === 'income')?.id || '';
                        setValue('categoryId', defaultInc);
                      }}
                      className={cn(
                        'flex items-center justify-center gap-1.5 rounded-[8px] py-1.5 text-xs font-medium transition-all',
                        field.value === 'income'
                          ? 'bg-[#72B895]/20 text-[#72B895] border border-[#72B895]/40 shadow-sm'
                          : 'text-[#858078] hover:text-[#F5F1E8]'
                      )}
                    >
                      <ArrowUpRight className="h-3.5 w-3.5" />
                      Income
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        field.onChange('transfer');
                        setValue('categoryId', '');
                      }}
                      className={cn(
                        'flex items-center justify-center gap-1.5 rounded-[8px] py-1.5 text-xs font-medium transition-all',
                        field.value === 'transfer'
                          ? 'bg-[#82A9CF]/20 text-[#82A9CF] border border-[#82A9CF]/40 shadow-sm'
                          : 'text-[#858078] hover:text-[#F5F1E8]'
                      )}
                    >
                      <ArrowLeftRight className="h-3.5 w-3.5" />
                      Transfer
                    </button>
                  </div>
                )}
              />
            </div>
          ) : (
            <div className="flex items-center justify-between p-2.5 rounded-[8px] bg-[#181818] border border-[#303030]">
              <span className="text-xs text-[#858078]">Transaction Type</span>
              <Badge
                variant={
                  selectedType === 'income'
                    ? 'income'
                    : selectedType === 'expense'
                    ? 'expense'
                    : 'transfer'
                }
                size="sm"
              >
                {selectedType.toUpperCase()}
              </Badge>
            </div>
          )}

          {/* Amount Input */}
          <div>
            <Input
              id="amount"
              label="Amount (INR)"
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              prefixIcon={<span className="text-xs font-bold text-[#D6AD60]">₹</span>}
              error={errors.amount?.message}
              {...register('amount')}
            />
          </div>

          {/* Title / Description */}
          <div>
            <Input
              id="title"
              label={selectedType === 'transfer' ? 'Title (Optional)' : 'Title / Description'}
              placeholder={
                selectedType === 'transfer'
                  ? 'Account Transfer'
                  : selectedType === 'income'
                  ? 'e.g. November Salary, Dividend'
                  : 'e.g. Grocery shopping, Electricity bill'
              }
              error={errors.title?.message}
              {...register('title')}
            />
          </div>

          {/* Account Selection */}
          {selectedType !== 'transfer' ? (
            <div className="space-y-1.5">
              <label htmlFor="accountId" className="block text-xs font-medium text-[#B9B4AA]">
                Account
              </label>
              <select
                id="accountId"
                required
                aria-required="true"
                aria-invalid={Boolean(errors.accountId)}
                aria-describedby={errors.accountId ? 'tx-account-error' : undefined}
                className="flex h-10 w-full rounded-[10px] border border-[#303030] bg-[#1B1B1B] px-3.5 py-2 text-sm text-[#F5F1E8] focus-visible:outline-none focus-visible:border-[#D6AD60] focus-visible:ring-1 focus-visible:ring-[#D6AD60]"
                {...register('accountId')}
              >
                <option value="">Select an account</option>
                {availableSourceAccounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name} ({acc.accountType}) {acc.isArchived ? '[Archived]' : ''}
                  </option>
                ))}
              </select>
              {errors.accountId?.message && (
                <p id="tx-account-error" role="alert" className="text-xs text-[#D9827C]">
                  {errors.accountId.message}
                </p>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Source Account */}
              <div className="space-y-1.5">
                <label htmlFor="accountId" className="block text-xs font-medium text-[#B9B4AA]">
                  From Account (Source)
                </label>
                <select
                  id="accountId"
                  required
                  aria-required="true"
                  aria-invalid={Boolean(errors.accountId)}
                  aria-describedby={errors.accountId ? 'tx-account-error' : undefined}
                  className="flex h-10 w-full rounded-[10px] border border-[#303030] bg-[#1B1B1B] px-3 py-2 text-sm text-[#F5F1E8] focus-visible:outline-none focus-visible:border-[#D6AD60] focus-visible:ring-1 focus-visible:ring-[#D6AD60]"
                  {...register('accountId')}
                >
                  <option value="">Select source</option>
                  {availableSourceAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name}
                    </option>
                  ))}
                </select>
                {errors.accountId?.message && (
                  <p id="tx-account-error" role="alert" className="text-xs text-[#D9827C]">
                    {errors.accountId.message}
                  </p>
                )}
              </div>

              {/* Destination Account */}
              <div className="space-y-1.5">
                <label htmlFor="destinationAccountId" className="block text-xs font-medium text-[#B9B4AA]">
                  To Account (Destination)
                </label>
                <select
                  id="destinationAccountId"
                  required
                  aria-required="true"
                  aria-invalid={Boolean(errors.destinationAccountId)}
                  aria-describedby={
                    errors.destinationAccountId ? 'tx-dest-account-error' : undefined
                  }
                  className="flex h-10 w-full rounded-[10px] border border-[#303030] bg-[#1B1B1B] px-3 py-2 text-sm text-[#F5F1E8] focus-visible:outline-none focus-visible:border-[#D6AD60] focus-visible:ring-1 focus-visible:ring-[#D6AD60]"
                  {...register('destinationAccountId')}
                >
                  <option value="">Select destination</option>
                  {availableDestAccounts
                    .filter((acc) => acc.id !== selectedAccountId)
                    .map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.name}
                      </option>
                    ))}
                </select>
                {errors.destinationAccountId?.message && (
                  <p id="tx-dest-account-error" role="alert" className="text-xs text-[#D9827C]">
                    {errors.destinationAccountId.message}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Category Selection (Hidden for Transfers) */}
          {selectedType !== 'transfer' && (
            <div className="space-y-1.5">
              <label htmlFor="categoryId" className="block text-xs font-medium text-[#B9B4AA]">
                Category
              </label>
              <select
                id="categoryId"
                aria-invalid={Boolean(errors.categoryId)}
                aria-describedby={errors.categoryId ? 'tx-category-error' : undefined}
                className="flex h-10 w-full rounded-[10px] border border-[#303030] bg-[#1B1B1B] px-3.5 py-2 text-sm text-[#F5F1E8] focus-visible:outline-none focus-visible:border-[#D6AD60] focus-visible:ring-1 focus-visible:ring-[#D6AD60]"
                {...register('categoryId')}
              >
                <option value="">Uncategorized</option>
                {availableCategories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
              {errors.categoryId?.message && (
                <p id="tx-category-error" role="alert" className="text-xs text-[#D9827C]">
                  {errors.categoryId.message}
                </p>
              )}
            </div>
          )}

          {/* Transaction Date */}
          <div>
            <Input
              id="transactionDate"
              label="Transaction Date"
              type="date"
              required
              aria-required="true"
              error={errors.transactionDate?.message}
              {...register('transactionDate')}
            />
          </div>

          {/* Optional Note */}
          <div className="space-y-1.5">
            <label htmlFor="note" className="block text-xs font-medium text-[#B9B4AA]">
              Notes (Optional)
            </label>
            <textarea
              id="note"
              rows={2}
              aria-invalid={Boolean(errors.note)}
              aria-describedby={errors.note ? 'tx-note-error' : undefined}
              placeholder="Additional ledger context, invoice reference, or check memo..."
              className="flex w-full rounded-[10px] border border-[#303030] bg-[#1B1B1B] px-3.5 py-2 text-sm text-[#F5F1E8] placeholder:text-[#858078] focus-visible:outline-none focus-visible:border-[#D6AD60] focus-visible:ring-1 focus-visible:ring-[#D6AD60] transition-colors resize-none"
              {...register('note')}
            />
            {errors.note?.message && (
              <p id="tx-note-error" role="alert" className="text-xs text-[#D9827C]">
                {errors.note.message}
              </p>
            )}
          </div>

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
              type="submit"
              variant="primary"
              size="sm"
              isLoading={isLoading}
            >
              {isEdit ? 'Save Changes' : 'Record Transaction'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

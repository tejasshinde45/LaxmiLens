import React, { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
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
import {
  addBorrowingSchema,
  AddBorrowingFormValues
} from '../schemas/borrowingSchemas';
import { zodResolver } from '@/utils/zodResolver';
import { AccountWithBalanceDTO } from '@/application/dto/AccountDTO';
import { LenderDTO } from '@/application/dto/BorrowingDTO';
import { format } from 'date-fns';

export interface AddBorrowingModalProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: AccountWithBalanceDTO[];
  existingLenders: LenderDTO[];
  onSubmit: (values: AddBorrowingFormValues) => Promise<void>;
  isLoading?: boolean;
}

export const AddBorrowingModal: React.FC<AddBorrowingModalProps> = ({
  isOpen,
  onClose,
  accounts,
  existingLenders,
  onSubmit,
  isLoading = false
}) => {
  const eligibleAccounts = useMemo(
    () =>
      accounts.filter(
        (a) =>
          !a.isArchived &&
          a.name.toLowerCase() !== 'personal borrowings' &&
          a.accountType !== 'credit_card'
      ),
    [accounts]
  );

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors }
  } = useForm<AddBorrowingFormValues>({
    resolver: zodResolver(addBorrowingSchema),
    defaultValues: {
      lenderName: '',
      lenderPhone: '',
      lenderEmail: '',
      amount: '',
      borrowingDate: format(new Date(), 'yyyy-MM-dd'),
      dueDate: '',
      receivingAccountId: eligibleAccounts[0]?.id || '',
      notes: ''
    }
  });

  useEffect(() => {
    if (isOpen) {
      reset({
        lenderName: '',
        lenderPhone: '',
        lenderEmail: '',
        amount: '',
        borrowingDate: format(new Date(), 'yyyy-MM-dd'),
        dueDate: '',
        receivingAccountId: eligibleAccounts[0]?.id || '',
        notes: ''
      });
    }
  }, [isOpen]);

  const handleFormSubmit = async (values: AddBorrowingFormValues) => {
    await onSubmit(values);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md w-full bg-[#161616] border border-[#303030] text-[#F5F1E8]">
        <DialogHeader>
          <DialogTitle className="text-lg font-display font-bold text-[#F5F1E8]">
            Add Personal Borrowing
          </DialogTitle>
          <DialogDescription className="text-xs text-[#858078]">
            Record money borrowed from an individual. Increases your receiving account
            balance and establishes a liability. Not counted as income.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4 pt-2" noValidate>
          {/* Lender Name with optional quick autocomplete datalist */}
          <div className="space-y-1.5">
            <label htmlFor="borrowing-lender-name" className="text-xs font-medium text-[#F5F1E8]">
              Lender Name <span className="text-[#D6AD60]" aria-hidden="true">*</span>
            </label>
            <Input
              id="borrowing-lender-name"
              required
              aria-required="true"
              aria-invalid={Boolean(errors.lenderName)}
              aria-describedby={errors.lenderName ? 'borrowing-lender-name-error' : undefined}
              {...register('lenderName')}
              list="existing-lenders-list"
              placeholder="e.g. Rahul Sharma"
              disabled={isLoading}
              autoComplete="off"
            />
            <datalist id="existing-lenders-list">
              {existingLenders.map((l) => (
                <option key={l.id} value={l.name} />
              ))}
            </datalist>
            {errors.lenderName && (
              <p id="borrowing-lender-name-error" role="alert" className="text-xs text-[#D9827C]">
                {errors.lenderName.message}
              </p>
            )}
          </div>

          {/* Amount (Rupees) */}
          <div className="space-y-1.5">
            <label htmlFor="borrowing-amount" className="text-xs font-medium text-[#F5F1E8]">
              Amount (₹) <span className="text-[#D6AD60]" aria-hidden="true">*</span>
            </label>
            <Input
              id="borrowing-amount"
              required
              aria-required="true"
              aria-invalid={Boolean(errors.amount)}
              aria-describedby={errors.amount ? 'borrowing-amount-error' : undefined}
              {...register('amount')}
              type="number"
              step="0.01"
              min="0.01"
              placeholder="0.00"
              disabled={isLoading}
            />
            {errors.amount && (
              <p id="borrowing-amount-error" role="alert" className="text-xs text-[#D9827C]">
                {errors.amount.message}
              </p>
            )}
          </div>

          {/* Receiving Account */}
          <div className="space-y-1.5">
            <label htmlFor="borrowing-receiving-account" className="text-xs font-medium text-[#F5F1E8]">
              Receiving Account (Cash/Bank) <span className="text-[#D6AD60]" aria-hidden="true">*</span>
            </label>
            <select
              id="borrowing-receiving-account"
              required
              aria-required="true"
              aria-invalid={Boolean(errors.receivingAccountId)}
              aria-describedby={errors.receivingAccountId ? 'borrowing-receiving-account-error' : undefined}
              {...register('receivingAccountId')}
              className="w-full h-10 px-3 rounded-md bg-[#1B1B1B] border border-[#303030] text-[#F5F1E8] text-sm focus-visible:outline-none focus-visible:border-[#D6AD60] focus-visible:ring-1 focus-visible:ring-[#D6AD60]"
              disabled={isLoading}
            >
              {eligibleAccounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name} ({acc.currentBalanceFormatted})
                </option>
              ))}
            </select>
            {errors.receivingAccountId && (
              <p
                id="borrowing-receiving-account-error"
                role="alert"
                className="text-xs text-[#D9827C]"
              >
                {errors.receivingAccountId.message}
              </p>
            )}
          </div>

          {/* Dates Grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="borrowing-date" className="text-xs font-medium text-[#F5F1E8]">
                Borrowing Date <span className="text-[#D6AD60]" aria-hidden="true">*</span>
              </label>
              <Input
                id="borrowing-date"
                required
                aria-required="true"
                aria-invalid={Boolean(errors.borrowingDate)}
                aria-describedby={errors.borrowingDate ? 'borrowing-date-error' : undefined}
                {...register('borrowingDate')}
                type="date"
                disabled={isLoading}
              />
              {errors.borrowingDate && (
                <p id="borrowing-date-error" role="alert" className="text-xs text-[#D9827C]">
                  {errors.borrowingDate.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="borrowing-due-date" className="text-xs font-medium text-[#858078]">
                Due Date (Optional)
              </label>
              <Input
                id="borrowing-due-date"
                {...register('dueDate')}
                type="date"
                disabled={isLoading}
              />
            </div>
          </div>

          {/* Optional Note */}
          <div className="space-y-1.5">
            <label htmlFor="borrowing-notes" className="text-xs font-medium text-[#858078]">
              Note (Optional)
            </label>
            <Input
              id="borrowing-notes"
              {...register('notes')}
              placeholder="e.g. For medical emergency or home repair"
              disabled={isLoading}
            />
          </div>

          <DialogFooter className="pt-2 flex justify-end gap-2">
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
              disabled={isLoading}
            >
              {isLoading ? 'Recording...' : 'Add Borrowing'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

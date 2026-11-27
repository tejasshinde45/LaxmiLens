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
  recordRepaymentSchema,
  RecordRepaymentFormValues
} from '../schemas/borrowingSchemas';
import { zodResolver } from '@/utils/zodResolver';
import { AccountWithBalanceDTO } from '@/application/dto/AccountDTO';
import { BorrowingDTO, LenderDTO } from '@/application/dto/BorrowingDTO';
import { format } from 'date-fns';
import { formatPaiseToINR } from '@/utils/formatters';

export interface RecordRepaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: AccountWithBalanceDTO[];
  lenders: LenderDTO[];
  borrowings: BorrowingDTO[];
  initialLenderId?: string | null;
  initialBorrowingId?: string | null;
  onSubmit: (values: RecordRepaymentFormValues) => Promise<void>;
  isLoading?: boolean;
}

export const RecordRepaymentModal: React.FC<RecordRepaymentModalProps> = ({
  isOpen,
  onClose,
  accounts,
  lenders,
  borrowings,
  initialLenderId,
  initialBorrowingId,
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

  const activeLenders = useMemo(
    () => lenders.filter((l) => l.outstandingPaise > 0),
    [lenders]
  );

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors }
  } = useForm<RecordRepaymentFormValues>({
    resolver: zodResolver(recordRepaymentSchema),
    defaultValues: {
      lenderId: initialLenderId || activeLenders[0]?.id || '',
      borrowingId: initialBorrowingId || '',
      amount: '',
      repaymentDate: format(new Date(), 'yyyy-MM-dd'),
      paymentAccountId: eligibleAccounts[0]?.id || '',
      notes: ''
    }
  });

  const selectedLenderId = watch('lenderId');
  const selectedBorrowingId = watch('borrowingId');
  const enteredAmount = watch('amount');

  // Filter active borrowings for selected lender
  const activeBorrowingsForLender = useMemo(() => {
    if (!selectedLenderId) return [];
    return borrowings.filter(
      (b) => b.lenderId === selectedLenderId && b.outstandingPaise > 0
    );
  }, [borrowings, selectedLenderId]);

  // Selected lender object
  const selectedLender = useMemo(() => {
    return lenders.find((l) => l.id === selectedLenderId);
  }, [lenders, selectedLenderId]);

  // Selected borrowing object
  const selectedBorrowing = useMemo(() => {
    if (selectedBorrowingId) {
      return borrowings.find((b) => b.id === selectedBorrowingId);
    }
    return activeBorrowingsForLender[0];
  }, [borrowings, selectedBorrowingId, activeBorrowingsForLender]);

  // Target outstanding amount (specific borrowing or lender's total)
  const maxOutstandingPaise = useMemo(() => {
    if (selectedBorrowing) {
      return selectedBorrowing.outstandingPaise;
    }
    return selectedLender ? selectedLender.outstandingPaise : 0;
  }, [selectedBorrowing, selectedLender]);

  // Check if entered amount exceeds max outstanding
  const isAmountOverDebt = useMemo(() => {
    const enteredPaise = Math.round(parseFloat(enteredAmount || '0') * 100);
    return enteredPaise > maxOutstandingPaise;
  }, [enteredAmount, maxOutstandingPaise]);

  useEffect(() => {
    if (isOpen) {
      const defaultLenderId = initialLenderId || activeLenders[0]?.id || '';
      reset({
        lenderId: defaultLenderId,
        borrowingId: initialBorrowingId || '',
        amount: '',
        repaymentDate: format(new Date(), 'yyyy-MM-dd'),
        paymentAccountId: eligibleAccounts[0]?.id || '',
        notes: ''
      });
    }
  }, [isOpen, initialLenderId, initialBorrowingId]);

  const handleFillFull = () => {
    if (maxOutstandingPaise > 0) {
      setValue('amount', (maxOutstandingPaise / 100).toFixed(2));
    }
  };

  const handleFormSubmit = async (values: RecordRepaymentFormValues) => {
    if (isAmountOverDebt) return;
    await onSubmit(values);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md w-full bg-[#161616] border border-[#303030] text-[#F5F1E8]">
        <DialogHeader>
          <DialogTitle className="text-lg font-display font-bold text-[#F5F1E8]">
            Record Repayment
          </DialogTitle>
          <DialogDescription className="text-xs text-[#858078]">
            Record money repaid to an individual lender. Decreases your payment account
            balance and reduces your personal borrowing liability. Not counted as an expense.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4 pt-2" noValidate>
          {/* Select Lender */}
          <div className="space-y-1.5">
            <label htmlFor="repayment-lender" className="text-xs font-medium text-[#F5F1E8]">
              Lender <span className="text-[#D6AD60]" aria-hidden="true">*</span>
            </label>
            <select
              id="repayment-lender"
              required
              aria-required="true"
              aria-invalid={Boolean(errors.lenderId)}
              aria-describedby={errors.lenderId ? 'repayment-lender-error' : undefined}
              {...register('lenderId')}
              className="w-full h-10 px-3 rounded-md bg-[#1B1B1B] border border-[#303030] text-[#F5F1E8] text-sm focus-visible:outline-none focus-visible:border-[#D6AD60] focus-visible:ring-1 focus-visible:ring-[#D6AD60]"
              disabled={isLoading}
              onChange={(e) => {
                setValue('lenderId', e.target.value);
                setValue('borrowingId', '');
              }}
            >
              <option value="">Select a lender...</option>
              {activeLenders.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} — Outstanding: {l.outstandingFormatted}
                </option>
              ))}
            </select>
            {errors.lenderId && (
              <p id="repayment-lender-error" role="alert" className="text-xs text-[#D9827C]">
                {errors.lenderId.message}
              </p>
            )}
          </div>

          {/* If lender has multiple borrowings, show specific borrowing selector */}
          {activeBorrowingsForLender.length > 1 && (
            <div className="space-y-1.5">
              <label htmlFor="repayment-borrowing-contract" className="text-xs font-medium text-[#858078]">
                Specific Borrowing Contract
              </label>
              <select
                id="repayment-borrowing-contract"
                {...register('borrowingId')}
                className="w-full h-10 px-3 rounded-md bg-[#1B1B1B] border border-[#303030] text-[#F5F1E8] text-sm focus-visible:outline-none focus-visible:border-[#D6AD60] focus-visible:ring-1 focus-visible:ring-[#D6AD60]"
                disabled={isLoading}
              >
                <option value="">Oldest Active ({formatPaiseToINR(maxOutstandingPaise)})</option>
                {activeBorrowingsForLender.map((b) => (
                  <option key={b.id} value={b.id}>
                    {format(new Date(b.borrowingDate), 'dd MMM yyyy')} — Borrowed {b.amountFormatted} (Owed: {b.outstandingFormatted})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Outstanding Balance Banner */}
          {selectedLender && (
            <div className="p-3 rounded-lg bg-[#1B1B1B] border border-[#303030] flex items-center justify-between">
              <div>
                <p className="text-[11px] text-[#858078]">Outstanding Balance</p>
                <p className="text-base font-bold font-tabular text-[#D6AD60]">
                  {formatPaiseToINR(maxOutstandingPaise)}
                </p>
              </div>
              <button
                type="button"
                onClick={handleFillFull}
                className="px-2.5 py-1 text-xs font-semibold rounded bg-[#D6AD60]/10 text-[#D6AD60] border border-[#D6AD60]/30 hover:bg-[#D6AD60]/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D6AD60] cursor-pointer"
              >
                Repay Full
              </button>
            </div>
          )}

          {/* Repayment Amount */}
          <div className="space-y-1.5">
            <label htmlFor="repayment-amount" className="text-xs font-medium text-[#F5F1E8]">
              Repayment Amount (₹) <span className="text-[#D6AD60]" aria-hidden="true">*</span>
            </label>
            <Input
              id="repayment-amount"
              required
              aria-required="true"
              aria-invalid={Boolean(errors.amount) || isAmountOverDebt}
              aria-describedby={
                errors.amount || isAmountOverDebt ? 'repayment-amount-error' : undefined
              }
              {...register('amount')}
              type="number"
              step="0.01"
              min="0.01"
              placeholder="0.00"
              disabled={isLoading}
            />
            {errors.amount && (
              <p id="repayment-amount-error" role="alert" className="text-xs text-[#D9827C]">
                {errors.amount.message}
              </p>
            )}
            {isAmountOverDebt && (
              <p id="repayment-amount-error" role="alert" className="text-xs text-[#D9827C] font-medium">
                Repayment exceeds the remaining outstanding balance of{' '}
                {formatPaiseToINR(maxOutstandingPaise)}.
              </p>
            )}
          </div>

          {/* Payment Account */}
          <div className="space-y-1.5">
            <label htmlFor="repayment-payment-account" className="text-xs font-medium text-[#F5F1E8]">
              Payment Account (Paid From) <span className="text-[#D6AD60]" aria-hidden="true">*</span>
            </label>
            <select
              id="repayment-payment-account"
              required
              aria-required="true"
              aria-invalid={Boolean(errors.paymentAccountId)}
              aria-describedby={
                errors.paymentAccountId ? 'repayment-payment-account-error' : undefined
              }
              {...register('paymentAccountId')}
              className="w-full h-10 px-3 rounded-md bg-[#1B1B1B] border border-[#303030] text-[#F5F1E8] text-sm focus-visible:outline-none focus-visible:border-[#D6AD60] focus-visible:ring-1 focus-visible:ring-[#D6AD60]"
              disabled={isLoading}
            >
              {eligibleAccounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name} ({acc.currentBalanceFormatted})
                </option>
              ))}
            </select>
            {errors.paymentAccountId && (
              <p
                id="repayment-payment-account-error"
                role="alert"
                className="text-xs text-[#D9827C]"
              >
                {errors.paymentAccountId.message}
              </p>
            )}
          </div>

          {/* Repayment Date */}
          <div className="space-y-1.5">
            <label htmlFor="repayment-date" className="text-xs font-medium text-[#F5F1E8]">
              Repayment Date <span className="text-[#D6AD60]" aria-hidden="true">*</span>
            </label>
            <Input
              id="repayment-date"
              required
              aria-required="true"
              aria-invalid={Boolean(errors.repaymentDate)}
              aria-describedby={errors.repaymentDate ? 'repayment-date-error' : undefined}
              {...register('repaymentDate')}
              type="date"
              disabled={isLoading}
            />
            {errors.repaymentDate && (
              <p id="repayment-date-error" role="alert" className="text-xs text-[#D9827C]">
                {errors.repaymentDate.message}
              </p>
            )}
          </div>

          {/* Optional Note */}
          <div className="space-y-1.5">
            <label htmlFor="repayment-notes" className="text-xs font-medium text-[#858078]">
              Note (Optional)
            </label>
            <Input
              id="repayment-notes"
              {...register('notes')}
              placeholder="e.g. First installment / Bank UPI transfer"
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
              disabled={isLoading || isAmountOverDebt || !selectedLenderId}
            >
              {isLoading ? 'Recording...' : 'Record Repayment'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

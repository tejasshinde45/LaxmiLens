import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { toast } from 'sonner';
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Calendar } from 'lucide-react';
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
import { cn } from '@/utils/cn';

export interface QuickAddModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const quickAddSchema = z.object({
  type: z.enum(['expense', 'income', 'transfer']),
  amount: z
    .string()
    .min(1, 'Amount is required')
    .refine((val) => !isNaN(Number(val)) && Number(val) > 0, {
      message: 'Amount must be greater than zero'
    }),
  accountId: z.string().min(1, 'Please select an account'),
  targetAccountId: z.string().optional(),
  categoryId: z.string().optional(),
  date: z.string().min(1, 'Date is required'),
  description: z.string().min(2, 'Description must be at least 2 characters'),
  notes: z.string().optional()
}).refine(
  (data) => {
    if (data.type === 'transfer') {
      return !!data.targetAccountId && data.accountId !== data.targetAccountId;
    }
    return true;
  },
  {
    message: 'Destination account must be different from source account',
    path: ['targetAccountId']
  }
);

type QuickAddFormValues = z.infer<typeof quickAddSchema>;

const ACCOUNT_OPTIONS = [
  { id: 'acc-1', name: 'HDFC Salary Bank', type: 'Bank' },
  { id: 'acc-2', name: 'Cash Wallet', type: 'Cash' },
  { id: 'acc-3', name: 'SBI Savings', type: 'Bank' },
  { id: 'acc-4', name: 'ICICI Amazon Pay Card', type: 'Credit Card' }
];

const CATEGORY_OPTIONS = [
  { id: 'cat-1', name: 'Food & Dining', type: 'expense' },
  { id: 'cat-2', name: 'Groceries & Supplies', type: 'expense' },
  { id: 'cat-3', name: 'Rent & Housing', type: 'expense' },
  { id: 'cat-4', name: 'Utilities & Bills', type: 'expense' },
  { id: 'cat-5', name: 'Transport & Fuel', type: 'expense' },
  { id: 'cat-6', name: 'Salary & Earnings', type: 'income' },
  { id: 'cat-7', name: 'Investments & Dividends', type: 'income' },
  { id: 'cat-8', name: 'Other', type: 'expense' }
];

const customZodResolver = async (values: QuickAddFormValues) => {
  const result = quickAddSchema.safeParse(values);
  if (result.success) {
    return { values: result.data, errors: {} };
  }
  const errors: Record<string, { type: string; message: string }> = {};
  for (const issue of result.error.issues) {
    const path = issue.path[0] ? String(issue.path[0]) : 'root';
    errors[path] = { type: issue.code, message: issue.message };
  }
  return { values: {}, errors };
};

export const QuickAddModal: React.FC<QuickAddModalProps> = ({ isOpen, onClose }) => {
  const todayStr = new Date().toISOString().split('T')[0];

  const {
    control,
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting }
  } = useForm<QuickAddFormValues>({
    resolver: customZodResolver,
    defaultValues: {
      type: 'expense',
      amount: '',
      accountId: 'acc-1',
      targetAccountId: '',
      categoryId: 'cat-1',
      date: todayStr,
      description: '',
      notes: ''
    }
  });

  const selectedType = watch('type');

  const onSubmit = (_data: QuickAddFormValues) => {
    // Presentation milestone only: do not persist data or touch Dexie/Supabase
    toast.success('Quick-add form validated successfully', {
      description: 'Presentation milestone: data persistence will connect in upcoming milestone.'
    });
    reset();
    onClose();
  };

  const handleCancel = () => {
    reset();
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleCancel()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Quick Record Transaction</DialogTitle>
          <DialogDescription>
            Log cash outflow, inflow, or internal account-to-account transfer.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-1">
          {/* Transaction Type Segmented Switcher */}
          <Controller
            name="type"
            control={control}
            render={({ field }) => (
              <div className="grid grid-cols-3 gap-1 rounded-[10px] border border-[#303030] bg-[#101010] p-1">
                <button
                  type="button"
                  onClick={() => field.onChange('expense')}
                  className={cn(
                    'flex items-center justify-center gap-1.5 rounded-[8px] py-1.5 text-xs font-semibold transition-all cursor-pointer',
                    field.value === 'expense'
                      ? 'bg-[#D9827C]/15 text-[#D9827C] border border-[#D9827C]/30 shadow-sm'
                      : 'text-[#858078] hover:text-[#B9B4AA]'
                  )}
                >
                  <ArrowDownLeft className="h-3.5 w-3.5" />
                  <span>Expense</span>
                </button>

                <button
                  type="button"
                  onClick={() => field.onChange('income')}
                  className={cn(
                    'flex items-center justify-center gap-1.5 rounded-[8px] py-1.5 text-xs font-semibold transition-all cursor-pointer',
                    field.value === 'income'
                      ? 'bg-[#72B895]/15 text-[#72B895] border border-[#72B895]/30 shadow-sm'
                      : 'text-[#858078] hover:text-[#B9B4AA]'
                  )}
                >
                  <ArrowUpRight className="h-3.5 w-3.5" />
                  <span>Income</span>
                </button>

                <button
                  type="button"
                  onClick={() => field.onChange('transfer')}
                  className={cn(
                    'flex items-center justify-center gap-1.5 rounded-[8px] py-1.5 text-xs font-semibold transition-all cursor-pointer',
                    field.value === 'transfer'
                      ? 'bg-[#82A9CF]/15 text-[#82A9CF] border border-[#82A9CF]/30 shadow-sm'
                      : 'text-[#858078] hover:text-[#B9B4AA]'
                  )}
                >
                  <ArrowLeftRight className="h-3.5 w-3.5" />
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
                type="number"
                step="0.01"
                placeholder="0.00"
                {...register('amount')}
                className={cn(
                  'flex h-12 w-full rounded-[10px] border border-[#303030] bg-[#242424] pl-9 pr-3 text-lg font-bold font-tabular text-[#F5F1E8] placeholder:text-[#858078] transition-colors focus-visible:outline-none focus-visible:border-[#D6AD60] focus-visible:ring-1 focus-visible:ring-[#D6AD60]',
                  errors.amount && 'border-[#D9827C]'
                )}
              />
            </div>
            {errors.amount && (
              <p className="text-xs text-[#D9827C]">{errors.amount.message}</p>
            )}
          </div>

          {/* Description */}
          <Input
            id="quick-add-desc"
            label="Description / Merchant"
            placeholder="e.g. Swiggy Lunch, Metro Card recharge"
            error={errors.description?.message}
            {...register('description')}
          />

          {/* Account Selectors */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="quick-add-source-acc" className="block text-xs font-medium text-[#B9B4AA]">
                {selectedType === 'transfer' ? 'Source Account' : 'Account'}
              </label>
              <select
                id="quick-add-source-acc"
                {...register('accountId')}
                className="flex h-10 w-full rounded-[10px] border border-[#303030] bg-[#1B1B1B] px-3 py-2 text-xs text-[#F5F1E8] focus-visible:outline-none focus-visible:border-[#D6AD60] cursor-pointer"
              >
                {ACCOUNT_OPTIONS.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name} ({acc.type})
                  </option>
                ))}
              </select>
            </div>

            {selectedType === 'transfer' ? (
              <div className="space-y-1">
                <label htmlFor="quick-add-target-acc" className="block text-xs font-medium text-[#B9B4AA]">
                  Destination Account
                </label>
                <select
                  id="quick-add-target-acc"
                  {...register('targetAccountId')}
                  className={cn(
                    'flex h-10 w-full rounded-[10px] border border-[#303030] bg-[#1B1B1B] px-3 py-2 text-xs text-[#F5F1E8] focus-visible:outline-none focus-visible:border-[#D6AD60] cursor-pointer',
                    errors.targetAccountId && 'border-[#D9827C]'
                  )}
                >
                  <option value="">Select destination...</option>
                  {ACCOUNT_OPTIONS.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} ({acc.type})
                    </option>
                  ))}
                </select>
                {errors.targetAccountId && (
                  <p className="text-xs text-[#D9827C]">{errors.targetAccountId.message}</p>
                )}
              </div>
            ) : (
              <div className="space-y-1">
                <label htmlFor="quick-add-category" className="block text-xs font-medium text-[#B9B4AA]">
                  Category
                </label>
                <select
                  id="quick-add-category"
                  {...register('categoryId')}
                  className="flex h-10 w-full rounded-[10px] border border-[#303030] bg-[#1B1B1B] px-3 py-2 text-xs text-[#F5F1E8] focus-visible:outline-none focus-visible:border-[#D6AD60] cursor-pointer"
                >
                  {CATEGORY_OPTIONS.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Date Picker */}
          <div className="space-y-1">
            <label htmlFor="quick-add-date" className="block text-xs font-medium text-[#B9B4AA]">
              Transaction Date
            </label>
            <div className="relative flex items-center">
              <Calendar className="pointer-events-none absolute left-3.5 h-4 w-4 text-[#858078]" />
              <input
                id="quick-add-date"
                type="date"
                {...register('date')}
                className="flex h-10 w-full rounded-[10px] border border-[#303030] bg-[#1B1B1B] pl-9.5 pr-3 py-2 text-xs text-[#F5F1E8] focus-visible:outline-none focus-visible:border-[#D6AD60]"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" size="md" onClick={handleCancel}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="md" isLoading={isSubmitting}>
              Save Transaction
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

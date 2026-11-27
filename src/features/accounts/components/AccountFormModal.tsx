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
import {
  createAccountSchema,
  editAccountSchema,
  CreateAccountFormValues,
  EditAccountFormValues,
  ACCOUNT_TYPE_CONFIG,
  PRESET_ACCOUNT_COLORS
} from '../schemas/accountSchemas';
import { zodResolver } from '@/utils/zodResolver';
import { AccountWithBalanceDTO } from '@/application/dto/AccountDTO';
import { AccountType } from '@/domain/entities/Account';
import { Check } from 'lucide-react';
import { cn } from '@/utils/cn';

export interface AccountFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: 'create' | 'edit';
  account?: AccountWithBalanceDTO | null;
  onSubmitCreate: (values: CreateAccountFormValues) => Promise<void>;
  onSubmitEdit: (values: EditAccountFormValues) => Promise<void>;
  isLoading?: boolean;
}

export const AccountFormModal: React.FC<AccountFormModalProps> = ({
  isOpen,
  onClose,
  mode,
  account,
  onSubmitCreate,
  onSubmitEdit,
  isLoading = false
}) => {
  const isEdit = mode === 'edit';

  const {
    register,
    handleSubmit,
    control,
    reset,
    watch,
    formState: { errors }
  } = useForm<CreateAccountFormValues & { id?: string }>({
    resolver: isEdit ? zodResolver(editAccountSchema) : zodResolver(createAccountSchema),
    defaultValues: {
      name: '',
      accountType: 'bank',
      openingBalance: '0',
      institutionName: '',
      color: PRESET_ACCOUNT_COLORS[0],
      notes: ''
    }
  });

  const selectedType = watch('accountType') as AccountType;

  // Reset or initialize form values when opened or mode changes
  useEffect(() => {
    if (!isOpen) return;

    if (isEdit && account) {
      reset({
        id: account.id,
        name: account.name,
        accountType: (account.accountType as AccountType) || 'bank',
        openingBalance: (account.openingBalancePaise / 100).toString(),
        institutionName: account.institutionName || '',
        color: account.color || ACCOUNT_TYPE_CONFIG[(account.accountType as AccountType) || 'bank']?.defaultColor || PRESET_ACCOUNT_COLORS[0],
        notes: account.notes || ''
      });
    } else {
      reset({
        name: '',
        accountType: 'bank',
        openingBalance: '0',
        institutionName: '',
        color: PRESET_ACCOUNT_COLORS[0],
        notes: ''
      });
    }
  }, [isOpen, isEdit, account, reset]);

  const handleFormSubmit = async (values: CreateAccountFormValues & { id?: string }) => {
    if (isEdit && account) {
      await onSubmitEdit({
        id: account.id,
        name: values.name,
        accountType: values.accountType,
        institutionName: values.institutionName,
        color: values.color,
        notes: values.notes
      });
    } else {
      await onSubmitCreate(values);
    }
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Account' : 'Register New Account'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Update account display name, classification, and preferences.'
              : 'Add a new bank account, cash reserve, digital wallet, or credit card.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4 py-2" noValidate>
          {/* Account Name */}
          <Input
            id="account-name"
            label="Account Name"
            placeholder="e.g. HDFC Salary Account, Cash Wallet"
            error={errors.name?.message}
            disabled={isLoading}
            {...register('name')}
          />

          {/* Account Type Selector */}
          <div className="space-y-1.5">
            <span id="account-type-group-label" className="block text-xs font-medium text-[#B9B4AA]">
              Account Type
            </span>
            <div
              role="radiogroup"
              aria-labelledby="account-type-group-label"
              className="grid grid-cols-2 sm:grid-cols-3 gap-2"
            >
              {(Object.keys(ACCOUNT_TYPE_CONFIG) as AccountType[]).map((typeKey) => {
                const config = ACCOUNT_TYPE_CONFIG[typeKey];
                const isSelected = selectedType === typeKey;

                return (
                  <label
                    key={typeKey}
                    className={cn(
                      'flex flex-col items-start p-2.5 rounded-[10px] border cursor-pointer select-none transition-all focus-within:border-[#D6AD60] focus-within:ring-2 focus-within:ring-[#D6AD60]',
                      isSelected
                        ? 'border-[#D6AD60] bg-[#D6AD60]/10 text-[#F5F1E8]'
                        : 'border-[#303030] bg-[#1B1B1B] text-[#B9B4AA] hover:bg-[#242424]'
                    )}
                  >
                    <input
                      type="radio"
                      value={typeKey}
                      className="sr-only"
                      disabled={isLoading}
                      {...register('accountType')}
                    />
                    <span className="text-xs font-semibold">{config.label}</span>
                    <span className="text-[10px] text-[#858078] line-clamp-1 mt-0.5">
                      {config.description}
                    </span>
                  </label>
                );
              })}
            </div>
            {errors.accountType?.message && (
              <p role="alert" className="text-xs text-[#D9827C]">
                {errors.accountType.message}
              </p>
            )}
          </div>

          {/* Opening Balance (immutable in edit mode) */}
          <div className="space-y-1.5">
            <Input
              id="opening-balance"
              label="Opening Balance (INR)"
              type="number"
              step="any"
              placeholder="0.00"
              prefixIcon={<span className="text-xs font-bold text-[#858078]">₹</span>}
              disabled={isEdit || isLoading}
              error={errors.openingBalance?.message}
              helperText={
                isEdit
                  ? 'Opening balance is permanent to preserve derived ledger accuracy.'
                  : selectedType === 'credit_card'
                  ? 'For existing credit card debt, you can enter a negative amount (e.g. -15000).'
                  : 'Starting baseline funds before any recorded transactions.'
              }
              {...register('openingBalance')}
            />
          </div>

          {/* Institution / Bank Name */}
          <Input
            id="institution-name"
            label="Institution / Bank Name (Optional)"
            placeholder="e.g. State Bank of India, HDFC, ICICI"
            error={errors.institutionName?.message}
            disabled={isLoading}
            {...register('institutionName')}
          />

          {/* Color Preset Swatches */}
          <div className="space-y-1.5">
            <span id="account-accent-color-label" className="block text-xs font-medium text-[#B9B4AA]">
              Accent Color
            </span>
            <Controller
              name="color"
              control={control}
              render={({ field }) => (
                <div
                  role="group"
                  aria-labelledby="account-accent-color-label"
                  className="flex items-center gap-2 flex-wrap"
                >
                  {PRESET_ACCOUNT_COLORS.map((c) => {
                    const isSelected = field.value === c;
                    return (
                      <button
                        type="button"
                        key={c}
                        onClick={() => field.onChange(c)}
                        disabled={isLoading}
                        aria-pressed={isSelected}
                        className={cn(
                          'h-7 w-7 rounded-full flex items-center justify-center transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D6AD60] cursor-pointer',
                          isSelected && 'ring-2 ring-offset-2 ring-offset-[#1B1B1B] ring-[#D6AD60]'
                        )}
                        style={{ backgroundColor: c }}
                        aria-label={`Select color ${c}`}
                      >
                        {isSelected && (
                          <Check className="h-3.5 w-3.5 text-[#101010] stroke-[3]" aria-hidden="true" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            />
          </div>

          {/* Notes / Memo */}
          <div className="space-y-1.5">
            <label htmlFor="account-notes" className="block text-xs font-medium text-[#B9B4AA]">
              Notes (Optional)
            </label>
            <textarea
              id="account-notes"
              rows={2}
              placeholder="e.g. Primary salary credit account, UPI linked"
              disabled={isLoading}
              aria-invalid={Boolean(errors.notes)}
              aria-describedby={errors.notes ? 'account-notes-error' : undefined}
              className={cn(
                'flex w-full rounded-[10px] border border-[#303030] bg-[#1B1B1B] px-3.5 py-2 text-sm text-[#F5F1E8] placeholder:text-[#858078] transition-colors focus-visible:outline-none focus-visible:border-[#D6AD60] focus-visible:ring-1 focus-visible:ring-[#D6AD60] disabled:cursor-not-allowed disabled:opacity-50 resize-none'
              )}
              {...register('notes')}
            />
            {errors.notes?.message && (
              <p id="account-notes-error" role="alert" className="text-xs text-[#D9827C]">
                {errors.notes.message}
              </p>
            )}
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              isLoading={isLoading}
              disabled={isLoading}
            >
              {isEdit ? 'Save Changes' : 'Create Account'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

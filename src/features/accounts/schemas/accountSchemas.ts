import { z } from 'zod';
import { AccountType } from '@/domain/entities/Account';

export const ACCOUNT_TYPE_CONFIG: Record<
  AccountType,
  {
    label: string;
    description: string;
    defaultColor: string;
    defaultIcon: string;
  }
> = {
  bank: {
    label: 'Bank Account',
    description: 'Checking, salary, or operational bank account',
    defaultColor: '#D6AD60',
    defaultIcon: 'Landmark'
  },
  savings: {
    label: 'Savings Account',
    description: 'High-yield savings, fixed deposit, or emergency fund',
    defaultColor: '#72B895',
    defaultIcon: 'PiggyBank'
  },
  cash: {
    label: 'Cash',
    description: 'Physical cash on hand, wallet currency, or envelope money',
    defaultColor: '#72B895',
    defaultIcon: 'Banknote'
  },
  wallet: {
    label: 'Digital Wallet',
    description: 'UPI prepaid balance, Paytm, Amazon Pay, or PayPal',
    defaultColor: '#82A9CF',
    defaultIcon: 'Wallet'
  },
  credit_card: {
    label: 'Credit Card',
    description: 'Revolving line of credit or card liability',
    defaultColor: '#D9827C',
    defaultIcon: 'CreditCard'
  },
  other: {
    label: 'Other Asset / Liability',
    description: 'Custom financial holding or miscellaneous store of value',
    defaultColor: '#B9B4AA',
    defaultIcon: 'HelpCircle'
  }
};

export const PRESET_ACCOUNT_COLORS = [
  '#D6AD60', // Obsidian Champagne Gold
  '#72B895', // Income Green
  '#D9827C', // Expense / Liability Coral
  '#82A9CF', // Transfer Blue
  '#E4B66D', // Warning Amber
  '#A388EE', // Purple / Tech
  '#E8927C', // Orange / Energy
  '#5CA4A9'  // Teal / Cyan
];

export const PRESET_ACCOUNT_ICONS = [
  'Landmark',
  'PiggyBank',
  'Banknote',
  'Wallet',
  'CreditCard',
  'Building2',
  'Coins',
  'ShieldCheck'
];

export const createAccountSchema = z.object({
  name: z
    .string()
    .min(1, 'Account name is required')
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name must not exceed 100 characters'),
  accountType: z.enum(['cash', 'bank', 'savings', 'credit_card', 'wallet', 'other'] as const),
  openingBalance: z
    .string()
    .min(1, 'Opening balance is required')
    .refine((val) => !isNaN(Number(val)), {
      message: 'Please enter a valid monetary amount'
    }),
  institutionName: z
    .string()
    .max(100, 'Institution name must not exceed 100 characters')
    .optional()
    .or(z.literal('')),
  color: z.string().optional(),
  icon: z.string().optional(),
  notes: z
    .string()
    .max(500, 'Notes must not exceed 500 characters')
    .optional()
    .or(z.literal(''))
});

export type CreateAccountFormValues = z.infer<typeof createAccountSchema>;

export const editAccountSchema = z.object({
  id: z.string().min(1, 'Account ID is required'),
  name: z
    .string()
    .min(1, 'Account name is required')
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name must not exceed 100 characters'),
  accountType: z.enum(['cash', 'bank', 'savings', 'credit_card', 'wallet', 'other'] as const),
  institutionName: z
    .string()
    .max(100, 'Institution name must not exceed 100 characters')
    .optional()
    .or(z.literal('')),
  color: z.string().optional(),
  icon: z.string().optional(),
  notes: z
    .string()
    .max(500, 'Notes must not exceed 500 characters')
    .optional()
    .or(z.literal(''))
});

export type EditAccountFormValues = z.infer<typeof editAccountSchema>;

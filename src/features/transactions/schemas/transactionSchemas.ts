import { z } from 'zod';

export const transactionTypeSchema = z.enum(['income', 'expense', 'transfer']);
export type TransactionTypeOption = z.infer<typeof transactionTypeSchema>;

/**
 * Validates a positive currency string with at most 2 decimal places (paise precision).
 * Examples of valid inputs: "100", "100.5", "100.50", "0.01".
 * Examples of invalid inputs: "0", "-50", "10.999", "abc".
 */
const amountSchema = z
  .string()
  .min(1, 'Amount is required')
  .refine(
    (val) => {
      const trimmed = val.trim();
      const num = Number(trimmed);
      return !isNaN(num) && num > 0;
    },
    { message: 'Amount must be greater than zero' }
  )
  .refine(
    (val) => {
      const trimmed = val.trim();
      return /^\d+(?:\.\d{1,2})?$/.test(trimmed) && Number(trimmed) > 0;
    },
    { message: 'Amount must have at most 2 decimal places' }
  );

export const createTransactionSchema = z
  .object({
    type: transactionTypeSchema,
    amount: amountSchema,
    title: z.string().max(100, 'Title cannot exceed 100 characters').optional(),
    accountId: z.string().min(1, 'Please select an account'),
    destinationAccountId: z.string().optional(),
    categoryId: z.string().optional(),
    transactionDate: z
      .string()
      .min(1, 'Transaction date is required')
      .refine((val) => !isNaN(Date.parse(val)), {
        message: 'Enter a valid transaction date'
      }),
    note: z.string().max(500, 'Note cannot exceed 500 characters').optional()
  })
  .superRefine((data, ctx) => {
    if (data.type === 'transfer') {
      if (!data.destinationAccountId || data.destinationAccountId.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Destination account is required for transfers',
          path: ['destinationAccountId']
        });
      } else if (data.accountId === data.destinationAccountId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Destination account must be different from source account',
          path: ['destinationAccountId']
        });
      }
    } else {
      if (!data.title || data.title.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Title is required',
          path: ['title']
        });
      }
    }
  });

export type CreateTransactionFormValues = z.infer<typeof createTransactionSchema>;

export const editTransactionSchema = z
  .object({
    id: z.string().min(1, 'Transaction ID is required'),
    type: transactionTypeSchema,
    amount: amountSchema,
    title: z.string().max(100, 'Title cannot exceed 100 characters').optional(),
    accountId: z.string().min(1, 'Please select an account'),
    destinationAccountId: z.string().optional(),
    categoryId: z.string().optional(),
    transactionDate: z
      .string()
      .min(1, 'Transaction date is required')
      .refine((val) => !isNaN(Date.parse(val)), {
        message: 'Enter a valid transaction date'
      }),
    note: z.string().max(500, 'Note cannot exceed 500 characters').optional()
  })
  .superRefine((data, ctx) => {
    if (data.type === 'transfer') {
      if (!data.destinationAccountId || data.destinationAccountId.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Destination account is required for transfers',
          path: ['destinationAccountId']
        });
      } else if (data.accountId === data.destinationAccountId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Destination account must be different from source account',
          path: ['destinationAccountId']
        });
      }
    } else {
      if (!data.title || data.title.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Title is required',
          path: ['title']
        });
      }
    }
  });

export type EditTransactionFormValues = z.infer<typeof editTransactionSchema>;

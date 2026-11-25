import { z } from 'zod';

export const addBorrowingSchema = z.object({
  lenderName: z
    .string()
    .min(1, 'Lender name is required.')
    .max(100, 'Lender name must not exceed 100 characters.'),
  lenderPhone: z.string().max(20, 'Phone must not exceed 20 characters.').optional(),
  lenderEmail: z.string().email('Please enter a valid email.').or(z.literal('')).optional(),
  amount: z
    .string()
    .min(1, 'Amount is required.')
    .refine((val) => {
      const num = parseFloat(val);
      return !isNaN(num) && num > 0;
    }, 'Amount must be greater than zero.'),
  borrowingDate: z.string().min(1, 'Borrowing date is required.'),
  dueDate: z.string().optional(),
  receivingAccountId: z.string().min(1, 'Receiving account is required.'),
  notes: z.string().max(500, 'Notes must not exceed 500 characters.').optional()
});

export type AddBorrowingFormValues = z.infer<typeof addBorrowingSchema>;

export const recordRepaymentSchema = z.object({
  lenderId: z.string().min(1, 'Lender is required.'),
  borrowingId: z.string().optional(),
  amount: z
    .string()
    .min(1, 'Repayment amount is required.')
    .refine((val) => {
      const num = parseFloat(val);
      return !isNaN(num) && num > 0;
    }, 'Repayment amount must be greater than zero.'),
  repaymentDate: z.string().min(1, 'Repayment date is required.'),
  paymentAccountId: z.string().min(1, 'Payment account is required.'),
  notes: z.string().max(500, 'Notes must not exceed 500 characters.').optional()
});

export type RecordRepaymentFormValues = z.infer<typeof recordRepaymentSchema>;

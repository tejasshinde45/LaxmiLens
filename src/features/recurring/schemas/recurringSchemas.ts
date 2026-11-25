import { z } from 'zod';
import { RECURRENCE_FREQUENCIES, RecurrenceFrequency } from '@/domain/services/RecurrenceScheduleService';
import {
  compareLocalDates,
  getLocalTodayDateString,
  isValidLocalCalendarDate,
  parseLocalCalendarDate
} from '@/domain/services/RecurrenceScheduleService';
import { parseInrToPaise as budgetParseInrToPaise } from '@/features/budgets/schemas/budgetSchemas';

const INR_AMOUNT_PATTERN = /^\d+(?:\.\d{1,2})?$/;

export function parseRecurringAmountToPaise(raw: string): number {
  const trimmed = (raw || '').trim();
  if (!INR_AMOUNT_PATTERN.test(trimmed)) {
    throw new Error('Enter a valid amount in INR with at most 2 decimal places.');
  }
  return budgetParseInrToPaise(trimmed);
}

export function formatRecurringPaiseForInput(paise: number): string {
  if (!Number.isSafeInteger(paise) || paise <= 0) return '';
  const rupees = Math.floor(paise / 100);
  const rem = paise % 100;
  return rem === 0 ? String(rupees) : `${rupees}.${String(rem).padStart(2, '0')}`;
}

export function formatFrequencyLabel(frequency: RecurrenceFrequency, interval: number): string {
  const n = Math.max(1, interval || 1);
  if (n === 1) {
    switch (frequency) {
      case 'daily':
        return 'Daily';
      case 'weekly':
        return 'Weekly';
      case 'monthly':
        return 'Monthly';
      case 'quarterly':
        return 'Quarterly';
      case 'yearly':
        return 'Yearly';
    }
  }
  switch (frequency) {
    case 'daily':
      return `Every ${n} days`;
    case 'weekly':
      return `Every ${n} weeks`;
    case 'monthly':
      return `Every ${n} months`;
    case 'quarterly':
      return `Every ${n} quarters`;
    case 'yearly':
      return `Every ${n} years`;
  }
}

export function formatLocalDateDisplay(dateStr: string): string {
  if (!isValidLocalCalendarDate(dateStr)) return dateStr;
  const { year, month, day } = parseLocalCalendarDate(dateStr);
  const display = new Date(year, month - 1, day, 12, 0, 0);
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).format(display);
}

export const recurringRuleFormSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, 'Schedule title is required')
      .max(100, 'Schedule title cannot exceed 100 characters'),
    description: z.string().trim().max(300, 'Notes cannot exceed 300 characters').optional(),
    type: z.enum(['expense', 'income']),
    amount: z
      .string()
      .min(1, 'Amount is required')
      .refine((v) => INR_AMOUNT_PATTERN.test(v.trim()), {
        message: 'Enter a valid INR amount (e.g. 1500 or 1500.50)'
      })
      .superRefine((v, ctx) => {
        try {
          parseRecurringAmountToPaise(v);
        } catch (err) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: err instanceof Error ? err.message : 'Invalid amount'
          });
        }
      }),
    accountId: z.string().min(1, 'Please select an account'),
    categoryId: z.string().optional(),
    frequency: z.enum(RECURRENCE_FREQUENCIES as [RecurrenceFrequency, ...RecurrenceFrequency[]]),
    interval: z
      .string()
      .min(1, 'Interval is required')
      .refine((val) => {
        const parsed = Number(val);
        return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 365;
      }, 'Interval must be a whole number between 1 and 365'),
    startDate: z
      .string()
      .refine((v) => isValidLocalCalendarDate(v), 'Select a valid calendar date'),
    endDate: z.string().optional()
  })
  .superRefine((data, ctx) => {
    const end = (data.endDate || '').trim();
    if (end.length > 0) {
      if (!isValidLocalCalendarDate(end)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['endDate'],
          message: 'Select a valid end date'
        });
        return;
      }
      if (isValidLocalCalendarDate(data.startDate) && compareLocalDates(end, data.startDate) < 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['endDate'],
          message: 'End date cannot be earlier than start date'
        });
      }
    }
  });

export type RecurringRuleFormValues = z.infer<typeof recurringRuleFormSchema>;

export function getDefaultRecurringFormValues(): RecurringRuleFormValues {
  return {
    title: '',
    description: '',
    type: 'expense',
    amount: '',
    accountId: '',
    categoryId: '',
    frequency: 'monthly',
    interval: '1',
    startDate: getLocalTodayDateString(),
    endDate: ''
  };
}

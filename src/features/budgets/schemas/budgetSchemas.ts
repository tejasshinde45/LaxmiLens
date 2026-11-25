import { z } from 'zod';
import { BUDGET_PERIOD_REGEX } from '@/domain/entities/Budget';
import { Money } from '@/domain/value-objects/Money';
import { parseBudgetPeriod } from '@/application/services/BudgetSpendingService';

const INR_AMOUNT_PATTERN = /^\d+(?:\.\d{1,2})?$/;

/**
 * Converts a validated INR decimal string (up to 2 decimal places) strictly into
 * safe integer paise using exact BigInt subunit arithmetic (avoiding IEEE-754 drift).
 */
export function parseInrToPaise(raw: string): number {
  const trimmed = (raw || '').trim();
  if (!INR_AMOUNT_PATTERN.test(trimmed)) {
    throw new Error('Enter a valid amount in INR with at most 2 decimal places.');
  }

  const [rupeesPart, paisePart = ''] = trimmed.split('.');
  const rupeesBig = BigInt(rupeesPart);
  const paiseBig = BigInt(paisePart.padEnd(2, '0'));
  const totalPaiseBig = rupeesBig * 100n + paiseBig;

  if (totalPaiseBig <= 0n) {
    throw new Error('Monthly budget limit must be greater than zero.');
  }

  if (totalPaiseBig > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Budget limit exceeds the maximum supported safe integer amount.');
  }

  return Money.fromPaise(Number(totalPaiseBig), 'INR').paise;
}

/**
 * Formats integer paise into an editable INR input string without floating-point rounding.
 */
export function formatPaiseForInput(paise: number): string {
  if (!Number.isSafeInteger(paise) || paise <= 0) {
    return '';
  }
  const rupees = Math.floor(paise / 100);
  const remainder = paise % 100;
  if (remainder === 0) {
    return String(rupees);
  }
  return `${rupees}.${String(remainder).padStart(2, '0')}`;
}

/**
 * Returns the local calendar month identifier in YYYY-MM format.
 */
export function getCurrentBudgetPeriod(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Formats a YYYY-MM period string into a readable Indian locale label (e.g. "November 2026").
 */
export function formatBudgetPeriodLabel(period: string): string {
  const { year, month } = parseBudgetPeriod(period);
  const displayDate = new Date(year, month - 1, 1);
  return new Intl.DateTimeFormat('en-IN', {
    month: 'long',
    year: 'numeric'
  }).format(displayDate);
}

/**
 * Shifts a YYYY-MM period backward or forward by deltaMonths.
 */
export function shiftBudgetPeriod(period: string, deltaMonths: number): string {
  const { year, month } = parseBudgetPeriod(period);
  const target = new Date(year, month - 1 + deltaMonths, 1);
  return getCurrentBudgetPeriod(target);
}

const budgetAmountSchema = z
  .string()
  .min(1, 'Monthly budget limit is required')
  .refine(
    (val) => {
      const trimmed = val.trim();
      return INR_AMOUNT_PATTERN.test(trimmed);
    },
    { message: 'Enter a valid INR limit with up to 2 decimal places' }
  )
  .superRefine((val, ctx) => {
    try {
      parseInrToPaise(val);
    } catch (err) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: err instanceof Error ? err.message : 'Invalid budget limit'
      });
    }
  });

export const createBudgetSchema = z.object({
  categoryId: z.string().min(1, 'Please select an active expense category'),
  period: z
    .string()
    .regex(BUDGET_PERIOD_REGEX, 'Budget period must follow YYYY-MM format'),
  limit: budgetAmountSchema
});

export type CreateBudgetFormValues = z.infer<typeof createBudgetSchema>;

export const editBudgetSchema = z.object({
  id: z.string().min(1, 'Budget identifier is required'),
  limit: budgetAmountSchema
});

export type EditBudgetFormValues = z.infer<typeof editBudgetSchema>;

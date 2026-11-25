import { Budget, BUDGET_PERIOD_REGEX } from '@/domain/entities/Budget';
import { Transaction } from '@/domain/entities/Transaction';
import { DateRange } from '@/domain/value-objects/DateRange';
import { CategoryId, UserId, validateUserId } from '@/domain/value-objects/Identifiers';
import { InvalidBudgetPeriodError } from '@/domain/errors/BudgetErrors';
import {
  InvalidTransactionAmountError,
  UnauthorizedEntityAccessError
} from '@/domain/errors/DomainErrors';

export interface ParsedBudgetPeriod {
  year: number;
  month: number; // 1..12
  normalizedPeriod: string;
}

export interface EvaluatedBudgetStatus {
  spentPaise: number;
  remainingPaise: number;
  utilizationPercentage: number;
  isExceeded: boolean;
}

/**
 * Validates and parses a calendar month string formatted as YYYY-MM.
 */
export function parseBudgetPeriod(period: string): ParsedBudgetPeriod {
  const normalizedPeriod = (period || '').trim();
  if (!BUDGET_PERIOD_REGEX.test(normalizedPeriod)) {
    throw new InvalidBudgetPeriodError(
      `Invalid budget period '${period}'. Expected format YYYY-MM with valid month (01-12).`
    );
  }

  const [yearStr, monthStr] = normalizedPeriod.split('-');
  return {
    year: Number(yearStr),
    month: Number(monthStr),
    normalizedPeriod
  };
}

/**
 * Shared application service encapsulating monthly calendar boundaries,
 * category-level integer-paise expense aggregation, and budget status evaluation.
 */
export class BudgetSpendingService {
  /**
   * Computes exact local calendar start and end bounds for a YYYY-MM period,
   * aligning with DateRange.thisMonth() and DexieTransactionRepository date filtering.
   */
  public static getMonthDateRange(period: string): DateRange {
    const { year, month } = parseBudgetPeriod(period);
    const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
    start.setFullYear(year);
    const end = new Date(year, month, 0, 23, 59, 59, 999);
    end.setFullYear(year);
    return new DateRange(start, end);
  }

  /**
   * Adds two non-negative integer paise amounts using strict safe-integer checks.
   */
  public static safeAddPaise(a: number, b: number): number {
    if (
      typeof a !== 'number' ||
      !Number.isSafeInteger(a) ||
      a < 0 ||
      typeof b !== 'number' ||
      !Number.isSafeInteger(b) ||
      b < 0
    ) {
      throw new InvalidTransactionAmountError(
        `Invalid monetary amount in budget aggregation: expected non-negative safe integers, received ${a} and ${b}.`
      );
    }

    const sum = a + b;
    if (!Number.isSafeInteger(sum)) {
      throw new InvalidTransactionAmountError(
        'Aggregated budget spending exceeds Number.MAX_SAFE_INTEGER.'
      );
    }

    return sum;
  }

  /**
   * Aggregates active expense transactions in integer paise by categoryId for the
   * authenticated user and calendar month.
   *
   * Strictly:
   * - Rejects foreign transactions (UnauthorizedEntityAccessError).
   * - Rejects non-integer / non-positive transaction amounts (InvalidTransactionAmountError).
   * - Rejects invalid transaction dates.
   * - Excludes soft-deleted transactions, income, transfers, and out-of-range dates.
   * - Never mutates input transactions.
   */
  public static aggregateExpenseByCategory(
    transactions: readonly Transaction[],
    userId: UserId,
    dateRange: DateRange,
    targetCategoryId?: CategoryId
  ): Map<string, number> {
    const validatedUserId = validateUserId(userId);
    const totalsByCategory = new Map<string, number>();

    for (const tx of transactions) {
      if (tx.userId !== validatedUserId) {
        throw new UnauthorizedEntityAccessError('Transaction', tx.id);
      }

      if (
        typeof tx.amountPaise !== 'number' ||
        !Number.isSafeInteger(tx.amountPaise) ||
        tx.amountPaise <= 0
      ) {
        throw new InvalidTransactionAmountError(
          `Transaction '${tx.id}' contains invalid amountPaise '${tx.amountPaise}'.`
        );
      }

      if (!(tx.transactionDate instanceof Date) || isNaN(tx.transactionDate.getTime())) {
        throw new Error(`Transaction '${tx.id}' contains an invalid transactionDate.`);
      }

      if (tx.isDeleted) {
        continue;
      }

      if (tx.type !== 'expense') {
        continue;
      }

      if (!dateRange.contains(tx.transactionDate)) {
        continue;
      }

      if (!tx.categoryId) {
        continue;
      }

      if (targetCategoryId && tx.categoryId !== targetCategoryId) {
        continue;
      }

      const currentTotal = totalsByCategory.get(tx.categoryId) ?? 0;
      totalsByCategory.set(tx.categoryId, this.safeAddPaise(currentTotal, tx.amountPaise));
    }

    return totalsByCategory;
  }

  /**
   * Computes remaining paise, utilization percentage, and exceeded state via domain entity methods.
   */
  public static evaluateBudget(budget: Budget, spentPaise: number): EvaluatedBudgetStatus {
    return {
      spentPaise,
      remainingPaise: budget.remainingPaise(spentPaise),
      utilizationPercentage: budget.utilizationPercentage(spentPaise),
      isExceeded: budget.isExceeded(spentPaise)
    };
  }
}

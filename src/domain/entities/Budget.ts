import { BudgetId, CategoryId, UserId, isValidUuid } from '../value-objects/Identifiers';
import { Money } from '../value-objects/Money';
import { InvalidUserIdError } from '../errors/DomainErrors';
import {
  InvalidBudgetLimitError,
  InvalidBudgetPeriodError,
  InvalidSpendingAmountError
} from '../errors/BudgetErrors';

export const BUDGET_PERIOD_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface BudgetProps {
  id: BudgetId;
  userId: UserId;
  categoryId: CategoryId;
  period: string; // YYYY-MM format
  limitPaise: number;
  version?: number;
  createdAt?: Date;
  updatedAt?: Date;

  // Compatibility alias
  limit?: Money;
}

export class Budget {
  public readonly id: BudgetId;
  public readonly userId: UserId;
  public readonly categoryId: CategoryId;
  public readonly period: string;
  public readonly limitPaise: number;
  public readonly version: number;
  public readonly createdAt: Date;
  public readonly updatedAt: Date;

  constructor(props: BudgetProps) {
    if (!props.id || !isValidUuid(props.id)) {
      throw new Error('Budget ID is required and must be a valid UUID.');
    }

    if (!props.userId || !isValidUuid(props.userId)) {
      throw new InvalidUserIdError(
        typeof props.userId === 'string' && props.userId.trim().length > 0
          ? `Invalid user ID '${props.userId}'. A valid UUID is required.`
          : 'User ID is required and must be a valid UUID.'
      );
    }

    if (!props.categoryId || !isValidUuid(props.categoryId)) {
      throw new Error('Category ID is required and must be a valid UUID.');
    }

    const resolvedPeriod = (props.period || '').trim();
    if (!BUDGET_PERIOD_REGEX.test(resolvedPeriod)) {
      throw new InvalidBudgetPeriodError(
        `Invalid budget period '${props.period}'. Expected format YYYY-MM with valid month (01-12).`
      );
    }

    const resolvedLimitPaise = props.limitPaise ?? props.limit?.paise;
    if (
      typeof resolvedLimitPaise !== 'number' ||
      !Number.isSafeInteger(resolvedLimitPaise) ||
      resolvedLimitPaise <= 0
    ) {
      throw new InvalidBudgetLimitError();
    }

    const now = new Date();
    this.id = props.id;
    this.userId = props.userId;
    this.categoryId = props.categoryId;
    this.period = resolvedPeriod;
    this.limitPaise = resolvedLimitPaise;
    this.version = props.version ?? 1;
    this.createdAt = props.createdAt ?? now;
    this.updatedAt = props.updatedAt ?? now;
    Object.freeze(this);
  }

  // --- Financial calculation methods ---

  private validateSpentPaise(spentPaise: number): void {
    if (
      typeof spentPaise !== 'number' ||
      !Number.isSafeInteger(spentPaise) ||
      spentPaise < 0
    ) {
      throw new InvalidSpendingAmountError();
    }
  }

  /**
   * Determines whether actual spending exceeds the allocated budget limit.
   */
  public isExceeded(spentPaise: number): boolean {
    this.validateSpentPaise(spentPaise);
    return spentPaise > this.limitPaise;
  }

  /**
   * Computes the unspent budget remaining for the period.
   * If spending equals or exceeds the limit, returns 0 paise.
   */
  public remainingPaise(spentPaise: number): number {
    this.validateSpentPaise(spentPaise);
    return Math.max(0, this.limitPaise - spentPaise);
  }

  /**
   * Computes the budget utilization percentage rounded to the nearest integer.
   * Does not cap at 100% when spending exceeds the limit (e.g. ₹1,500 of ₹1,000 = 150%).
   */
  public utilizationPercentage(spentPaise: number): number {
    this.validateSpentPaise(spentPaise);
    if (this.limitPaise <= 0) return 0;
    return Math.round((spentPaise / this.limitPaise) * 100);
  }

  /**
   * Immutably creates a copy of the budget with an updated limit.
   */
  public updateLimit(newLimitPaise: number, newVersion?: number): Budget {
    return new Budget({
      id: this.id,
      userId: this.userId,
      categoryId: this.categoryId,
      period: this.period,
      limitPaise: newLimitPaise,
      version: newVersion ?? this.version + 1,
      createdAt: this.createdAt,
      updatedAt: new Date()
    });
  }

  // --- Backward-compatibility getters and methods ---

  public get limit(): Money {
    return Money.fromPaise(this.limitPaise);
  }

  public isOverBudget(spent: Money): boolean {
    return this.isExceeded(spent.paise);
  }

  public remaining(spent: Money): Money {
    return Money.fromPaise(this.remainingPaise(spent.paise));
  }
}

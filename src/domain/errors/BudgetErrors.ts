import { DomainError } from './DomainErrors';

export class InvalidBudgetLimitError extends DomainError {
  constructor(message = 'Budget limit must be a strictly positive safe integer in paise.') {
    super(message, 'INVALID_BUDGET_LIMIT');
  }
}

export class InvalidBudgetPeriodError extends DomainError {
  constructor(message = 'Budget period must be a valid calendar month formatted as YYYY-MM.') {
    super(message, 'INVALID_BUDGET_PERIOD');
  }
}

export class InvalidSpendingAmountError extends DomainError {
  constructor(message = 'Spending amount in paise must be a non-negative safe integer.') {
    super(message, 'INVALID_SPENDING_AMOUNT');
  }
}

export class BudgetNotFoundError extends DomainError {
  constructor(identifier?: string) {
    super(
      identifier
        ? `Budget with ID '${identifier}' was not found.`
        : 'The specified budget was not found.',
      'BUDGET_NOT_FOUND'
    );
  }
}

export class DuplicateBudgetError extends DomainError {
  constructor(categoryId: string, period: string) {
    super(
      `A budget for category '${categoryId}' in period '${period}' already exists.`,
      'DUPLICATE_BUDGET'
    );
  }
}

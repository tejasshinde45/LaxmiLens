export abstract class DomainError extends Error {
  public readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class InvalidMoneyError extends DomainError {
  constructor(message = 'Monetary amount must be a valid integer in paise.') {
    super(message, 'INVALID_MONEY');
  }
}

export class InvalidTransactionAmountError extends DomainError {
  constructor(message = 'Transaction amount must be a strictly positive integer in paise.') {
    super(message, 'INVALID_TRANSACTION_AMOUNT');
  }
}

export class InsufficientFundsError extends DomainError {
  constructor(accountId: string, availablePaise: number, requestedPaise: number) {
    super(
      `Insufficient funds in account ${accountId}. Available: ₹${availablePaise / 100}, Requested: ₹${requestedPaise / 100}`,
      'INSUFFICIENT_FUNDS'
    );
  }
}

export class AccountNotFoundError extends DomainError {
  constructor(accountId: string) {
    super(`Account with ID '${accountId}' was not found.`, 'ACCOUNT_NOT_FOUND');
  }
}

export class MissingAccountError extends DomainError {
  constructor(message = 'Transaction must reference a valid source account.') {
    super(message, 'MISSING_ACCOUNT');
  }
}

export class TransactionNotFoundError extends DomainError {
  constructor(transactionId: string) {
    super(`Transaction with ID '${transactionId}' was not found.`, 'TRANSACTION_NOT_FOUND');
  }
}

export class CategoryNotFoundError extends DomainError {
  constructor(categoryId: string) {
    super(`Category with ID '${categoryId}' was not found.`, 'CATEGORY_NOT_FOUND');
  }
}

export class CategoryTypeMismatchError extends DomainError {
  constructor(expectedType: 'income' | 'expense', actualType: 'income' | 'expense') {
    super(
      `Cannot use ${actualType} category for ${expectedType} transaction. Expected category type: ${expectedType}.`,
      'CATEGORY_TYPE_MISMATCH'
    );
  }
}

export class CategoryArchivedError extends DomainError {
  constructor(categoryId: string) {
    super(
      `Category with ID '${categoryId}' is archived and cannot be used for this operation.`,
      'CATEGORY_ARCHIVED'
    );
  }
}

export class TransferAccountMismatchError extends DomainError {
  constructor(message = 'A transfer transaction must specify distinct source and destination accounts.') {
    super(message, 'TRANSFER_ACCOUNT_MISMATCH');
  }
}

export class DuplicateTransactionError extends DomainError {
  constructor(idempotencyKey: string) {
    super(`A transaction with idempotency key '${idempotencyKey}' already exists.`, 'DUPLICATE_TRANSACTION');
  }
}

export class InvalidUserIdError extends DomainError {
  constructor(message = 'A valid user UUID is required for this operation.') {
    super(message, 'INVALID_USER_ID');
  }
}

export class UnauthorizedEntityAccessError extends DomainError {
  constructor(entityName: string, entityId: string) {
    super(`User is not authorized to access or reference ${entityName} with ID '${entityId}'.`, 'UNAUTHORIZED_ENTITY_ACCESS');
  }
}

export class InvalidDateRangeError extends DomainError {
  constructor(start: Date, end: Date) {
    super(`Start date (${start.toISOString()}) must precede or equal end date (${end.toISOString()}).`, 'INVALID_DATE_RANGE');
  }
}

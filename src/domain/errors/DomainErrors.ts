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

export class TransferAccountMismatchError extends DomainError {
  constructor() {
    super('A transfer transaction must specify distinct source and destination accounts.', 'TRANSFER_ACCOUNT_MISMATCH');
  }
}

export class DuplicateTransactionError extends DomainError {
  constructor(idempotencyKey: string) {
    super(`A transaction with idempotency key '${idempotencyKey}' already exists.`, 'DUPLICATE_TRANSACTION');
  }
}

export class InvalidDateRangeError extends DomainError {
  constructor(start: Date, end: Date) {
    super(`Start date (${start.toISOString()}) must precede or equal end date (${end.toISOString()}).`, 'INVALID_DATE_RANGE');
  }
}

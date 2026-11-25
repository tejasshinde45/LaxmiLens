import { DomainError } from './DomainErrors';

export class LenderNotFoundError extends DomainError {
  constructor(identifier?: string) {
    super(
      identifier
        ? `Lender with ID or name '${identifier}' was not found.`
        : 'The specified lender was not found.',
      'LENDER_NOT_FOUND'
    );
  }
}

export class BorrowingNotFoundError extends DomainError {
  constructor(identifier?: string) {
    super(
      identifier
        ? `Borrowing with ID '${identifier}' was not found.`
        : 'The specified borrowing was not found.',
      'BORROWING_NOT_FOUND'
    );
  }
}

export class InvalidLenderNameError extends DomainError {
  constructor(message = 'Lender name is required and cannot be empty.') {
    super(message, 'INVALID_LENDER_NAME');
  }
}

export class InvalidBorrowingAmountError extends DomainError {
  constructor(message = 'Borrowing amount must be a positive integer greater than zero.') {
    super(message, 'INVALID_BORROWING_AMOUNT');
  }
}

export class InvalidRepaymentAmountError extends DomainError {
  constructor(message = 'Repayment amount must be a positive integer greater than zero.') {
    super(message, 'INVALID_REPAYMENT_AMOUNT');
  }
}

export class RepaymentExceedsOutstandingBalanceError extends DomainError {
  constructor(repaymentPaise: number, outstandingPaise: number) {
    const repayRupees = (repaymentPaise / 100).toLocaleString('en-IN', {
      maximumFractionDigits: 2
    });
    const outstandingRupees = (outstandingPaise / 100).toLocaleString('en-IN', {
      maximumFractionDigits: 2
    });
    super(
      `Repayment amount of ₹${repayRupees} exceeds the outstanding balance of ₹${outstandingRupees}.`,
      'REPAYMENT_EXCEEDS_OUTSTANDING_BALANCE'
    );
  }
}

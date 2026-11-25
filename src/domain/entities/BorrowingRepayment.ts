import {
  RepaymentId,
  BorrowingId,
  LenderId,
  AccountId,
  TransactionId,
  UserId,
  isValidUuid
} from '../value-objects/Identifiers';
import { Money } from '../value-objects/Money';
import { InvalidUserIdError } from '../errors/DomainErrors';
import { InvalidRepaymentAmountError } from '../errors/BorrowingErrors';

export interface BorrowingRepaymentProps {
  id: RepaymentId;
  userId: UserId;
  borrowingId: BorrowingId;
  lenderId: LenderId;
  amountPaise: number;
  repaymentDate: Date;
  paymentAccountId: AccountId;
  transactionId: TransactionId;
  notes?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export class BorrowingRepayment {
  public readonly id: RepaymentId;
  public readonly userId: UserId;
  public readonly borrowingId: BorrowingId;
  public readonly lenderId: LenderId;
  public readonly amountPaise: number;
  public readonly repaymentDate: Date;
  public readonly paymentAccountId: AccountId;
  public readonly transactionId: TransactionId;
  public readonly notes?: string;
  public readonly createdAt: Date;
  public readonly updatedAt: Date;

  constructor(props: BorrowingRepaymentProps) {
    if (!Number.isSafeInteger(props.amountPaise) || props.amountPaise <= 0) {
      throw new InvalidRepaymentAmountError();
    }

    if (!props.userId || !isValidUuid(props.userId)) {
      throw new InvalidUserIdError('User ID is required and must be a valid UUID.');
    }

    if (!props.borrowingId) {
      throw new Error('Borrowing ID is required for a repayment.');
    }

    if (!props.lenderId) {
      throw new Error('Lender ID is required for a repayment.');
    }

    if (!props.paymentAccountId) {
      throw new Error('Payment account ID is required for a repayment.');
    }

    if (!props.transactionId) {
      throw new Error('Transaction ID is required for a repayment.');
    }

    const now = new Date();
    this.id = props.id;
    this.userId = props.userId;
    this.borrowingId = props.borrowingId;
    this.lenderId = props.lenderId;
    this.amountPaise = props.amountPaise;
    this.repaymentDate = props.repaymentDate;
    this.paymentAccountId = props.paymentAccountId;
    this.transactionId = props.transactionId;
    this.notes = props.notes?.trim();
    this.createdAt = props.createdAt ?? now;
    this.updatedAt = props.updatedAt ?? now;

    Object.freeze(this);
  }

  public get amount(): Money {
    return Money.fromPaise(this.amountPaise);
  }
}

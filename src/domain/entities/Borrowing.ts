import {
  BorrowingId,
  LenderId,
  AccountId,
  TransactionId,
  UserId,
  isValidUuid
} from '../value-objects/Identifiers';
import { Money } from '../value-objects/Money';
import { InvalidUserIdError } from '../errors/DomainErrors';
import { InvalidBorrowingAmountError } from '../errors/BorrowingErrors';

export type BorrowingStatus = 'active' | 'repaid';

export interface BorrowingProps {
  id: BorrowingId;
  userId: UserId;
  lenderId: LenderId;
  amountPaise: number;
  borrowingDate: Date;
  dueDate?: Date | null;
  receivingAccountId: AccountId;
  transactionId: TransactionId;
  status?: BorrowingStatus;
  notes?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export class Borrowing {
  public readonly id: BorrowingId;
  public readonly userId: UserId;
  public readonly lenderId: LenderId;
  public readonly amountPaise: number;
  public readonly borrowingDate: Date;
  public readonly dueDate?: Date | null;
  public readonly receivingAccountId: AccountId;
  public readonly transactionId: TransactionId;
  public readonly status: BorrowingStatus;
  public readonly notes?: string;
  public readonly createdAt: Date;
  public readonly updatedAt: Date;

  constructor(props: BorrowingProps) {
    if (!Number.isSafeInteger(props.amountPaise) || props.amountPaise <= 0) {
      throw new InvalidBorrowingAmountError();
    }

    if (!props.userId || !isValidUuid(props.userId)) {
      throw new InvalidUserIdError('User ID is required and must be a valid UUID.');
    }

    if (!props.lenderId) {
      throw new Error('Lender ID is required for a borrowing.');
    }

    if (!props.receivingAccountId) {
      throw new Error('Receiving account ID is required for a borrowing.');
    }

    if (!props.transactionId) {
      throw new Error('Transaction ID is required for a borrowing.');
    }

    const now = new Date();
    this.id = props.id;
    this.userId = props.userId;
    this.lenderId = props.lenderId;
    this.amountPaise = props.amountPaise;
    this.borrowingDate = props.borrowingDate;
    this.dueDate = props.dueDate;
    this.receivingAccountId = props.receivingAccountId;
    this.transactionId = props.transactionId;
    this.status = props.status ?? 'active';
    this.notes = props.notes?.trim();
    this.createdAt = props.createdAt ?? now;
    this.updatedAt = props.updatedAt ?? now;

    Object.freeze(this);
  }

  public get amount(): Money {
    return Money.fromPaise(this.amountPaise);
  }

  public isRepaid(): boolean {
    return this.status === 'repaid';
  }
}

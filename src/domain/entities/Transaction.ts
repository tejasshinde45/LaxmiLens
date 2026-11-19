import { TransactionId, AccountId, CategoryId } from '../value-objects/Identifiers';
import { Money } from '../value-objects/Money';
import { TransferAccountMismatchError, InvalidMoneyError } from '../errors/DomainErrors';

export type TransactionType = 'income' | 'expense' | 'transfer';
export type TransactionStatus = 'cleared' | 'pending' | 'reconciled';

export interface TransactionProps {
  id: TransactionId;
  type: TransactionType;
  amount: Money;
  accountId: AccountId;
  targetAccountId?: AccountId;
  categoryId?: CategoryId;
  date: Date;
  description: string;
  notes?: string;
  status: TransactionStatus;
  idempotencyKey: string;
  version: number;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class Transaction {
  public readonly id: TransactionId;
  public readonly type: TransactionType;
  public readonly amount: Money;
  public readonly accountId: AccountId;
  public readonly targetAccountId?: AccountId;
  public readonly categoryId?: CategoryId;
  public readonly date: Date;
  public readonly description: string;
  public readonly notes?: string;
  public readonly status: TransactionStatus;
  public readonly idempotencyKey: string;
  public readonly version: number;
  public readonly isDeleted: boolean;
  public readonly createdAt: Date;
  public readonly updatedAt: Date;

  constructor(props: TransactionProps) {
    if (props.amount.isZero() || props.amount.isNegative()) {
      throw new InvalidMoneyError('Transaction amount must be strictly positive.');
    }

    if (props.type === 'transfer') {
      if (!props.targetAccountId || props.accountId === props.targetAccountId) {
        throw new TransferAccountMismatchError();
      }
    }

    this.id = props.id;
    this.type = props.type;
    this.amount = props.amount;
    this.accountId = props.accountId;
    this.targetAccountId = props.targetAccountId;
    this.categoryId = props.categoryId;
    this.date = props.date;
    this.description = props.description;
    this.notes = props.notes;
    this.status = props.status;
    this.idempotencyKey = props.idempotencyKey;
    this.version = props.version;
    this.isDeleted = props.isDeleted;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
    Object.freeze(this);
  }

  public isTransfer(): boolean {
    return this.type === 'transfer';
  }

  public isIncome(): boolean {
    return this.type === 'income';
  }

  public isExpense(): boolean {
    return this.type === 'expense';
  }
}

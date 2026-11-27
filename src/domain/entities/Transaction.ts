import { TransactionId, AccountId, CategoryId, UserId } from '../value-objects/Identifiers';
import { Money } from '../value-objects/Money';
import {
  TransferAccountMismatchError,
  InvalidTransactionAmountError,
  MissingAccountError
} from '../errors/DomainErrors';
import { normalizeOptionalText } from '@/utils/textNormalization';

export type TransactionType = 'income' | 'expense' | 'transfer';
export type TransactionStatus = 'cleared' | 'pending' | 'reconciled';

export interface TransactionProps {
  id: TransactionId;
  userId: UserId;
  type: TransactionType;
  amountPaise: number;
  currency?: string;
  accountId: AccountId;
  destinationAccountId?: AccountId;
  categoryId?: CategoryId;
  title: string;
  note?: string;
  transactionDate: Date;
  deletedAt?: Date | null;
  version?: number;
  deviceId?: string;
  idempotencyKey: string;
  createdAt?: Date;
  updatedAt?: Date;

  // Compatibility aliases
  targetAccountId?: AccountId;
  description?: string;
  notes?: string;
  date?: Date;
  isDeleted?: boolean;
  status?: TransactionStatus;
}

export class Transaction {
  public readonly id: TransactionId;
  public readonly userId: UserId;
  public readonly type: TransactionType;
  public readonly amountPaise: number;
  public readonly currency: string;
  public readonly accountId: AccountId;
  public readonly destinationAccountId?: AccountId;
  public readonly categoryId?: CategoryId;
  public readonly title: string;
  public readonly note?: string;
  public readonly transactionDate: Date;
  public readonly deletedAt: Date | null;
  public readonly version: number;
  public readonly deviceId?: string;
  public readonly idempotencyKey: string;
  public readonly createdAt: Date;
  public readonly updatedAt: Date;
  public readonly status: TransactionStatus;

  constructor(props: TransactionProps) {
    // 1. Amount must be a positive integer in paise
    if (!Number.isSafeInteger(props.amountPaise) || props.amountPaise <= 0) {
      throw new InvalidTransactionAmountError();
    }

    // 2. Validate source account
    if (!props.accountId) {
      throw new MissingAccountError('Transaction must reference a valid source account.');
    }

    // 3. Title validation
    const resolvedTitle = (props.title || props.description || '').trim();
    if (resolvedTitle.length === 0) {
      throw new Error('Transaction title must not be empty.');
    }

    // 4. Transfer rules
    const resolvedDestination = props.destinationAccountId || props.targetAccountId;
    if (props.type === 'transfer') {
      if (!resolvedDestination || props.accountId === resolvedDestination) {
        throw new TransferAccountMismatchError('A transfer transaction must specify distinct source and destination accounts.');
      }
    } else {
      if (resolvedDestination) {
        throw new Error('Only transfer transactions may specify a destination account.');
      }
    }

    // 5. Idempotency key validation
    if (!props.idempotencyKey || props.idempotencyKey.trim().length === 0) {
      throw new Error('Transaction must have an idempotency key to prevent duplicate creation.');
    }

    const now = new Date();
    this.id = props.id;
    this.userId = props.userId;
    this.type = props.type;
    this.amountPaise = props.amountPaise;
    this.currency = props.currency ?? 'INR';
    this.accountId = props.accountId;
    this.destinationAccountId = resolvedDestination;
    this.categoryId = props.categoryId;
    this.title = resolvedTitle;
    this.note = normalizeOptionalText(props.note ?? props.notes);
    this.transactionDate = props.transactionDate ?? props.date ?? now;
    this.deletedAt = props.deletedAt ?? (props.isDeleted ? now : null);
    this.version = props.version ?? 1;
    this.deviceId = props.deviceId;
    this.idempotencyKey = props.idempotencyKey.trim();
    this.status = props.status ?? 'cleared';
    this.createdAt = props.createdAt ?? now;
    this.updatedAt = props.updatedAt ?? now;
    Object.freeze(this);
  }

  // Compatibility and financial helper getters
  public get amount(): Money {
    return Money.fromPaise(this.amountPaise, this.currency);
  }

  public get description(): string {
    return this.title;
  }

  public get notes(): string | undefined {
    return this.note;
  }

  public get date(): Date {
    return this.transactionDate;
  }

  public get targetAccountId(): AccountId | undefined {
    return this.destinationAccountId;
  }

  public get isDeleted(): boolean {
    return this.deletedAt !== null;
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

  public markDeleted(deletedAt: Date = new Date(), newVersion?: number): Transaction {
    return new Transaction({
      ...this,
      deletedAt,
      version: newVersion ?? this.version + 1,
      updatedAt: new Date()
    });
  }
}

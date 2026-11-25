import { AccountId, UserId, isValidUuid } from '../value-objects/Identifiers';
import { Money } from '../value-objects/Money';
import { InvalidUserIdError } from '../errors/DomainErrors';

export type AccountType = 'cash' | 'bank' | 'savings' | 'credit_card' | 'wallet' | 'other';

export type AccountStatus = 'active' | 'archived';

export interface AccountProps {
  id: AccountId;
  userId: UserId;
  name: string;
  accountType: AccountType;
  openingBalancePaise: number;
  currency?: string;
  institutionName?: string;
  color?: string;
  icon?: string;
  notes?: string;
  systemTag?: string | null;
  isArchived?: boolean;
  version?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export class Account {
  public readonly id: AccountId;
  public readonly userId: UserId;
  public readonly name: string;
  public readonly accountType: AccountType;
  public readonly openingBalancePaise: number;
  public readonly currency: string;
  public readonly institutionName?: string;
  public readonly color?: string;
  public readonly icon?: string;
  public readonly notes?: string;
  public readonly systemTag?: string;
  public readonly isArchived: boolean;
  public readonly version: number;
  public readonly createdAt: Date;
  public readonly updatedAt: Date;

  constructor(props: AccountProps) {
    if (!props.name || props.name.trim().length === 0) {
      throw new Error('Account name must not be empty.');
    }

    if (!props.userId || !isValidUuid(props.userId)) {
      throw new InvalidUserIdError(
        typeof props.userId === 'string' && props.userId.trim().length > 0
          ? `Invalid user ID '${props.userId}'. A valid UUID is required.`
          : 'User ID is required and must be a valid UUID.'
      );
    }

    const now = new Date();
    this.id = props.id;
    this.userId = props.userId;
    this.name = props.name.trim();
    this.accountType = props.accountType;
    this.openingBalancePaise = props.openingBalancePaise;
    this.currency = props.currency ?? 'INR';
    this.institutionName = props.institutionName?.trim();
    this.color = props.color;
    this.icon = props.icon;
    this.notes = props.notes?.trim();
    this.systemTag = props.systemTag?.trim() || undefined;
    this.isArchived = props.isArchived ?? false;
    this.version = props.version ?? 1;
    this.createdAt = props.createdAt ?? now;
    this.updatedAt = props.updatedAt ?? now;
    Object.freeze(this);
  }

  // Getters for financial calculation and compatibility
  public get openingBalance(): Money {
    return Money.fromPaise(this.openingBalancePaise, this.currency);
  }

  public get type(): AccountType {
    return this.accountType;
  }

  public get status(): AccountStatus {
    return this.isArchived ? 'archived' : 'active';
  }

  public isCreditCard(): boolean {
    return this.accountType === 'credit_card';
  }

  public isSystemAccount(): boolean {
    return Boolean(this.systemTag);
  }

  public isPersonalBorrowingsLiability(): boolean {
    return this.systemTag === 'personal_borrowings';
  }
}

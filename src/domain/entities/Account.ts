import { AccountId } from '../value-objects/Identifiers';
import { Money } from '../value-objects/Money';

export type AccountType = 'cash' | 'bank' | 'upi' | 'wallet' | 'credit_card';

export type AccountStatus = 'active' | 'archived';

export interface AccountProps {
  id: AccountId;
  name: string;
  type: AccountType;
  currency: string;
  openingBalance: Money;
  status: AccountStatus;
  color?: string;
  icon?: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export class Account {
  public readonly id: AccountId;
  public readonly name: string;
  public readonly type: AccountType;
  public readonly currency: string;
  public readonly openingBalance: Money;
  public readonly status: AccountStatus;
  public readonly color?: string;
  public readonly icon?: string;
  public readonly version: number;
  public readonly createdAt: Date;
  public readonly updatedAt: Date;

  constructor(props: AccountProps) {
    this.id = props.id;
    this.name = props.name;
    this.type = props.type;
    this.currency = props.currency;
    this.openingBalance = props.openingBalance;
    this.status = props.status;
    this.color = props.color;
    this.icon = props.icon;
    this.version = props.version;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
    Object.freeze(this);
  }

  public isArchived(): boolean {
    return this.status === 'archived';
  }

  public isCreditCard(): boolean {
    return this.type === 'credit_card';
  }
}

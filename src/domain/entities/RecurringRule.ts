import { RecurringRuleId, AccountId, CategoryId } from '../value-objects/Identifiers';
import { Money } from '../value-objects/Money';
import { TransactionType } from './Transaction';

export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface RecurringRuleProps {
  id: RecurringRuleId;
  name: string;
  type: TransactionType;
  amount: Money;
  accountId: AccountId;
  targetAccountId?: AccountId;
  categoryId?: CategoryId;
  frequency: RecurrenceFrequency;
  interval: number; // e.g. every 1 month
  startDate: Date;
  endDate?: Date;
  nextDueDate: Date;
  lastGeneratedDate?: Date;
  requiresUserConfirmation: boolean; // Ensures rules do NOT silently create transactions
  isActive: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export class RecurringRule {
  public readonly id: RecurringRuleId;
  public readonly name: string;
  public readonly type: TransactionType;
  public readonly amount: Money;
  public readonly accountId: AccountId;
  public readonly targetAccountId?: AccountId;
  public readonly categoryId?: CategoryId;
  public readonly frequency: RecurrenceFrequency;
  public readonly interval: number;
  public readonly startDate: Date;
  public readonly endDate?: Date;
  public readonly nextDueDate: Date;
  public readonly lastGeneratedDate?: Date;
  public readonly requiresUserConfirmation: boolean;
  public readonly isActive: boolean;
  public readonly version: number;
  public readonly createdAt: Date;
  public readonly updatedAt: Date;

  constructor(props: RecurringRuleProps) {
    this.id = props.id;
    this.name = props.name;
    this.type = props.type;
    this.amount = props.amount;
    this.accountId = props.accountId;
    this.targetAccountId = props.targetAccountId;
    this.categoryId = props.categoryId;
    this.frequency = props.frequency;
    this.interval = props.interval;
    this.startDate = props.startDate;
    this.endDate = props.endDate;
    this.nextDueDate = props.nextDueDate;
    this.lastGeneratedDate = props.lastGeneratedDate;
    this.requiresUserConfirmation = props.requiresUserConfirmation;
    this.isActive = props.isActive;
    this.version = props.version;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
    Object.freeze(this);
  }

  public isDue(asOfDate: Date = new Date()): boolean {
    if (!this.isActive) return false;
    if (this.endDate && asOfDate > this.endDate) return false;
    return asOfDate >= this.nextDueDate;
  }
}

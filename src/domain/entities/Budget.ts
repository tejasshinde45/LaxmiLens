import { BudgetId, CategoryId } from '../value-objects/Identifiers';
import { Money } from '../value-objects/Money';

export interface BudgetProps {
  id: BudgetId;
  categoryId: CategoryId;
  period: string; // YYYY-MM format
  limit: Money;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export class Budget {
  public readonly id: BudgetId;
  public readonly categoryId: CategoryId;
  public readonly period: string;
  public readonly limit: Money;
  public readonly version: number;
  public readonly createdAt: Date;
  public readonly updatedAt: Date;

  constructor(props: BudgetProps) {
    this.id = props.id;
    this.categoryId = props.categoryId;
    this.period = props.period;
    this.limit = props.limit;
    this.version = props.version;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
    Object.freeze(this);
  }

  public isOverBudget(spent: Money): boolean {
    return spent.greaterThan(this.limit);
  }

  public remaining(spent: Money): Money {
    if (this.isOverBudget(spent)) {
      return Money.zero();
    }
    return this.limit.subtract(spent);
  }
}

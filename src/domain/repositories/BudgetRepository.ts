import { BudgetId, CategoryId, UserId } from '../value-objects/Identifiers';
import { Budget } from '../entities/Budget';

export interface BudgetRepository {
  findById(id: BudgetId, userId: UserId): Promise<Budget | null>;
  findByPeriod(period: string, userId: UserId): Promise<Budget[]>;
  findByCategoryAndPeriod(categoryId: CategoryId, period: string, userId: UserId): Promise<Budget | null>;
  save(budget: Budget): Promise<void>;
  delete(id: BudgetId, userId: UserId): Promise<void>;
}

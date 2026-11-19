import { BudgetId, CategoryId } from '../value-objects/Identifiers';
import { Budget } from '../entities/Budget';

export interface BudgetRepository {
  findById(id: BudgetId): Promise<Budget | null>;
  findByPeriod(period: string): Promise<Budget[]>;
  findByCategoryAndPeriod(categoryId: CategoryId, period: string): Promise<Budget | null>;
  save(budget: Budget): Promise<void>;
  delete(id: BudgetId): Promise<void>;
}

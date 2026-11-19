import { BudgetRepository } from '@/domain/repositories/BudgetRepository';
import { TransactionRepository } from '@/domain/repositories/TransactionRepository';
import { createCategoryId } from '@/domain/value-objects/Identifiers';
import { Money } from '@/domain/value-objects/Money';

export interface BudgetStatusDTO {
  budgetId: string;
  categoryId: string;
  period: string;
  limitInPaise: number;
  spentInPaise: number;
  remainingInPaise: number;
  percentageUsed: number;
  isExceeded: boolean;
}

export class CheckBudgetUseCase {
  constructor(
    private readonly budgetRepo: BudgetRepository,
    private readonly transactionRepo: TransactionRepository
  ) {}

  public async execute(categoryIdStr: string, period: string): Promise<BudgetStatusDTO | null> {
    const categoryId = createCategoryId(categoryIdStr);
    const budget = await this.budgetRepo.findByCategoryAndPeriod(categoryId, period);
    if (!budget) return null;

    // Filter transactions for this category and month
    const transactions = await this.transactionRepo.findMany({ categoryId });
    let spentPaise = 0;

    for (const tx of transactions) {
      if (tx.isDeleted) continue;
      const txPeriod = `${tx.date.getFullYear()}-${String(tx.date.getMonth() + 1).padStart(2, '0')}`;
      if (txPeriod === period && tx.type === 'expense') {
        spentPaise += tx.amount.paise;
      }
    }

    const spent = Money.fromPaise(spentPaise);
    const isExceeded = budget.isOverBudget(spent);
    const remaining = budget.remaining(spent);
    const percentage = budget.limit.paise > 0 ? (spent.paise / budget.limit.paise) * 100 : 0;

    return {
      budgetId: budget.id,
      categoryId: budget.categoryId,
      period: budget.period,
      limitInPaise: budget.limit.paise,
      spentInPaise: spent.paise,
      remainingInPaise: remaining.paise,
      percentageUsed: Math.min(Math.round(percentage), 100),
      isExceeded
    };
  }
}

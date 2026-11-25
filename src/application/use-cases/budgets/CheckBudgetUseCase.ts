import { BudgetRepository } from '@/domain/repositories/BudgetRepository';
import { TransactionRepository } from '@/domain/repositories/TransactionRepository';
import { createCategoryId, validateUserId } from '@/domain/value-objects/Identifiers';
import { BudgetStatusDTO } from '@/application/dto/BudgetDTO';
import {
  BudgetSpendingService,
  parseBudgetPeriod
} from '@/application/services/BudgetSpendingService';
import { formatPaiseToINR } from '@/utils/formatters';

export type { BudgetStatusDTO };

export class CheckBudgetUseCase {
  constructor(
    private readonly budgetRepo: BudgetRepository,
    private readonly transactionRepo: TransactionRepository
  ) {}

  public async execute(
    categoryIdStr: string,
    period: string,
    userIdStr: string
  ): Promise<BudgetStatusDTO | null> {
    const userId = validateUserId(userIdStr);
    const { normalizedPeriod } = parseBudgetPeriod(period);
    const dateRange = BudgetSpendingService.getMonthDateRange(normalizedPeriod);
    const categoryId = createCategoryId((categoryIdStr || '').trim());

    const budget = await this.budgetRepo.findByCategoryAndPeriod(
      categoryId,
      normalizedPeriod,
      userId
    );
    if (!budget) return null;

    const transactions = await this.transactionRepo.findMany({
      userId,
      categoryId,
      dateRange,
      types: ['expense'],
      includeDeleted: false
    });

    const spentByCategory = BudgetSpendingService.aggregateExpenseByCategory(
      transactions,
      userId,
      dateRange,
      categoryId
    );

    const spentPaise = spentByCategory.get(categoryId) ?? 0;
    const evaluation = BudgetSpendingService.evaluateBudget(budget, spentPaise);

    return {
      budgetId: budget.id,
      userId: budget.userId,
      categoryId: budget.categoryId,
      period: budget.period,
      limitPaise: budget.limitPaise,
      limitFormatted: formatPaiseToINR(budget.limitPaise),
      spentPaise: evaluation.spentPaise,
      spentFormatted: formatPaiseToINR(evaluation.spentPaise),
      remainingPaise: evaluation.remainingPaise,
      remainingFormatted: formatPaiseToINR(evaluation.remainingPaise),
      utilizationPercentage: evaluation.utilizationPercentage,
      isExceeded: evaluation.isExceeded,

      // Compatibility aliases
      limitInPaise: budget.limitPaise,
      spentInPaise: evaluation.spentPaise,
      remainingInPaise: evaluation.remainingPaise,
      percentageUsed: evaluation.utilizationPercentage
    };
  }
}

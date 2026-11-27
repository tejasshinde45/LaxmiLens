import { BudgetRepository } from '@/domain/repositories/BudgetRepository';
import { TransactionRepository } from '@/domain/repositories/TransactionRepository';
import { CategoryRepository } from '@/domain/repositories/CategoryRepository';
import { Category } from '@/domain/entities/Category';
import { validateUserId } from '@/domain/value-objects/Identifiers';
import { UnauthorizedEntityAccessError } from '@/domain/errors/DomainErrors';
import {
  BudgetOverviewItemDTO,
  BudgetsOverviewResponseDTO
} from '@/application/dto/BudgetDTO';
import {
  BudgetSpendingService,
  parseBudgetPeriod
} from '@/application/services/BudgetSpendingService';
import { formatPaiseToINR } from '@/utils/formatters';

export class GetBudgetsOverviewUseCase {
  constructor(
    private readonly budgetRepo: BudgetRepository,
    private readonly transactionRepo: TransactionRepository,
    private readonly categoryRepo: CategoryRepository
  ) {}

  public async execute(userIdStr: string, period: string): Promise<BudgetsOverviewResponseDTO> {
    const userId = validateUserId(userIdStr);
    const { normalizedPeriod } = parseBudgetPeriod(period);
    const budgets = await this.budgetRepo.findByPeriod(normalizedPeriod, userId);

    if (budgets.length === 0) {
      const zeroFormatted = formatPaiseToINR(0);
      return {
        period: normalizedPeriod,
        summary: {
          period: normalizedPeriod,
          totalBudgetLimitPaise: 0,
          totalBudgetLimitFormatted: zeroFormatted,
          totalSpentPaise: 0,
          totalSpentFormatted: zeroFormatted,
          totalRemainingPaise: 0,
          totalRemainingFormatted: zeroFormatted,
          overallUtilizationPercentage: 0,
          budgetCount: 0,
          exceededCount: 0
        },
        budgets: []
      };
    }

    const dateRange = BudgetSpendingService.getMonthDateRange(normalizedPeriod);

    const [transactions, categories] = await Promise.all([
      this.transactionRepo.findMany({
        userId,
        dateRange,
        types: ['expense'],
        includeDeleted: false
      }),
      this.categoryRepo.findByUserId(userId)
    ]);

    // Map categories strictly by category ID (never by display name)
    const categoryMap = new Map<string, Category>();
    for (const category of categories) {
      categoryMap.set(category.id, category);
    }

    // Aggregate expenses in integer paise by categoryId for the target month
    const spentByCategory = BudgetSpendingService.aggregateExpenseByCategory(
      transactions,
      userId,
      dateRange
    );

    let totalBudgetLimitPaise = 0;
    let totalSpentPaise = 0;
    let exceededCount = 0;

    const items: BudgetOverviewItemDTO[] = [];

    for (const budget of budgets) {
      if (budget.userId !== userId) {
        throw new UnauthorizedEntityAccessError('Budget', budget.id);
      }

      let category = categoryMap.get(budget.categoryId);
      if (!category) {
        // Explicit lookup verifies cross-tenant ownership if category exists outside cache
        category = (await this.categoryRepo.findById(budget.categoryId, userId)) ?? undefined;
      }

      if (category && category.userId !== userId) {
        throw new UnauthorizedEntityAccessError('Category', budget.categoryId);
      }

      const spentPaise = spentByCategory.get(budget.categoryId) ?? 0;
      const evaluation = BudgetSpendingService.evaluateBudget(budget, spentPaise);

      totalBudgetLimitPaise = BudgetSpendingService.safeAddPaise(
        totalBudgetLimitPaise,
        budget.limitPaise
      );
      totalSpentPaise = BudgetSpendingService.safeAddPaise(
        totalSpentPaise,
        evaluation.spentPaise
      );
      if (evaluation.isExceeded) {
        exceededCount++;
      }

      items.push({
        budgetId: budget.id,
        userId: budget.userId,
        categoryId: budget.categoryId,
        categoryName: category?.name ?? 'Unknown Category',
        categoryIcon: category?.icon,
        categoryColor: category?.color,
        categoryIsArchived: category?.isArchived ?? false,
        period: budget.period,
        limitPaise: budget.limitPaise,
        limitFormatted: formatPaiseToINR(budget.limitPaise),
        spentPaise: evaluation.spentPaise,
        spentFormatted: formatPaiseToINR(evaluation.spentPaise),
        remainingPaise: evaluation.remainingPaise,
        remainingFormatted: formatPaiseToINR(evaluation.remainingPaise),
        utilizationPercentage: evaluation.utilizationPercentage,
        isExceeded: evaluation.isExceeded,
        version: budget.version,
        createdAt: budget.createdAt.toISOString(),
        updatedAt: budget.updatedAt.toISOString()
      });
    }

    items.sort((a, b) => {
      const nameOrder = a.categoryName.localeCompare(b.categoryName);
      return nameOrder !== 0 ? nameOrder : a.budgetId.localeCompare(b.budgetId);
    });

    const totalRemainingPaise = Math.max(0, totalBudgetLimitPaise - totalSpentPaise);
    const overallUtilizationPercentage =
      totalBudgetLimitPaise > 0
        ? Math.round((totalSpentPaise / totalBudgetLimitPaise) * 100)
        : 0;

    return {
      period: normalizedPeriod,
      summary: {
        period: normalizedPeriod,
        totalBudgetLimitPaise,
        totalBudgetLimitFormatted: formatPaiseToINR(totalBudgetLimitPaise),
        totalSpentPaise,
        totalSpentFormatted: formatPaiseToINR(totalSpentPaise),
        totalRemainingPaise,
        totalRemainingFormatted: formatPaiseToINR(totalRemainingPaise),
        overallUtilizationPercentage,
        budgetCount: items.length,
        exceededCount
      },
      budgets: items
    };
  }
}

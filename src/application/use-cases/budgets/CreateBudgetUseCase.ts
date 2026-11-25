import { BudgetRepository } from '@/domain/repositories/BudgetRepository';
import { CategoryRepository } from '@/domain/repositories/CategoryRepository';
import { SyncPort } from '@/application/ports/SyncPort';
import { UnitOfWork } from '@/application/ports/UnitOfWork';
import { CreateBudgetDTO, BudgetResponseDTO } from '@/application/dto/BudgetDTO';
import { parseBudgetPeriod } from '@/application/services/BudgetSpendingService';
import { Budget } from '@/domain/entities/Budget';
import {
  createBudgetId,
  createCategoryId,
  validateUserId
} from '@/domain/value-objects/Identifiers';
import {
  CategoryArchivedError,
  CategoryNotFoundError,
  CategoryTypeMismatchError,
  InvalidUserIdError,
  UnauthorizedEntityAccessError
} from '@/domain/errors/DomainErrors';
import { DuplicateBudgetError, InvalidBudgetLimitError } from '@/domain/errors/BudgetErrors';
import { formatPaiseToINR } from '@/utils/formatters';

export class CreateBudgetUseCase {
  constructor(
    private readonly budgetRepo: BudgetRepository,
    private readonly categoryRepo: CategoryRepository,
    private readonly syncPort: SyncPort,
    private readonly unitOfWork: UnitOfWork
  ) {}

  public async execute(dto: CreateBudgetDTO): Promise<BudgetResponseDTO> {
    if (!dto.userId) {
      throw new InvalidUserIdError('A valid user UUID is required to create a budget.');
    }
    const userId = validateUserId(dto.userId);
    const { normalizedPeriod } = parseBudgetPeriod(dto.period);

    const resolvedLimitPaise = dto.limitPaise ?? dto.limitInPaise;
    if (
      typeof resolvedLimitPaise !== 'number' ||
      !Number.isSafeInteger(resolvedLimitPaise) ||
      resolvedLimitPaise <= 0
    ) {
      throw new InvalidBudgetLimitError();
    }

    const rawCategoryId = (dto.categoryId || '').trim();
    if (!rawCategoryId) {
      throw new CategoryNotFoundError(dto.categoryId ?? '');
    }
    const categoryId = createCategoryId(rawCategoryId);

    // 1. Verify category exists, belongs to authenticated user, is active, and is an expense category
    const category = await this.categoryRepo.findById(categoryId, userId);
    if (!category) {
      throw new CategoryNotFoundError(rawCategoryId);
    }
    if (category.userId !== userId) {
      throw new UnauthorizedEntityAccessError('Category', rawCategoryId);
    }
    if (category.isArchived) {
      throw new CategoryArchivedError(rawCategoryId);
    }
    if (category.type !== 'expense') {
      throw new CategoryTypeMismatchError('expense', category.type);
    }

    // 2. Reject duplicate budgets for the same user, category, and period
    const existing = await this.budgetRepo.findByCategoryAndPeriod(
      category.id,
      normalizedPeriod,
      userId
    );
    if (existing) {
      throw new DuplicateBudgetError(category.id, normalizedPeriod);
    }

    const now = new Date();
    const budget = new Budget({
      id: createBudgetId(crypto.randomUUID()),
      userId,
      categoryId: category.id,
      period: normalizedPeriod,
      limitPaise: resolvedLimitPaise,
      version: 1,
      createdAt: now,
      updatedAt: now
    });

    const outboxEntry = {
      userId: budget.userId,
      entity: 'budgets' as const,
      entityId: budget.id,
      operation: 'INSERT' as const,
      payload: {
        id: budget.id,
        user_id: budget.userId,
        category_id: budget.categoryId,
        period: budget.period,
        limit_paise: budget.limitPaise,
        version: budget.version,
        created_at: budget.createdAt.toISOString(),
        updated_at: budget.updatedAt.toISOString()
      },
      idempotencyKey: crypto.randomUUID()
    };

    await this.unitOfWork.run(async () => {
      await this.budgetRepo.save(budget);
      await this.syncPort.enqueue(outboxEntry);
    });

    return {
      id: budget.id,
      userId: budget.userId,
      categoryId: budget.categoryId,
      period: budget.period,
      limitPaise: budget.limitPaise,
      limitFormatted: formatPaiseToINR(budget.limitPaise),
      version: budget.version,
      createdAt: budget.createdAt.toISOString(),
      updatedAt: budget.updatedAt.toISOString(),
      limitInPaise: budget.limitPaise
    };
  }
}

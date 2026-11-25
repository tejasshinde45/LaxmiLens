import { BudgetRepository } from '@/domain/repositories/BudgetRepository';
import { SyncPort } from '@/application/ports/SyncPort';
import { UnitOfWork } from '@/application/ports/UnitOfWork';
import { UpdateBudgetDTO, BudgetResponseDTO } from '@/application/dto/BudgetDTO';
import { createBudgetId, validateUserId } from '@/domain/value-objects/Identifiers';
import { UnauthorizedEntityAccessError } from '@/domain/errors/DomainErrors';
import { BudgetNotFoundError, InvalidBudgetLimitError } from '@/domain/errors/BudgetErrors';
import { formatPaiseToINR } from '@/utils/formatters';

export class UpdateBudgetUseCase {
  constructor(
    private readonly budgetRepo: BudgetRepository,
    private readonly syncPort: SyncPort,
    private readonly unitOfWork: UnitOfWork
  ) {}

  public async execute(dto: UpdateBudgetDTO): Promise<BudgetResponseDTO> {
    const userId = validateUserId(dto.userId);
    const rawBudgetId = (dto.id || '').trim();
    if (!rawBudgetId) {
      throw new BudgetNotFoundError(dto.id ?? '');
    }
    const budgetId = createBudgetId(rawBudgetId);

    const existing = await this.budgetRepo.findById(budgetId, userId);
    if (!existing) {
      throw new BudgetNotFoundError(rawBudgetId);
    }
    if (existing.userId !== userId) {
      throw new UnauthorizedEntityAccessError('Budget', rawBudgetId);
    }

    const resolvedLimitPaise = dto.limitPaise ?? dto.limitInPaise;
    if (
      typeof resolvedLimitPaise !== 'number' ||
      !Number.isSafeInteger(resolvedLimitPaise) ||
      resolvedLimitPaise <= 0
    ) {
      throw new InvalidBudgetLimitError();
    }

    // Update atomically via domain entity (preserves id, userId, categoryId, period, createdAt; increments version)
    const updated = existing.updateLimit(resolvedLimitPaise);

    const outboxEntry = {
      userId: updated.userId,
      entity: 'budgets' as const,
      entityId: updated.id,
      operation: 'UPDATE' as const,
      payload: {
        id: updated.id,
        user_id: updated.userId,
        category_id: updated.categoryId,
        period: updated.period,
        limit_paise: updated.limitPaise,
        expected_version: existing.version,
        version: updated.version,
        updated_at: updated.updatedAt.toISOString()
      },
      idempotencyKey: crypto.randomUUID()
    };

    await this.unitOfWork.run(async () => {
      await this.budgetRepo.save(updated);
      await this.syncPort.enqueue(outboxEntry);
    });

    return {
      id: updated.id,
      userId: updated.userId,
      categoryId: updated.categoryId,
      period: updated.period,
      limitPaise: updated.limitPaise,
      limitFormatted: formatPaiseToINR(updated.limitPaise),
      version: updated.version,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      limitInPaise: updated.limitPaise
    };
  }
}

import { BudgetRepository } from '@/domain/repositories/BudgetRepository';
import { SyncPort } from '@/application/ports/SyncPort';
import { UnitOfWork } from '@/application/ports/UnitOfWork';
import { createBudgetId, validateUserId } from '@/domain/value-objects/Identifiers';
import { UnauthorizedEntityAccessError } from '@/domain/errors/DomainErrors';
import { BudgetNotFoundError } from '@/domain/errors/BudgetErrors';

export class DeleteBudgetUseCase {
  constructor(
    private readonly budgetRepo: BudgetRepository,
    private readonly syncPort: SyncPort,
    private readonly unitOfWork: UnitOfWork
  ) {}

  public async execute(budgetIdStr: string, userIdStr: string): Promise<void> {
    const userId = validateUserId(userIdStr);
    const rawBudgetId = (budgetIdStr || '').trim();
    if (!rawBudgetId) {
      throw new BudgetNotFoundError(budgetIdStr ?? '');
    }
    const budgetId = createBudgetId(rawBudgetId);

    const existing = await this.budgetRepo.findById(budgetId, userId);
    if (!existing) {
      throw new BudgetNotFoundError(rawBudgetId);
    }
    if (existing.userId !== userId) {
      throw new UnauthorizedEntityAccessError('Budget', rawBudgetId);
    }

    const now = new Date();
    const targetVersion = existing.version + 1;

    // Preserves deletion intent in the transactional outbox for future cloud synchronization
    // while removing the local budget record so (userId, categoryId, period) can be recreated.
    const outboxEntry = {
      userId: existing.userId,
      entity: 'budgets' as const,
      entityId: budgetId,
      operation: 'DELETE' as const,
      payload: {
        id: budgetId,
        user_id: existing.userId,
        category_id: existing.categoryId,
        period: existing.period,
        expected_version: existing.version,
        version: targetVersion,
        deleted_at: now.toISOString()
      },
      idempotencyKey: crypto.randomUUID()
    };

    await this.unitOfWork.run(async () => {
      await this.budgetRepo.delete(budgetId, userId);
      await this.syncPort.enqueue(outboxEntry);
    });
  }
}

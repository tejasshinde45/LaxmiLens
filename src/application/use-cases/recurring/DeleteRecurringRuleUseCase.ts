import { RecurringRuleRepository } from '@/domain/repositories/RecurringRuleRepository';
import { SyncPort } from '@/application/ports/SyncPort';
import { UnitOfWork } from '@/application/ports/UnitOfWork';
import { DeleteRecurringRuleDTO } from '@/application/dto/RecurringDTO';
import { createRecurringRuleId, validateUserId } from '@/domain/value-objects/Identifiers';
import { UnauthorizedEntityAccessError } from '@/domain/errors/DomainErrors';
import { RecurringRuleNotFoundError } from '@/domain/errors/RecurringErrors';

export class DeleteRecurringRuleUseCase {
  constructor(
    private readonly recurringRuleRepo: RecurringRuleRepository,
    private readonly syncPort: SyncPort,
    private readonly unitOfWork: UnitOfWork
  ) {}

  public async execute(dto: DeleteRecurringRuleDTO): Promise<void> {
    const userId = validateUserId(dto.userId);
    const rawId = (dto.id || '').trim();
    if (!rawId) throw new RecurringRuleNotFoundError(dto.id ?? '');

    const rule = await this.recurringRuleRepo.findById(createRecurringRuleId(rawId), userId);
    if (!rule) throw new RecurringRuleNotFoundError(rawId);
    if (rule.userId !== userId) throw new UnauthorizedEntityAccessError('RecurringRule', rawId);

    const prevVersion = rule.version;
    const now = new Date();
    rule.markDeleted(now);

    await this.unitOfWork.run(async () => {
      await this.recurringRuleRepo.save(rule);
      await this.syncPort.enqueue({
        userId: rule.userId,
        entity: 'recurring_rules',
        entityId: rule.id,
        operation: 'DELETE',
        payload: {
          id: rule.id,
          user_id: rule.userId,
          deleted_at: rule.deletedAt?.toISOString() ?? now.toISOString(),
          expected_version: prevVersion,
          version: rule.version,
          updated_at: rule.updatedAt.toISOString()
        },
        idempotencyKey: crypto.randomUUID()
      });
    });
  }
}

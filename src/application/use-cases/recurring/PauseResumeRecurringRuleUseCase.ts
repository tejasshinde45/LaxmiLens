import { RecurringRuleRepository } from '@/domain/repositories/RecurringRuleRepository';
import { RecurringOccurrenceRepository } from '@/domain/repositories/RecurringOccurrenceRepository';
import { SyncPort } from '@/application/ports/SyncPort';
import { UnitOfWork } from '@/application/ports/UnitOfWork';
import { PauseResumeRecurringRuleDTO } from '@/application/dto/RecurringDTO';
import { RecurringRuleStatus } from '@/domain/entities/RecurringRule';
import { RecurringOccurrence } from '@/domain/entities/RecurringOccurrence';
import { buildRecurringOccurrenceIdempotencyKey } from '@/domain/services/RecurrenceScheduleService';
import {
  createRecurringOccurrenceId,
  createRecurringRuleId,
  validateUserId
} from '@/domain/value-objects/Identifiers';
import { UnauthorizedEntityAccessError } from '@/domain/errors/DomainErrors';
import { RecurringRuleNotFoundError } from '@/domain/errors/RecurringErrors';

export interface PauseResumeResultDTO {
  id: string;
  userId: string;
  status: RecurringRuleStatus;
  version: number;
  updatedAt: string;
}

export class PauseRecurringRuleUseCase {
  constructor(
    private readonly recurringRuleRepo: RecurringRuleRepository,
    private readonly syncPort: SyncPort,
    private readonly unitOfWork: UnitOfWork
  ) {}

  public async execute(dto: PauseResumeRecurringRuleDTO): Promise<PauseResumeResultDTO> {
    const userId = validateUserId(dto.userId);
    const rawId = (dto.id || '').trim();
    if (!rawId) throw new RecurringRuleNotFoundError(dto.id ?? '');

    const rule = await this.recurringRuleRepo.findById(createRecurringRuleId(rawId), userId);
    if (!rule) throw new RecurringRuleNotFoundError(rawId);
    if (rule.userId !== userId) throw new UnauthorizedEntityAccessError('RecurringRule', rawId);

    const prevVersion = rule.version;
    const now = new Date();
    rule.pause(now);

    if (rule.version !== prevVersion) {
      await this.unitOfWork.run(async () => {
        await this.recurringRuleRepo.save(rule);
        await this.syncPort.enqueue({
          userId: rule.userId,
          entity: 'recurring_rules',
          entityId: rule.id,
          operation: 'UPDATE',
          payload: {
            id: rule.id,
            user_id: rule.userId,
            status: rule.status,
            expected_version: prevVersion,
            version: rule.version,
            updated_at: rule.updatedAt.toISOString()
          },
          idempotencyKey: crypto.randomUUID()
        });
      });
    }

    return {
      id: rule.id,
      userId: rule.userId,
      status: rule.status,
      version: rule.version,
      updatedAt: rule.updatedAt.toISOString()
    };
  }
}

export class ResumeRecurringRuleUseCase {
  constructor(
    private readonly recurringRuleRepo: RecurringRuleRepository,
    private readonly recurringOccurrenceRepo: RecurringOccurrenceRepository,
    private readonly syncPort: SyncPort,
    private readonly unitOfWork: UnitOfWork
  ) {}

  public async execute(dto: PauseResumeRecurringRuleDTO): Promise<PauseResumeResultDTO> {
    const userId = validateUserId(dto.userId);
    const rawId = (dto.id || '').trim();
    if (!rawId) throw new RecurringRuleNotFoundError(dto.id ?? '');

    const rule = await this.recurringRuleRepo.findById(createRecurringRuleId(rawId), userId);
    if (!rule) throw new RecurringRuleNotFoundError(rawId);
    if (rule.userId !== userId) throw new UnauthorizedEntityAccessError('RecurringRule', rawId);

    const prevVersion = rule.version;
    const now = new Date();
    rule.resume(now);

    if (rule.version !== prevVersion) {
      await this.unitOfWork.run(async () => {
        await this.recurringRuleRepo.save(rule);
        await this.syncPort.enqueue({
          userId: rule.userId,
          entity: 'recurring_rules',
          entityId: rule.id,
          operation: 'UPDATE',
          payload: {
            id: rule.id,
            user_id: rule.userId,
            status: rule.status,
            expected_version: prevVersion,
            version: rule.version,
            updated_at: rule.updatedAt.toISOString()
          },
          idempotencyKey: crypto.randomUUID()
        });

        const existingOcc = await this.recurringOccurrenceRepo.findByRuleAndDate(
          rule.id,
          rule.nextDueDate,
          userId
        );
        if (!existingOcc) {
          const occ = new RecurringOccurrence({
            id: createRecurringOccurrenceId(crypto.randomUUID()),
            userId: rule.userId,
            recurringRuleId: rule.id,
            occurrenceDate: rule.nextDueDate,
            status: 'pending',
            idempotencyKey: buildRecurringOccurrenceIdempotencyKey(rule.id, rule.nextDueDate),
            version: 1,
            createdAt: now,
            updatedAt: now
          });
          await this.recurringOccurrenceRepo.save(occ);
          await this.syncPort.enqueue({
            userId: occ.userId,
            entity: 'recurring_occurrences',
            entityId: occ.id,
            operation: 'INSERT',
            payload: {
              id: occ.id,
              user_id: occ.userId,
              recurring_rule_id: occ.recurringRuleId,
              occurrence_date: occ.occurrenceDate,
              status: occ.status,
              snoozed_until_date: null,
              transaction_id: null,
              idempotency_key: occ.idempotencyKey,
              confirmed_at: null,
              skipped_at: null,
              dismissed_at: null,
              version: occ.version,
              created_at: occ.createdAt.toISOString(),
              updated_at: occ.updatedAt.toISOString(),
              deleted_at: null
            },
            idempotencyKey: crypto.randomUUID()
          });
        }
      });
    }

    return {
      id: rule.id,
      userId: rule.userId,
      status: rule.status,
      version: rule.version,
      updatedAt: rule.updatedAt.toISOString()
    };
  }
}

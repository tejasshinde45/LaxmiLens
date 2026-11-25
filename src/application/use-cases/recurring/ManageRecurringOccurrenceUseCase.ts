import { RecurringRuleRepository } from '@/domain/repositories/RecurringRuleRepository';
import { RecurringOccurrenceRepository } from '@/domain/repositories/RecurringOccurrenceRepository';
import { SyncPort } from '@/application/ports/SyncPort';
import { UnitOfWork } from '@/application/ports/UnitOfWork';
import {
  SkipRecurringOccurrenceDTO,
  SnoozeRecurringOccurrenceDTO,
  DismissRecurringOccurrenceDTO
} from '@/application/dto/RecurringDTO';
import { RecurringOccurrence } from '@/domain/entities/RecurringOccurrence';
import { RecurringRuleStatus } from '@/domain/entities/RecurringRule';
import {
  buildRecurringOccurrenceIdempotencyKey,
  compareLocalDates,
  getLocalTodayDateString,
  parseLocalCalendarDate
} from '@/domain/services/RecurrenceScheduleService';
import {
  createRecurringOccurrenceId,
  createRecurringRuleId,
  validateUserId
} from '@/domain/value-objects/Identifiers';
import { UnauthorizedEntityAccessError } from '@/domain/errors/DomainErrors';
import {
  InvalidRecurrenceScheduleError,
  RecurringOccurrenceAlreadyResolvedError,
  RecurringOccurrenceNotFoundError,
  RecurringRuleNotActiveError,
  RecurringRuleNotFoundError
} from '@/domain/errors/RecurringErrors';

export interface OccurrenceLifecycleResultDTO {
  occurrenceId: string;
  recurringRuleId: string;
  occurrenceDate: string;
  status: string;
  snoozedUntilDate: string | null;
  nextDueDate: string;
  ruleStatus: RecurringRuleStatus;
}

async function resolveTargetOccurrence(
  recurringOccurrenceRepo: RecurringOccurrenceRepository,
  ruleId: string,
  normalizedDate: string,
  userId: ReturnType<typeof validateUserId>,
  occurrenceId?: string
): Promise<{ occurrence: RecurringOccurrence; isNew: boolean; expectedVersion?: number }> {
  if (occurrenceId && occurrenceId.trim().length > 0) {
    const existing = await recurringOccurrenceRepo.findById(
      createRecurringOccurrenceId(occurrenceId.trim()),
      userId
    );
    if (!existing) {
      throw new RecurringOccurrenceNotFoundError(occurrenceId);
    }
    if (existing.userId !== userId) {
      throw new UnauthorizedEntityAccessError('RecurringOccurrence', occurrenceId);
    }
    return { occurrence: existing, isNew: false, expectedVersion: existing.version };
  }

  const bySlot = await recurringOccurrenceRepo.findByRuleAndDate(
    createRecurringRuleId(ruleId),
    normalizedDate,
    userId
  );
  if (bySlot) {
    return { occurrence: bySlot, isNew: false, expectedVersion: bySlot.version };
  }

  const now = new Date();
  const created = new RecurringOccurrence({
    id: createRecurringOccurrenceId(crypto.randomUUID()),
    userId,
    recurringRuleId: createRecurringRuleId(ruleId),
    occurrenceDate: normalizedDate,
    status: 'pending',
    idempotencyKey: buildRecurringOccurrenceIdempotencyKey(ruleId, normalizedDate),
    version: 1,
    createdAt: now,
    updatedAt: now
  });
  return { occurrence: created, isNew: true };
}

function buildOccurrenceOutboxPayload(occ: RecurringOccurrence, expectedVersion?: number) {
  return {
    id: occ.id,
    user_id: occ.userId,
    recurring_rule_id: occ.recurringRuleId,
    occurrence_date: occ.occurrenceDate,
    status: occ.status,
    snoozed_until_date: occ.snoozedUntilDate,
    transaction_id: occ.transactionId,
    idempotency_key: occ.idempotencyKey,
    confirmed_at: occ.confirmedAt ? occ.confirmedAt.toISOString() : null,
    skipped_at: occ.skippedAt ? occ.skippedAt.toISOString() : null,
    dismissed_at: occ.dismissedAt ? occ.dismissedAt.toISOString() : null,
    ...(expectedVersion !== undefined ? { expected_version: expectedVersion } : {}),
    version: occ.version,
    created_at: occ.createdAt.toISOString(),
    updated_at: occ.updatedAt.toISOString(),
    deleted_at: null
  };
}

export class SkipRecurringOccurrenceUseCase {
  constructor(
    private readonly recurringRuleRepo: RecurringRuleRepository,
    private readonly recurringOccurrenceRepo: RecurringOccurrenceRepository,
    private readonly syncPort: SyncPort,
    private readonly unitOfWork: UnitOfWork
  ) {}

  public async execute(dto: SkipRecurringOccurrenceDTO): Promise<OccurrenceLifecycleResultDTO> {
    const userId = validateUserId(dto.userId);
    const ruleIdStr = (dto.recurringRuleId || '').trim();
    if (!ruleIdStr) throw new RecurringRuleNotFoundError(dto.recurringRuleId ?? '');
    const normalizedDate = parseLocalCalendarDate(dto.occurrenceDate).normalized;

    return await this.unitOfWork.run(async () => {
      const rule = await this.recurringRuleRepo.findById(createRecurringRuleId(ruleIdStr), userId);
      if (!rule) throw new RecurringRuleNotFoundError(ruleIdStr);
      if (rule.userId !== userId) throw new UnauthorizedEntityAccessError('RecurringRule', ruleIdStr);
      if (rule.status !== 'active') throw new RecurringRuleNotActiveError(rule.status);

      const resolved = await resolveTargetOccurrence(
        this.recurringOccurrenceRepo,
        rule.id,
        normalizedDate,
        userId,
        dto.occurrenceId
      );
      if (resolved.occurrence.recurringRuleId !== rule.id) {
        throw new InvalidRecurrenceScheduleError('Occurrence does not belong to specified recurring schedule.');
      }
      if (!resolved.occurrence.isActionable) {
        throw new RecurringOccurrenceAlreadyResolvedError(resolved.occurrence.status);
      }

      const now = new Date();
      resolved.occurrence.skip(now);
      const prevRuleVersion = rule.version;
      rule.advanceAfterOccurrence(resolved.occurrence.occurrenceDate, false, now);

      await this.recurringOccurrenceRepo.save(resolved.occurrence);
      await this.syncPort.enqueue({
        userId: resolved.occurrence.userId,
        entity: 'recurring_occurrences',
        entityId: resolved.occurrence.id,
        operation: resolved.isNew ? 'INSERT' : 'UPDATE',
        payload: buildOccurrenceOutboxPayload(resolved.occurrence, resolved.expectedVersion),
        idempotencyKey: crypto.randomUUID()
      });

      await this.recurringRuleRepo.save(rule);
      await this.syncPort.enqueue({
        userId: rule.userId,
        entity: 'recurring_rules',
        entityId: rule.id,
        operation: 'UPDATE',
        payload: {
          id: rule.id,
          user_id: rule.userId,
          next_due_date: rule.nextDueDate,
          last_generated_date: rule.lastGeneratedDate,
          status: rule.status,
          expected_version: prevRuleVersion,
          version: rule.version,
          updated_at: rule.updatedAt.toISOString()
        },
        idempotencyKey: crypto.randomUUID()
      });

      if (rule.status === 'active') {
        const nextOcc = await this.recurringOccurrenceRepo.findByRuleAndDate(
          rule.id,
          rule.nextDueDate,
          userId
        );
        if (!nextOcc) {
          const pendingNext = new RecurringOccurrence({
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
          await this.recurringOccurrenceRepo.save(pendingNext);
          await this.syncPort.enqueue({
            userId: pendingNext.userId,
            entity: 'recurring_occurrences',
            entityId: pendingNext.id,
            operation: 'INSERT',
            payload: buildOccurrenceOutboxPayload(pendingNext),
            idempotencyKey: crypto.randomUUID()
          });
        }
      }

      return {
        occurrenceId: resolved.occurrence.id,
        recurringRuleId: rule.id,
        occurrenceDate: resolved.occurrence.occurrenceDate,
        status: resolved.occurrence.status,
        snoozedUntilDate: resolved.occurrence.snoozedUntilDate,
        nextDueDate: rule.nextDueDate,
        ruleStatus: rule.status
      };
    });
  }
}

export class SnoozeRecurringOccurrenceUseCase {
  constructor(
    private readonly recurringRuleRepo: RecurringRuleRepository,
    private readonly recurringOccurrenceRepo: RecurringOccurrenceRepository,
    private readonly syncPort: SyncPort,
    private readonly unitOfWork: UnitOfWork
  ) {}

  public async execute(dto: SnoozeRecurringOccurrenceDTO): Promise<OccurrenceLifecycleResultDTO> {
    const userId = validateUserId(dto.userId);
    const ruleIdStr = (dto.recurringRuleId || '').trim();
    if (!ruleIdStr) throw new RecurringRuleNotFoundError(dto.recurringRuleId ?? '');
    const normalizedDate = parseLocalCalendarDate(dto.occurrenceDate).normalized;
    const normalizedSnooze = parseLocalCalendarDate(dto.snoozeUntilDate).normalized;
    const todayStr = getLocalTodayDateString();

    if (compareLocalDates(normalizedSnooze, todayStr) < 0) {
      throw new InvalidRecurrenceScheduleError(
        `Snooze date '${normalizedSnooze}' cannot be earlier than today (${todayStr}).`
      );
    }

    return await this.unitOfWork.run(async () => {
      const rule = await this.recurringRuleRepo.findById(createRecurringRuleId(ruleIdStr), userId);
      if (!rule) throw new RecurringRuleNotFoundError(ruleIdStr);
      if (rule.userId !== userId) throw new UnauthorizedEntityAccessError('RecurringRule', ruleIdStr);
      if (rule.status !== 'active') throw new RecurringRuleNotActiveError(rule.status);

      const resolved = await resolveTargetOccurrence(
        this.recurringOccurrenceRepo,
        rule.id,
        normalizedDate,
        userId,
        dto.occurrenceId
      );
      if (resolved.occurrence.recurringRuleId !== rule.id) {
        throw new InvalidRecurrenceScheduleError('Occurrence does not belong to specified recurring schedule.');
      }
      if (!resolved.occurrence.isActionable) {
        throw new RecurringOccurrenceAlreadyResolvedError(resolved.occurrence.status);
      }

      const now = new Date();
      resolved.occurrence.snooze(normalizedSnooze, now);

      await this.recurringOccurrenceRepo.save(resolved.occurrence);
      await this.syncPort.enqueue({
        userId: resolved.occurrence.userId,
        entity: 'recurring_occurrences',
        entityId: resolved.occurrence.id,
        operation: resolved.isNew ? 'INSERT' : 'UPDATE',
        payload: buildOccurrenceOutboxPayload(resolved.occurrence, resolved.expectedVersion),
        idempotencyKey: crypto.randomUUID()
      });

      return {
        occurrenceId: resolved.occurrence.id,
        recurringRuleId: rule.id,
        occurrenceDate: resolved.occurrence.occurrenceDate,
        status: resolved.occurrence.status,
        snoozedUntilDate: resolved.occurrence.snoozedUntilDate,
        nextDueDate: rule.nextDueDate,
        ruleStatus: rule.status
      };
    });
  }
}

export class DismissRecurringOccurrenceUseCase {
  constructor(
    private readonly recurringRuleRepo: RecurringRuleRepository,
    private readonly recurringOccurrenceRepo: RecurringOccurrenceRepository,
    private readonly syncPort: SyncPort,
    private readonly unitOfWork: UnitOfWork
  ) {}

  public async execute(dto: DismissRecurringOccurrenceDTO): Promise<OccurrenceLifecycleResultDTO> {
    const userId = validateUserId(dto.userId);
    const ruleIdStr = (dto.recurringRuleId || '').trim();
    if (!ruleIdStr) throw new RecurringRuleNotFoundError(dto.recurringRuleId ?? '');
    const normalizedDate = parseLocalCalendarDate(dto.occurrenceDate).normalized;

    return await this.unitOfWork.run(async () => {
      const rule = await this.recurringRuleRepo.findById(createRecurringRuleId(ruleIdStr), userId);
      if (!rule) throw new RecurringRuleNotFoundError(ruleIdStr);
      if (rule.userId !== userId) throw new UnauthorizedEntityAccessError('RecurringRule', ruleIdStr);
      if (rule.status !== 'active') throw new RecurringRuleNotActiveError(rule.status);

      const resolved = await resolveTargetOccurrence(
        this.recurringOccurrenceRepo,
        rule.id,
        normalizedDate,
        userId,
        dto.occurrenceId
      );
      if (resolved.occurrence.recurringRuleId !== rule.id) {
        throw new InvalidRecurrenceScheduleError('Occurrence does not belong to specified recurring schedule.');
      }
      if (!resolved.occurrence.isActionable) {
        throw new RecurringOccurrenceAlreadyResolvedError(resolved.occurrence.status);
      }

      const now = new Date();
      resolved.occurrence.dismiss(now);
      const prevRuleVersion = rule.version;
      rule.advanceAfterOccurrence(resolved.occurrence.occurrenceDate, false, now);

      await this.recurringOccurrenceRepo.save(resolved.occurrence);
      await this.syncPort.enqueue({
        userId: resolved.occurrence.userId,
        entity: 'recurring_occurrences',
        entityId: resolved.occurrence.id,
        operation: resolved.isNew ? 'INSERT' : 'UPDATE',
        payload: buildOccurrenceOutboxPayload(resolved.occurrence, resolved.expectedVersion),
        idempotencyKey: crypto.randomUUID()
      });

      await this.recurringRuleRepo.save(rule);
      await this.syncPort.enqueue({
        userId: rule.userId,
        entity: 'recurring_rules',
        entityId: rule.id,
        operation: 'UPDATE',
        payload: {
          id: rule.id,
          user_id: rule.userId,
          next_due_date: rule.nextDueDate,
          last_generated_date: rule.lastGeneratedDate,
          status: rule.status,
          expected_version: prevRuleVersion,
          version: rule.version,
          updated_at: rule.updatedAt.toISOString()
        },
        idempotencyKey: crypto.randomUUID()
      });

      if (rule.status === 'active') {
        const nextOcc = await this.recurringOccurrenceRepo.findByRuleAndDate(
          rule.id,
          rule.nextDueDate,
          userId
        );
        if (!nextOcc) {
          const pendingNext = new RecurringOccurrence({
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
          await this.recurringOccurrenceRepo.save(pendingNext);
          await this.syncPort.enqueue({
            userId: pendingNext.userId,
            entity: 'recurring_occurrences',
            entityId: pendingNext.id,
            operation: 'INSERT',
            payload: buildOccurrenceOutboxPayload(pendingNext),
            idempotencyKey: crypto.randomUUID()
          });
        }
      }

      return {
        occurrenceId: resolved.occurrence.id,
        recurringRuleId: rule.id,
        occurrenceDate: resolved.occurrence.occurrenceDate,
        status: resolved.occurrence.status,
        snoozedUntilDate: resolved.occurrence.snoozedUntilDate,
        nextDueDate: rule.nextDueDate,
        ruleStatus: rule.status
      };
    });
  }
}

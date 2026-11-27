import { RecurringRuleRepository } from '@/domain/repositories/RecurringRuleRepository';
import { RecurringOccurrenceRepository } from '@/domain/repositories/RecurringOccurrenceRepository';
import { TransactionRepository } from '@/domain/repositories/TransactionRepository';
import { CreateTransactionUseCase } from '@/application/use-cases/transactions/CreateTransactionUseCase';
import { SyncPort } from '@/application/ports/SyncPort';
import { UnitOfWork } from '@/application/ports/UnitOfWork';
import {
  ConfirmRecurringOccurrenceDTO,
  ConfirmRecurringOccurrenceResultDTO
} from '@/application/dto/RecurringDTO';
import { RecurringOccurrence } from '@/domain/entities/RecurringOccurrence';
import {
  buildRecurringOccurrenceIdempotencyKey,
  parseLocalCalendarDate,
  toLocalTransactionIsoTimestamp
} from '@/domain/services/RecurrenceScheduleService';
import {
  createRecurringOccurrenceId,
  createRecurringRuleId,
  createTransactionId,
  validateUserId
} from '@/domain/value-objects/Identifiers';
import { UnauthorizedEntityAccessError } from '@/domain/errors/DomainErrors';
import { normalizeOptionalText } from '@/utils/textNormalization';
import {
  InvalidRecurrenceScheduleError,
  RecurringOccurrenceAlreadyResolvedError,
  RecurringOccurrenceNotFoundError,
  RecurringRuleNotActiveError,
  RecurringRuleNotFoundError
} from '@/domain/errors/RecurringErrors';

/**
 * Explicitly confirms a pending/snoozed recurring payment occurrence and generates
 * the actual ledger transaction via CreateTransactionUseCase inside an atomic UnitOfWork.
 * Never runs automatically on read; enforces strict (rule, occurrenceDate) idempotency.
 */
export class ConfirmRecurringOccurrenceUseCase {
  constructor(
    private readonly recurringRuleRepo: RecurringRuleRepository,
    private readonly recurringOccurrenceRepo: RecurringOccurrenceRepository,
    private readonly transactionRepo: TransactionRepository,
    private readonly createTransactionUseCase: CreateTransactionUseCase,
    private readonly syncPort: SyncPort,
    private readonly unitOfWork: UnitOfWork
  ) {}

  public async execute(
    dto: ConfirmRecurringOccurrenceDTO
  ): Promise<ConfirmRecurringOccurrenceResultDTO> {
    const userId = validateUserId(dto.userId);
    const ruleIdStr = (dto.recurringRuleId || '').trim();
    if (!ruleIdStr) {
      throw new RecurringRuleNotFoundError(dto.recurringRuleId ?? '');
    }
    const normalizedDate = parseLocalCalendarDate(dto.occurrenceDate).normalized;

    return await this.unitOfWork.run(async () => {
      const rule = await this.recurringRuleRepo.findById(createRecurringRuleId(ruleIdStr), userId);
      if (!rule) {
        throw new RecurringRuleNotFoundError(ruleIdStr);
      }
      if (rule.userId !== userId) {
        throw new UnauthorizedEntityAccessError('RecurringRule', ruleIdStr);
      }

      let occ: RecurringOccurrence | null = null;
      let isNewOccurrence = false;
      let expectedOccurrenceVersion: number | undefined;

      if (dto.occurrenceId && dto.occurrenceId.trim().length > 0) {
        occ = await this.recurringOccurrenceRepo.findById(
          createRecurringOccurrenceId(dto.occurrenceId.trim()),
          userId
        );
        if (!occ) {
          throw new RecurringOccurrenceNotFoundError(dto.occurrenceId);
        }
        if (occ.userId !== userId) {
          throw new UnauthorizedEntityAccessError('RecurringOccurrence', dto.occurrenceId);
        }
        if (occ.recurringRuleId !== rule.id) {
          throw new InvalidRecurrenceScheduleError(
            'Occurrence does not belong to specified recurring schedule.'
          );
        }
        expectedOccurrenceVersion = occ.version;
      } else {
        occ = await this.recurringOccurrenceRepo.findByRuleAndDate(rule.id, normalizedDate, userId);
        if (occ) {
          expectedOccurrenceVersion = occ.version;
        }
      }

      // Idempotent short-circuit if already confirmed
      if (occ && occ.status === 'confirmed' && occ.transactionId) {
        return {
          occurrenceId: occ.id,
          recurringRuleId: rule.id,
          occurrenceDate: occ.occurrenceDate,
          transactionId: occ.transactionId,
          alreadyConfirmed: true,
          nextDueDate: rule.nextDueDate,
          ruleStatus: rule.status
        };
      }

      if (occ && !occ.isActionable) {
        throw new RecurringOccurrenceAlreadyResolvedError(occ.status);
      }

      if (rule.status !== 'active') {
        throw new RecurringRuleNotActiveError(rule.status);
      }

      const now = new Date();
      if (!occ) {
        occ = new RecurringOccurrence({
          id: createRecurringOccurrenceId(crypto.randomUUID()),
          userId: rule.userId,
          recurringRuleId: rule.id,
          occurrenceDate: normalizedDate,
          status: 'pending',
          idempotencyKey: buildRecurringOccurrenceIdempotencyKey(rule.id, normalizedDate),
          version: 1,
          createdAt: now,
          updatedAt: now
        });
        isNewOccurrence = true;
      }

      // Guard against duplicate transaction creation for same (rule, occurrenceDate) idempotency key
      const existingLedgerTx = await this.transactionRepo.findByIdempotencyKey(
        occ.idempotencyKey,
        userId
      );

      let generatedTransactionId: string;
      let alreadyConfirmed = false;

      if (existingLedgerTx) {
        generatedTransactionId = existingLedgerTx.id;
        alreadyConfirmed = true;
      } else {
        const createdTx = await this.createTransactionUseCase.execute({
          userId: rule.userId,
          type: rule.type,
          amountPaise: rule.amount.paise,
          currency: rule.amount.currency,
          accountId: rule.accountId,
          categoryId: rule.categoryId,
          title: dto.overrideTitle?.trim() || rule.title,
          note: normalizeOptionalText(
            dto.overrideNote !== undefined ? dto.overrideNote : rule.description
          ),
          transactionDate: toLocalTransactionIsoTimestamp(occ.occurrenceDate),
          idempotencyKey: occ.idempotencyKey
        });
        generatedTransactionId = createdTx.id;
      }

      occ.confirm(createTransactionId(generatedTransactionId), now);
      await this.recurringOccurrenceRepo.save(occ);
      await this.syncPort.enqueue({
        userId: occ.userId,
        entity: 'recurring_occurrences',
        entityId: occ.id,
        operation: isNewOccurrence ? 'INSERT' : 'UPDATE',
        payload: {
          id: occ.id,
          user_id: occ.userId,
          recurring_rule_id: occ.recurringRuleId,
          occurrence_date: occ.occurrenceDate,
          status: occ.status,
          snoozed_until_date: null,
          transaction_id: occ.transactionId,
          idempotency_key: occ.idempotencyKey,
          confirmed_at: occ.confirmedAt?.toISOString() ?? now.toISOString(),
          skipped_at: null,
          dismissed_at: null,
          ...(expectedOccurrenceVersion !== undefined
            ? { expected_version: expectedOccurrenceVersion }
            : {}),
          version: occ.version,
          created_at: occ.createdAt.toISOString(),
          updated_at: occ.updatedAt.toISOString(),
          deleted_at: null
        },
        idempotencyKey: crypto.randomUUID()
      });

      const prevRuleVersion = rule.version;
      rule.advanceAfterOccurrence(occ.occurrenceDate, true, now);
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

      // Pre-create next pending occurrence if schedule remains active and next slot isn't already tracked
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
            payload: {
              id: pendingNext.id,
              user_id: pendingNext.userId,
              recurring_rule_id: pendingNext.recurringRuleId,
              occurrence_date: pendingNext.occurrenceDate,
              status: pendingNext.status,
              snoozed_until_date: null,
              transaction_id: null,
              idempotency_key: pendingNext.idempotencyKey,
              confirmed_at: null,
              skipped_at: null,
              dismissed_at: null,
              version: pendingNext.version,
              created_at: pendingNext.createdAt.toISOString(),
              updated_at: pendingNext.updatedAt.toISOString(),
              deleted_at: null
            },
            idempotencyKey: crypto.randomUUID()
          });
        }
      }

      return {
        occurrenceId: occ.id,
        recurringRuleId: rule.id,
        occurrenceDate: occ.occurrenceDate,
        transactionId: generatedTransactionId,
        alreadyConfirmed,
        nextDueDate: rule.nextDueDate,
        ruleStatus: rule.status
      };
    });
  }
}

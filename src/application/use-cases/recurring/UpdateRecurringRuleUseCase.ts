import { RecurringRuleRepository } from '@/domain/repositories/RecurringRuleRepository';
import { RecurringOccurrenceRepository } from '@/domain/repositories/RecurringOccurrenceRepository';
import { AccountRepository } from '@/domain/repositories/AccountRepository';
import { CategoryRepository } from '@/domain/repositories/CategoryRepository';
import { SyncPort } from '@/application/ports/SyncPort';
import { UnitOfWork } from '@/application/ports/UnitOfWork';
import { UpdateRecurringRuleDTO, RecurringRuleResponseDTO } from '@/application/dto/RecurringDTO';
import { RecurringOccurrence } from '@/domain/entities/RecurringOccurrence';
import { Money } from '@/domain/value-objects/Money';
import {
  addDaysToLocalDate,
  buildRecurringOccurrenceIdempotencyKey,
  getLocalTodayDateString,
  previewUpcomingScheduleDates
} from '@/domain/services/RecurrenceScheduleService';
import {
  createAccountId,
  createCategoryId,
  createRecurringOccurrenceId,
  createRecurringRuleId,
  validateUserId
} from '@/domain/value-objects/Identifiers';
import {
  AccountNotFoundError,
  CategoryArchivedError,
  CategoryNotFoundError,
  CategoryTypeMismatchError,
  UnauthorizedEntityAccessError
} from '@/domain/errors/DomainErrors';
import {
  InvalidRecurrenceScheduleError,
  RecurringRuleNotFoundError
} from '@/domain/errors/RecurringErrors';
import { formatPaiseToINR } from '@/utils/formatters';

export class UpdateRecurringRuleUseCase {
  constructor(
    private readonly recurringRuleRepo: RecurringRuleRepository,
    private readonly recurringOccurrenceRepo: RecurringOccurrenceRepository,
    private readonly accountRepo: AccountRepository,
    private readonly categoryRepo: CategoryRepository,
    private readonly syncPort: SyncPort,
    private readonly unitOfWork: UnitOfWork
  ) {}

  public async execute(dto: UpdateRecurringRuleDTO): Promise<RecurringRuleResponseDTO> {
    const userId = validateUserId(dto.userId);
    const rawId = (dto.id || '').trim();
    if (!rawId) {
      throw new RecurringRuleNotFoundError(dto.id ?? '');
    }
    const ruleId = createRecurringRuleId(rawId);

    const rule = await this.recurringRuleRepo.findById(ruleId, userId);
    if (!rule) {
      throw new RecurringRuleNotFoundError(rawId);
    }
    if (rule.userId !== userId) {
      throw new UnauthorizedEntityAccessError('RecurringRule', rawId);
    }

    if (dto.amountPaise !== undefined) {
      if (
        typeof dto.amountPaise !== 'number' ||
        !Number.isSafeInteger(dto.amountPaise) ||
        dto.amountPaise <= 0
      ) {
        throw new InvalidRecurrenceScheduleError(
          'Recurring amount must be a strictly positive integer in paise.'
        );
      }
    }

    const nextAccountId =
      dto.accountId !== undefined ? createAccountId(dto.accountId.trim()) : rule.accountId;
    const account = await this.accountRepo.findById(nextAccountId, userId);
    if (!account) {
      throw new AccountNotFoundError(nextAccountId);
    }
    if (account.userId !== userId) {
      throw new UnauthorizedEntityAccessError('Account', nextAccountId);
    }
    if (dto.accountId !== undefined && account.isArchived) {
      throw new InvalidRecurrenceScheduleError(
        `Account '${nextAccountId}' is archived and cannot be selected.`
      );
    }

    let resolvedCategoryId = rule.categoryId;
    let categoryName: string | undefined;
    let categoryIcon: string | undefined;
    let categoryColor: string | undefined;

    if (dto.categoryId === null || dto.categoryId === '') {
      resolvedCategoryId = undefined;
    } else if (dto.categoryId !== undefined) {
      resolvedCategoryId = createCategoryId(dto.categoryId.trim());
    }

    if (resolvedCategoryId) {
      const category = await this.categoryRepo.findById(resolvedCategoryId, userId);
      if (!category) {
        throw new CategoryNotFoundError(resolvedCategoryId);
      }
      if (category.userId !== userId) {
        throw new UnauthorizedEntityAccessError('Category', resolvedCategoryId);
      }
      if (dto.categoryId !== undefined && category.isArchived) {
        throw new CategoryArchivedError(resolvedCategoryId);
      }
      if (category.type !== rule.type) {
        throw new CategoryTypeMismatchError(rule.type, category.type);
      }
      categoryName = category.name;
      categoryIcon = category.icon;
      categoryColor = category.color;
    }

    const previousVersion = rule.version;
    const previousNextDueDate = rule.nextDueDate;
    const now = new Date();

    rule.updateSchedule({
      title: dto.title,
      description: dto.description,
      amount: dto.amountPaise !== undefined ? Money.fromPaise(dto.amountPaise, 'INR') : undefined,
      accountId: nextAccountId,
      categoryId: dto.categoryId === undefined ? undefined : resolvedCategoryId ?? null,
      frequency: dto.frequency,
      interval: dto.interval,
      endDate: dto.endDate,
      nextDueDate: dto.nextDueDate,
      now
    });

    const outboxRule = {
      userId: rule.userId,
      entity: 'recurring_rules' as const,
      entityId: rule.id,
      operation: 'UPDATE' as const,
      payload: {
        id: rule.id,
        user_id: rule.userId,
        title: rule.title,
        description: rule.description ?? null,
        type: rule.type,
        amount_paise: rule.amount.paise,
        account_id: rule.accountId,
        category_id: rule.categoryId ?? null,
        frequency: rule.frequency,
        interval: rule.interval,
        anchor_day_of_month: rule.anchorDayOfMonth,
        start_date: rule.startDate,
        end_date: rule.endDate,
        next_due_date: rule.nextDueDate,
        last_generated_date: rule.lastGeneratedDate,
        status: rule.status,
        requires_user_confirmation: rule.requiresUserConfirmation,
        expected_version: previousVersion,
        version: rule.version,
        updated_at: rule.updatedAt.toISOString()
      },
      idempotencyKey: crypto.randomUUID()
    };

    await this.unitOfWork.run(async () => {
      await this.recurringRuleRepo.save(rule);
      await this.syncPort.enqueue(outboxRule);

      if (rule.nextDueDate !== previousNextDueDate) {
        const oldOcc = await this.recurringOccurrenceRepo.findByRuleAndDate(
          rule.id,
          previousNextDueDate,
          userId
        );
        if (oldOcc && oldOcc.status === 'pending') {
          const oldVer = oldOcc.version;
          oldOcc.dismiss(now);
          await this.recurringOccurrenceRepo.save(oldOcc);
          await this.syncPort.enqueue({
            userId: oldOcc.userId,
            entity: 'recurring_occurrences',
            entityId: oldOcc.id,
            operation: 'UPDATE',
            payload: {
              id: oldOcc.id,
              user_id: oldOcc.userId,
              recurring_rule_id: oldOcc.recurringRuleId,
              occurrence_date: oldOcc.occurrenceDate,
              status: oldOcc.status,
              snoozed_until_date: null,
              transaction_id: null,
              dismissed_at: oldOcc.dismissedAt?.toISOString() ?? null,
              expected_version: oldVer,
              version: oldOcc.version,
              updated_at: oldOcc.updatedAt.toISOString()
            },
            idempotencyKey: crypto.randomUUID()
          });
        }

        if (rule.status === 'active') {
          const existingNext = await this.recurringOccurrenceRepo.findByRuleAndDate(
            rule.id,
            rule.nextDueDate,
            userId
          );
          if (!existingNext) {
            const newOcc = new RecurringOccurrence({
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
            await this.recurringOccurrenceRepo.save(newOcc);
            await this.syncPort.enqueue({
              userId: newOcc.userId,
              entity: 'recurring_occurrences',
              entityId: newOcc.id,
              operation: 'INSERT',
              payload: {
                id: newOcc.id,
                user_id: newOcc.userId,
                recurring_rule_id: newOcc.recurringRuleId,
                occurrence_date: newOcc.occurrenceDate,
                status: newOcc.status,
                snoozed_until_date: null,
                transaction_id: null,
                idempotency_key: newOcc.idempotencyKey,
                confirmed_at: null,
                skipped_at: null,
                dismissed_at: null,
                version: newOcc.version,
                created_at: newOcc.createdAt.toISOString(),
                updated_at: newOcc.updatedAt.toISOString(),
                deleted_at: null
              },
              idempotencyKey: crypto.randomUUID()
            });
          }
        }
      }
    });

    const horizonEnd = addDaysToLocalDate(getLocalTodayDateString(now), 90);
    return {
      id: rule.id,
      userId: rule.userId,
      title: rule.title,
      description: rule.description,
      type: rule.type,
      amountPaise: rule.amount.paise,
      amountFormatted: formatPaiseToINR(rule.amount.paise),
      accountId: rule.accountId,
      accountName: account.name,
      categoryId: rule.categoryId,
      categoryName,
      categoryIcon,
      categoryColor,
      frequency: rule.frequency,
      interval: rule.interval,
      anchorDayOfMonth: rule.anchorDayOfMonth,
      startDate: rule.startDate,
      endDate: rule.endDate,
      nextDueDate: rule.nextDueDate,
      lastGeneratedDate: rule.lastGeneratedDate,
      status: rule.status,
      requiresUserConfirmation: rule.requiresUserConfirmation,
      previewDates:
        rule.status === 'active'
          ? previewUpcomingScheduleDates({
              nextDueDate: rule.nextDueDate,
              endDate: rule.endDate,
              frequency: rule.frequency,
              interval: rule.interval,
              anchorDay: rule.anchorDayOfMonth,
              horizonEndDate: horizonEnd,
              maxCount: 6
            })
          : [],
      version: rule.version,
      createdAt: rule.createdAt.toISOString(),
      updatedAt: rule.updatedAt.toISOString()
    };
  }
}

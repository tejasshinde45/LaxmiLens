import { RecurringRuleRepository } from '@/domain/repositories/RecurringRuleRepository';
import { RecurringOccurrenceRepository } from '@/domain/repositories/RecurringOccurrenceRepository';
import { AccountRepository } from '@/domain/repositories/AccountRepository';
import { CategoryRepository } from '@/domain/repositories/CategoryRepository';
import { SyncPort } from '@/application/ports/SyncPort';
import { UnitOfWork } from '@/application/ports/UnitOfWork';
import { CreateRecurringRuleDTO, RecurringRuleResponseDTO } from '@/application/dto/RecurringDTO';
import { RecurringRule } from '@/domain/entities/RecurringRule';
import { RecurringOccurrence } from '@/domain/entities/RecurringOccurrence';
import { Money } from '@/domain/value-objects/Money';
import {
  buildRecurringOccurrenceIdempotencyKey,
  previewUpcomingScheduleDates,
  addDaysToLocalDate,
  getLocalTodayDateString
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
import { InvalidRecurrenceScheduleError } from '@/domain/errors/RecurringErrors';
import { formatPaiseToINR } from '@/utils/formatters';

export class CreateRecurringRuleUseCase {
  constructor(
    private readonly recurringRuleRepo: RecurringRuleRepository,
    private readonly recurringOccurrenceRepo: RecurringOccurrenceRepository,
    private readonly accountRepo: AccountRepository,
    private readonly categoryRepo: CategoryRepository,
    private readonly syncPort: SyncPort,
    private readonly unitOfWork: UnitOfWork
  ) {}

  public async execute(dto: CreateRecurringRuleDTO): Promise<RecurringRuleResponseDTO> {
    const userId = validateUserId(dto.userId);

    if (
      typeof dto.amountPaise !== 'number' ||
      !Number.isSafeInteger(dto.amountPaise) ||
      dto.amountPaise <= 0
    ) {
      throw new InvalidRecurrenceScheduleError(
        'Recurring amount must be a strictly positive integer in paise.'
      );
    }

    const rawAccountId = (dto.accountId || '').trim();
    if (!rawAccountId) {
      throw new AccountNotFoundError(dto.accountId ?? '');
    }
    const accountId = createAccountId(rawAccountId);
    const account = await this.accountRepo.findById(accountId, userId);
    if (!account) {
      throw new AccountNotFoundError(rawAccountId);
    }
    if (account.userId !== userId) {
      throw new UnauthorizedEntityAccessError('Account', rawAccountId);
    }
    if (account.isArchived) {
      throw new InvalidRecurrenceScheduleError(
        `Account '${rawAccountId}' is archived and cannot be used for new recurring schedules.`
      );
    }

    let categoryName: string | undefined;
    let categoryIcon: string | undefined;
    let categoryColor: string | undefined;
    let resolvedCategoryId = undefined;

    if (dto.categoryId && dto.categoryId.trim().length > 0) {
      const catId = createCategoryId(dto.categoryId.trim());
      const category = await this.categoryRepo.findById(catId, userId);
      if (!category) {
        throw new CategoryNotFoundError(catId);
      }
      if (category.userId !== userId) {
        throw new UnauthorizedEntityAccessError('Category', catId);
      }
      if (category.isArchived) {
        throw new CategoryArchivedError(catId);
      }
      if (category.type !== dto.type) {
        throw new CategoryTypeMismatchError(dto.type, category.type);
      }
      resolvedCategoryId = category.id;
      categoryName = category.name;
      categoryIcon = category.icon;
      categoryColor = category.color;
    }

    const now = new Date();
    const rule = new RecurringRule({
      id: createRecurringRuleId(crypto.randomUUID()),
      userId,
      title: dto.title,
      description: dto.description,
      type: dto.type,
      amount: Money.fromPaise(dto.amountPaise, 'INR'),
      accountId: account.id,
      categoryId: resolvedCategoryId,
      frequency: dto.frequency,
      interval: dto.interval ?? 1,
      startDate: dto.startDate,
      endDate: dto.endDate ?? null,
      nextDueDate: dto.startDate,
      status: 'active',
      requiresUserConfirmation: true,
      version: 1,
      createdAt: now,
      updatedAt: now
    });

    const initialOccurrence = new RecurringOccurrence({
      id: createRecurringOccurrenceId(crypto.randomUUID()),
      userId,
      recurringRuleId: rule.id,
      occurrenceDate: rule.nextDueDate,
      status: 'pending',
      idempotencyKey: buildRecurringOccurrenceIdempotencyKey(rule.id, rule.nextDueDate),
      version: 1,
      createdAt: now,
      updatedAt: now
    });

    const ruleOutbox = {
      userId: rule.userId,
      entity: 'recurring_rules' as const,
      entityId: rule.id,
      operation: 'INSERT' as const,
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
        version: rule.version,
        created_at: rule.createdAt.toISOString(),
        updated_at: rule.updatedAt.toISOString(),
        deleted_at: null
      },
      idempotencyKey: crypto.randomUUID()
    };

    const occurrenceOutbox = {
      userId: initialOccurrence.userId,
      entity: 'recurring_occurrences' as const,
      entityId: initialOccurrence.id,
      operation: 'INSERT' as const,
      payload: {
        id: initialOccurrence.id,
        user_id: initialOccurrence.userId,
        recurring_rule_id: initialOccurrence.recurringRuleId,
        occurrence_date: initialOccurrence.occurrenceDate,
        status: initialOccurrence.status,
        snoozed_until_date: null,
        transaction_id: null,
        idempotency_key: initialOccurrence.idempotencyKey,
        confirmed_at: null,
        skipped_at: null,
        dismissed_at: null,
        version: initialOccurrence.version,
        created_at: initialOccurrence.createdAt.toISOString(),
        updated_at: initialOccurrence.updatedAt.toISOString(),
        deleted_at: null
      },
      idempotencyKey: crypto.randomUUID()
    };

    await this.unitOfWork.run(async () => {
      await this.recurringRuleRepo.save(rule);
      await this.recurringOccurrenceRepo.save(initialOccurrence);
      await this.syncPort.enqueue(ruleOutbox);
      await this.syncPort.enqueue(occurrenceOutbox);
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
      previewDates: previewUpcomingScheduleDates({
        nextDueDate: rule.nextDueDate,
        endDate: rule.endDate,
        frequency: rule.frequency,
        interval: rule.interval,
        anchorDay: rule.anchorDayOfMonth,
        horizonEndDate: horizonEnd,
        maxCount: 6
      }),
      version: rule.version,
      createdAt: rule.createdAt.toISOString(),
      updatedAt: rule.updatedAt.toISOString()
    };
  }
}

import { BUDGET_PERIOD_REGEX } from '@/domain/entities/Budget';
import {
  Notification,
  NotificationEntityType,
  NotificationMetadata,
  NotificationStatus,
  RecurringNotificationMilestone
} from '@/domain/entities/Notification';
import { NotificationPreference } from '@/domain/entities/NotificationPreference';
import { InvalidNotificationError } from '@/domain/errors/NotificationErrors';
import { NotificationPreferenceRepository } from '@/domain/repositories/NotificationPreferenceRepository';
import { NotificationRepository } from '@/domain/repositories/NotificationRepository';
import {
  buildBudgetNotificationDedupeKey,
  buildRecurringNotificationDedupeKey,
  compareNotificationSeverity,
  deriveDeterministicNotificationId,
  NotificationCategory,
  NotificationSeverity
} from '@/domain/services/NotificationIdentityService';
import {
  getLocalTodayDateString,
  parseLocalCalendarDate
} from '@/domain/services/RecurrenceScheduleService';
import { validateUserId } from '@/domain/value-objects/Identifiers';
import {
  EvaluateFinancialAlertsOptionsDTO,
  EvaluateFinancialAlertsResultDTO
} from '@/application/dto/NotificationDTO';
import { RecurringReminderDTO } from '@/application/dto/RecurringDTO';
import { SyncPort } from '@/application/ports/SyncPort';
import { UnitOfWork } from '@/application/ports/UnitOfWork';
import { GetBudgetsOverviewUseCase } from '@/application/use-cases/budgets/GetBudgetsOverviewUseCase';
import { GetRecurringOverviewUseCase } from '@/application/use-cases/recurring/GetRecurringOverviewUseCase';
import { formatPaiseToINR } from '@/utils/formatters';
import { buildNotificationOutboxEntry } from './NotificationMapper';

interface AlertCandidate {
  dedupeKey: string;
  category: NotificationCategory;
  severity: NotificationSeverity;
  title: string;
  message: string;
  entityType: NotificationEntityType;
  entityId: string;
  triggerDate: string;
  actionRoute: string;
  metadata: NotificationMetadata;
}

function clampText(text: string, maxLength: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 3)}...`;
}

function buildRecurringCandidate(
  item: RecurringReminderDTO,
  milestone: RecurringNotificationMilestone,
  severity: NotificationSeverity
): AlertCandidate {
  const isIncome = item.type === 'income';
  const absDays = Math.abs(item.daysUntilDue);
  const dayUnit = absDays === 1 ? 'day' : 'days';

  let rawTitle: string;
  let rawMessage: string;

  if (milestone === 'overdue') {
    rawTitle = isIncome
      ? `Overdue recurring income: ${item.title}`
      : `Overdue payment: ${item.title}`;
    rawMessage = isIncome
      ? `${item.title} (${item.amountFormatted}) was expected ${absDays} ${dayUnit} ago (${item.effectiveDueDate}).`
      : `${item.title} (${item.amountFormatted}) was due ${absDays} ${dayUnit} ago (${item.effectiveDueDate}).`;
  } else if (milestone === 'due_today') {
    rawTitle = isIncome
      ? `Recurring income due today: ${item.title}`
      : `Payment due today: ${item.title}`;
    rawMessage = isIncome
      ? `${item.title} (${item.amountFormatted}) is scheduled for today (${item.effectiveDueDate}).`
      : `${item.title} (${item.amountFormatted}) is due today (${item.effectiveDueDate}).`;
  } else {
    rawTitle = isIncome
      ? `Upcoming recurring income: ${item.title}`
      : `Upcoming payment: ${item.title}`;
    rawMessage = isIncome
      ? `${item.title} (${item.amountFormatted}) is scheduled in ${absDays} ${dayUnit} (${item.effectiveDueDate}).`
      : `${item.title} (${item.amountFormatted}) is due in ${absDays} ${dayUnit} (${item.effectiveDueDate}).`;
  }

  return {
    dedupeKey: buildRecurringNotificationDedupeKey(item.recurringRuleId, item.occurrenceDate),
    category: 'recurring_payment',
    severity,
    title: clampText(rawTitle, 160),
    message: clampText(rawMessage, 500),
    entityType: item.occurrenceId ? 'recurring_occurrence' : 'recurring_rule',
    entityId: item.occurrenceId ?? item.recurringRuleId,
    triggerDate: item.effectiveDueDate,
    actionRoute: '/recurring',
    metadata: {
      recurringRuleId: item.recurringRuleId,
      occurrenceDate: item.occurrenceDate,
      dueDate: item.occurrenceDate,
      effectiveDueDate: item.effectiveDueDate,
      daysUntilDue: item.daysUntilDue,
      recurringMilestone: milestone,
      amountPaise: item.amountPaise,
      categoryId: item.categoryId,
      categoryName: item.categoryName
    }
  };
}

/**
 * Evaluates recurring reminders and budget utilization in read-only fashion against domain
 * services/use cases and persists idempotent, monotonically escalating local notifications +
 * transactional outbox entries. Never mutates financial records.
 */
export class EvaluateFinancialAlertsUseCase {
  private readonly userLocks = new Map<string, Promise<void>>();

  constructor(
    private readonly notificationRepo: NotificationRepository,
    private readonly preferenceRepo: NotificationPreferenceRepository,
    private readonly getBudgetsOverviewUseCase: GetBudgetsOverviewUseCase,
    private readonly getRecurringOverviewUseCase: GetRecurringOverviewUseCase,
    private readonly syncPort: SyncPort,
    private readonly unitOfWork: UnitOfWork
  ) {}

  public async execute(
    rawUserId: string,
    options?: EvaluateFinancialAlertsOptionsDTO
  ): Promise<EvaluateFinancialAlertsResultDTO> {
    const userId = validateUserId(rawUserId);

    // Serialize per-user evaluation in-process to prevent concurrent duplicate alert writes.
    const priorLock = this.userLocks.get(userId) ?? Promise.resolve();
    let releaseLock!: () => void;
    const currentLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    this.userLocks.set(userId, currentLock);

    try {
      await priorLock;
      return await this.evaluateUnlocked(userId, options);
    } finally {
      releaseLock();
      if (this.userLocks.get(userId) === currentLock) {
        this.userLocks.delete(userId);
      }
    }
  }

  private async evaluateUnlocked(
    userId: string,
    options?: EvaluateFinancialAlertsOptionsDTO
  ): Promise<EvaluateFinancialAlertsResultDTO> {
    const asOfDate = options?.asOfDate
      ? parseLocalCalendarDate(options.asOfDate).normalized
      : getLocalTodayDateString();
    const period = options?.period ? options.period.trim() : asOfDate.slice(0, 7);

    if (!BUDGET_PERIOD_REGEX.test(period)) {
      throw new InvalidNotificationError(`Invalid budget period "${period}" for alert evaluation`);
    }

    const evaluatedAt = new Date().toISOString();
    const storedPreference = await this.preferenceRepo.findByUserId(userId);
    const preferences = storedPreference ?? NotificationPreference.createDefault(userId, evaluatedAt);

    const [recurringOverview, budgetsOverview] = await Promise.all([
      preferences.recurringPaymentEnabled
        ? this.getRecurringOverviewUseCase.execute(userId, {
            asOfDate,
            horizonDays: preferences.upcomingLeadDays
          })
        : Promise.resolve(null),
      preferences.budgetWarningEnabled || preferences.budgetExceededEnabled
        ? this.getBudgetsOverviewUseCase.execute(userId, period)
        : Promise.resolve(null)
    ]);

    const candidateMap = new Map<string, AlertCandidate>();
    const registerCandidate = (candidate: AlertCandidate) => {
      const existing = candidateMap.get(candidate.dedupeKey);
      if (!existing || compareNotificationSeverity(candidate.severity, existing.severity) > 0) {
        candidateMap.set(candidate.dedupeKey, candidate);
      }
    };

    if (recurringOverview && preferences.recurringPaymentEnabled) {
      for (const item of recurringOverview.overdue) {
        registerCandidate(buildRecurringCandidate(item, 'overdue', 'critical'));
      }
      for (const item of recurringOverview.dueToday) {
        registerCandidate(buildRecurringCandidate(item, 'due_today', 'warning'));
      }
      for (const item of recurringOverview.upcoming) {
        if (item.daysUntilDue >= 1 && item.daysUntilDue <= preferences.upcomingLeadDays) {
          registerCandidate(buildRecurringCandidate(item, 'upcoming', 'info'));
        }
      }
    }

    if (budgetsOverview) {
      for (const budget of budgetsOverview.budgets) {
        const isExceeded =
          budget.isExceeded ||
          (budget.limitPaise > 0 && budget.spentPaise >= budget.limitPaise) ||
          budget.utilizationPercentage >= 100;
        const isWarning =
          !isExceeded &&
          budget.limitPaise > 0 &&
          budget.spentPaise * 100 >= budget.limitPaise * 80;

        if (isExceeded) {
          if (!preferences.budgetExceededEnabled) {
            continue;
          }
          const overPaise = Math.max(0, budget.spentPaise - budget.limitPaise);
          const rawTitle =
            overPaise > 0
              ? `Budget exceeded: ${budget.categoryName}`
              : `Budget limit reached: ${budget.categoryName}`;
          const rawMessage =
            overPaise > 0
              ? `${budget.categoryName} exceeded its ${budget.period} budget of ${budget.limitFormatted} (${budget.spentFormatted} spent, ${formatPaiseToINR(overPaise)} over limit).`
              : `${budget.categoryName} reached 100% of its ${budget.period} budget (${budget.spentFormatted} of ${budget.limitFormatted}).`;

          registerCandidate({
            dedupeKey: buildBudgetNotificationDedupeKey(budget.budgetId, budget.period),
            category: 'budget_exceeded',
            severity: 'critical',
            title: clampText(rawTitle, 160),
            message: clampText(rawMessage, 500),
            entityType: 'budget',
            entityId: budget.budgetId,
            triggerDate: asOfDate,
            actionRoute: '/budgets',
            metadata: {
              budgetId: budget.budgetId,
              categoryId: budget.categoryId,
              categoryName: budget.categoryName,
              period: budget.period,
              limitPaise: budget.limitPaise,
              spentPaise: budget.spentPaise,
              utilizationPercentage: budget.utilizationPercentage
            }
          });
        } else if (isWarning) {
          if (!preferences.budgetWarningEnabled) {
            continue;
          }
          registerCandidate({
            dedupeKey: buildBudgetNotificationDedupeKey(budget.budgetId, budget.period),
            category: 'budget_warning',
            severity: 'warning',
            title: clampText(`Budget approaching limit: ${budget.categoryName}`, 160),
            message: clampText(
              `${budget.categoryName} budget for ${budget.period} is ${budget.utilizationPercentage}% used (${budget.spentFormatted} of ${budget.limitFormatted}).`,
              500
            ),
            entityType: 'budget',
            entityId: budget.budgetId,
            triggerDate: asOfDate,
            actionRoute: '/budgets',
            metadata: {
              budgetId: budget.budgetId,
              categoryId: budget.categoryId,
              categoryName: budget.categoryName,
              period: budget.period,
              limitPaise: budget.limitPaise,
              spentPaise: budget.spentPaise,
              utilizationPercentage: budget.utilizationPercentage
            }
          });
        }
      }
    }

    // Derive deterministic WebCrypto IDs outside IndexedDB rw transaction to avoid auto-commit.
    const preparedCandidates = await Promise.all(
      Array.from(candidateMap.values()).map(async (candidate) => ({
        candidate,
        deterministicId: await deriveDeterministicNotificationId(userId, candidate.dedupeKey)
      }))
    );

    let createdCount = 0;
    let updatedCount = 0;
    let unchangedCount = 0;
    let unreadCount = 0;

    await this.unitOfWork.run(async () => {
      const toPersist: Notification[] = [];
      const outboxEntries: ReturnType<typeof buildNotificationOutboxEntry>[] = [];

      for (const { candidate, deterministicId } of preparedCandidates) {
        const existing = await this.notificationRepo.findByDedupeKey(userId, candidate.dedupeKey);

        if (!existing) {
          const initialStatus: NotificationStatus = 'unread';
          const created = new Notification({
            id: deterministicId,
            userId,
            category: candidate.category,
            severity: candidate.severity,
            status: initialStatus,
            dedupeKey: candidate.dedupeKey,
            title: candidate.title,
            message: candidate.message,
            entityType: candidate.entityType,
            entityId: candidate.entityId,
            triggerDate: candidate.triggerDate,
            actionRoute: candidate.actionRoute,
            metadata: candidate.metadata,
            version: 1,
            createdAt: evaluatedAt,
            updatedAt: evaluatedAt
          });
          toPersist.push(created);
          outboxEntries.push(buildNotificationOutboxEntry(created, 'INSERT'));
          createdCount += 1;
          continue;
        }

        const { notification: promoted, changed } = existing.promoteAlert({
          category: candidate.category,
          severity: candidate.severity,
          title: candidate.title,
          message: candidate.message,
          entityType: candidate.entityType,
          entityId: candidate.entityId,
          triggerDate: candidate.triggerDate,
          actionRoute: candidate.actionRoute,
          metadata: candidate.metadata,
          now: evaluatedAt
        });

        if (changed) {
          toPersist.push(promoted);
          outboxEntries.push(buildNotificationOutboxEntry(promoted, 'UPDATE', existing.version));
          updatedCount += 1;
        } else {
          unchangedCount += 1;
        }
      }

      if (toPersist.length > 0) {
        await this.notificationRepo.saveMany(toPersist);
        for (const entry of outboxEntries) {
          await this.syncPort.enqueue(entry);
        }
      }

      unreadCount = await this.notificationRepo.countUnread(userId);
    });

    return {
      createdCount,
      updatedCount,
      unchangedCount,
      unreadCount,
      evaluatedAt
    };
  }
}

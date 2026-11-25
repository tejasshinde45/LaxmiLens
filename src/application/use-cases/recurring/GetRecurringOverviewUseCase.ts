import { RecurringRuleRepository } from '@/domain/repositories/RecurringRuleRepository';
import { RecurringOccurrenceRepository } from '@/domain/repositories/RecurringOccurrenceRepository';
import { AccountRepository } from '@/domain/repositories/AccountRepository';
import { CategoryRepository } from '@/domain/repositories/CategoryRepository';
import { validateUserId } from '@/domain/value-objects/Identifiers';
import { RecurringRule } from '@/domain/entities/RecurringRule';
import { RecurringOccurrence } from '@/domain/entities/RecurringOccurrence';
import {
  RecurringOverviewResponseDTO,
  RecurringReminderDTO,
  RecurringRuleResponseDTO,
  ReminderBucket
} from '@/application/dto/RecurringDTO';
import {
  addDaysToLocalDate,
  buildRecurringOccurrenceIdempotencyKey,
  compareLocalDates,
  differenceInCalendarDays,
  getLocalTodayDateString,
  parseLocalCalendarDate,
  previewUpcomingScheduleDates
} from '@/domain/services/RecurrenceScheduleService';
import { formatPaiseToINR } from '@/utils/formatters';

export interface GetRecurringOverviewOptions {
  asOfDate?: string; // Optional YYYY-MM-DD local calendar override
  horizonDays?: number; // Default 30 days for upcoming projections
}

/**
 * Pure read-only query aggregating recurring payment schedules, overdue/due-today/upcoming/snoozed
 * payment reminders, and recently confirmed transactions. Never mutates financial records or generates
 * ledger transactions automatically.
 */
export class GetRecurringOverviewUseCase {
  constructor(
    private readonly recurringRuleRepo: RecurringRuleRepository,
    private readonly recurringOccurrenceRepo: RecurringOccurrenceRepository,
    private readonly accountRepo: AccountRepository,
    private readonly categoryRepo: CategoryRepository
  ) {}

  public async execute(
    rawUserId: string,
    options?: GetRecurringOverviewOptions
  ): Promise<RecurringOverviewResponseDTO> {
    const userId = validateUserId(rawUserId);
    const asOfDate = options?.asOfDate
      ? parseLocalCalendarDate(options.asOfDate).normalized
      : getLocalTodayDateString();
    const horizonDays = options?.horizonDays ?? 30;
    const horizonEnd = addDaysToLocalDate(asOfDate, horizonDays);
    const previewHorizonEnd = addDaysToLocalDate(asOfDate, 90);

    const [rules, occurrences, accounts, categories] = await Promise.all([
      this.recurringRuleRepo.findAll(userId),
      this.recurringOccurrenceRepo.findAll(userId),
      this.accountRepo.findAll(userId),
      this.categoryRepo.findAll(userId)
    ]);

    const accountMap = new Map(accounts.map((a) => [a.id, a]));
    const categoryMap = new Map(categories.map((c) => [c.id, c]));
    const ruleMap = new Map(rules.map((r) => [r.id, r]));

    const actionableOccurrencesByRuleAndDate = new Set<string>();
    const resolvedOccurrencesByRuleAndDate = new Set<string>();

    const overdue: RecurringReminderDTO[] = [];
    const dueToday: RecurringReminderDTO[] = [];
    const upcoming: RecurringReminderDTO[] = [];
    const snoozed: RecurringReminderDTO[] = [];
    const recentlyGenerated: RecurringReminderDTO[] = [];

    const buildReminderDTO = (
      rule: RecurringRule,
      occ: RecurringOccurrence | null,
      occurrenceDate: string,
      bucket: ReminderBucket
    ): RecurringReminderDTO => {
      const account = accountMap.get(rule.accountId);
      const category = rule.categoryId ? categoryMap.get(rule.categoryId) : undefined;
      const effectiveDueDate = occ ? occ.effectiveDueDate : occurrenceDate;
      const daysUntilDue = differenceInCalendarDays(asOfDate, effectiveDueDate);

      return {
        occurrenceId: occ?.id,
        recurringRuleId: rule.id,
        userId: rule.userId,
        title: rule.title,
        description: rule.description,
        type: rule.type,
        amountPaise: rule.amount.paise,
        amountFormatted: formatPaiseToINR(rule.amount.paise),
        accountId: rule.accountId,
        accountName: account?.name ?? 'Unknown Account',
        categoryId: rule.categoryId,
        categoryName: category?.name,
        categoryIcon: category?.icon,
        categoryColor: category?.color,
        frequency: rule.frequency,
        interval: rule.interval,
        occurrenceDate,
        effectiveDueDate,
        snoozedUntilDate: occ?.snoozedUntilDate ?? null,
        status: occ?.status ?? 'pending',
        bucket,
        daysUntilDue,
        transactionId: occ?.transactionId ?? null,
        confirmedAt: occ?.confirmedAt ? occ.confirmedAt.toISOString() : null,
        idempotencyKey:
          occ?.idempotencyKey ?? buildRecurringOccurrenceIdempotencyKey(rule.id, occurrenceDate)
      };
    };

    const classifyBucket = (occ: RecurringOccurrence): ReminderBucket => {
      if (occ.status === 'snoozed' && occ.snoozedUntilDate) {
        if (compareLocalDates(occ.snoozedUntilDate, asOfDate) > 0) {
          return 'snoozed';
        }
        if (compareLocalDates(occ.snoozedUntilDate, asOfDate) === 0) {
          return 'dueToday';
        }
        return 'overdue';
      }

      const cmp = compareLocalDates(occ.occurrenceDate, asOfDate);
      if (cmp < 0) return 'overdue';
      if (cmp === 0) return 'dueToday';
      return 'upcoming';
    };

    // 1. Classify persisted occurrences
    for (const occ of occurrences) {
      const key = `${occ.recurringRuleId}:${occ.occurrenceDate}`;
      const rule = ruleMap.get(occ.recurringRuleId);
      if (!rule) continue;

      if (occ.status === 'confirmed') {
        resolvedOccurrencesByRuleAndDate.add(key);
        recentlyGenerated.push(buildReminderDTO(rule, occ, occ.occurrenceDate, 'upcoming'));
        continue;
      }

      if (occ.status === 'skipped' || occ.status === 'dismissed') {
        resolvedOccurrencesByRuleAndDate.add(key);
        continue;
      }

      // Actionable: pending or snoozed (only surface for active schedules)
      if (rule.status !== 'active') continue;

      actionableOccurrencesByRuleAndDate.add(key);
      const bucket = classifyBucket(occ);
      const dto = buildReminderDTO(rule, occ, occ.occurrenceDate, bucket);

      if (bucket === 'overdue') overdue.push(dto);
      else if (bucket === 'dueToday') dueToday.push(dto);
      else if (bucket === 'snoozed') snoozed.push(dto);
      else upcoming.push(dto);
    }

    // 2. For active schedules missing an occurrence row for nextDueDate (e.g. cloud pull), surface virtual pending reminder
    for (const rule of rules) {
      if (rule.status !== 'active') continue;
      if (rule.endDate && compareLocalDates(rule.nextDueDate, rule.endDate) > 0) continue;

      const key = `${rule.id}:${rule.nextDueDate}`;
      if (
        actionableOccurrencesByRuleAndDate.has(key) ||
        resolvedOccurrencesByRuleAndDate.has(key)
      ) {
        continue;
      }

      const cmp = compareLocalDates(rule.nextDueDate, asOfDate);
      const bucket: ReminderBucket = cmp < 0 ? 'overdue' : cmp === 0 ? 'dueToday' : 'upcoming';
      const dto = buildReminderDTO(rule, null, rule.nextDueDate, bucket);

      if (bucket === 'overdue') overdue.push(dto);
      else if (bucket === 'dueToday') dueToday.push(dto);
      else upcoming.push(dto);
    }

    const byDateAsc = (a: RecurringReminderDTO, b: RecurringReminderDTO) =>
      compareLocalDates(a.effectiveDueDate, b.effectiveDueDate) || a.title.localeCompare(b.title);

    overdue.sort(byDateAsc);
    dueToday.sort(byDateAsc);
    upcoming.sort(byDateAsc);
    snoozed.sort(byDateAsc);
    recentlyGenerated.sort((a, b) => (b.confirmedAt ?? '').localeCompare(a.confirmedAt ?? ''));

    // 3. Build schedule DTOs with read-only upcoming cycle previews
    const schedules: RecurringRuleResponseDTO[] = rules
      .slice()
      .sort((a, b) => compareLocalDates(a.nextDueDate, b.nextDueDate) || a.title.localeCompare(b.title))
      .map((rule) => {
        const account = accountMap.get(rule.accountId);
        const category = rule.categoryId ? categoryMap.get(rule.categoryId) : undefined;
        return {
          id: rule.id,
          userId: rule.userId,
          title: rule.title,
          description: rule.description,
          type: rule.type,
          amountPaise: rule.amount.paise,
          amountFormatted: formatPaiseToINR(rule.amount.paise),
          accountId: rule.accountId,
          accountName: account?.name ?? 'Unknown Account',
          categoryId: rule.categoryId,
          categoryName: category?.name,
          categoryIcon: category?.icon,
          categoryColor: category?.color,
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
                  horizonEndDate: previewHorizonEnd,
                  maxCount: 6
                })
              : [],
          version: rule.version,
          createdAt: rule.createdAt.toISOString(),
          updatedAt: rule.updatedAt.toISOString()
        };
      });

    // 4. Compute read-only upcoming 30-day totals from active schedule projections
    let upcoming30ExpensePaise = 0;
    let upcoming30IncomePaise = 0;
    for (const rule of rules) {
      if (rule.status !== 'active') continue;
      const datesWithinHorizon = previewUpcomingScheduleDates({
        nextDueDate: rule.nextDueDate,
        endDate: rule.endDate,
        frequency: rule.frequency,
        interval: rule.interval,
        anchorDay: rule.anchorDayOfMonth,
        horizonEndDate: horizonEnd,
        maxCount: 64
      });
      for (const dt of datesWithinHorizon) {
        if (compareLocalDates(dt, asOfDate) < 0) continue;
        if (resolvedOccurrencesByRuleAndDate.has(`${rule.id}:${dt}`)) continue;
        if (rule.type === 'expense') upcoming30ExpensePaise += rule.amount.paise;
        else upcoming30IncomePaise += rule.amount.paise;
      }
    }

    const totalOverdueAmountPaise = overdue.reduce((acc, item) => acc + item.amountPaise, 0);
    const totalDueTodayAmountPaise = dueToday.reduce((acc, item) => acc + item.amountPaise, 0);

    return {
      summary: {
        asOfDate,
        activeSchedulesCount: rules.filter((r) => r.status === 'active').length,
        pausedSchedulesCount: rules.filter((r) => r.status === 'paused').length,
        completedSchedulesCount: rules.filter((r) => r.status === 'completed').length,
        overdueCount: overdue.length,
        dueTodayCount: dueToday.length,
        upcomingCount: upcoming.length,
        snoozedCount: snoozed.length,
        totalOverdueAmountPaise,
        totalOverdueAmountFormatted: formatPaiseToINR(totalOverdueAmountPaise),
        totalDueTodayAmountPaise,
        totalDueTodayAmountFormatted: formatPaiseToINR(totalDueTodayAmountPaise),
        totalUpcoming30DaysExpensePaise: upcoming30ExpensePaise,
        totalUpcoming30DaysExpenseFormatted: formatPaiseToINR(upcoming30ExpensePaise),
        totalUpcoming30DaysIncomePaise: upcoming30IncomePaise,
        totalUpcoming30DaysIncomeFormatted: formatPaiseToINR(upcoming30IncomePaise)
      },
      overdue,
      dueToday,
      upcoming,
      snoozed,
      recentlyGenerated: recentlyGenerated.slice(0, 20),
      schedules
    };
  }
}

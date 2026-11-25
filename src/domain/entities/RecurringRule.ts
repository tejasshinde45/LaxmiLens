import {
  AccountId,
  CategoryId,
  RecurringRuleId,
  UserId,
  validateUserId
} from '../value-objects/Identifiers';
import { Money } from '../value-objects/Money';
import {
  RECURRENCE_FREQUENCIES,
  RecurrenceFrequency,
  calculateNextOccurrenceDate,
  compareLocalDates,
  getLocalTodayDateString,
  parseLocalCalendarDate
} from '../services/RecurrenceScheduleService';
import { InvalidRecurrenceScheduleError } from '../errors/RecurringErrors';

export type RecurringTransactionType = 'income' | 'expense';
export type RecurringRuleStatus = 'active' | 'paused' | 'completed';

export { type RecurrenceFrequency };

export interface RecurringRuleProps {
  id: RecurringRuleId;
  userId: UserId;
  title: string;
  description?: string;
  type: RecurringTransactionType;
  amount: Money;
  accountId: AccountId;
  categoryId?: CategoryId;
  frequency: RecurrenceFrequency;
  interval: number;
  anchorDayOfMonth?: number;
  startDate: string; // YYYY-MM-DD local calendar date
  endDate?: string | null; // YYYY-MM-DD local calendar date
  nextDueDate: string; // YYYY-MM-DD local calendar date
  lastGeneratedDate?: string | null; // YYYY-MM-DD local calendar date
  status?: RecurringRuleStatus;
  requiresUserConfirmation?: boolean;
  version?: number;
  createdAt?: Date;
  updatedAt?: Date;
  deletedAt?: Date | null;
}

export class RecurringRule {
  public readonly id: RecurringRuleId;
  public readonly userId: UserId;
  public title: string;
  public description?: string;
  public readonly type: RecurringTransactionType;
  public amount: Money;
  public accountId: AccountId;
  public categoryId?: CategoryId;
  public frequency: RecurrenceFrequency;
  public interval: number;
  public anchorDayOfMonth: number;
  public readonly startDate: string;
  public endDate: string | null;
  public nextDueDate: string;
  public lastGeneratedDate: string | null;
  public status: RecurringRuleStatus;
  public requiresUserConfirmation: boolean;
  public version: number;
  public readonly createdAt: Date;
  public updatedAt: Date;
  public deletedAt: Date | null;

  constructor(props: RecurringRuleProps) {
    if (!props.id || typeof props.id !== 'string' || props.id.trim().length === 0) {
      throw new InvalidRecurrenceScheduleError('RecurringRule ID is required.');
    }

    const validatedUserId = validateUserId(props.userId);
    const trimmedTitle = (props.title || '').trim();
    if (trimmedTitle.length === 0 || trimmedTitle.length > 100) {
      throw new InvalidRecurrenceScheduleError('Schedule title must be between 1 and 100 characters.');
    }

    if (props.type !== 'income' && props.type !== 'expense') {
      throw new InvalidRecurrenceScheduleError(
        `Recurring schedule type must be 'income' or 'expense'. Received '${props.type}'.`
      );
    }

    if (!props.amount || !Number.isSafeInteger(props.amount.paise) || props.amount.paise <= 0) {
      throw new InvalidRecurrenceScheduleError('Recurring schedule amount must be greater than zero.');
    }

    if (!props.accountId || props.accountId.trim().length === 0) {
      throw new InvalidRecurrenceScheduleError('A valid account ID is required for recurring schedules.');
    }

    if (!RECURRENCE_FREQUENCIES.includes(props.frequency)) {
      throw new InvalidRecurrenceScheduleError(`Unsupported recurrence frequency '${props.frequency}'.`);
    }

    if (!Number.isSafeInteger(props.interval) || props.interval < 1 || props.interval > 365) {
      throw new InvalidRecurrenceScheduleError('Recurrence interval must be an integer between 1 and 365.');
    }

    const normalizedStartDate = parseLocalCalendarDate(props.startDate).normalized;
    const startParsed = parseLocalCalendarDate(normalizedStartDate);
    const normalizedNextDue = parseLocalCalendarDate(props.nextDueDate).normalized;

    let normalizedEndDate: string | null = null;
    if (props.endDate !== undefined && props.endDate !== null && props.endDate.trim() !== '') {
      normalizedEndDate = parseLocalCalendarDate(props.endDate).normalized;
      if (compareLocalDates(normalizedEndDate, normalizedStartDate) < 0) {
        throw new InvalidRecurrenceScheduleError('End date cannot be earlier than the start date.');
      }
    }

    let normalizedLastGenerated: string | null = null;
    if (
      props.lastGeneratedDate !== undefined &&
      props.lastGeneratedDate !== null &&
      props.lastGeneratedDate.trim() !== ''
    ) {
      normalizedLastGenerated = parseLocalCalendarDate(props.lastGeneratedDate).normalized;
    }

    const anchorDay = props.anchorDayOfMonth ?? startParsed.day;
    if (!Number.isSafeInteger(anchorDay) || anchorDay < 1 || anchorDay > 31) {
      throw new InvalidRecurrenceScheduleError('Anchor day of month must be between 1 and 31.');
    }

    const status = props.status ?? 'active';
    if (status !== 'active' && status !== 'paused' && status !== 'completed') {
      throw new InvalidRecurrenceScheduleError(`Invalid recurring schedule status '${status}'.`);
    }

    const version = props.version ?? 1;
    if (!Number.isSafeInteger(version) || version < 1) {
      throw new InvalidRecurrenceScheduleError('Version must be a positive integer >= 1.');
    }

    this.id = props.id.trim() as RecurringRuleId;
    this.userId = validatedUserId;
    this.title = trimmedTitle;
    this.description = props.description?.trim() ? props.description.trim() : undefined;
    this.type = props.type;
    this.amount = props.amount;
    this.accountId = props.accountId.trim() as AccountId;
    this.categoryId =
      props.categoryId && props.categoryId.trim().length > 0
        ? (props.categoryId.trim() as CategoryId)
        : undefined;
    this.frequency = props.frequency;
    this.interval = props.interval;
    this.anchorDayOfMonth = anchorDay;
    this.startDate = normalizedStartDate;
    this.endDate = normalizedEndDate;
    this.nextDueDate = normalizedNextDue;
    this.lastGeneratedDate = normalizedLastGenerated;
    this.status = status;
    // Always enforce explicit user confirmation unless explicitly overridden in future opt-in modes
    this.requiresUserConfirmation = props.requiresUserConfirmation ?? true;
    this.version = version;
    this.createdAt = props.createdAt ?? new Date();
    this.updatedAt = props.updatedAt ?? new Date();
    this.deletedAt = props.deletedAt ?? null;
  }

  /** Convenience compatibility alias */
  public get name(): string {
    return this.title;
  }

  public get isActive(): boolean {
    return this.status === 'active' && this.deletedAt === null;
  }

  public get isDeleted(): boolean {
    return this.deletedAt !== null;
  }

  public isDue(asOfDate: string | Date = new Date()): boolean {
    if (!this.isActive) return false;
    const asOfStr =
      typeof asOfDate === 'string'
        ? parseLocalCalendarDate(asOfDate).normalized
        : getLocalTodayDateString(asOfDate);
    return compareLocalDates(this.nextDueDate, asOfStr) <= 0;
  }

  public updateSchedule(params: {
    title?: string;
    description?: string | null;
    amount?: Money;
    accountId?: AccountId;
    categoryId?: CategoryId | null;
    frequency?: RecurrenceFrequency;
    interval?: number;
    endDate?: string | null;
    nextDueDate?: string;
    now?: Date;
  }): void {
    if (this.deletedAt) {
      throw new InvalidRecurrenceScheduleError('Cannot modify a deleted recurring schedule.');
    }

    if (params.title !== undefined) {
      const trimmed = params.title.trim();
      if (!trimmed || trimmed.length > 100) {
        throw new InvalidRecurrenceScheduleError('Schedule title must be between 1 and 100 characters.');
      }
      this.title = trimmed;
    }

    if (params.description !== undefined) {
      this.description = params.description?.trim() ? params.description.trim() : undefined;
    }

    if (params.amount !== undefined) {
      if (!Number.isSafeInteger(params.amount.paise) || params.amount.paise <= 0) {
        throw new InvalidRecurrenceScheduleError('Recurring schedule amount must be greater than zero.');
      }
      this.amount = params.amount;
    }

    if (params.accountId !== undefined) {
      if (!params.accountId.trim()) {
        throw new InvalidRecurrenceScheduleError('A valid account ID is required.');
      }
      this.accountId = params.accountId.trim() as AccountId;
    }

    if (params.categoryId !== undefined) {
      this.categoryId =
        params.categoryId && params.categoryId.trim().length > 0
          ? (params.categoryId.trim() as CategoryId)
          : undefined;
    }

    if (params.frequency !== undefined) {
      if (!RECURRENCE_FREQUENCIES.includes(params.frequency)) {
        throw new InvalidRecurrenceScheduleError(`Unsupported recurrence frequency '${params.frequency}'.`);
      }
      this.frequency = params.frequency;
    }

    if (params.interval !== undefined) {
      if (!Number.isSafeInteger(params.interval) || params.interval < 1 || params.interval > 365) {
        throw new InvalidRecurrenceScheduleError('Recurrence interval must be between 1 and 365.');
      }
      this.interval = params.interval;
    }

    if (params.endDate !== undefined) {
      if (params.endDate === null || params.endDate.trim() === '') {
        this.endDate = null;
      } else {
        const normalizedEnd = parseLocalCalendarDate(params.endDate).normalized;
        if (compareLocalDates(normalizedEnd, this.startDate) < 0) {
          throw new InvalidRecurrenceScheduleError('End date cannot be earlier than start date.');
        }
        this.endDate = normalizedEnd;
      }
    }

    if (params.nextDueDate !== undefined) {
      const parsedNext = parseLocalCalendarDate(params.nextDueDate);
      if (compareLocalDates(parsedNext.normalized, this.startDate) < 0) {
        throw new InvalidRecurrenceScheduleError('Next due date cannot be earlier than start date.');
      }
      this.nextDueDate = parsedNext.normalized;
      this.anchorDayOfMonth = parsedNext.day;
    }

    if (this.endDate && compareLocalDates(this.nextDueDate, this.endDate) > 0) {
      this.status = 'completed';
    }

    this.version += 1;
    this.updatedAt = params.now ?? new Date();
  }

  public pause(now: Date = new Date()): void {
    if (this.status === 'completed') {
      throw new InvalidRecurrenceScheduleError('Cannot pause a completed recurring schedule.');
    }
    if (this.status === 'paused') return;
    this.status = 'paused';
    this.version += 1;
    this.updatedAt = now;
  }

  public resume(now: Date = new Date()): void {
    if (this.status === 'completed') {
      throw new InvalidRecurrenceScheduleError('Cannot resume a completed recurring schedule.');
    }
    if (this.status === 'active') return;
    this.status = 'active';
    this.version += 1;
    this.updatedAt = now;
  }

  /**
   * Advances `nextDueDate` after an occurrence on `occurrenceDateStr` is resolved (confirmed, skipped, or dismissed).
   * If `confirmedTransaction` is true, records `lastGeneratedDate = occurrenceDateStr`.
   * If the computed next due date exceeds `endDate`, transitions the schedule to 'completed'.
   */
  public advanceAfterOccurrence(
    occurrenceDateStr: string,
    confirmedTransaction: boolean,
    now: Date = new Date()
  ): void {
    const resolvedDate = parseLocalCalendarDate(occurrenceDateStr).normalized;

    if (confirmedTransaction) {
      this.lastGeneratedDate = resolvedDate;
    }

    // Only advance nextDueDate if the resolved occurrence equals or is ahead of nextDueDate
    if (compareLocalDates(resolvedDate, this.nextDueDate) >= 0) {
      const nextCandidate = calculateNextOccurrenceDate(
        resolvedDate,
        this.frequency,
        this.interval,
        this.anchorDayOfMonth
      );

      this.nextDueDate = nextCandidate;

      if (this.endDate && compareLocalDates(nextCandidate, this.endDate) > 0) {
        this.status = 'completed';
      }
    }

    this.version += 1;
    this.updatedAt = now;
  }

  public markDeleted(now: Date = new Date()): void {
    if (this.deletedAt !== null) return;
    this.deletedAt = now;
    this.version += 1;
    this.updatedAt = now;
  }
}

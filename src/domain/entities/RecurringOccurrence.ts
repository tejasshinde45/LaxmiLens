import {
  RecurringOccurrenceId,
  RecurringRuleId,
  TransactionId,
  UserId,
  isValidUuid,
  validateUserId
} from '../value-objects/Identifiers';
import {
  buildRecurringOccurrenceIdempotencyKey,
  parseLocalCalendarDate
} from '../services/RecurrenceScheduleService';
import {
  InvalidRecurrenceScheduleError,
  RecurringOccurrenceAlreadyResolvedError
} from '../errors/RecurringErrors';

export type RecurringOccurrenceStatus =
  | 'pending'
  | 'confirmed'
  | 'skipped'
  | 'snoozed'
  | 'dismissed';

export interface RecurringOccurrenceProps {
  id: RecurringOccurrenceId;
  userId: UserId;
  recurringRuleId: RecurringRuleId;
  occurrenceDate: string; // YYYY-MM-DD local calendar date
  status?: RecurringOccurrenceStatus;
  snoozedUntilDate?: string | null;
  transactionId?: TransactionId | null;
  idempotencyKey?: string;
  confirmedAt?: Date | null;
  skippedAt?: Date | null;
  dismissedAt?: Date | null;
  version?: number;
  createdAt?: Date;
  updatedAt?: Date;
  deletedAt?: Date | null;
}

export class RecurringOccurrence {
  public readonly id: RecurringOccurrenceId;
  public readonly userId: UserId;
  public readonly recurringRuleId: RecurringRuleId;
  public readonly occurrenceDate: string;
  public status: RecurringOccurrenceStatus;
  public snoozedUntilDate: string | null;
  public transactionId: TransactionId | null;
  public readonly idempotencyKey: string;
  public confirmedAt: Date | null;
  public skippedAt: Date | null;
  public dismissedAt: Date | null;
  public version: number;
  public readonly createdAt: Date;
  public updatedAt: Date;
  public deletedAt: Date | null;

  constructor(props: RecurringOccurrenceProps) {
    if (!props.id || typeof props.id !== 'string' || props.id.trim().length === 0) {
      throw new InvalidRecurrenceScheduleError('RecurringOccurrence ID is required.');
    }

    const validatedUserId = validateUserId(props.userId);
    const trimmedRuleId = (props.recurringRuleId || '').trim();
    if (!trimmedRuleId || !isValidUuid(trimmedRuleId)) {
      throw new InvalidRecurrenceScheduleError(
        `Invalid recurringRuleId '${props.recurringRuleId}': must be a valid UUID.`
      );
    }

    const normalizedDate = parseLocalCalendarDate(props.occurrenceDate).normalized;
    const status: RecurringOccurrenceStatus = props.status ?? 'pending';

    let normalizedSnooze: string | null = null;
    if (
      props.snoozedUntilDate !== undefined &&
      props.snoozedUntilDate !== null &&
      props.snoozedUntilDate.trim() !== ''
    ) {
      normalizedSnooze = parseLocalCalendarDate(props.snoozedUntilDate).normalized;
    }

    if (status === 'snoozed' && !normalizedSnooze) {
      throw new InvalidRecurrenceScheduleError(
        'Snoozed occurrences must specify a valid snoozedUntilDate (YYYY-MM-DD).'
      );
    }

    const txId =
      props.transactionId && props.transactionId.trim().length > 0
        ? (props.transactionId.trim() as TransactionId)
        : null;

    if (status === 'confirmed' && !txId) {
      throw new InvalidRecurrenceScheduleError(
        'Confirmed occurrences must reference a generated transactionId.'
      );
    }

    const version = props.version ?? 1;
    if (!Number.isSafeInteger(version) || version < 1) {
      throw new InvalidRecurrenceScheduleError('Version must be a positive integer >= 1.');
    }

    this.id = props.id.trim() as RecurringOccurrenceId;
    this.userId = validatedUserId;
    this.recurringRuleId = trimmedRuleId as RecurringRuleId;
    this.occurrenceDate = normalizedDate;
    this.status = status;
    this.snoozedUntilDate = normalizedSnooze;
    this.transactionId = txId;
    this.idempotencyKey =
      props.idempotencyKey?.trim() ||
      buildRecurringOccurrenceIdempotencyKey(trimmedRuleId, normalizedDate);
    this.confirmedAt = props.confirmedAt ?? null;
    this.skippedAt = props.skippedAt ?? null;
    this.dismissedAt = props.dismissedAt ?? null;
    this.version = version;
    this.createdAt = props.createdAt ?? new Date();
    this.updatedAt = props.updatedAt ?? new Date();
    this.deletedAt = props.deletedAt ?? null;
  }

  /**
   * Effective calendar date for reminder scheduling (snooze overrides original due date until acted upon).
   */
  public get effectiveDueDate(): string {
    if (this.status === 'snoozed' && this.snoozedUntilDate) {
      return this.snoozedUntilDate;
    }
    return this.occurrenceDate;
  }

  public get isActionable(): boolean {
    return (this.status === 'pending' || this.status === 'snoozed') && this.deletedAt === null;
  }

  public confirm(transactionId: TransactionId, now: Date = new Date()): void {
    if (!this.isActionable) {
      throw new RecurringOccurrenceAlreadyResolvedError(this.status);
    }
    if (!transactionId || !isValidUuid(transactionId)) {
      throw new InvalidRecurrenceScheduleError('A valid generated transaction UUID is required to confirm.');
    }

    this.status = 'confirmed';
    this.transactionId = transactionId.trim() as TransactionId;
    this.snoozedUntilDate = null;
    this.confirmedAt = now;
    this.version += 1;
    this.updatedAt = now;
  }

  public skip(now: Date = new Date()): void {
    if (!this.isActionable) {
      throw new RecurringOccurrenceAlreadyResolvedError(this.status);
    }

    this.status = 'skipped';
    this.snoozedUntilDate = null;
    this.skippedAt = now;
    this.version += 1;
    this.updatedAt = now;
  }

  public snooze(untilDate: string, now: Date = new Date()): void {
    if (!this.isActionable) {
      throw new RecurringOccurrenceAlreadyResolvedError(this.status);
    }

    const normalizedUntil = parseLocalCalendarDate(untilDate).normalized;
    this.status = 'snoozed';
    this.snoozedUntilDate = normalizedUntil;
    this.version += 1;
    this.updatedAt = now;
  }

  public dismiss(now: Date = new Date()): void {
    if (!this.isActionable) {
      throw new RecurringOccurrenceAlreadyResolvedError(this.status);
    }

    this.status = 'dismissed';
    this.snoozedUntilDate = null;
    this.dismissedAt = now;
    this.version += 1;
    this.updatedAt = now;
  }
}

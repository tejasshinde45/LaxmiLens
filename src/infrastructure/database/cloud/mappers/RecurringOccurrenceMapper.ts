import {
  RecurringOccurrence,
  RecurringOccurrenceStatus
} from '@/domain/entities/RecurringOccurrence';
import {
  createRecurringOccurrenceId,
  createRecurringRuleId,
  createTransactionId,
  isValidUuid,
  validateUserId
} from '@/domain/value-objects/Identifiers';
import { isValidLocalCalendarDate } from '@/domain/services/RecurrenceScheduleService';
import { LocalRecurringOccurrenceRecord } from '@/infrastructure/database/local/schema';

export interface CloudRecurringOccurrenceRow {
  id: string;
  user_id: string;
  recurring_rule_id: string;
  occurrence_date: string;
  status: RecurringOccurrenceStatus;
  snoozed_until_date: string | null;
  transaction_id: string | null;
  idempotency_key: string;
  confirmed_at: string | null;
  skipped_at: string | null;
  dismissed_at: string | null;
  version: number;
  created_at?: string;
  updated_at?: string;
  deleted_at: string | null;
}

const VALID_OCC_STATUSES: readonly RecurringOccurrenceStatus[] = [
  'pending',
  'confirmed',
  'skipped',
  'snoozed',
  'dismissed'
];

export class RecurringOccurrenceMapper {
  public static validateCloudRow(row: CloudRecurringOccurrenceRow): void {
    if (!row || typeof row !== 'object') {
      throw new Error('Malformed cloud recurring occurrence row: expected object.');
    }
    if (typeof row.id !== 'string' || !isValidUuid(row.id)) {
      throw new Error(`Invalid cloud recurring occurrence ID '${row.id}'.`);
    }
    validateUserId(row.user_id);

    if (typeof row.recurring_rule_id !== 'string' || !isValidUuid(row.recurring_rule_id)) {
      throw new Error(`Invalid cloud recurring_rule_id '${row.recurring_rule_id}'.`);
    }
    if (!isValidLocalCalendarDate(row.occurrence_date)) {
      throw new Error(`Invalid cloud occurrence_date '${row.occurrence_date}'.`);
    }
    if (!VALID_OCC_STATUSES.includes(row.status)) {
      throw new Error(`Invalid cloud occurrence status '${row.status}'.`);
    }
    if (row.status === 'snoozed' && !isValidLocalCalendarDate(row.snoozed_until_date)) {
      throw new Error(`Snoozed occurrence '${row.id}' missing valid snoozed_until_date.`);
    }
    if (
      row.status === 'confirmed' &&
      (typeof row.transaction_id !== 'string' || !isValidUuid(row.transaction_id))
    ) {
      throw new Error(`Confirmed occurrence '${row.id}' missing valid transaction_id.`);
    }
    if (typeof row.idempotency_key !== 'string' || row.idempotency_key.trim().length === 0) {
      throw new Error(`Occurrence '${row.id}' missing idempotency_key.`);
    }
    if (typeof row.version !== 'number' || !Number.isSafeInteger(row.version) || row.version < 1) {
      throw new Error(`Invalid occurrence version '${row.version}'.`);
    }
  }

  public static toDomain(row: CloudRecurringOccurrenceRow): RecurringOccurrence {
    this.validateCloudRow(row);
    if (row.deleted_at) {
      throw new Error(`Cannot map tombstoned occurrence '${row.id}' to domain entity.`);
    }

    return new RecurringOccurrence({
      id: createRecurringOccurrenceId(row.id.trim()),
      userId: validateUserId(row.user_id),
      recurringRuleId: createRecurringRuleId(row.recurring_rule_id.trim()),
      occurrenceDate: row.occurrence_date.trim(),
      status: row.status,
      snoozedUntilDate: row.snoozed_until_date ? row.snoozed_until_date.trim() : null,
      transactionId: row.transaction_id ? createTransactionId(row.transaction_id.trim()) : null,
      idempotencyKey: row.idempotency_key.trim(),
      confirmedAt: row.confirmed_at ? new Date(row.confirmed_at) : null,
      skippedAt: row.skipped_at ? new Date(row.skipped_at) : null,
      dismissedAt: row.dismissed_at ? new Date(row.dismissed_at) : null,
      version: row.version,
      createdAt: row.created_at ? new Date(row.created_at) : undefined,
      updatedAt: row.updated_at ? new Date(row.updated_at) : undefined
    });
  }

  public static toLocalRecord(row: CloudRecurringOccurrenceRow): LocalRecurringOccurrenceRecord {
    this.validateCloudRow(row);
    if (row.deleted_at) {
      throw new Error(`Cannot map tombstoned occurrence '${row.id}' to local record.`);
    }
    const nowIso = new Date().toISOString();
    return {
      id: row.id.trim(),
      userId: validateUserId(row.user_id),
      recurringRuleId: row.recurring_rule_id.trim(),
      occurrenceDate: row.occurrence_date.trim(),
      status: row.status,
      snoozedUntilDate: row.snoozed_until_date ? row.snoozed_until_date.trim() : null,
      transactionId: row.transaction_id ? row.transaction_id.trim() : null,
      idempotencyKey: row.idempotency_key.trim(),
      confirmedAt: row.confirmed_at ? new Date(row.confirmed_at).toISOString() : null,
      skippedAt: row.skipped_at ? new Date(row.skipped_at).toISOString() : null,
      dismissedAt: row.dismissed_at ? new Date(row.dismissed_at).toISOString() : null,
      version: row.version,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : nowIso,
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : nowIso,
      deletedAt: null
    };
  }

  public static mapCreatePayload(payload: Record<string, unknown>): CloudRecurringOccurrenceRow {
    const row: CloudRecurringOccurrenceRow = {
      id: String(payload.id ?? '').trim(),
      user_id: String(payload.user_id ?? payload.userId ?? '').trim(),
      recurring_rule_id: String(
        payload.recurring_rule_id ?? payload.recurringRuleId ?? ''
      ).trim(),
      occurrence_date: String(payload.occurrence_date ?? payload.occurrenceDate ?? '').trim(),
      status: (payload.status as RecurringOccurrenceStatus) ?? 'pending',
      snoozed_until_date:
        typeof (payload.snoozed_until_date ?? payload.snoozedUntilDate) === 'string' &&
        String(payload.snoozed_until_date ?? payload.snoozedUntilDate).trim().length > 0
          ? String(payload.snoozed_until_date ?? payload.snoozedUntilDate).trim()
          : null,
      transaction_id:
        typeof (payload.transaction_id ?? payload.transactionId) === 'string' &&
        String(payload.transaction_id ?? payload.transactionId).trim().length > 0
          ? String(payload.transaction_id ?? payload.transactionId).trim()
          : null,
      idempotency_key: String(payload.idempotency_key ?? payload.idempotencyKey ?? '').trim(),
      confirmed_at:
        typeof (payload.confirmed_at ?? payload.confirmedAt) === 'string'
          ? new Date(String(payload.confirmed_at ?? payload.confirmedAt)).toISOString()
          : null,
      skipped_at:
        typeof (payload.skipped_at ?? payload.skippedAt) === 'string'
          ? new Date(String(payload.skipped_at ?? payload.skippedAt)).toISOString()
          : null,
      dismissed_at:
        typeof (payload.dismissed_at ?? payload.dismissedAt) === 'string'
          ? new Date(String(payload.dismissed_at ?? payload.dismissedAt)).toISOString()
          : null,
      version: Number(payload.version ?? 1),
      created_at:
        typeof payload.created_at === 'string'
          ? new Date(payload.created_at).toISOString()
          : undefined,
      updated_at:
        typeof payload.updated_at === 'string'
          ? new Date(payload.updated_at).toISOString()
          : undefined,
      deleted_at: null
    };

    this.validateCloudRow(row);
    return row;
  }

  public static mapUpdatePayload(
    payload: Record<string, unknown>
  ): Partial<CloudRecurringOccurrenceRow> {
    const patch: Partial<CloudRecurringOccurrenceRow> = {};

    if (payload.status !== undefined) patch.status = payload.status as RecurringOccurrenceStatus;
    if (payload.snoozed_until_date !== undefined || payload.snoozedUntilDate !== undefined) {
      const s = payload.snoozed_until_date ?? payload.snoozedUntilDate;
      patch.snoozed_until_date = typeof s === 'string' && s.trim().length > 0 ? s.trim() : null;
    }
    if (payload.transaction_id !== undefined || payload.transactionId !== undefined) {
      const t = payload.transaction_id ?? payload.transactionId;
      patch.transaction_id = typeof t === 'string' && t.trim().length > 0 ? t.trim() : null;
    }
    if (payload.confirmed_at !== undefined || payload.confirmedAt !== undefined) {
      const c = payload.confirmed_at ?? payload.confirmedAt;
      patch.confirmed_at = typeof c === 'string' ? new Date(c).toISOString() : null;
    }
    if (payload.skipped_at !== undefined || payload.skippedAt !== undefined) {
      const s = payload.skipped_at ?? payload.skippedAt;
      patch.skipped_at = typeof s === 'string' ? new Date(s).toISOString() : null;
    }
    if (payload.dismissed_at !== undefined || payload.dismissedAt !== undefined) {
      const d = payload.dismissed_at ?? payload.dismissedAt;
      patch.dismissed_at = typeof d === 'string' ? new Date(d).toISOString() : null;
    }
    if (typeof payload.version === 'number') patch.version = payload.version;
    patch.updated_at =
      typeof payload.updated_at === 'string'
        ? new Date(payload.updated_at).toISOString()
        : new Date().toISOString();

    return patch;
  }
}

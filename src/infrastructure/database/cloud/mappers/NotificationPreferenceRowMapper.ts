import {
  MAX_UPCOMING_LEAD_DAYS,
  MIN_UPCOMING_LEAD_DAYS,
  NotificationPreference
} from '@/domain/entities/NotificationPreference';
import { InvalidNotificationPreferenceError } from '@/domain/errors/NotificationErrors';
import { validateUserId } from '@/domain/value-objects/Identifiers';
import { LocalNotificationPreferenceRecord } from '@/infrastructure/database/local/schema';

export interface CloudNotificationPreferenceRow {
  user_id: string;
  recurring_payment_enabled: boolean;
  budget_warning_enabled: boolean;
  budget_exceeded_enabled: boolean;
  upcoming_lead_days: number;
  version: number;
  created_at: string;
  updated_at: string;
}

function parseIsoTimestamp(raw: unknown, fieldName: string): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new InvalidNotificationPreferenceError(
      `Invalid cloud notification preference ${fieldName}: missing timestamp.`
    );
  }
  const parsed = new Date(raw);
  if (isNaN(parsed.getTime())) {
    throw new InvalidNotificationPreferenceError(
      `Invalid cloud notification preference ${fieldName}: '${raw}'.`
    );
  }
  return parsed.toISOString();
}

export class NotificationPreferenceRowMapper {
  public static validateCloudRow(row: CloudNotificationPreferenceRow): void {
    if (!row || typeof row !== 'object') {
      throw new InvalidNotificationPreferenceError(
        'Malformed cloud notification preference row: expected object.'
      );
    }

    validateUserId(row.user_id);

    if (
      typeof row.recurring_payment_enabled !== 'boolean' ||
      typeof row.budget_warning_enabled !== 'boolean' ||
      typeof row.budget_exceeded_enabled !== 'boolean'
    ) {
      throw new InvalidNotificationPreferenceError(
        'Cloud notification preference toggles must be boolean values.'
      );
    }

    if (
      typeof row.upcoming_lead_days !== 'number' ||
      !Number.isSafeInteger(row.upcoming_lead_days) ||
      row.upcoming_lead_days < MIN_UPCOMING_LEAD_DAYS ||
      row.upcoming_lead_days > MAX_UPCOMING_LEAD_DAYS
    ) {
      throw new InvalidNotificationPreferenceError(
        `Invalid cloud upcoming_lead_days '${row.upcoming_lead_days}': must be integer between ${MIN_UPCOMING_LEAD_DAYS} and ${MAX_UPCOMING_LEAD_DAYS}.`
      );
    }

    if (
      typeof row.version !== 'number' ||
      !Number.isSafeInteger(row.version) ||
      row.version < 1
    ) {
      throw new InvalidNotificationPreferenceError(
        `Invalid cloud notification preference version '${row.version}'.`
      );
    }

    parseIsoTimestamp(row.created_at, 'created_at');
    parseIsoTimestamp(row.updated_at, 'updated_at');
  }

  public static toDomain(row: CloudNotificationPreferenceRow): NotificationPreference {
    this.validateCloudRow(row);
    return new NotificationPreference({
      userId: validateUserId(row.user_id),
      recurringPaymentEnabled: row.recurring_payment_enabled,
      budgetWarningEnabled: row.budget_warning_enabled,
      budgetExceededEnabled: row.budget_exceeded_enabled,
      upcomingLeadDays: row.upcoming_lead_days,
      version: row.version,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString()
    });
  }

  public static toLocalRecord(
    row: CloudNotificationPreferenceRow
  ): LocalNotificationPreferenceRecord {
    const domain = this.toDomain(row);
    return {
      userId: domain.userId,
      recurringPaymentEnabled: domain.recurringPaymentEnabled,
      budgetWarningEnabled: domain.budgetWarningEnabled,
      budgetExceededEnabled: domain.budgetExceededEnabled,
      upcomingLeadDays: domain.upcomingLeadDays,
      version: domain.version,
      createdAt: domain.createdAt,
      updatedAt: domain.updatedAt
    };
  }

  public static toCloud(entity: NotificationPreference): CloudNotificationPreferenceRow {
    return {
      user_id: entity.userId,
      recurring_payment_enabled: entity.recurringPaymentEnabled,
      budget_warning_enabled: entity.budgetWarningEnabled,
      budget_exceeded_enabled: entity.budgetExceededEnabled,
      upcoming_lead_days: entity.upcomingLeadDays,
      version: entity.version,
      created_at: entity.createdAt,
      updated_at: entity.updatedAt
    };
  }

  public static mapCreatePayload(
    payload: Record<string, unknown>
  ): CloudNotificationPreferenceRow {
    const nowIso = new Date().toISOString();
    const row: CloudNotificationPreferenceRow = {
      user_id: String(payload.user_id ?? payload.userId ?? '').trim(),
      recurring_payment_enabled: (payload.recurring_payment_enabled ??
        payload.recurringPaymentEnabled) as boolean,
      budget_warning_enabled: (payload.budget_warning_enabled ??
        payload.budgetWarningEnabled) as boolean,
      budget_exceeded_enabled: (payload.budget_exceeded_enabled ??
        payload.budgetExceededEnabled) as boolean,
      upcoming_lead_days: (payload.upcoming_lead_days ?? payload.upcomingLeadDays) as number,
      version: Number(payload.version ?? 1),
      created_at:
        typeof (payload.created_at ?? payload.createdAt) === 'string'
          ? parseIsoTimestamp(payload.created_at ?? payload.createdAt, 'created_at')
          : nowIso,
      updated_at:
        typeof (payload.updated_at ?? payload.updatedAt) === 'string'
          ? parseIsoTimestamp(payload.updated_at ?? payload.updatedAt, 'updated_at')
          : nowIso
    };

    this.validateCloudRow(row);
    return row;
  }

  public static mapUpdatePayload(
    payload: Record<string, unknown>
  ): Partial<CloudNotificationPreferenceRow> {
    const patch: Partial<CloudNotificationPreferenceRow> = {};

    const recurring = payload.recurring_payment_enabled ?? payload.recurringPaymentEnabled;
    if (recurring !== undefined) {
      if (typeof recurring !== 'boolean') {
        throw new InvalidNotificationPreferenceError(
          'recurring_payment_enabled must be a boolean.'
        );
      }
      patch.recurring_payment_enabled = recurring;
    }

    const warning = payload.budget_warning_enabled ?? payload.budgetWarningEnabled;
    if (warning !== undefined) {
      if (typeof warning !== 'boolean') {
        throw new InvalidNotificationPreferenceError('budget_warning_enabled must be a boolean.');
      }
      patch.budget_warning_enabled = warning;
    }

    const exceeded = payload.budget_exceeded_enabled ?? payload.budgetExceededEnabled;
    if (exceeded !== undefined) {
      if (typeof exceeded !== 'boolean') {
        throw new InvalidNotificationPreferenceError(
          'budget_exceeded_enabled must be a boolean.'
        );
      }
      patch.budget_exceeded_enabled = exceeded;
    }

    const leadDays = payload.upcoming_lead_days ?? payload.upcomingLeadDays;
    if (leadDays !== undefined) {
      if (
        typeof leadDays !== 'number' ||
        !Number.isSafeInteger(leadDays) ||
        leadDays < MIN_UPCOMING_LEAD_DAYS ||
        leadDays > MAX_UPCOMING_LEAD_DAYS
      ) {
        throw new InvalidNotificationPreferenceError(
          `upcoming_lead_days must be an integer between ${MIN_UPCOMING_LEAD_DAYS} and ${MAX_UPCOMING_LEAD_DAYS}.`
        );
      }
      patch.upcoming_lead_days = leadDays;
    }

    if (typeof payload.version === 'number') {
      if (!Number.isSafeInteger(payload.version) || payload.version < 2) {
        throw new InvalidNotificationPreferenceError(
          `Invalid preference update version '${payload.version}'.`
        );
      }
      patch.version = payload.version;
    }

    const rawUpdatedAt = payload.updated_at ?? payload.updatedAt;
    patch.updated_at = rawUpdatedAt
      ? parseIsoTimestamp(rawUpdatedAt, 'updated_at')
      : new Date().toISOString();

    return patch;
  }
}

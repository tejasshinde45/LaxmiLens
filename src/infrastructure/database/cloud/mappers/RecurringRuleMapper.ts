import {
  RecurringRule,
  RecurrenceFrequency,
  RecurringRuleStatus,
  RecurringTransactionType
} from '@/domain/entities/RecurringRule';
import {
  createAccountId,
  createCategoryId,
  createRecurringRuleId,
  isValidUuid,
  validateUserId
} from '@/domain/value-objects/Identifiers';
import { Money } from '@/domain/value-objects/Money';
import {
  RECURRENCE_FREQUENCIES,
  isValidLocalCalendarDate
} from '@/domain/services/RecurrenceScheduleService';
import { LocalRecurringRuleRecord } from '@/infrastructure/database/local/schema';

export interface CloudRecurringRuleRow {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  type: RecurringTransactionType;
  amount_paise: number;
  account_id: string;
  category_id: string | null;
  frequency: RecurrenceFrequency;
  interval: number;
  anchor_day_of_month: number;
  start_date: string;
  end_date: string | null;
  next_due_date: string;
  last_generated_date: string | null;
  status: RecurringRuleStatus;
  requires_user_confirmation: boolean;
  version: number;
  created_at?: string;
  updated_at?: string;
  deleted_at: string | null;
}

export class RecurringRuleMapper {
  public static validateCloudRow(row: CloudRecurringRuleRow): void {
    if (!row || typeof row !== 'object') {
      throw new Error('Malformed cloud recurring rule row: expected object.');
    }
    if (typeof row.id !== 'string' || !isValidUuid(row.id)) {
      throw new Error(`Invalid cloud recurring rule ID '${row.id}': must be a valid UUID.`);
    }
    validateUserId(row.user_id);

    if (typeof row.title !== 'string' || row.title.trim().length === 0) {
      throw new Error(`Invalid cloud recurring rule title on '${row.id}'.`);
    }
    if (row.type !== 'income' && row.type !== 'expense') {
      throw new Error(`Invalid cloud recurring rule type '${row.type}'.`);
    }
    if (
      typeof row.amount_paise !== 'number' ||
      !Number.isSafeInteger(row.amount_paise) ||
      row.amount_paise <= 0
    ) {
      throw new Error(`Invalid cloud recurring rule amount_paise '${row.amount_paise}'.`);
    }
    if (typeof row.account_id !== 'string' || !isValidUuid(row.account_id)) {
      throw new Error(`Invalid cloud recurring rule account_id '${row.account_id}'.`);
    }
    if (
      row.category_id !== null &&
      row.category_id !== undefined &&
      (typeof row.category_id !== 'string' || !isValidUuid(row.category_id))
    ) {
      throw new Error(`Invalid cloud recurring rule category_id '${row.category_id}'.`);
    }
    if (!RECURRENCE_FREQUENCIES.includes(row.frequency)) {
      throw new Error(`Invalid cloud recurring rule frequency '${row.frequency}'.`);
    }
    if (
      typeof row.interval !== 'number' ||
      !Number.isSafeInteger(row.interval) ||
      row.interval < 1 ||
      row.interval > 365
    ) {
      throw new Error(`Invalid cloud recurring rule interval '${row.interval}'.`);
    }
    if (
      typeof row.anchor_day_of_month !== 'number' ||
      !Number.isSafeInteger(row.anchor_day_of_month) ||
      row.anchor_day_of_month < 1 ||
      row.anchor_day_of_month > 31
    ) {
      throw new Error(`Invalid cloud anchor_day_of_month '${row.anchor_day_of_month}'.`);
    }
    if (!isValidLocalCalendarDate(row.start_date)) {
      throw new Error(`Invalid cloud start_date '${row.start_date}'.`);
    }
    if (row.end_date !== null && row.end_date !== undefined && !isValidLocalCalendarDate(row.end_date)) {
      throw new Error(`Invalid cloud end_date '${row.end_date}'.`);
    }
    if (!isValidLocalCalendarDate(row.next_due_date)) {
      throw new Error(`Invalid cloud next_due_date '${row.next_due_date}'.`);
    }
    if (
      row.last_generated_date !== null &&
      row.last_generated_date !== undefined &&
      !isValidLocalCalendarDate(row.last_generated_date)
    ) {
      throw new Error(`Invalid cloud last_generated_date '${row.last_generated_date}'.`);
    }
    if (row.status !== 'active' && row.status !== 'paused' && row.status !== 'completed') {
      throw new Error(`Invalid cloud status '${row.status}'.`);
    }
    if (typeof row.version !== 'number' || !Number.isSafeInteger(row.version) || row.version < 1) {
      throw new Error(`Invalid cloud version '${row.version}'.`);
    }
  }

  public static toDomain(row: CloudRecurringRuleRow): RecurringRule {
    this.validateCloudRow(row);
    if (row.deleted_at) {
      throw new Error(`Cannot map tombstoned recurring rule '${row.id}' to domain entity.`);
    }

    return new RecurringRule({
      id: createRecurringRuleId(row.id.trim()),
      userId: validateUserId(row.user_id),
      title: row.title.trim(),
      description: row.description ?? undefined,
      type: row.type,
      amount: Money.fromPaise(row.amount_paise, 'INR'),
      accountId: createAccountId(row.account_id.trim()),
      categoryId: row.category_id ? createCategoryId(row.category_id.trim()) : undefined,
      frequency: row.frequency,
      interval: row.interval,
      anchorDayOfMonth: row.anchor_day_of_month,
      startDate: row.start_date.trim(),
      endDate: row.end_date ? row.end_date.trim() : null,
      nextDueDate: row.next_due_date.trim(),
      lastGeneratedDate: row.last_generated_date ? row.last_generated_date.trim() : null,
      status: row.status,
      requiresUserConfirmation: row.requires_user_confirmation ?? true,
      version: row.version,
      createdAt: row.created_at ? new Date(row.created_at) : undefined,
      updatedAt: row.updated_at ? new Date(row.updated_at) : undefined
    });
  }

  public static toLocalRecord(
    row: CloudRecurringRuleRow,
    resolvedLocalCategoryId?: string | null
  ): LocalRecurringRuleRecord {
    this.validateCloudRow(row);
    if (row.deleted_at) {
      throw new Error(`Cannot map tombstoned recurring rule '${row.id}' to local record.`);
    }
    const nowIso = new Date().toISOString();
    return {
      id: row.id.trim(),
      userId: validateUserId(row.user_id),
      title: row.title.trim(),
      description: row.description ?? undefined,
      type: row.type,
      amountPaise: row.amount_paise,
      accountId: row.account_id.trim(),
      categoryId: resolvedLocalCategoryId ?? (row.category_id ? row.category_id.trim() : undefined),
      frequency: row.frequency,
      interval: row.interval,
      anchorDayOfMonth: row.anchor_day_of_month,
      startDate: row.start_date.trim(),
      endDate: row.end_date ? row.end_date.trim() : null,
      nextDueDate: row.next_due_date.trim(),
      lastGeneratedDate: row.last_generated_date ? row.last_generated_date.trim() : null,
      status: row.status,
      requiresUserConfirmation: row.requires_user_confirmation ?? true,
      version: row.version,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : nowIso,
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : nowIso,
      deletedAt: null
    };
  }

  public static mapCreatePayload(payload: Record<string, unknown>): CloudRecurringRuleRow {
    const id = String(payload.id ?? '').trim();
    const userId = String(payload.user_id ?? payload.userId ?? '').trim();
    const title = String(payload.title ?? '').trim();
    const type = payload.type as RecurringTransactionType;
    const amountPaise = Number(payload.amount_paise ?? payload.amountPaise);
    const accountId = String(payload.account_id ?? payload.accountId ?? '').trim();
    const rawCat = payload.category_id ?? payload.categoryId;
    const categoryId = typeof rawCat === 'string' && rawCat.trim().length > 0 ? rawCat.trim() : null;
    const frequency = payload.frequency as RecurrenceFrequency;
    const interval = Number(payload.interval ?? 1);
    const startDate = String(payload.start_date ?? payload.startDate ?? '').trim();
    const anchorDay = Number(
      payload.anchor_day_of_month ?? payload.anchorDayOfMonth ?? Number(startDate.split('-')[2] || 1)
    );
    const endDate =
      typeof (payload.end_date ?? payload.endDate) === 'string' &&
      String(payload.end_date ?? payload.endDate).trim().length > 0
        ? String(payload.end_date ?? payload.endDate).trim()
        : null;
    const nextDueDate = String(payload.next_due_date ?? payload.nextDueDate ?? startDate).trim();
    const lastGeneratedDate =
      typeof (payload.last_generated_date ?? payload.lastGeneratedDate) === 'string' &&
      String(payload.last_generated_date ?? payload.lastGeneratedDate).trim().length > 0
        ? String(payload.last_generated_date ?? payload.lastGeneratedDate).trim()
        : null;
    const status = (payload.status as RecurringRuleStatus) ?? 'active';
    const version = Number(payload.version ?? 1);

    const row: CloudRecurringRuleRow = {
      id,
      user_id: userId,
      title,
      description:
        typeof payload.description === 'string' && payload.description.trim().length > 0
          ? payload.description.trim()
          : null,
      type,
      amount_paise: amountPaise,
      account_id: accountId,
      category_id: categoryId,
      frequency,
      interval,
      anchor_day_of_month: anchorDay,
      start_date: startDate,
      end_date: endDate,
      next_due_date: nextDueDate,
      last_generated_date: lastGeneratedDate,
      status,
      requires_user_confirmation:
        typeof (payload.requires_user_confirmation ?? payload.requiresUserConfirmation) === 'boolean'
          ? Boolean(payload.requires_user_confirmation ?? payload.requiresUserConfirmation)
          : true,
      version,
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

  public static mapUpdatePayload(payload: Record<string, unknown>): Partial<CloudRecurringRuleRow> {
    const patch: Partial<CloudRecurringRuleRow> = {};

    if (typeof payload.title === 'string') patch.title = payload.title.trim();
    if (payload.description !== undefined) {
      patch.description =
        typeof payload.description === 'string' && payload.description.trim().length > 0
          ? payload.description.trim()
          : null;
    }
    if (payload.amount_paise !== undefined || payload.amountPaise !== undefined) {
      patch.amount_paise = Number(payload.amount_paise ?? payload.amountPaise);
    }
    if (payload.account_id !== undefined || payload.accountId !== undefined) {
      patch.account_id = String(payload.account_id ?? payload.accountId).trim();
    }
    if (payload.category_id !== undefined || payload.categoryId !== undefined) {
      const c = payload.category_id ?? payload.categoryId;
      patch.category_id = typeof c === 'string' && c.trim().length > 0 ? c.trim() : null;
    }
    if (payload.frequency !== undefined) patch.frequency = payload.frequency as RecurrenceFrequency;
    if (payload.interval !== undefined) patch.interval = Number(payload.interval);
    if (payload.anchor_day_of_month !== undefined || payload.anchorDayOfMonth !== undefined) {
      patch.anchor_day_of_month = Number(payload.anchor_day_of_month ?? payload.anchorDayOfMonth);
    }
    if (payload.end_date !== undefined || payload.endDate !== undefined) {
      const e = payload.end_date ?? payload.endDate;
      patch.end_date = typeof e === 'string' && e.trim().length > 0 ? e.trim() : null;
    }
    if (payload.next_due_date !== undefined || payload.nextDueDate !== undefined) {
      patch.next_due_date = String(payload.next_due_date ?? payload.nextDueDate).trim();
    }
    if (payload.last_generated_date !== undefined || payload.lastGeneratedDate !== undefined) {
      const lg = payload.last_generated_date ?? payload.lastGeneratedDate;
      patch.last_generated_date = typeof lg === 'string' && lg.trim().length > 0 ? lg.trim() : null;
    }
    if (payload.status !== undefined) patch.status = payload.status as RecurringRuleStatus;
    if (typeof payload.version === 'number') patch.version = payload.version;
    patch.updated_at =
      typeof payload.updated_at === 'string'
        ? new Date(payload.updated_at).toISOString()
        : new Date().toISOString();

    return patch;
  }

  public static mapSoftDeletePayload(payload: Record<string, unknown>): Partial<CloudRecurringRuleRow> {
    const version = Number(payload.version);
    if (!Number.isSafeInteger(version) || version < 2) {
      throw new Error(`Invalid soft-delete recurring rule version '${payload.version}'.`);
    }
    const deletedAt =
      typeof payload.deleted_at === 'string' && !Number.isNaN(new Date(payload.deleted_at).getTime())
        ? new Date(payload.deleted_at).toISOString()
        : new Date().toISOString();
    return {
      deleted_at: deletedAt,
      version,
      updated_at:
        typeof payload.updated_at === 'string'
          ? new Date(payload.updated_at).toISOString()
          : deletedAt
    };
  }
}

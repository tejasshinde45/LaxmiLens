import {
  Notification,
  NotificationEntityType,
  NotificationMetadata,
  NotificationStatus
} from '@/domain/entities/Notification';
import { InvalidNotificationError } from '@/domain/errors/NotificationErrors';
import {
  NotificationCategory,
  NotificationSeverity
} from '@/domain/services/NotificationIdentityService';
import { isValidLocalCalendarDate } from '@/domain/services/RecurrenceScheduleService';
import {
  createNotificationId,
  isValidUuid,
  validateUserId
} from '@/domain/value-objects/Identifiers';
import { LocalNotificationRecord } from '@/infrastructure/database/local/schema';

export interface CloudNotificationRow {
  id: string;
  user_id: string;
  category: NotificationCategory;
  severity: NotificationSeverity;
  status: NotificationStatus;
  dedupe_key: string;
  title: string;
  message: string;
  entity_type: NotificationEntityType;
  entity_id: string;
  trigger_date: string;
  action_route: string;
  metadata_json: NotificationMetadata | Record<string, unknown>;
  read_at: string | null;
  dismissed_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

const VALID_CATEGORIES: ReadonlySet<NotificationCategory> = new Set([
  'recurring_payment',
  'budget_warning',
  'budget_exceeded'
]);
const VALID_SEVERITIES: ReadonlySet<NotificationSeverity> = new Set([
  'info',
  'warning',
  'critical'
]);
const VALID_STATUSES: ReadonlySet<NotificationStatus> = new Set([
  'unread',
  'read',
  'dismissed'
]);
const VALID_ENTITY_TYPES: ReadonlySet<NotificationEntityType> = new Set([
  'recurring_occurrence',
  'recurring_rule',
  'budget'
]);

const NON_NEGATIVE_INTEGER_META_KEYS: ReadonlyArray<keyof NotificationMetadata> = [
  'amountPaise',
  'limitPaise',
  'spentPaise',
  'utilizationPercentage'
];

export function normalizeAndValidateCloudMetadata(raw: unknown): NotificationMetadata {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) {
      return {};
    }
    try {
      obj = JSON.parse(trimmed);
    } catch {
      throw new InvalidNotificationError('Malformed cloud notification metadata_json string.');
    }
  }

  if (obj === null || obj === undefined) {
    return {};
  }
  if (typeof obj !== 'object' || Array.isArray(obj)) {
    throw new InvalidNotificationError('Cloud notification metadata_json must be a JSON object.');
  }

  const record = obj as Record<string, unknown>;
  for (const key of NON_NEGATIVE_INTEGER_META_KEYS) {
    const val = record[key];
    if (val !== undefined) {
      if (typeof val !== 'number' || !Number.isSafeInteger(val) || val < 0) {
        throw new InvalidNotificationError(
          `Invalid cloud notification metadata field '${String(key)}': must be a non-negative safe integer.`
        );
      }
    }
  }

  if (record.daysUntilDue !== undefined) {
    if (typeof record.daysUntilDue !== 'number' || !Number.isSafeInteger(record.daysUntilDue)) {
      throw new InvalidNotificationError(
        `Invalid cloud notification metadata field 'daysUntilDue': must be a safe integer.`
      );
    }
  }

  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    const val = record[key];
    if (val !== undefined) {
      normalized[key] = typeof val === 'string' ? val.trim() : val;
    }
  }
  return normalized as NotificationMetadata;
}

function parseIsoTimestamp(raw: unknown, fieldName: string): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new InvalidNotificationError(`Invalid cloud notification ${fieldName}: missing timestamp.`);
  }
  const parsed = new Date(raw);
  if (isNaN(parsed.getTime())) {
    throw new InvalidNotificationError(`Invalid cloud notification ${fieldName}: '${raw}'.`);
  }
  return parsed.toISOString();
}

function parseOptionalIsoTimestamp(raw: unknown, fieldName: string): string | null {
  if (raw === null || raw === undefined || raw === '') {
    return null;
  }
  return parseIsoTimestamp(raw, fieldName);
}

export class NotificationRowMapper {
  public static validateCloudRow(row: CloudNotificationRow): void {
    if (!row || typeof row !== 'object') {
      throw new InvalidNotificationError('Malformed cloud notification row: expected object.');
    }
    if (typeof row.id !== 'string' || !isValidUuid(row.id)) {
      throw new InvalidNotificationError(`Invalid cloud notification ID '${row.id}'.`);
    }
    validateUserId(row.user_id);

    if (!VALID_CATEGORIES.has(row.category)) {
      throw new InvalidNotificationError(`Invalid cloud notification category '${row.category}'.`);
    }
    if (!VALID_SEVERITIES.has(row.severity)) {
      throw new InvalidNotificationError(`Invalid cloud notification severity '${row.severity}'.`);
    }
    if (
      (row.category === 'budget_warning' && row.severity !== 'warning') ||
      (row.category === 'budget_exceeded' && row.severity !== 'critical')
    ) {
      throw new InvalidNotificationError(
        `Incompatible category '${row.category}' and severity '${row.severity}' on cloud notification '${row.id}'.`
      );
    }
    if (!VALID_STATUSES.has(row.status)) {
      throw new InvalidNotificationError(`Invalid cloud notification status '${row.status}'.`);
    }

    const dedupeKey = typeof row.dedupe_key === 'string' ? row.dedupe_key.trim() : '';
    if (!dedupeKey || dedupeKey.length > 255) {
      throw new InvalidNotificationError(
        `Invalid cloud notification dedupe_key on '${row.id}'.`
      );
    }

    const title = typeof row.title === 'string' ? row.title.trim() : '';
    if (!title || title.length > 160) {
      throw new InvalidNotificationError(`Invalid cloud notification title on '${row.id}'.`);
    }

    const message = typeof row.message === 'string' ? row.message.trim() : '';
    if (!message || message.length > 500) {
      throw new InvalidNotificationError(`Invalid cloud notification message on '${row.id}'.`);
    }

    if (!VALID_ENTITY_TYPES.has(row.entity_type)) {
      throw new InvalidNotificationError(
        `Invalid cloud notification entity_type '${row.entity_type}'.`
      );
    }
    if (typeof row.entity_id !== 'string' || !isValidUuid(row.entity_id)) {
      throw new InvalidNotificationError(
        `Invalid cloud notification entity_id '${row.entity_id}'.`
      );
    }
    if (typeof row.trigger_date !== 'string' || !isValidLocalCalendarDate(row.trigger_date)) {
      throw new InvalidNotificationError(
        `Invalid cloud notification trigger_date '${row.trigger_date}'.`
      );
    }

    const route = typeof row.action_route === 'string' ? row.action_route.trim() : '';
    if (!route || !route.startsWith('/') || route.includes('://')) {
      throw new InvalidNotificationError(
        `Invalid cloud notification action_route '${row.action_route}'.`
      );
    }

    normalizeAndValidateCloudMetadata(row.metadata_json);

    const readAt = parseOptionalIsoTimestamp(row.read_at, 'read_at');
    const dismissedAt = parseOptionalIsoTimestamp(row.dismissed_at, 'dismissed_at');

    if (row.status === 'unread' && (readAt !== null || dismissedAt !== null)) {
      throw new InvalidNotificationError(
        `Unread notification '${row.id}' must not carry read_at or dismissed_at.`
      );
    }
    if (row.status === 'read' && (!readAt || dismissedAt !== null)) {
      throw new InvalidNotificationError(
        `Read notification '${row.id}' must have read_at and null dismissed_at.`
      );
    }
    if (row.status === 'dismissed' && !dismissedAt) {
      throw new InvalidNotificationError(
        `Dismissed notification '${row.id}' must include dismissed_at.`
      );
    }

    if (typeof row.version !== 'number' || !Number.isSafeInteger(row.version) || row.version < 1) {
      throw new InvalidNotificationError(
        `Invalid cloud notification version '${row.version}' on '${row.id}'.`
      );
    }

    parseIsoTimestamp(row.created_at, 'created_at');
    parseIsoTimestamp(row.updated_at, 'updated_at');
    parseOptionalIsoTimestamp(row.deleted_at, 'deleted_at');
  }

  public static toDomain(row: CloudNotificationRow): Notification {
    this.validateCloudRow(row);
    if (row.deleted_at !== null && row.deleted_at !== undefined) {
      throw new InvalidNotificationError(
        `Cannot map tombstoned cloud notification '${row.id}' to active Notification entity.`
      );
    }

    return new Notification({
      id: createNotificationId(row.id.trim()),
      userId: validateUserId(row.user_id),
      category: row.category,
      severity: row.severity,
      status: row.status,
      dedupeKey: row.dedupe_key.trim(),
      title: row.title.trim(),
      message: row.message.trim(),
      entityType: row.entity_type,
      entityId: row.entity_id.trim(),
      triggerDate: row.trigger_date.trim(),
      actionRoute: row.action_route.trim(),
      metadata: normalizeAndValidateCloudMetadata(row.metadata_json),
      readAt: row.read_at ? new Date(row.read_at).toISOString() : undefined,
      dismissedAt: row.dismissed_at ? new Date(row.dismissed_at).toISOString() : undefined,
      version: row.version,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString()
    });
  }

  public static toLocalRecord(row: CloudNotificationRow): LocalNotificationRecord {
    const domain = this.toDomain(row);
    return {
      id: domain.id,
      userId: domain.userId,
      category: domain.category,
      severity: domain.severity,
      status: domain.status,
      dedupeKey: domain.dedupeKey,
      title: domain.title,
      message: domain.message,
      entityType: domain.entityType,
      entityId: domain.entityId,
      triggerDate: domain.triggerDate,
      actionRoute: domain.actionRoute,
      metadataJson: JSON.stringify(domain.metadata),
      readAt: domain.readAt,
      dismissedAt: domain.dismissedAt,
      version: domain.version,
      createdAt: domain.createdAt,
      updatedAt: domain.updatedAt,
      deletedAt: undefined
    };
  }

  public static toCloud(entity: Notification): CloudNotificationRow {
    return {
      id: entity.id,
      user_id: entity.userId,
      category: entity.category,
      severity: entity.severity,
      status: entity.status,
      dedupe_key: entity.dedupeKey,
      title: entity.title,
      message: entity.message,
      entity_type: entity.entityType,
      entity_id: entity.entityId,
      trigger_date: entity.triggerDate,
      action_route: entity.actionRoute,
      metadata_json: { ...entity.metadata },
      read_at: entity.readAt ?? null,
      dismissed_at: entity.dismissedAt ?? null,
      version: entity.version,
      created_at: entity.createdAt,
      updated_at: entity.updatedAt,
      deleted_at: entity.deletedAt ?? null
    };
  }

  public static mapCreatePayload(payload: Record<string, unknown>): CloudNotificationRow {
    const nowIso = new Date().toISOString();
    const rawMeta = payload.metadata_json ?? payload.metadataJson ?? payload.metadata;
    const row: CloudNotificationRow = {
      id: String(payload.id ?? '').trim(),
      user_id: String(payload.user_id ?? payload.userId ?? '').trim(),
      category: payload.category as NotificationCategory,
      severity: payload.severity as NotificationSeverity,
      status: (payload.status as NotificationStatus) ?? 'unread',
      dedupe_key: String(payload.dedupe_key ?? payload.dedupeKey ?? '').trim(),
      title: String(payload.title ?? '').trim(),
      message: String(payload.message ?? '').trim(),
      entity_type: (payload.entity_type ?? payload.entityType) as NotificationEntityType,
      entity_id: String(payload.entity_id ?? payload.entityId ?? '').trim(),
      trigger_date: String(payload.trigger_date ?? payload.triggerDate ?? '').trim(),
      action_route: String(payload.action_route ?? payload.actionRoute ?? '').trim(),
      metadata_json: normalizeAndValidateCloudMetadata(rawMeta),
      read_at: parseOptionalIsoTimestamp(payload.read_at ?? payload.readAt, 'read_at'),
      dismissed_at: parseOptionalIsoTimestamp(
        payload.dismissed_at ?? payload.dismissedAt,
        'dismissed_at'
      ),
      version: Number(payload.version ?? 1),
      created_at:
        typeof (payload.created_at ?? payload.createdAt) === 'string'
          ? parseIsoTimestamp(payload.created_at ?? payload.createdAt, 'created_at')
          : nowIso,
      updated_at:
        typeof (payload.updated_at ?? payload.updatedAt) === 'string'
          ? parseIsoTimestamp(payload.updated_at ?? payload.updatedAt, 'updated_at')
          : nowIso,
      deleted_at: null
    };

    this.validateCloudRow(row);
    return row;
  }

  public static mapUpdatePayload(
    payload: Record<string, unknown>
  ): Partial<CloudNotificationRow> {
    const patch: Partial<CloudNotificationRow> = {};

    if (payload.category !== undefined) {
      if (!VALID_CATEGORIES.has(payload.category as NotificationCategory)) {
        throw new InvalidNotificationError(
          `Invalid update notification category '${String(payload.category)}'.`
        );
      }
      patch.category = payload.category as NotificationCategory;
    }

    if (payload.severity !== undefined) {
      if (!VALID_SEVERITIES.has(payload.severity as NotificationSeverity)) {
        throw new InvalidNotificationError(
          `Invalid update notification severity '${String(payload.severity)}'.`
        );
      }
      patch.severity = payload.severity as NotificationSeverity;
    }

    if (payload.status !== undefined) {
      if (!VALID_STATUSES.has(payload.status as NotificationStatus)) {
        throw new InvalidNotificationError(
          `Invalid update notification status '${String(payload.status)}'.`
        );
      }
      patch.status = payload.status as NotificationStatus;
    }

    if (payload.title !== undefined) {
      const title = String(payload.title).trim();
      if (!title || title.length > 160) {
        throw new InvalidNotificationError('Notification update title must be 1..160 characters.');
      }
      patch.title = title;
    }

    if (payload.message !== undefined) {
      const message = String(payload.message).trim();
      if (!message || message.length > 500) {
        throw new InvalidNotificationError('Notification update message must be 1..500 characters.');
      }
      patch.message = message;
    }

    const rawEntityType = payload.entity_type ?? payload.entityType;
    if (rawEntityType !== undefined) {
      if (!VALID_ENTITY_TYPES.has(rawEntityType as NotificationEntityType)) {
        throw new InvalidNotificationError(
          `Invalid update notification entity_type '${String(rawEntityType)}'.`
        );
      }
      patch.entity_type = rawEntityType as NotificationEntityType;
    }

    const rawEntityId = payload.entity_id ?? payload.entityId;
    if (rawEntityId !== undefined) {
      const trimmed = String(rawEntityId).trim();
      if (!isValidUuid(trimmed)) {
        throw new InvalidNotificationError(`Invalid update entity_id '${trimmed}'.`);
      }
      patch.entity_id = trimmed;
    }

    const rawTriggerDate = payload.trigger_date ?? payload.triggerDate;
    if (rawTriggerDate !== undefined) {
      const trimmed = String(rawTriggerDate).trim();
      if (!isValidLocalCalendarDate(trimmed)) {
        throw new InvalidNotificationError(`Invalid update trigger_date '${trimmed}'.`);
      }
      patch.trigger_date = trimmed;
    }

    const rawRoute = payload.action_route ?? payload.actionRoute;
    if (rawRoute !== undefined) {
      const trimmed = String(rawRoute).trim();
      if (!trimmed || !trimmed.startsWith('/') || trimmed.includes('://')) {
        throw new InvalidNotificationError(`Invalid update action_route '${trimmed}'.`);
      }
      patch.action_route = trimmed;
    }

    const rawMeta = payload.metadata_json ?? payload.metadataJson ?? payload.metadata;
    if (rawMeta !== undefined) {
      patch.metadata_json = normalizeAndValidateCloudMetadata(rawMeta);
    }

    if (payload.read_at !== undefined || payload.readAt !== undefined) {
      patch.read_at = parseOptionalIsoTimestamp(payload.read_at ?? payload.readAt, 'read_at');
    }

    if (payload.dismissed_at !== undefined || payload.dismissedAt !== undefined) {
      patch.dismissed_at = parseOptionalIsoTimestamp(
        payload.dismissed_at ?? payload.dismissedAt,
        'dismissed_at'
      );
    }

    if (typeof payload.version === 'number') {
      if (!Number.isSafeInteger(payload.version) || payload.version < 2) {
        throw new InvalidNotificationError(
          `Invalid notification update version '${payload.version}'.`
        );
      }
      patch.version = payload.version;
    }

    const rawUpdatedAt = payload.updated_at ?? payload.updatedAt;
    if (rawUpdatedAt !== undefined) {
      patch.updated_at = parseIsoTimestamp(rawUpdatedAt, 'updated_at');
    } else {
      patch.updated_at = new Date().toISOString();
    }

    return patch;
  }

  public static mapSoftDeletePayload(payload: Record<string, unknown>): {
    deleted_at: string;
    version: number;
    updated_at: string;
  } {
    const rawDeletedAt = payload.deleted_at ?? payload.deletedAt ?? new Date().toISOString();
    const deleted_at = parseIsoTimestamp(rawDeletedAt, 'deleted_at');
    const version = Number(payload.version);
    if (!Number.isSafeInteger(version) || version < 2) {
      throw new InvalidNotificationError(
        `Invalid notification soft-delete version '${payload.version}'.`
      );
    }
    const rawUpdatedAt = payload.updated_at ?? payload.updatedAt;
    const updated_at = rawUpdatedAt
      ? parseIsoTimestamp(rawUpdatedAt, 'updated_at')
      : deleted_at;
    return { deleted_at, version, updated_at };
  }
}

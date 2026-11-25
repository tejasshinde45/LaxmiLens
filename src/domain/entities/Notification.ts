import { InvalidNotificationError } from '../errors/NotificationErrors';
import {
  compareNotificationSeverity,
  isCompatibleNotificationCategoryProgression,
  NotificationCategory,
  NotificationSeverity
} from '../services/NotificationIdentityService';
import { isValidLocalCalendarDate } from '../services/RecurrenceScheduleService';
import {
  createNotificationId,
  isValidUuid,
  NotificationId,
  UserId,
  validateUserId
} from '../value-objects/Identifiers';

export type NotificationStatus = 'unread' | 'read' | 'dismissed';

export type NotificationEntityType =
  | 'recurring_occurrence'
  | 'recurring_rule'
  | 'budget';

export type RecurringNotificationMilestone = 'upcoming' | 'due_today' | 'overdue';

export interface NotificationMetadata {
  readonly recurringRuleId?: string;
  readonly occurrenceDate?: string;
  readonly dueDate?: string;
  readonly effectiveDueDate?: string;
  readonly daysUntilDue?: number;
  readonly recurringMilestone?: RecurringNotificationMilestone;
  readonly budgetId?: string;
  readonly categoryId?: string;
  readonly categoryName?: string;
  readonly period?: string;
  readonly amountPaise?: number;
  readonly limitPaise?: number;
  readonly spentPaise?: number;
  readonly utilizationPercentage?: number;
}

export interface NotificationProps {
  id: NotificationId | string;
  userId: UserId | string;
  category: NotificationCategory;
  severity: NotificationSeverity;
  status: NotificationStatus;
  dedupeKey: string;
  title: string;
  message: string;
  entityType: NotificationEntityType;
  entityId: string;
  triggerDate: string;
  actionRoute: string;
  metadata?: NotificationMetadata;
  readAt?: string;
  dismissedAt?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface PromoteNotificationInput {
  category: NotificationCategory;
  severity: NotificationSeverity;
  title: string;
  message: string;
  entityType: NotificationEntityType;
  entityId: string;
  triggerDate: string;
  actionRoute: string;
  metadata?: NotificationMetadata;
  now?: string;
}

const VALID_CATEGORIES = new Set<NotificationCategory>([
  'recurring_payment',
  'budget_warning',
  'budget_exceeded'
]);
const VALID_SEVERITIES = new Set<NotificationSeverity>(['info', 'warning', 'critical']);
const VALID_STATUSES = new Set<NotificationStatus>(['unread', 'read', 'dismissed']);
const VALID_ENTITY_TYPES = new Set<NotificationEntityType>([
  'recurring_occurrence',
  'recurring_rule',
  'budget'
]);

const NON_NEGATIVE_PAISE_FIELDS: ReadonlyArray<keyof NotificationMetadata> = [
  'amountPaise',
  'limitPaise',
  'spentPaise',
  'utilizationPercentage'
];

function normalizeAndValidateMetadata(raw?: NotificationMetadata): NotificationMetadata {
  if (!raw) {
    return Object.freeze({});
  }

  for (const field of NON_NEGATIVE_PAISE_FIELDS) {
    const value = raw[field];
    if (value !== undefined) {
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        throw new InvalidNotificationError(
          `Metadata field "${String(field)}" must be a non-negative safe integer`
        );
      }
    }
  }

  if (raw.daysUntilDue !== undefined) {
    if (typeof raw.daysUntilDue !== 'number' || !Number.isSafeInteger(raw.daysUntilDue)) {
      throw new InvalidNotificationError('Metadata field "daysUntilDue" must be a safe integer');
    }
  }

  const normalized: Record<string, unknown> = {};
  const sortedKeys = (Object.keys(raw) as Array<keyof NotificationMetadata>).sort();
  for (const key of sortedKeys) {
    const val = raw[key];
    if (val !== undefined) {
      normalized[key] = typeof val === 'string' ? val.trim() : val;
    }
  }

  return Object.freeze(normalized as NotificationMetadata);
}

function areMetadataEqual(left: NotificationMetadata, right: NotificationMetadata): boolean {
  const leftKeys = Object.keys(left) as Array<keyof NotificationMetadata>;
  const rightKeys = Object.keys(right) as Array<keyof NotificationMetadata>;
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  for (const key of leftKeys) {
    if (left[key] !== right[key]) {
      return false;
    }
  }
  return true;
}

export class Notification {
  public readonly id: NotificationId;
  public readonly userId: UserId;
  public readonly category: NotificationCategory;
  public readonly severity: NotificationSeverity;
  public readonly status: NotificationStatus;
  public readonly dedupeKey: string;
  public readonly title: string;
  public readonly message: string;
  public readonly entityType: NotificationEntityType;
  public readonly entityId: string;
  public readonly triggerDate: string;
  public readonly actionRoute: string;
  public readonly metadata: NotificationMetadata;
  public readonly readAt?: string;
  public readonly dismissedAt?: string;
  public readonly version: number;
  public readonly createdAt: string;
  public readonly updatedAt: string;
  public readonly deletedAt?: string;

  constructor(props: NotificationProps) {
    if (!props.id || !isValidUuid(props.id)) {
      throw new InvalidNotificationError(`Invalid notification ID: "${props.id}"`);
    }
    this.id = createNotificationId(props.id);
    this.userId = validateUserId(props.userId);

    if (!VALID_CATEGORIES.has(props.category)) {
      throw new InvalidNotificationError(`Invalid notification category: "${props.category}"`);
    }
    this.category = props.category;

    if (!VALID_SEVERITIES.has(props.severity)) {
      throw new InvalidNotificationError(`Invalid notification severity: "${props.severity}"`);
    }
    this.severity = props.severity;

    if (!VALID_STATUSES.has(props.status)) {
      throw new InvalidNotificationError(`Invalid notification status: "${props.status}"`);
    }
    this.status = props.status;

    const dedupeKey = props.dedupeKey?.trim();
    if (!dedupeKey || dedupeKey.length > 255) {
      throw new InvalidNotificationError('Notification dedupeKey must be between 1 and 255 characters');
    }
    this.dedupeKey = dedupeKey;

    const title = props.title?.trim();
    if (!title || title.length > 160) {
      throw new InvalidNotificationError('Notification title must be between 1 and 160 characters');
    }
    this.title = title;

    const message = props.message?.trim();
    if (!message || message.length > 500) {
      throw new InvalidNotificationError('Notification message must be between 1 and 500 characters');
    }
    this.message = message;

    if (!VALID_ENTITY_TYPES.has(props.entityType)) {
      throw new InvalidNotificationError(`Invalid notification entityType: "${props.entityType}"`);
    }
    this.entityType = props.entityType;

    const entityId = props.entityId?.trim();
    if (!entityId || !isValidUuid(entityId)) {
      throw new InvalidNotificationError(`Notification entityId must be a valid UUID: "${props.entityId}"`);
    }
    this.entityId = entityId;

    if (!isValidLocalCalendarDate(props.triggerDate)) {
      throw new InvalidNotificationError(
        `Notification triggerDate must be a valid YYYY-MM-DD local date: "${props.triggerDate}"`
      );
    }
    this.triggerDate = props.triggerDate;

    const actionRoute = props.actionRoute?.trim();
    if (!actionRoute || !actionRoute.startsWith('/') || actionRoute.includes('://')) {
      throw new InvalidNotificationError(
        `Notification actionRoute must be a safe internal app path: "${props.actionRoute}"`
      );
    }
    this.actionRoute = actionRoute;

    this.metadata = normalizeAndValidateMetadata(props.metadata);

    if (props.status === 'read' && !props.readAt) {
      throw new InvalidNotificationError('Read notifications must include readAt timestamp');
    }
    if (props.status === 'dismissed' && !props.dismissedAt) {
      throw new InvalidNotificationError('Dismissed notifications must include dismissedAt timestamp');
    }
    if (!Number.isSafeInteger(props.version) || props.version < 1) {
      throw new InvalidNotificationError('Notification version must be an integer >= 1');
    }
    if (!props.createdAt || !props.updatedAt) {
      throw new InvalidNotificationError('Notification createdAt and updatedAt timestamps are required');
    }

    this.readAt = props.readAt;
    this.dismissedAt = props.dismissedAt;
    this.version = props.version;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
    this.deletedAt = props.deletedAt;

    Object.freeze(this);
  }

  public get isDeleted(): boolean {
    return Boolean(this.deletedAt);
  }

  public get isRead(): boolean {
    return this.status === 'read';
  }

  public get isDismissed(): boolean {
    return this.status === 'dismissed';
  }

  public markAsRead(now = new Date().toISOString()): Notification {
    if (this.deletedAt) {
      throw new InvalidNotificationError(`Cannot mark deleted notification ${this.id} as read`);
    }
    if (this.status === 'read' || this.status === 'dismissed') {
      return this;
    }

    return new Notification({
      ...this.toProps(),
      status: 'read',
      readAt: this.readAt ?? now,
      version: this.version + 1,
      updatedAt: now
    });
  }

  public dismiss(now = new Date().toISOString()): Notification {
    if (this.deletedAt) {
      throw new InvalidNotificationError(`Cannot dismiss deleted notification ${this.id}`);
    }
    if (this.status === 'dismissed') {
      return this;
    }

    return new Notification({
      ...this.toProps(),
      status: 'dismissed',
      dismissedAt: this.dismissedAt ?? now,
      readAt: this.readAt,
      version: this.version + 1,
      updatedAt: now
    });
  }

  public markDeleted(now = new Date().toISOString()): Notification {
    if (this.deletedAt) {
      return this;
    }
    return new Notification({
      ...this.toProps(),
      deletedAt: now,
      version: this.version + 1,
      updatedAt: now
    });
  }

  /**
   * Monotonically promotes an existing notification along its lifecycle:
   * - Never downgrades severity or moves budget_exceeded back to budget_warning.
   * - Never moves status back to unread once read or dismissed.
   * - Preserves original readAt and dismissedAt timestamps verbatim.
   */
  public promoteAlert(input: PromoteNotificationInput): {
    notification: Notification;
    changed: boolean;
  } {
    if (this.deletedAt) {
      return { notification: this, changed: false };
    }

    if (!isCompatibleNotificationCategoryProgression(this.category, input.category)) {
      return { notification: this, changed: false };
    }

    const severityDiff = compareNotificationSeverity(input.severity, this.severity);
    if (severityDiff < 0) {
      return { notification: this, changed: false };
    }

    const categoryEscalated = this.category !== input.category;
    const severityEscalated = severityDiff > 0;

    // Avoid unnecessary churn for already-dismissed alerts unless urgency genuinely escalated.
    if (this.status === 'dismissed' && !categoryEscalated && !severityEscalated) {
      return { notification: this, changed: false };
    }

    const normalizedMeta = normalizeAndValidateMetadata(input.metadata);
    const trimmedTitle = input.title.trim();
    const trimmedMessage = input.message.trim();
    const trimmedEntityId = input.entityId.trim();
    const trimmedActionRoute = input.actionRoute.trim();

    const contentChanged =
      categoryEscalated ||
      severityEscalated ||
      this.title !== trimmedTitle ||
      this.message !== trimmedMessage ||
      this.entityType !== input.entityType ||
      this.entityId !== trimmedEntityId ||
      this.triggerDate !== input.triggerDate ||
      this.actionRoute !== trimmedActionRoute ||
      !areMetadataEqual(this.metadata, normalizedMeta);

    if (!contentChanged) {
      return { notification: this, changed: false };
    }

    const now = input.now ?? new Date().toISOString();
    const promoted = new Notification({
      ...this.toProps(),
      category: input.category,
      severity: input.severity,
      title: trimmedTitle,
      message: trimmedMessage,
      entityType: input.entityType,
      entityId: trimmedEntityId,
      triggerDate: input.triggerDate,
      actionRoute: trimmedActionRoute,
      metadata: normalizedMeta,
      status: this.status,
      readAt: this.readAt,
      dismissedAt: this.dismissedAt,
      version: this.version + 1,
      updatedAt: now
    });

    return { notification: promoted, changed: true };
  }

  public toProps(): NotificationProps {
    return {
      id: this.id,
      userId: this.userId,
      category: this.category,
      severity: this.severity,
      status: this.status,
      dedupeKey: this.dedupeKey,
      title: this.title,
      message: this.message,
      entityType: this.entityType,
      entityId: this.entityId,
      triggerDate: this.triggerDate,
      actionRoute: this.actionRoute,
      metadata: { ...this.metadata },
      readAt: this.readAt,
      dismissedAt: this.dismissedAt,
      version: this.version,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      deletedAt: this.deletedAt
    };
  }
}

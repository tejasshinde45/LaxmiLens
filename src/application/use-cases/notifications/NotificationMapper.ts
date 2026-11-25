import { Notification } from '@/domain/entities/Notification';
import { NotificationPreference } from '@/domain/entities/NotificationPreference';
import {
  NotificationDTO,
  NotificationPreferenceDTO
} from '@/application/dto/NotificationDTO';

export function toNotificationDTO(entity: Notification): NotificationDTO {
  return {
    id: entity.id,
    userId: entity.userId,
    category: entity.category,
    severity: entity.severity,
    status: entity.status,
    dedupeKey: entity.dedupeKey,
    title: entity.title,
    message: entity.message,
    entityType: entity.entityType,
    entityId: entity.entityId,
    triggerDate: entity.triggerDate,
    actionRoute: entity.actionRoute,
    metadata: { ...entity.metadata },
    readAt: entity.readAt,
    dismissedAt: entity.dismissedAt,
    version: entity.version,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt
  };
}

export function toNotificationPreferenceDTO(
  entity: NotificationPreference,
  isDefault: boolean
): NotificationPreferenceDTO {
  return {
    userId: entity.userId,
    recurringPaymentEnabled: entity.recurringPaymentEnabled,
    budgetWarningEnabled: entity.budgetWarningEnabled,
    budgetExceededEnabled: entity.budgetExceededEnabled,
    upcomingLeadDays: entity.upcomingLeadDays,
    version: entity.version,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
    isDefault
  };
}

export function buildNotificationOutboxEntry(
  notification: Notification,
  operation: 'INSERT' | 'UPDATE',
  expectedVersion?: number
) {
  return {
    userId: notification.userId,
    entity: 'notifications' as const,
    entityId: notification.id,
    operation,
    payload: {
      id: notification.id,
      user_id: notification.userId,
      category: notification.category,
      severity: notification.severity,
      status: notification.status,
      dedupe_key: notification.dedupeKey,
      title: notification.title,
      message: notification.message,
      entity_type: notification.entityType,
      entity_id: notification.entityId,
      trigger_date: notification.triggerDate,
      action_route: notification.actionRoute,
      metadata_json: { ...notification.metadata },
      read_at: notification.readAt ?? null,
      dismissed_at: notification.dismissedAt ?? null,
      ...(expectedVersion !== undefined ? { expected_version: expectedVersion } : {}),
      version: notification.version,
      created_at: notification.createdAt,
      updated_at: notification.updatedAt,
      deleted_at: notification.deletedAt ?? null
    },
    idempotencyKey: crypto.randomUUID()
  };
}

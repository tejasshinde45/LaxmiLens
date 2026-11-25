import { NotificationCategory } from '@/domain/services/NotificationIdentityService';
import { NotificationStatus } from '@/domain/entities/Notification';

export const notificationQueryKeys = {
  all: (userId?: string) => ['notifications', userId] as const,
  list: (userId?: string, status?: NotificationStatus, category?: NotificationCategory) =>
    ['notifications', userId, 'list', status ?? 'all', category ?? 'all'] as const,
  preferences: (userId?: string) => ['notificationPreferences', userId] as const,
  pendingOutbox: (userId?: string) => ['pendingOutboxNotificationIds', userId] as const
};

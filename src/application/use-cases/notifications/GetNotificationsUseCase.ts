import { NotificationRepository } from '@/domain/repositories/NotificationRepository';
import { validateUserId } from '@/domain/value-objects/Identifiers';
import {
  GetNotificationsQueryDTO,
  NotificationsResponseDTO
} from '@/application/dto/NotificationDTO';
import { toNotificationDTO } from './NotificationMapper';

export class GetNotificationsUseCase {
  constructor(private readonly notificationRepo: NotificationRepository) {}

  public async execute(
    rawUserId: string,
    query?: GetNotificationsQueryDTO
  ): Promise<NotificationsResponseDTO> {
    const userId = validateUserId(rawUserId);
    const [notifications, unreadCount] = await Promise.all([
      this.notificationRepo.findAll(userId, {
        status: query?.status,
        category: query?.category,
        severity: query?.severity,
        includeDeleted: false
      }),
      this.notificationRepo.countUnread(userId)
    ]);

    return {
      notifications: notifications.map(toNotificationDTO),
      unreadCount,
      totalCount: notifications.length
    };
  }
}

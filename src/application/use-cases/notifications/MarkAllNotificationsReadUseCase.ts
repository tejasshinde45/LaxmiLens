import { NotificationRepository } from '@/domain/repositories/NotificationRepository';
import { validateUserId } from '@/domain/value-objects/Identifiers';
import { SyncPort } from '@/application/ports/SyncPort';
import { UnitOfWork } from '@/application/ports/UnitOfWork';
import { buildNotificationOutboxEntry } from './NotificationMapper';

export class MarkAllNotificationsReadUseCase {
  constructor(
    private readonly notificationRepo: NotificationRepository,
    private readonly syncPort: SyncPort,
    private readonly unitOfWork: UnitOfWork
  ) {}

  public async execute(rawUserId: string): Promise<{ updatedCount: number }> {
    const userId = validateUserId(rawUserId);
    const unreadNotifications = await this.notificationRepo.findAll(userId, {
      status: 'unread',
      includeDeleted: false
    });

    if (unreadNotifications.length === 0) {
      return { updatedCount: 0 };
    }

    const now = new Date().toISOString();
    const updatedPairs = unreadNotifications
      .map((existing) => ({
        existing,
        updated: existing.markAsRead(now)
      }))
      .filter(({ existing, updated }) => updated !== existing);

    if (updatedPairs.length === 0) {
      return { updatedCount: 0 };
    }

    const updatedEntities = updatedPairs.map(({ updated }) => updated);
    const outboxEntries = updatedPairs.map(({ existing, updated }) =>
      buildNotificationOutboxEntry(updated, 'UPDATE', existing.version)
    );

    await this.unitOfWork.run(async () => {
      await this.notificationRepo.saveMany(updatedEntities);
      for (const entry of outboxEntries) {
        await this.syncPort.enqueue(entry);
      }
    });

    return { updatedCount: updatedEntities.length };
  }
}

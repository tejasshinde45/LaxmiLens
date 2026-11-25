import { NotificationRepository } from '@/domain/repositories/NotificationRepository';
import { NotificationNotFoundError } from '@/domain/errors/NotificationErrors';
import { createNotificationId, isValidUuid, validateUserId } from '@/domain/value-objects/Identifiers';
import { SyncPort } from '@/application/ports/SyncPort';
import { UnitOfWork } from '@/application/ports/UnitOfWork';
import { NotificationDTO } from '@/application/dto/NotificationDTO';
import { buildNotificationOutboxEntry, toNotificationDTO } from './NotificationMapper';

export class DismissNotificationUseCase {
  constructor(
    private readonly notificationRepo: NotificationRepository,
    private readonly syncPort: SyncPort,
    private readonly unitOfWork: UnitOfWork
  ) {}

  public async execute(rawUserId: string, rawNotificationId: string): Promise<NotificationDTO> {
    const userId = validateUserId(rawUserId);
    const trimmedId = (rawNotificationId || '').trim();
    if (!trimmedId || !isValidUuid(trimmedId)) {
      throw new NotificationNotFoundError(rawNotificationId ?? '');
    }

    const notificationId = createNotificationId(trimmedId);
    const existing = await this.notificationRepo.findById(notificationId, userId);
    if (!existing) {
      throw new NotificationNotFoundError(trimmedId);
    }

    const now = new Date().toISOString();
    const updated = existing.dismiss(now);
    if (updated === existing) {
      return toNotificationDTO(existing);
    }

    const outboxEntry = buildNotificationOutboxEntry(updated, 'UPDATE', existing.version);

    await this.unitOfWork.run(async () => {
      await this.notificationRepo.save(updated);
      await this.syncPort.enqueue(outboxEntry);
    });

    return toNotificationDTO(updated);
  }
}

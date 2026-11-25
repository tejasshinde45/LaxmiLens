import { Notification, NotificationMetadata } from '@/domain/entities/Notification';
import {
  DuplicateNotificationError,
  InvalidNotificationError
} from '@/domain/errors/NotificationErrors';
import {
  NotificationFilterOptions,
  NotificationRepository
} from '@/domain/repositories/NotificationRepository';
import { NotificationId, UserId, validateUserId } from '@/domain/value-objects/Identifiers';
import { UnauthorizedDatabaseAccessError } from '../errors/DatabaseErrors';
import { LaxmiLensDB } from '../DexieDatabase';
import { LocalNotificationRecord } from '../schema';

function parseMetadataJson(rawJson: string): NotificationMetadata {
  if (!rawJson) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(rawJson);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new InvalidNotificationError('Notification metadataJson must decode to a JSON object');
    }
    return parsed as NotificationMetadata;
  } catch (error) {
    if (error instanceof InvalidNotificationError) {
      throw error;
    }
    throw new InvalidNotificationError('Failed to parse notification metadataJson');
  }
}

export function mapLocalNotificationToDomain(record: LocalNotificationRecord): Notification {
  return new Notification({
    id: record.id,
    userId: record.userId,
    category: record.category,
    severity: record.severity,
    status: record.status,
    dedupeKey: record.dedupeKey,
    title: record.title,
    message: record.message,
    entityType: record.entityType,
    entityId: record.entityId,
    triggerDate: record.triggerDate,
    actionRoute: record.actionRoute,
    metadata: parseMetadataJson(record.metadataJson),
    readAt: record.readAt,
    dismissedAt: record.dismissedAt,
    version: record.version,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    deletedAt: record.deletedAt
  });
}

export function mapDomainNotificationToLocal(entity: Notification): LocalNotificationRecord {
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
    metadataJson: JSON.stringify(entity.metadata),
    readAt: entity.readAt,
    dismissedAt: entity.dismissedAt,
    version: entity.version,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
    deletedAt: entity.deletedAt
  };
}

export class DexieNotificationRepository implements NotificationRepository {
  constructor(private readonly db: LaxmiLensDB) {}

  public async findById(
    id: NotificationId | string,
    userId: UserId | string
  ): Promise<Notification | null> {
    const validatedUserId = validateUserId(userId);
    const record = await this.db.notifications.get(id);
    if (!record) {
      return null;
    }
    if (record.userId !== validatedUserId) {
      throw new UnauthorizedDatabaseAccessError(validatedUserId, record.userId);
    }
    if (record.deletedAt) {
      return null;
    }
    return mapLocalNotificationToDomain(record);
  }

  public async findByDedupeKey(
    userId: UserId | string,
    dedupeKey: string
  ): Promise<Notification | null> {
    const validatedUserId = validateUserId(userId);
    const normalizedKey = dedupeKey.trim();
    if (!normalizedKey) {
      return null;
    }
    const matches = await this.db.notifications
      .where('[userId+dedupeKey]')
      .equals([validatedUserId, normalizedKey])
      .toArray();

    if (matches.length === 0) {
      return null;
    }

    const activeMatch = matches.find((item) => !item.deletedAt) ?? matches[0]!;
    return mapLocalNotificationToDomain(activeMatch);
  }

  public async findAll(
    userId: UserId | string,
    filter?: NotificationFilterOptions
  ): Promise<Notification[]> {
    const validatedUserId = validateUserId(userId);
    const records = await this.db.notifications
      .where('userId')
      .equals(validatedUserId)
      .toArray();

    const includeDeleted = Boolean(filter?.includeDeleted);
    const filtered = records.filter((record) => {
      if (!includeDeleted && record.deletedAt) {
        return false;
      }
      if (filter?.status && record.status !== filter.status) {
        return false;
      }
      if (filter?.category && record.category !== filter.category) {
        return false;
      }
      if (filter?.severity && record.severity !== filter.severity) {
        return false;
      }
      return true;
    });

    filtered.sort((a, b) => {
      const updatedCmp = b.updatedAt.localeCompare(a.updatedAt);
      if (updatedCmp !== 0) return updatedCmp;
      const triggerCmp = b.triggerDate.localeCompare(a.triggerDate);
      if (triggerCmp !== 0) return triggerCmp;
      return a.id.localeCompare(b.id);
    });

    return filtered.map(mapLocalNotificationToDomain);
  }

  public async countUnread(userId: UserId | string): Promise<number> {
    const validatedUserId = validateUserId(userId);
    return this.db.notifications
      .where('[userId+status]')
      .equals([validatedUserId, 'unread'])
      .filter((record) => !record.deletedAt)
      .count();
  }

  public async save(notification: Notification): Promise<void> {
    const validatedUserId = validateUserId(notification.userId);
    const record = mapDomainNotificationToLocal(notification);

    await this.db.transaction('rw', this.db.notifications, async () => {
      const existingById = await this.db.notifications.get(record.id);
      if (existingById && existingById.userId !== validatedUserId) {
        throw new UnauthorizedDatabaseAccessError(validatedUserId, existingById.userId);
      }

      const existingByDedupe = await this.db.notifications
        .where('[userId+dedupeKey]')
        .equals([validatedUserId, record.dedupeKey])
        .toArray();

      const conflicting = existingByDedupe.find((item) => item.id !== record.id);
      if (conflicting) {
        throw new DuplicateNotificationError(record.dedupeKey);
      }

      await this.db.notifications.put(record);
    });
  }

  public async saveMany(notifications: Notification[]): Promise<void> {
    if (notifications.length === 0) {
      return;
    }

    const seenDedupeByUser = new Map<string, string>();
    const records: LocalNotificationRecord[] = [];
    for (const notification of notifications) {
      const validatedUserId = validateUserId(notification.userId);
      const composite = `${validatedUserId}::${notification.dedupeKey}`;
      const existingId = seenDedupeByUser.get(composite);
      if (existingId && existingId !== notification.id) {
        throw new DuplicateNotificationError(notification.dedupeKey);
      }
      seenDedupeByUser.set(composite, notification.id);
      records.push(mapDomainNotificationToLocal(notification));
    }

    await this.db.transaction('rw', this.db.notifications, async () => {
      for (const record of records) {
        const existingById = await this.db.notifications.get(record.id);
        if (existingById && existingById.userId !== record.userId) {
          throw new UnauthorizedDatabaseAccessError(record.userId, existingById.userId);
        }

        const existingByDedupe = await this.db.notifications
          .where('[userId+dedupeKey]')
          .equals([record.userId, record.dedupeKey])
          .toArray();

        const conflicting = existingByDedupe.find((item) => item.id !== record.id);
        if (conflicting) {
          throw new DuplicateNotificationError(record.dedupeKey);
        }
      }

      await this.db.notifications.bulkPut(records);
    });
  }
}

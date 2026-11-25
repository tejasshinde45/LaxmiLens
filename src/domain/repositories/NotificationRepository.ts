import { Notification, NotificationStatus } from '../entities/Notification';
import { NotificationCategory, NotificationSeverity } from '../services/NotificationIdentityService';
import { NotificationId, UserId } from '../value-objects/Identifiers';

export interface NotificationFilterOptions {
  status?: NotificationStatus;
  category?: NotificationCategory;
  severity?: NotificationSeverity;
  includeDeleted?: boolean;
}

export interface NotificationRepository {
  findById(id: NotificationId | string, userId: UserId | string): Promise<Notification | null>;
  findByDedupeKey(userId: UserId | string, dedupeKey: string): Promise<Notification | null>;
  findAll(userId: UserId | string, filter?: NotificationFilterOptions): Promise<Notification[]>;
  countUnread(userId: UserId | string): Promise<number>;
  save(notification: Notification): Promise<void>;
  saveMany(notifications: Notification[]): Promise<void>;
}

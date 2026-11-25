import { NotificationPreference } from '../entities/NotificationPreference';
import { UserId } from '../value-objects/Identifiers';

export interface NotificationPreferenceRepository {
  findByUserId(userId: UserId | string): Promise<NotificationPreference | null>;
  save(preference: NotificationPreference): Promise<void>;
}

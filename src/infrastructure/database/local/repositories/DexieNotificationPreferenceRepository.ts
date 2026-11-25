import { NotificationPreference } from '@/domain/entities/NotificationPreference';
import { NotificationPreferenceRepository } from '@/domain/repositories/NotificationPreferenceRepository';
import { UserId, validateUserId } from '@/domain/value-objects/Identifiers';
import { UnauthorizedDatabaseAccessError } from '../errors/DatabaseErrors';
import { LaxmiLensDB } from '../DexieDatabase';
import { LocalNotificationPreferenceRecord } from '../schema';

export function mapLocalNotificationPreferenceToDomain(
  record: LocalNotificationPreferenceRecord
): NotificationPreference {
  return new NotificationPreference({
    userId: record.userId,
    recurringPaymentEnabled: record.recurringPaymentEnabled,
    budgetWarningEnabled: record.budgetWarningEnabled,
    budgetExceededEnabled: record.budgetExceededEnabled,
    upcomingLeadDays: record.upcomingLeadDays,
    version: record.version,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  });
}

export function mapDomainNotificationPreferenceToLocal(
  entity: NotificationPreference
): LocalNotificationPreferenceRecord {
  return {
    userId: entity.userId,
    recurringPaymentEnabled: entity.recurringPaymentEnabled,
    budgetWarningEnabled: entity.budgetWarningEnabled,
    budgetExceededEnabled: entity.budgetExceededEnabled,
    upcomingLeadDays: entity.upcomingLeadDays,
    version: entity.version,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt
  };
}

export class DexieNotificationPreferenceRepository
  implements NotificationPreferenceRepository
{
  constructor(private readonly db: LaxmiLensDB) {}

  public async findByUserId(userId: UserId | string): Promise<NotificationPreference | null> {
    const validatedUserId = validateUserId(userId);
    const record = await this.db.notificationPreferences.get(validatedUserId);
    if (!record) {
      return null;
    }
    if (record.userId !== validatedUserId) {
      throw new UnauthorizedDatabaseAccessError(validatedUserId, record.userId);
    }
    return mapLocalNotificationPreferenceToDomain(record);
  }

  public async save(preference: NotificationPreference): Promise<void> {
    const validatedUserId = validateUserId(preference.userId);
    const record = mapDomainNotificationPreferenceToLocal(preference);

    await this.db.transaction('rw', this.db.notificationPreferences, async () => {
      const existing = await this.db.notificationPreferences.get(validatedUserId);
      if (existing && existing.userId !== validatedUserId) {
        throw new UnauthorizedDatabaseAccessError(validatedUserId, existing.userId);
      }
      await this.db.notificationPreferences.put(record);
    });
  }
}

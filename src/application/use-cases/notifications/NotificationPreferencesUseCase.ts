import { NotificationPreference } from '@/domain/entities/NotificationPreference';
import { NotificationPreferenceRepository } from '@/domain/repositories/NotificationPreferenceRepository';
import { validateUserId } from '@/domain/value-objects/Identifiers';
import { SyncPort } from '@/application/ports/SyncPort';
import { UnitOfWork } from '@/application/ports/UnitOfWork';
import {
  NotificationPreferenceDTO,
  UpdateNotificationPreferenceDTO
} from '@/application/dto/NotificationDTO';
import { toNotificationPreferenceDTO } from './NotificationMapper';

export class GetNotificationPreferencesUseCase {
  constructor(private readonly preferenceRepo: NotificationPreferenceRepository) {}

  /**
   * Returns persisted user preferences or safe defaults without writing rows during read.
   */
  public async execute(rawUserId: string): Promise<NotificationPreferenceDTO> {
    const userId = validateUserId(rawUserId);
    const existing = await this.preferenceRepo.findByUserId(userId);
    if (!existing) {
      return toNotificationPreferenceDTO(NotificationPreference.createDefault(userId), true);
    }
    return toNotificationPreferenceDTO(existing, false);
  }
}

export class UpdateNotificationPreferencesUseCase {
  constructor(
    private readonly preferenceRepo: NotificationPreferenceRepository,
    private readonly syncPort: SyncPort,
    private readonly unitOfWork: UnitOfWork
  ) {}

  public async execute(
    dto: UpdateNotificationPreferenceDTO
  ): Promise<NotificationPreferenceDTO> {
    const userId = validateUserId(dto.userId);
    const now = new Date().toISOString();
    const existing = await this.preferenceRepo.findByUserId(userId);

    const base = existing ?? NotificationPreference.createDefault(userId, now);
    const updated = existing
      ? existing.update(
          {
            recurringPaymentEnabled: dto.recurringPaymentEnabled,
            budgetWarningEnabled: dto.budgetWarningEnabled,
            budgetExceededEnabled: dto.budgetExceededEnabled,
            upcomingLeadDays: dto.upcomingLeadDays
          },
          now
        )
      : new NotificationPreference({
          userId,
          recurringPaymentEnabled:
            dto.recurringPaymentEnabled ?? base.recurringPaymentEnabled,
          budgetWarningEnabled: dto.budgetWarningEnabled ?? base.budgetWarningEnabled,
          budgetExceededEnabled: dto.budgetExceededEnabled ?? base.budgetExceededEnabled,
          upcomingLeadDays: dto.upcomingLeadDays ?? base.upcomingLeadDays,
          version: 1,
          createdAt: now,
          updatedAt: now
        });

    if (existing && updated === existing) {
      return toNotificationPreferenceDTO(existing, false);
    }

    const operation: 'INSERT' | 'UPDATE' = existing ? 'UPDATE' : 'INSERT';
    const outboxEntry = {
      userId: updated.userId,
      entity: 'notification_preferences' as const,
      entityId: updated.userId,
      operation,
      payload: {
        user_id: updated.userId,
        recurring_payment_enabled: updated.recurringPaymentEnabled,
        budget_warning_enabled: updated.budgetWarningEnabled,
        budget_exceeded_enabled: updated.budgetExceededEnabled,
        upcoming_lead_days: updated.upcomingLeadDays,
        ...(existing ? { expected_version: existing.version } : {}),
        version: updated.version,
        created_at: updated.createdAt,
        updated_at: updated.updatedAt
      },
      idempotencyKey: crypto.randomUUID()
    };

    await this.unitOfWork.run(async () => {
      await this.preferenceRepo.save(updated);
      await this.syncPort.enqueue(outboxEntry);
    });

    return toNotificationPreferenceDTO(updated, false);
  }
}

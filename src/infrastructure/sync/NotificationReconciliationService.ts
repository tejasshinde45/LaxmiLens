import { AuthPort } from '@/application/ports/AuthPort';
import {
  isCompatibleNotificationCategoryProgression,
  NOTIFICATION_SEVERITY_RANK
} from '@/domain/services/NotificationIdentityService';
import { validateUserId } from '@/domain/value-objects/Identifiers';
import { LaxmiLensDB } from '@/infrastructure/database/local/DexieDatabase';
import {
  LocalNotificationPreferenceRecord,
  LocalNotificationRecord,
  LocalOutboxRecord
} from '@/infrastructure/database/local/schema';
import {
  NotificationRowMapper,
  CloudNotificationRow
} from '@/infrastructure/database/cloud/mappers/NotificationRowMapper';
import {
  NotificationPreferenceRowMapper,
  CloudNotificationPreferenceRow
} from '@/infrastructure/database/cloud/mappers/NotificationPreferenceRowMapper';
import { ISupabaseNotificationRepository } from '@/infrastructure/database/cloud/repositories/SupabaseNotificationRepository';
import { ISupabaseNotificationPreferenceRepository } from '@/infrastructure/database/cloud/repositories/SupabaseNotificationPreferenceRepository';
import { SyncAuthError } from './errors/SyncErrors';

export interface NotificationPullConflict {
  entity: 'notifications' | 'notification_preferences';
  entityId: string;
  reason: string;
}

export interface NotificationReconciliationResult {
  pulledCount: number;
  conflictCount: number;
  conflicts: NotificationPullConflict[];
}

function isStatusDowngrade(
  localStatus: LocalNotificationRecord['status'],
  cloudStatus: CloudNotificationRow['status']
): boolean {
  if (localStatus === 'dismissed' && cloudStatus !== 'dismissed') {
    return true;
  }
  if (localStatus === 'read' && cloudStatus === 'unread') {
    return true;
  }
  return false;
}

function areLocalAndCloudNotificationsEquivalent(
  local: LocalNotificationRecord,
  cloud: CloudNotificationRow
): boolean {
  const mappedCloud = NotificationRowMapper.toLocalRecord(cloud);
  return (
    local.id === mappedCloud.id &&
    local.userId === mappedCloud.userId &&
    local.category === mappedCloud.category &&
    local.severity === mappedCloud.severity &&
    local.status === mappedCloud.status &&
    local.dedupeKey === mappedCloud.dedupeKey &&
    local.title === mappedCloud.title &&
    local.message === mappedCloud.message &&
    local.entityType === mappedCloud.entityType &&
    local.entityId === mappedCloud.entityId &&
    local.triggerDate === mappedCloud.triggerDate &&
    local.actionRoute === mappedCloud.actionRoute &&
    local.metadataJson === mappedCloud.metadataJson &&
    local.readAt === mappedCloud.readAt &&
    local.dismissedAt === mappedCloud.dismissedAt &&
    local.version === mappedCloud.version
  );
}

function arePreferencesEqual(
  local: LocalNotificationPreferenceRecord,
  cloud: CloudNotificationPreferenceRow
): boolean {
  return (
    local.userId === cloud.user_id &&
    local.recurringPaymentEnabled === cloud.recurring_payment_enabled &&
    local.budgetWarningEnabled === cloud.budget_warning_enabled &&
    local.budgetExceededEnabled === cloud.budget_exceeded_enabled &&
    local.upcomingLeadDays === cloud.upcoming_lead_days &&
    local.version === cloud.version
  );
}

export class NotificationReconciliationService {
  constructor(
    private readonly database: LaxmiLensDB,
    private readonly cloudNotificationRepo: ISupabaseNotificationRepository,
    private readonly cloudPreferenceRepo: ISupabaseNotificationPreferenceRepository,
    private readonly authPort: AuthPort
  ) {}

  public async pullAndReconcile(userId?: string): Promise<NotificationReconciliationResult> {
    const currentUser = await this.authPort.getCurrentUser();
    if (!currentUser || !currentUser.id) {
      throw new SyncAuthError('Notification reconciliation aborted: User is not authenticated.');
    }

    const authenticatedUserId = validateUserId(currentUser.id);
    if (userId && validateUserId(userId) !== authenticatedUserId) {
      throw new SyncAuthError(
        `Notification reconciliation aborted: Requested user '${userId}' does not match authenticated user.`
      );
    }

    const [cloudNotifications, cloudPreference] = await Promise.all([
      this.cloudNotificationRepo.findAll(authenticatedUserId, { includeDeleted: true }),
      this.cloudPreferenceRepo.findByUserId(authenticatedUserId)
    ]);

    for (const row of cloudNotifications) {
      NotificationRowMapper.validateCloudRow(row);
      if (row.user_id !== authenticatedUserId) {
        throw new SyncAuthError(`Cloud notification '${row.id}' belongs to another user.`);
      }
    }

    if (cloudPreference) {
      NotificationPreferenceRowMapper.validateCloudRow(cloudPreference);
      if (cloudPreference.user_id !== authenticatedUserId) {
        throw new SyncAuthError(
          `Cloud notification preference '${cloudPreference.user_id}' belongs to another user.`
        );
      }
    }

    const tombstones = cloudNotifications.filter(
      (r) => r.deleted_at !== null && r.deleted_at !== undefined
    );
    const activeRows = cloudNotifications.filter(
      (r) => r.deleted_at === null || r.deleted_at === undefined
    );
    const orderedRows = [...tombstones, ...activeRows];

    const result: NotificationReconciliationResult = {
      pulledCount: 0,
      conflictCount: 0,
      conflicts: []
    };

    await this.database.transaction(
      'rw',
      [
        this.database.notifications,
        this.database.notificationPreferences,
        this.database.syncOutbox
      ],
      async () => {
        const outbox = (await this.database.syncOutbox
          .where('userId')
          .equals(authenticatedUserId)
          .toArray()) as LocalOutboxRecord[];

        const pendingNotifEntries = outbox.filter((e) => e.entity === 'notifications');
        const pendingNotifIds = new Set<string>(pendingNotifEntries.map((e) => e.entityId));
        const pendingDedupeKeys = new Set<string>();
        for (const pending of pendingNotifEntries) {
          const rawKey = pending.payload?.dedupe_key ?? pending.payload?.dedupeKey;
          if (typeof rawKey === 'string' && rawKey.trim().length > 0) {
            pendingDedupeKeys.add(rawKey.trim());
          }
        }

        const hasPendingPreference = outbox.some(
          (e) => e.entity === 'notification_preferences' && e.entityId === authenticatedUserId
        );

        const localNotifications = await this.database.notifications
          .where('userId')
          .equals(authenticatedUserId)
          .toArray();

        const localById = new Map<string, LocalNotificationRecord>(
          localNotifications.map((n) => [n.id, n])
        );
        const localByDedupe = new Map<string, LocalNotificationRecord>(
          localNotifications.map((n) => [n.dedupeKey, n])
        );

        for (const pendingId of pendingNotifIds) {
          const localPending = localById.get(pendingId);
          if (localPending) {
            pendingDedupeKeys.add(localPending.dedupeKey);
          }
        }

        for (const cloudRow of orderedRows) {
          if (
            pendingNotifIds.has(cloudRow.id) ||
            pendingDedupeKeys.has(cloudRow.dedupe_key.trim())
          ) {
            continue;
          }

          const existing = localById.get(cloudRow.id);

          if (cloudRow.deleted_at !== null && cloudRow.deleted_at !== undefined) {
            if (existing && !existing.deletedAt) {
              if (cloudRow.version >= existing.version) {
                await this.database.notifications.put({
                  ...existing,
                  deletedAt: new Date(cloudRow.deleted_at).toISOString(),
                  version: cloudRow.version,
                  updatedAt: new Date(cloudRow.updated_at).toISOString()
                });
                result.pulledCount++;
              } else {
                result.conflictCount++;
                result.conflicts.push({
                  entity: 'notifications',
                  entityId: cloudRow.id,
                  reason: `Remote tombstone for notification '${cloudRow.id}' has older version (${cloudRow.version}) than local (${existing.version}).`
                });
              }
            }
            continue;
          }

          const dedupeOccupant = localByDedupe.get(cloudRow.dedupe_key.trim());
          if (dedupeOccupant && dedupeOccupant.id !== cloudRow.id) {
            result.conflictCount++;
            result.conflicts.push({
              entity: 'notifications',
              entityId: cloudRow.id,
              reason: `Dedupe key '${cloudRow.dedupe_key}' is occupied locally by '${dedupeOccupant.id}'. Local notification preserved.`
            });
            continue;
          }

          if (existing) {
            if (existing.deletedAt) {
              result.conflictCount++;
              result.conflicts.push({
                entity: 'notifications',
                entityId: cloudRow.id,
                reason: `Local notification '${cloudRow.id}' is tombstoned; ignoring active remote record.`
              });
              continue;
            }

            const monotonicViolation =
              !isCompatibleNotificationCategoryProgression(existing.category, cloudRow.category) ||
              NOTIFICATION_SEVERITY_RANK[cloudRow.severity] <
                NOTIFICATION_SEVERITY_RANK[existing.severity] ||
              isStatusDowngrade(existing.status, cloudRow.status);

            if (monotonicViolation) {
              result.conflictCount++;
              result.conflicts.push({
                entity: 'notifications',
                entityId: cloudRow.id,
                reason: `Remote notification '${cloudRow.id}' attempted non-monotonic downgrade (status/severity/category). Local notification preserved.`
              });
              continue;
            }

            if (cloudRow.version > existing.version) {
              const mapped = NotificationRowMapper.toLocalRecord(cloudRow);
              await this.database.notifications.put(mapped);
              localById.set(mapped.id, mapped);
              localByDedupe.set(mapped.dedupeKey, mapped);
              result.pulledCount++;
            } else if (cloudRow.version === existing.version) {
              if (!areLocalAndCloudNotificationsEquivalent(existing, cloudRow)) {
                result.conflictCount++;
                result.conflicts.push({
                  entity: 'notifications',
                  entityId: cloudRow.id,
                  reason: `Divergent notification '${cloudRow.id}' at version ${cloudRow.version}. Local notification preserved.`
                });
              }
            } else {
              result.conflictCount++;
              result.conflicts.push({
                entity: 'notifications',
                entityId: cloudRow.id,
                reason: `Remote notification '${cloudRow.id}' has older version (${cloudRow.version}) than local (${existing.version}). Local notification preserved.`
              });
            }
            continue;
          }

          const mapped = NotificationRowMapper.toLocalRecord(cloudRow);
          await this.database.notifications.put(mapped);
          localById.set(mapped.id, mapped);
          localByDedupe.set(mapped.dedupeKey, mapped);
          result.pulledCount++;
        }

        // Reconcile preferences strictly when cloudPreference exists and is not pending locally
        if (cloudPreference && !hasPendingPreference) {
          const localPref = await this.database.notificationPreferences.get(authenticatedUserId);
          if (!localPref || cloudPreference.version > localPref.version) {
            await this.database.notificationPreferences.put(
              NotificationPreferenceRowMapper.toLocalRecord(cloudPreference)
            );
            result.pulledCount++;
          } else if (cloudPreference.version === localPref.version) {
            if (!arePreferencesEqual(localPref, cloudPreference)) {
              result.conflictCount++;
              result.conflicts.push({
                entity: 'notification_preferences',
                entityId: authenticatedUserId,
                reason: `Divergent notification preferences at version ${cloudPreference.version}. Local preference preserved.`
              });
            }
          } else {
            result.conflictCount++;
            result.conflicts.push({
              entity: 'notification_preferences',
              entityId: authenticatedUserId,
              reason: `Remote notification preference version (${cloudPreference.version}) is older than local (${localPref.version}). Local preference preserved.`
            });
          }
        }
      }
    );

    return result;
  }
}

import { AuthPort } from '@/application/ports/AuthPort';
import { LocalOutboxRecord } from '@/infrastructure/database/local/schema';
import {
  CloudNotificationPreferenceRow,
  NotificationPreferenceRowMapper
} from '@/infrastructure/database/cloud/mappers/NotificationPreferenceRowMapper';
import { ISupabaseNotificationPreferenceRepository } from '@/infrastructure/database/cloud/repositories/SupabaseNotificationPreferenceRepository';
import { OutboxManager } from '@/infrastructure/sync/OutboxManager';
import { SyncAuthError, SyncInProgressError } from '@/infrastructure/sync/errors/SyncErrors';
import { validateUserId } from '@/domain/value-objects/Identifiers';

export class NotificationPreferenceSyncDispatcher {
  private readonly inFlightUsers: Set<string> = new Set();

  constructor(
    private readonly preferenceRepo: ISupabaseNotificationPreferenceRepository,
    private readonly authPort: AuthPort,
    private readonly outboxManager?: OutboxManager
  ) {}

  public async dispatch(entry: LocalOutboxRecord): Promise<void> {
    if (this.inFlightUsers.has(entry.entityId)) {
      throw new SyncInProgressError(
        `Cannot dispatch notification preferences for '${entry.entityId}': operation already in progress.`
      );
    }

    this.inFlightUsers.add(entry.entityId);
    try {
      await this.executeDispatch(entry);
      if (this.outboxManager && typeof entry.id === 'number') {
        await this.outboxManager.markSuccess(entry.id);
      }
    } catch (error) {
      if (this.outboxManager && typeof entry.id === 'number') {
        const msg = error instanceof Error ? error.message : String(error);
        await this.outboxManager.markFailure(entry.id, msg);
      }
      throw error;
    } finally {
      this.inFlightUsers.delete(entry.entityId);
    }
  }

  private async executeDispatch(
    entry: LocalOutboxRecord
  ): Promise<CloudNotificationPreferenceRow> {
    if (entry.entity !== 'notification_preferences') {
      throw new Error(
        `NotificationPreferenceSyncDispatcher received unexpected entity '${entry.entity}'.`
      );
    }

    if (entry.operation !== 'INSERT' && entry.operation !== 'UPDATE') {
      throw new Error(
        `NotificationPreferenceSyncDispatcher does not support operation '${entry.operation}'.`
      );
    }

    const currentUser = await this.authPort.getCurrentUser();
    if (!currentUser || !currentUser.id) {
      throw new SyncAuthError('Notification preference sync aborted: User is not authenticated.');
    }
    const authenticatedUserId = validateUserId(currentUser.id);

    if (validateUserId(entry.entityId) !== authenticatedUserId) {
      throw new SyncAuthError(
        `Notification preference sync aborted: entityId '${entry.entityId}' does not match authenticated user.`
      );
    }

    const payloadUserId = entry.payload.user_id ?? entry.payload.userId;
    if (
      payloadUserId !== undefined &&
      (typeof payloadUserId !== 'string' || validateUserId(payloadUserId) !== authenticatedUserId)
    ) {
      throw new SyncAuthError(
        `Notification preference sync aborted: payload user_id mismatch for '${authenticatedUserId}'.`
      );
    }

    if (entry.operation === 'INSERT') {
      const row = NotificationPreferenceRowMapper.mapCreatePayload({
        ...entry.payload,
        user_id: authenticatedUserId
      });
      const persisted = await this.preferenceRepo.insert(row);
      if (persisted.user_id !== authenticatedUserId) {
        throw new Error(
          `Persisted notification preference owner mismatch for '${authenticatedUserId}'.`
        );
      }
      return persisted;
    }

    const targetVersion = Number(entry.payload.version);
    if (!Number.isSafeInteger(targetVersion) || targetVersion < 2) {
      throw new Error(
        `Invalid target version '${entry.payload.version}' for notification preference update.`
      );
    }
    const expectedVersion = Number(entry.payload.expected_version ?? targetVersion - 1);
    if (!Number.isSafeInteger(expectedVersion) || targetVersion !== expectedVersion + 1) {
      throw new Error(
        `Invalid expected_version '${expectedVersion}' for target version '${targetVersion}'.`
      );
    }

    const patch = NotificationPreferenceRowMapper.mapUpdatePayload(entry.payload);
    const persisted = await this.preferenceRepo.updatePartial(
      authenticatedUserId,
      patch,
      expectedVersion
    );
    if (persisted.user_id !== authenticatedUserId || persisted.version !== targetVersion) {
      throw new Error(
        `Updated notification preference confirmation failed for '${authenticatedUserId}'.`
      );
    }
    return persisted;
  }
}

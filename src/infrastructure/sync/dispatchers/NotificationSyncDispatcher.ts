import { AuthPort } from '@/application/ports/AuthPort';
import { LocalOutboxRecord } from '@/infrastructure/database/local/schema';
import {
  CloudNotificationRow,
  NotificationRowMapper
} from '@/infrastructure/database/cloud/mappers/NotificationRowMapper';
import { ISupabaseNotificationRepository } from '@/infrastructure/database/cloud/repositories/SupabaseNotificationRepository';
import { OutboxManager } from '@/infrastructure/sync/OutboxManager';
import { SyncAuthError, SyncInProgressError } from '@/infrastructure/sync/errors/SyncErrors';
import { validateUserId } from '@/domain/value-objects/Identifiers';

export class NotificationSyncDispatcher {
  private readonly inFlightNotifications: Set<string> = new Set();

  constructor(
    private readonly notificationRepo: ISupabaseNotificationRepository,
    private readonly authPort: AuthPort,
    private readonly outboxManager?: OutboxManager
  ) {}

  public async dispatch(entry: LocalOutboxRecord): Promise<void> {
    if (this.inFlightNotifications.has(entry.entityId)) {
      throw new SyncInProgressError(
        `Cannot dispatch notification '${entry.entityId}': operation already in progress.`
      );
    }

    this.inFlightNotifications.add(entry.entityId);
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
      this.inFlightNotifications.delete(entry.entityId);
    }
  }

  private async executeDispatch(entry: LocalOutboxRecord): Promise<CloudNotificationRow> {
    if (entry.entity !== 'notifications') {
      throw new Error(`NotificationSyncDispatcher received unexpected entity '${entry.entity}'.`);
    }

    if (
      entry.operation !== 'INSERT' &&
      entry.operation !== 'UPDATE' &&
      entry.operation !== 'DELETE'
    ) {
      throw new Error(
        `NotificationSyncDispatcher does not support operation '${entry.operation}'.`
      );
    }

    const currentUser = await this.authPort.getCurrentUser();
    if (!currentUser || !currentUser.id) {
      throw new SyncAuthError('Notification sync aborted: User is not authenticated.');
    }
    const authenticatedUserId = validateUserId(currentUser.id);

    if (entry.userId && validateUserId(entry.userId) !== authenticatedUserId) {
      throw new SyncAuthError(
        `Notification sync aborted: Outbox entry userId '${entry.userId}' does not match authenticated user.`
      );
    }

    if (entry.payload.id !== undefined && entry.payload.id !== entry.entityId) {
      throw new Error(
        `Notification sync aborted: Payload ID '${entry.payload.id}' does not match entityId '${entry.entityId}'.`
      );
    }

    const payloadUserId = entry.payload.user_id ?? entry.payload.userId;
    if (entry.operation === 'INSERT') {
      if (typeof payloadUserId !== 'string' || validateUserId(payloadUserId) !== authenticatedUserId) {
        throw new SyncAuthError(
          `Notification sync aborted: Payload user_id mismatch for '${entry.entityId}'.`
        );
      }

      const row = NotificationRowMapper.mapCreatePayload(entry.payload);
      const persisted = await this.notificationRepo.insert(row);
      if (
        persisted.id !== row.id ||
        persisted.user_id !== authenticatedUserId ||
        persisted.dedupe_key !== row.dedupe_key
      ) {
        throw new Error(
          `Persisted notification identity mismatch for ID '${row.id}'.`
        );
      }
      return persisted;
    }

    if (
      payloadUserId !== undefined &&
      (typeof payloadUserId !== 'string' || validateUserId(payloadUserId) !== authenticatedUserId)
    ) {
      throw new SyncAuthError(
        `Notification sync aborted: Payload user_id mismatch for '${entry.entityId}'.`
      );
    }

    const targetVersion = Number(entry.payload.version);
    if (!Number.isSafeInteger(targetVersion) || targetVersion < 2) {
      throw new Error(
        `Invalid target version '${entry.payload.version}' for notification ${entry.operation}.`
      );
    }
    const expectedVersion = Number(entry.payload.expected_version ?? targetVersion - 1);
    if (!Number.isSafeInteger(expectedVersion) || targetVersion !== expectedVersion + 1) {
      throw new Error(
        `Invalid expected_version '${expectedVersion}' for target version '${targetVersion}' on notification '${entry.entityId}'.`
      );
    }

    if (entry.operation === 'UPDATE') {
      const patch = NotificationRowMapper.mapUpdatePayload(entry.payload);
      const persisted = await this.notificationRepo.updatePartial(
        entry.entityId,
        authenticatedUserId,
        patch,
        expectedVersion
      );
      if (
        persisted.id !== entry.entityId ||
        persisted.user_id !== authenticatedUserId ||
        persisted.version !== targetVersion
      ) {
        throw new Error(
          `Updated notification confirmation failed for ID '${entry.entityId}'.`
        );
      }
      return persisted;
    }

    const deletePatch = NotificationRowMapper.mapSoftDeletePayload(entry.payload);
    const persisted = await this.notificationRepo.softDelete(
      entry.entityId,
      authenticatedUserId,
      deletePatch.deleted_at,
      expectedVersion,
      targetVersion
    );
    if (
      persisted.id !== entry.entityId ||
      persisted.user_id !== authenticatedUserId ||
      persisted.version !== targetVersion ||
      !persisted.deleted_at
    ) {
      throw new Error(
        `Deleted notification confirmation failed for ID '${entry.entityId}'.`
      );
    }
    return persisted;
  }
}

import { LocalOutboxRecord } from '@/infrastructure/database/local/schema';
import { ISupabaseAccountRepository } from '@/infrastructure/database/cloud/repositories/SupabaseAccountRepository';
import { AuthPort } from '@/application/ports/AuthPort';
import { OutboxManager } from '@/infrastructure/sync/OutboxManager';
import { AccountMapper, CloudAccountRow } from '@/infrastructure/database/cloud/mappers/AccountMapper';
import { SyncAuthError, SyncInProgressError } from '@/infrastructure/sync/errors/SyncErrors';

export class AccountSyncDispatcher {
  private readonly inFlightAccounts: Set<string> = new Set();

  constructor(
    private readonly accountRepo: ISupabaseAccountRepository,
    private readonly authPort: AuthPort,
    private readonly outboxManager?: OutboxManager
  ) {}

  /**
   * Dispatches a single accounts outbox entry to Supabase.
   * If an OutboxManager is provided and entry has a valid local ID,
   * automatically acknowledges success via markSuccess only after cloud verification,
   * or records failure metadata via markFailure on error.
   */
  public async dispatch(entry: LocalOutboxRecord): Promise<void> {
    if (this.inFlightAccounts.has(entry.entityId)) {
      throw new SyncInProgressError(
        `Cannot dispatch outbox entry for account '${entry.entityId}': An operation for this account is already in progress.`
      );
    }

    this.inFlightAccounts.add(entry.entityId);

    try {
      await this.executeDispatch(entry);

      // Acknowledge outbox entry ONLY after confirmed remote persistence
      if (this.outboxManager && typeof entry.id === 'number') {
        await this.outboxManager.markSuccess(entry.id);
      }
    } catch (error) {
      if (this.outboxManager && typeof entry.id === 'number') {
        const errorMsg = error instanceof Error ? error.message : String(error);
        await this.outboxManager.markFailure(entry.id, errorMsg);
      }
      throw error;
    } finally {
      this.inFlightAccounts.delete(entry.entityId);
    }
  }

  private async executeDispatch(entry: LocalOutboxRecord): Promise<CloudAccountRow | void> {
    // 1. Guard supported entity
    if (entry.entity !== 'accounts') {
      throw new Error(`AccountSyncDispatcher only processes 'accounts' entities. Received '${entry.entity}'.`);
    }

    // 2. Guard supported operations
    if (entry.operation !== 'INSERT' && entry.operation !== 'UPDATE' && entry.operation !== 'DELETE') {
      throw new Error(`AccountSyncDispatcher only processes 'INSERT', 'UPDATE', and 'DELETE'. Received '${entry.operation}'.`);
    }

    // 3. Resolve and verify authenticated user
    const currentUser = await this.authPort.getCurrentUser();
    if (!currentUser || !currentUser.id) {
      throw new SyncAuthError('Sync aborted: User is not authenticated.');
    }

    // 4. Validate payload ID consistency when supplied
    if (entry.payload.id !== undefined && entry.payload.id !== entry.entityId) {
      throw new Error(
        `Sync aborted: Payload ID '${entry.payload.id}' does not match entityId '${entry.entityId}'.`
      );
    }

    // 5. Tenant validation strategy
    if (entry.operation === 'INSERT') {
      // INSERT requires explicit payload user_id matching authenticated user
      const payloadUserId = entry.payload.user_id;
      if (typeof payloadUserId !== 'string' || payloadUserId !== currentUser.id) {
        throw new SyncAuthError(
          `Sync aborted: Outbox payload user_id '${payloadUserId}' does not match authenticated user '${currentUser.id}'.`
        );
      }
    } else {
      // UPDATE/DELETE delta payloads match authenticated user if present
      const payloadUserId = entry.payload.user_id ?? entry.payload.userId;
      if (payloadUserId !== undefined && (typeof payloadUserId !== 'string' || payloadUserId !== currentUser.id)) {
        throw new SyncAuthError(
          `Sync aborted: Outbox payload user_id '${payloadUserId}' does not match authenticated user '${currentUser.id}'.`
        );
      }
    }

    // 6. Execute INSERT
    if (entry.operation === 'INSERT') {
      const cloudRow = AccountMapper.mapCreatePayload(entry.payload);
      const persisted = await this.accountRepo.insert(cloudRow);

      if (persisted.id !== cloudRow.id || persisted.user_id !== currentUser.id) {
        throw new Error(
          `Persisted account confirmation failed for ID '${cloudRow.id}'. Remote ID or owner mismatch.`
        );
      }

      return persisted;
    }

    // 7. Execute DELETE
    if (entry.operation === 'DELETE') {
      if (!this.accountRepo.safeDelete) {
        throw new Error('SupabaseAccountRepository does not support safe account deletion.');
      }

      const rawExpected = entry.payload.expected_version ?? entry.payload.expectedVersion;
      const rawVersion = entry.payload.version;
      let expectedVersion: number;

      if (typeof rawExpected === 'number' && Number.isSafeInteger(rawExpected) && rawExpected >= 1) {
        expectedVersion = rawExpected;
      } else if (typeof rawVersion === 'number' && Number.isSafeInteger(rawVersion) && rawVersion >= 2) {
        expectedVersion = rawVersion - 1;
      } else {
        throw new Error(`Invalid version metadata in account DELETE payload for '${entry.entityId}'.`);
      }

      await this.accountRepo.safeDelete(entry.entityId, currentUser.id, expectedVersion);
      return;
    }

    // 8. Execute UPDATE (including archive and restore)
    const entityId = entry.entityId;
    const targetVersion = entry.payload.version;

    if (typeof targetVersion !== 'number' || !Number.isSafeInteger(targetVersion) || targetVersion < 2) {
      throw new Error(`Invalid target version '${targetVersion}' in account update payload.`);
    }

    const expectedVersion = targetVersion - 1;

    let patch: Partial<CloudAccountRow>;
    // Detect minimal delta payload (Archive/Restore)
    if (
      entry.payload.is_archived !== undefined &&
      Object.keys(entry.payload).filter((k) => k !== 'id' && k !== 'user_id').length <= 2
    ) {
      patch = entry.payload.is_archived
        ? AccountMapper.mapArchivePayload(entry.payload)
        : AccountMapper.mapRestorePayload(entry.payload);
    } else {
      patch = AccountMapper.mapUpdatePayload(entry.payload);
    }

    const persisted = await this.accountRepo.updatePartial(
      entityId,
      currentUser.id,
      patch,
      expectedVersion
    );

    if (persisted.id !== entityId || persisted.user_id !== currentUser.id) {
      throw new Error(
        `Updated account confirmation failed for ID '${entityId}'. Remote ID or owner mismatch.`
      );
    }

    return persisted;
  }
}

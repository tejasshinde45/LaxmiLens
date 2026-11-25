import { LocalOutboxRecord } from '@/infrastructure/database/local/schema';
import { ISupabaseBorrowingRepository } from '@/infrastructure/database/cloud/repositories/SupabaseBorrowingRepository';
import { AuthPort } from '@/application/ports/AuthPort';
import { OutboxManager } from '@/infrastructure/sync/OutboxManager';
import {
  BorrowingMapper,
  CloudBorrowingRow
} from '@/infrastructure/database/cloud/mappers/BorrowingMapper';
import { SyncAuthError, SyncInProgressError } from '@/infrastructure/sync/errors/SyncErrors';

export class BorrowingSyncDispatcher {
  private readonly inFlightBorrowings: Set<string> = new Set();

  constructor(
    private readonly borrowingRepo: ISupabaseBorrowingRepository,
    private readonly authPort: AuthPort,
    private readonly outboxManager?: OutboxManager
  ) {}

  /**
   * Dispatches a single borrowings outbox entry to Supabase.
   * If an OutboxManager is provided and entry has a valid local ID,
   * automatically acknowledges success via markSuccess only after cloud verification,
   * or records failure metadata via markFailure on error.
   */
  public async dispatch(entry: LocalOutboxRecord): Promise<void> {
    if (this.inFlightBorrowings.has(entry.entityId)) {
      throw new SyncInProgressError(
        `Cannot dispatch outbox entry for borrowing '${entry.entityId}': An operation for this borrowing is already in progress.`
      );
    }

    this.inFlightBorrowings.add(entry.entityId);

    try {
      await this.executeDispatch(entry);

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
      this.inFlightBorrowings.delete(entry.entityId);
    }
  }

  private async executeDispatch(entry: LocalOutboxRecord): Promise<CloudBorrowingRow> {
    // 1. Guard supported entity
    if (entry.entity !== 'borrowings') {
      throw new Error(
        `BorrowingSyncDispatcher only processes 'borrowings' entities. Received '${entry.entity}'.`
      );
    }

    // 2. Guard supported operations
    if (entry.operation !== 'INSERT' && entry.operation !== 'UPDATE') {
      throw new Error(
        `BorrowingSyncDispatcher only processes 'INSERT' and 'UPDATE'. Received '${entry.operation}'.`
      );
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
    const payloadUserId = entry.payload.user_id ?? entry.payload.userId;
    if (entry.operation === 'INSERT') {
      if (typeof payloadUserId !== 'string' || payloadUserId !== currentUser.id) {
        throw new SyncAuthError(
          `Sync aborted: Outbox payload user_id '${payloadUserId}' does not match authenticated user '${currentUser.id}'.`
        );
      }
    } else if (entry.operation === 'UPDATE') {
      if (
        payloadUserId !== undefined &&
        (typeof payloadUserId !== 'string' || payloadUserId !== currentUser.id)
      ) {
        throw new SyncAuthError(
          `Sync aborted: Outbox payload user_id '${payloadUserId}' does not match authenticated user '${currentUser.id}'.`
        );
      }
    }

    // 6. Execute INSERT
    if (entry.operation === 'INSERT') {
      const cloudRow = BorrowingMapper.mapCreatePayload(entry.payload);
      const persisted = await this.borrowingRepo.insert(cloudRow);

      if (persisted.id !== cloudRow.id || persisted.user_id !== currentUser.id) {
        throw new Error(
          `Persisted borrowing confirmation failed for ID '${cloudRow.id}'. Remote ID or owner mismatch.`
        );
      }

      return persisted;
    }

    // 7. Execute UPDATE
    const entityId = entry.entityId;
    const patch = BorrowingMapper.mapUpdatePayload(entry.payload);

    const persisted = await this.borrowingRepo.updatePartial(
      entityId,
      currentUser.id,
      patch
    );

    if (persisted.id !== entityId || persisted.user_id !== currentUser.id) {
      throw new Error(
        `Updated borrowing confirmation failed for ID '${entityId}'. Remote ID or owner mismatch.`
      );
    }

    return persisted;
  }
}

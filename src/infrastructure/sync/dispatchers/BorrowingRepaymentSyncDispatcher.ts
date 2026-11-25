import { LocalOutboxRecord } from '@/infrastructure/database/local/schema';
import { ISupabaseBorrowingRepaymentRepository } from '@/infrastructure/database/cloud/repositories/SupabaseBorrowingRepaymentRepository';
import { AuthPort } from '@/application/ports/AuthPort';
import { OutboxManager } from '@/infrastructure/sync/OutboxManager';
import {
  BorrowingRepaymentMapper,
  CloudBorrowingRepaymentRow
} from '@/infrastructure/database/cloud/mappers/BorrowingRepaymentMapper';
import { SyncAuthError, SyncInProgressError } from '@/infrastructure/sync/errors/SyncErrors';

export class BorrowingRepaymentSyncDispatcher {
  private readonly inFlightRepayments: Set<string> = new Set();

  constructor(
    private readonly repaymentRepo: ISupabaseBorrowingRepaymentRepository,
    private readonly authPort: AuthPort,
    private readonly outboxManager?: OutboxManager
  ) {}

  /**
   * Dispatches a single borrowing_repayments outbox entry to Supabase.
   * If an OutboxManager is provided and entry has a valid local ID,
   * automatically acknowledges success via markSuccess only after cloud verification,
   * or records failure metadata via markFailure on error.
   */
  public async dispatch(entry: LocalOutboxRecord): Promise<void> {
    if (this.inFlightRepayments.has(entry.entityId)) {
      throw new SyncInProgressError(
        `Cannot dispatch outbox entry for borrowing repayment '${entry.entityId}': An operation for this repayment is already in progress.`
      );
    }

    this.inFlightRepayments.add(entry.entityId);

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
      this.inFlightRepayments.delete(entry.entityId);
    }
  }

  private async executeDispatch(entry: LocalOutboxRecord): Promise<CloudBorrowingRepaymentRow> {
    // 1. Guard supported entity
    if (entry.entity !== 'borrowing_repayments') {
      throw new Error(
        `BorrowingRepaymentSyncDispatcher only processes 'borrowing_repayments' entities. Received '${entry.entity}'.`
      );
    }

    // 2. Guard supported operations (repayments are insert-only immutable event logs)
    if (entry.operation !== 'INSERT') {
      throw new Error(
        `BorrowingRepaymentSyncDispatcher only processes 'INSERT'. Received '${entry.operation}'.`
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
    if (typeof payloadUserId !== 'string' || payloadUserId !== currentUser.id) {
      throw new SyncAuthError(
        `Sync aborted: Outbox payload user_id '${payloadUserId}' does not match authenticated user '${currentUser.id}'.`
      );
    }

    // 6. Execute INSERT
    const cloudRow = BorrowingRepaymentMapper.mapCreatePayload(entry.payload);
    const persisted = await this.repaymentRepo.insert(cloudRow);

    if (persisted.id !== cloudRow.id || persisted.user_id !== currentUser.id) {
      throw new Error(
        `Persisted repayment confirmation failed for ID '${cloudRow.id}'. Remote ID or owner mismatch.`
      );
    }

    return persisted;
  }
}

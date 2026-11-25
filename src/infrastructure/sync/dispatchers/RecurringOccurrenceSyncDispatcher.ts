import { LocalOutboxRecord } from '@/infrastructure/database/local/schema';
import { ISupabaseRecurringOccurrenceRepository } from '@/infrastructure/database/cloud/repositories/SupabaseRecurringOccurrenceRepository';
import { AuthPort } from '@/application/ports/AuthPort';
import { OutboxManager } from '@/infrastructure/sync/OutboxManager';
import {
  CloudRecurringOccurrenceRow,
  RecurringOccurrenceMapper
} from '@/infrastructure/database/cloud/mappers/RecurringOccurrenceMapper';
import { SyncAuthError, SyncInProgressError } from '@/infrastructure/sync/errors/SyncErrors';

export class RecurringOccurrenceSyncDispatcher {
  private readonly inFlightOccurrences: Set<string> = new Set();

  constructor(
    private readonly occurrenceRepo: ISupabaseRecurringOccurrenceRepository,
    private readonly authPort: AuthPort,
    private readonly outboxManager?: OutboxManager
  ) {}

  public async dispatch(entry: LocalOutboxRecord): Promise<void> {
    if (this.inFlightOccurrences.has(entry.entityId)) {
      throw new SyncInProgressError(
        `Cannot dispatch recurring occurrence '${entry.entityId}': operation already in progress.`
      );
    }

    this.inFlightOccurrences.add(entry.entityId);
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
      this.inFlightOccurrences.delete(entry.entityId);
    }
  }

  private async executeDispatch(entry: LocalOutboxRecord): Promise<CloudRecurringOccurrenceRow> {
    if (entry.entity !== 'recurring_occurrences') {
      throw new Error(
        `RecurringOccurrenceSyncDispatcher received unexpected entity '${entry.entity}'.`
      );
    }

    const currentUser = await this.authPort.getCurrentUser();
    if (!currentUser || !currentUser.id) {
      throw new SyncAuthError('Sync aborted: User is not authenticated.');
    }

    const payloadUserId = entry.payload.user_id ?? entry.payload.userId;
    if (
      payloadUserId !== undefined &&
      (typeof payloadUserId !== 'string' || payloadUserId !== currentUser.id)
    ) {
      throw new SyncAuthError(
        `Sync aborted: Outbox recurring occurrence user_id mismatch for '${entry.entityId}'.`
      );
    }

    if (entry.operation === 'INSERT') {
      const row = RecurringOccurrenceMapper.mapCreatePayload(entry.payload);
      return await this.occurrenceRepo.insert(row);
    }

    if (entry.operation === 'UPDATE') {
      const targetVersion = Number(entry.payload.version);
      if (!Number.isSafeInteger(targetVersion) || targetVersion < 2) {
        throw new Error(
          `Invalid target version '${entry.payload.version}' for recurring occurrence update.`
        );
      }
      const expectedVersion = Number(entry.payload.expected_version ?? targetVersion - 1);
      const patch = RecurringOccurrenceMapper.mapUpdatePayload(entry.payload);
      return await this.occurrenceRepo.updatePartial(
        entry.entityId,
        currentUser.id,
        patch,
        expectedVersion
      );
    }

    throw new Error(
      `Unsupported operation '${entry.operation}' in RecurringOccurrenceSyncDispatcher.`
    );
  }
}

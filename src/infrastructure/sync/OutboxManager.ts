import Dexie from 'dexie';
import { SyncPort, OutboxEntry, SyncResult } from '@/application/ports/SyncPort';
import { db, LaxmiLensDB } from '../database/local/DexieDatabase';
import { LocalOutboxRecord } from '../database/local/schema';
import { validateUserId } from '@/domain/value-objects/Identifiers';
import { LocalWriteCommitNotifier } from './LocalWriteCommitNotifier';

export class OutboxManager implements SyncPort {
  constructor(
    private readonly database: LaxmiLensDB = db,
    private readonly commitNotifier?: LocalWriteCommitNotifier
  ) {}

  public async enqueue(entry: Omit<OutboxEntry, 'id' | 'attempts' | 'createdAt'>): Promise<void> {
    const validatedUserId = validateUserId(entry.userId);

    // Cross-check payload ownership consistency if present in payload
    const payload = (entry.payload || {}) as Record<string, unknown>;
    const payloadUserIdRaw = payload.user_id ?? payload.userId;
    if (payloadUserIdRaw !== undefined && payloadUserIdRaw !== null) {
      const payloadUserId = validateUserId(payloadUserIdRaw);
      if (payloadUserId !== validatedUserId) {
        throw new Error(
          `Outbox ownership mismatch: entry userId '${validatedUserId}' does not match payload user_id '${payloadUserId}'.`
        );
      }
    }

    const record: LocalOutboxRecord = {
      userId: validatedUserId,
      entity: entry.entity,
      entityId: entry.entityId,
      operation: entry.operation,
      payload: entry.payload,
      idempotencyKey: entry.idempotencyKey,
      attempts: 0,
      createdAt: new Date().toISOString()
    };

    await this.database.syncOutbox.add(record);
    this.commitNotifier?.recordOutboxWrite();
  }

  public async getPendingCount(userId: string): Promise<number> {
    const validatedUserId = validateUserId(userId);
    return this.database.syncOutbox.where('userId').equals(validatedUserId).count();
  }

  public async getPendingEntries(userId: string, limit = 50): Promise<LocalOutboxRecord[]> {
    return this.getPendingEntriesPage(userId, limit);
  }

  public async getPendingEntriesPage(
    userId: string,
    limit = 50,
    afterId?: number
  ): Promise<LocalOutboxRecord[]> {
    const validatedUserId = validateUserId(userId);
    const safeLimit = Math.max(1, Math.floor(Number.isFinite(limit) && limit > 0 ? limit : 50));
    const lowerBound =
      typeof afterId === 'number' && Number.isFinite(afterId) ? afterId : Dexie.minKey;
    const includeLower = typeof afterId !== 'number' || !Number.isFinite(afterId);

    return this.database.syncOutbox
      .where('[userId+id]')
      .between([validatedUserId, lowerBound], [validatedUserId, Dexie.maxKey], includeLower, true)
      .limit(safeLimit)
      .toArray();
  }

  public async markSuccess(id: number): Promise<void> {
    await this.database.syncOutbox.delete(id);
  }

  public async markFailure(id: number, error: string): Promise<void> {
    const item = await this.database.syncOutbox.get(id);
    if (item) {
      await this.database.syncOutbox.update(id, {
        attempts: item.attempts + 1,
        lastAttemptAt: new Date().toISOString(),
        lastError: error
      });
    }
  }

  public async clearOutbox(): Promise<void> {
    await this.database.syncOutbox.clear();
  }

  public async processOutbox(): Promise<SyncResult> {
    // Contract stub: The full sync orchestration is handled by ManualSyncCoordinator
    return {
      pushedCount: 0,
      pulledCount: 0,
      conflictsCount: 0,
      errors: []
    };
  }
}

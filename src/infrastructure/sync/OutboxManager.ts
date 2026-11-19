import { SyncPort, OutboxEntry, SyncResult } from '@/application/ports/SyncPort';
import { db, LaxmiLensDB } from '../database/local/DexieDatabase';
import { LocalOutboxRecord } from '../database/local/schema';

export class OutboxManager implements SyncPort {
  constructor(private readonly database: LaxmiLensDB = db) {}

  public async enqueue(entry: Omit<OutboxEntry, 'id' | 'attempts' | 'createdAt'>): Promise<void> {
    const record: LocalOutboxRecord = {
      entity: entry.entity,
      entityId: entry.entityId,
      operation: entry.operation,
      payload: entry.payload,
      idempotencyKey: entry.idempotencyKey,
      attempts: 0,
      createdAt: new Date().toISOString()
    };

    await this.database.syncOutbox.add(record);
  }

  public async getPendingCount(): Promise<number> {
    return this.database.syncOutbox.count();
  }

  public async getPendingEntries(limit = 50): Promise<LocalOutboxRecord[]> {
    return this.database.syncOutbox.orderBy('id').limit(limit).toArray();
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
    // Contract stub: The full sync orchestration is handled by SyncEngine
    return {
      pushedCount: 0,
      pulledCount: 0,
      conflictsCount: 0,
      errors: []
    };
  }
}

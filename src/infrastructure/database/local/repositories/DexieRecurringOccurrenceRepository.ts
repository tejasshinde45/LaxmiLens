import {
  RecurringOccurrence,
  RecurringOccurrenceStatus
} from '@/domain/entities/RecurringOccurrence';
import { RecurringOccurrenceRepository } from '@/domain/repositories/RecurringOccurrenceRepository';
import {
  RecurringOccurrenceId,
  RecurringRuleId,
  UserId,
  createRecurringOccurrenceId,
  createRecurringRuleId,
  createTransactionId,
  validateUserId
} from '@/domain/value-objects/Identifiers';
import { UnauthorizedEntityAccessError } from '@/domain/errors/DomainErrors';
import { DuplicateRecurringOccurrenceError } from '@/domain/errors/RecurringErrors';
import { db, LaxmiLensDB } from '../DexieDatabase';
import { LocalRecurringOccurrenceRecord } from '../schema';

export class DexieRecurringOccurrenceRepository implements RecurringOccurrenceRepository {
  constructor(private readonly database: LaxmiLensDB = db) {}

  public async findById(
    id: RecurringOccurrenceId,
    userId: UserId
  ): Promise<RecurringOccurrence | null> {
    const validatedUserId = validateUserId(userId);
    let record: LocalRecurringOccurrenceRecord | undefined | null;

    if (typeof this.database.recurringOccurrences.where === 'function') {
      record = await this.database.recurringOccurrences
        .where('[userId+id]')
        .equals([validatedUserId, id])
        .first();
    } else {
      const candidate = await this.database.recurringOccurrences.get(id);
      if (candidate && candidate.userId === validatedUserId) {
        record = candidate;
      }
    }

    if (!record) {
      const raw = await this.database.recurringOccurrences.get(id);
      if (raw && raw.userId && raw.userId !== validatedUserId) {
        throw new UnauthorizedEntityAccessError('RecurringOccurrence', id);
      }
      return null;
    }

    if (record.deletedAt) return null;
    return this.toDomain(record);
  }

  public async findByRuleAndDate(
    recurringRuleId: RecurringRuleId,
    occurrenceDate: string,
    userId: UserId
  ): Promise<RecurringOccurrence | null> {
    const validatedUserId = validateUserId(userId);
    let records: LocalRecurringOccurrenceRecord[];

    if (typeof this.database.recurringOccurrences.where === 'function') {
      records = await this.database.recurringOccurrences
        .where('[userId+recurringRuleId+occurrenceDate]')
        .equals([validatedUserId, recurringRuleId, occurrenceDate])
        .toArray();
    } else {
      const all = await this.database.recurringOccurrences.toArray();
      records = all.filter(
        (r) =>
          r.userId === validatedUserId &&
          r.recurringRuleId === recurringRuleId &&
          r.occurrenceDate === occurrenceDate
      );
    }

    const active = records.find((r) => !r.deletedAt);
    return active ? this.toDomain(active) : null;
  }

  public async findByRuleId(
    recurringRuleId: RecurringRuleId,
    userId: UserId
  ): Promise<RecurringOccurrence[]> {
    const validatedUserId = validateUserId(userId);
    const records =
      typeof this.database.recurringOccurrences.where === 'function'
        ? await this.database.recurringOccurrences
            .where('[userId+recurringRuleId]')
            .equals([validatedUserId, recurringRuleId])
            .toArray()
        : (await this.database.recurringOccurrences.toArray()).filter(
            (r) => r.userId === validatedUserId && r.recurringRuleId === recurringRuleId
          );

    return records.filter((r) => !r.deletedAt).map((r) => this.toDomain(r));
  }

  public async findByStatus(
    status: RecurringOccurrenceStatus,
    userId: UserId
  ): Promise<RecurringOccurrence[]> {
    const validatedUserId = validateUserId(userId);
    const records =
      typeof this.database.recurringOccurrences.where === 'function'
        ? await this.database.recurringOccurrences
            .where('[userId+status]')
            .equals([validatedUserId, status])
            .toArray()
        : (await this.database.recurringOccurrences.toArray()).filter(
            (r) => r.userId === validatedUserId && r.status === status
          );

    return records.filter((r) => !r.deletedAt).map((r) => this.toDomain(r));
  }

  public async findAll(userId: UserId): Promise<RecurringOccurrence[]> {
    const validatedUserId = validateUserId(userId);
    const records =
      typeof this.database.recurringOccurrences.where === 'function'
        ? await this.database.recurringOccurrences
            .where('userId')
            .equals(validatedUserId)
            .toArray()
        : (await this.database.recurringOccurrences.toArray()).filter(
            (r) => r.userId === validatedUserId
          );

    return records.filter((r) => !r.deletedAt).map((r) => this.toDomain(r));
  }

  public async save(occurrence: RecurringOccurrence): Promise<void> {
    const validatedUserId = validateUserId(occurrence.userId);
    const record = this.toRecord(occurrence);

    await this.database.transaction('rw', [this.database.recurringOccurrences], async () => {
      const existing = await this.database.recurringOccurrences.get(occurrence.id);
      if (existing && existing.userId !== validatedUserId) {
        throw new UnauthorizedEntityAccessError('RecurringOccurrence', occurrence.id);
      }

      if (!occurrence.deletedAt) {
        const matches =
          typeof this.database.recurringOccurrences.where === 'function'
            ? await this.database.recurringOccurrences
                .where('[userId+recurringRuleId+occurrenceDate]')
                .equals([validatedUserId, occurrence.recurringRuleId, occurrence.occurrenceDate])
                .toArray()
            : (await this.database.recurringOccurrences.toArray()).filter(
                (r) =>
                  r.userId === validatedUserId &&
                  r.recurringRuleId === occurrence.recurringRuleId &&
                  r.occurrenceDate === occurrence.occurrenceDate
              );

        const duplicate = matches.find((m) => !m.deletedAt && m.id !== occurrence.id);
        if (duplicate) {
          throw new DuplicateRecurringOccurrenceError(
            occurrence.recurringRuleId,
            occurrence.occurrenceDate
          );
        }
      }

      await this.database.recurringOccurrences.put(record);
    });
  }

  private toDomain(record: LocalRecurringOccurrenceRecord): RecurringOccurrence {
    return new RecurringOccurrence({
      id: createRecurringOccurrenceId(record.id),
      userId: validateUserId(record.userId),
      recurringRuleId: createRecurringRuleId(record.recurringRuleId),
      occurrenceDate: record.occurrenceDate,
      status: record.status,
      snoozedUntilDate: record.snoozedUntilDate ?? null,
      transactionId: record.transactionId ? createTransactionId(record.transactionId) : null,
      idempotencyKey: record.idempotencyKey,
      confirmedAt: record.confirmedAt ? new Date(record.confirmedAt) : null,
      skippedAt: record.skippedAt ? new Date(record.skippedAt) : null,
      dismissedAt: record.dismissedAt ? new Date(record.dismissedAt) : null,
      version: record.version ?? 1,
      createdAt: record.createdAt ? new Date(record.createdAt) : undefined,
      updatedAt: record.updatedAt ? new Date(record.updatedAt) : undefined,
      deletedAt: record.deletedAt ? new Date(record.deletedAt) : null
    });
  }

  private toRecord(occ: RecurringOccurrence): LocalRecurringOccurrenceRecord {
    return {
      id: occ.id,
      userId: occ.userId,
      recurringRuleId: occ.recurringRuleId,
      occurrenceDate: occ.occurrenceDate,
      status: occ.status,
      snoozedUntilDate: occ.snoozedUntilDate,
      transactionId: occ.transactionId,
      idempotencyKey: occ.idempotencyKey,
      confirmedAt: occ.confirmedAt ? occ.confirmedAt.toISOString() : null,
      skippedAt: occ.skippedAt ? occ.skippedAt.toISOString() : null,
      dismissedAt: occ.dismissedAt ? occ.dismissedAt.toISOString() : null,
      version: occ.version,
      createdAt: occ.createdAt.toISOString(),
      updatedAt: occ.updatedAt.toISOString(),
      deletedAt: occ.deletedAt ? occ.deletedAt.toISOString() : null
    };
  }
}

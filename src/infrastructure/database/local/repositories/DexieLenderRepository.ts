import { LenderRepository } from '@/domain/repositories/LenderRepository';
import { Lender } from '@/domain/entities/Lender';
import { LenderId, UserId, createLenderId, validateUserId } from '@/domain/value-objects/Identifiers';
import { UnauthorizedEntityAccessError } from '@/domain/errors/DomainErrors';
import { LenderNotFoundError } from '@/domain/errors/BorrowingErrors';
import { db, LaxmiLensDB } from '../DexieDatabase';
import { LocalLenderRecord } from '../schema';

export class DexieLenderRepository implements LenderRepository {
  constructor(private readonly database: LaxmiLensDB = db) {}

  public async findById(id: LenderId, userId: UserId): Promise<Lender | null> {
    const validatedUserId = validateUserId(userId);
    let record: LocalLenderRecord | undefined | null;

    if (typeof this.database.lenders.where === 'function') {
      record = await this.database.lenders
        .where('[userId+id]')
        .equals([validatedUserId, id])
        .first();
    } else {
      const candidate = await this.database.lenders.get(id);
      if (candidate && candidate.userId === validatedUserId) {
        record = candidate;
      }
    }

    if (!record) {
      const raw = await this.database.lenders.get(id);
      if (raw && raw.userId && raw.userId !== validatedUserId) {
        throw new UnauthorizedEntityAccessError('Lender', id);
      }
      return null;
    }

    return this.toDomain(record);
  }

  public async findByName(name: string, userId: UserId): Promise<Lender | null> {
    const validatedUserId = validateUserId(userId);
    const trimmed = name.trim().toLowerCase();

    const records = await this.database.lenders
      .where('userId')
      .equals(validatedUserId)
      .toArray();

    const match = records.find(
      (r) => r.name.trim().toLowerCase() === trimmed && !r.isArchived
    );

    return match ? this.toDomain(match) : null;
  }

  public async findByUserId(userId: UserId): Promise<Lender[]> {
    const validatedUserId = validateUserId(userId);
    const records = await this.database.lenders
      .where('userId')
      .equals(validatedUserId)
      .toArray();

    return records.map((r) => this.toDomain(r));
  }

  public async save(lender: Lender): Promise<void> {
    const validatedUserId = validateUserId(lender.userId);
    const existing = await this.database.lenders.get(lender.id);

    if (existing && existing.userId && existing.userId !== validatedUserId) {
      throw new UnauthorizedEntityAccessError('Lender', lender.id);
    }

    const record = this.toRecord(lender);
    await this.database.lenders.put(record);
  }

  public async archive(id: LenderId, userId: UserId): Promise<void> {
    const validatedUserId = validateUserId(userId);
    const existing = await this.database.lenders.get(id);

    if (!existing) {
      throw new LenderNotFoundError(id);
    }

    if (existing.userId !== validatedUserId) {
      throw new UnauthorizedEntityAccessError('Lender', id);
    }

    await this.database.lenders.update(id, {
      isArchived: true,
      updatedAt: new Date().toISOString()
    });
  }

  private toDomain(record: LocalLenderRecord): Lender {
    return new Lender({
      id: createLenderId(record.id),
      userId: validateUserId(record.userId),
      name: record.name,
      phone: record.phone,
      email: record.email,
      notes: record.notes,
      isArchived: record.isArchived,
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt)
    });
  }

  private toRecord(lender: Lender): LocalLenderRecord {
    return {
      id: lender.id,
      userId: lender.userId,
      name: lender.name,
      phone: lender.phone,
      email: lender.email,
      notes: lender.notes,
      isArchived: lender.isArchived,
      createdAt: lender.createdAt.toISOString(),
      updatedAt: lender.updatedAt.toISOString()
    };
  }
}

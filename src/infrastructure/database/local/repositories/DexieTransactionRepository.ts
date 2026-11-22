import { TransactionRepository, TransactionFilter } from '@/domain/repositories/TransactionRepository';
import { Transaction, TransactionType } from '@/domain/entities/Transaction';
import {
  TransactionId,
  AccountId,
  UserId,
  createTransactionId,
  createAccountId,
  createCategoryId,
  validateUserId
} from '@/domain/value-objects/Identifiers';
import {
  InvalidUserIdError,
  TransactionNotFoundError,
  UnauthorizedEntityAccessError
} from '@/domain/errors/DomainErrors';
import { db, LaxmiLensDB } from '../DexieDatabase';
import { LocalTransactionRecord } from '../schema';

export class DexieTransactionRepository implements TransactionRepository {
  constructor(private readonly database: LaxmiLensDB = db) {}

  public async findById(id: TransactionId, userId: UserId): Promise<Transaction | null> {
    const validatedUserId = validateUserId(userId);
    let record: LocalTransactionRecord | undefined | null;
    if (typeof this.database.transactions.where === 'function') {
      record = await this.database.transactions
        .where('[userId+id]')
        .equals([validatedUserId, id])
        .first();
    } else {
      const candidate = await this.database.transactions.get(id);
      if (candidate && candidate.userId === validatedUserId) {
        record = candidate;
      }
    }
    if (!record) {
      const raw = await this.database.transactions.get(id);
      if (raw && raw.userId && raw.userId !== validatedUserId) {
        throw new UnauthorizedEntityAccessError('Transaction', id);
      }
      return null;
    }
    return this.toDomain(record);
  }

  public async findByIdempotencyKey(key: string, userId: UserId): Promise<Transaction | null> {
    const validatedUserId = validateUserId(userId);
    const records = await this.database.transactions.where('idempotencyKey').equals(key).toArray();
    const matched = records.find((r) => r.userId === validatedUserId);
    return matched ? this.toDomain(matched) : null;
  }

  public async findByAccount(accountId: AccountId, userId: UserId): Promise<Transaction[]> {
    const validatedUserId = validateUserId(userId);
    const sourceRecords = await this.database.transactions
      .where('[userId+accountId]')
      .equals([validatedUserId, accountId])
      .toArray();

    const destRecords = await this.database.transactions
      .where('destinationAccountId')
      .equals(accountId)
      .toArray();
    const userDestRecords = destRecords.filter((r) => r.userId === validatedUserId);

    const map = new Map<string, LocalTransactionRecord>();
    sourceRecords.forEach((r) => map.set(r.id, r));
    userDestRecords.forEach((r) => map.set(r.id, r));

    const records = Array.from(map.values());
    records.sort((a, b) => {
      const dateA = new Date(a.transactionDate || a.date || '').getTime();
      const dateB = new Date(b.transactionDate || b.date || '').getTime();
      return dateB - dateA;
    });

    return records.map((r) => this.toDomain(r));
  }

  public async findMany(filter: TransactionFilter): Promise<Transaction[]> {
    const validatedUserId = validateUserId(filter.userId);
    let records: LocalTransactionRecord[];

    if (filter.accountId) {
      const sourceRecords = await this.database.transactions
        .where('[userId+accountId]')
        .equals([validatedUserId, filter.accountId])
        .toArray();

      const destRecords = await this.database.transactions
        .where('destinationAccountId')
        .equals(filter.accountId)
        .toArray();
      const userDestRecords = destRecords.filter((r) => r.userId === validatedUserId);

      const map = new Map<string, LocalTransactionRecord>();
      sourceRecords.forEach((r) => map.set(r.id, r));
      userDestRecords.forEach((r) => map.set(r.id, r));
      records = Array.from(map.values());
    } else {
      records = await this.database.transactions.where('userId').equals(validatedUserId).toArray();
    }

    // Exclude soft-deleted transactions by default unless explicitly included
    if (!filter.includeDeleted) {
      records = records.filter((r) => !r.deletedAt && !r.isDeleted);
    }

    if (filter.categoryId) {
      records = records.filter((r) => r.categoryId === filter.categoryId);
    }

    if (filter.dateRange) {
      records = records.filter((r) => {
        const txDate = new Date(r.transactionDate || r.date || '');
        return filter.dateRange!.contains(txDate);
      });
    }

    if (filter.types && filter.types.length > 0) {
      records = records.filter((r) => filter.types!.includes(r.type as TransactionType));
    }

    if (filter.searchQuery) {
      const q = filter.searchQuery.toLowerCase();
      records = records.filter((r) => {
        const titleMatch = (r.title || r.description || '').toLowerCase().includes(q);
        const noteMatch = (r.note || r.notes || '').toLowerCase().includes(q);
        return titleMatch || noteMatch;
      });
    }

    // Sort descending by transactionDate
    records.sort((a, b) => {
      const dateA = new Date(a.transactionDate || a.date || '').getTime();
      const dateB = new Date(b.transactionDate || b.date || '').getTime();
      return dateB - dateA;
    });

    if (filter.offset !== undefined) {
      records = records.slice(filter.offset);
    }
    if (filter.limit !== undefined) {
      records = records.slice(0, filter.limit);
    }

    return records.map((r) => this.toDomain(r));
  }

  public async save(transaction: Transaction): Promise<void> {
    const validatedUserId = validateUserId(transaction.userId);
    const existing = await this.database.transactions.get(transaction.id);
    if (existing && existing.userId && existing.userId !== validatedUserId) {
      throw new UnauthorizedEntityAccessError('Transaction', transaction.id);
    }
    const record = this.toRecord(transaction);
    await this.database.transactions.put(record);
  }

  public async saveBatch(transactions: Transaction[]): Promise<void> {
    for (const t of transactions) {
      const validatedUserId = validateUserId(t.userId);
      const existing = await this.database.transactions.get(t.id);
      if (existing && existing.userId && existing.userId !== validatedUserId) {
        throw new UnauthorizedEntityAccessError('Transaction', t.id);
      }
    }
    const records = transactions.map((t) => this.toRecord(t));
    await this.database.transactions.bulkPut(records);
  }

  public async softDelete(
    id: TransactionId,
    userId: UserId,
    deletedAt: Date = new Date(),
    version?: number
  ): Promise<void> {
    const validatedUserId = validateUserId(userId);
    const existing = await this.database.transactions.get(id);
    if (!existing) {
      throw new TransactionNotFoundError(id);
    }
    if (existing.userId !== validatedUserId) {
      throw new UnauthorizedEntityAccessError('Transaction', id);
    }
    const newVersion = version ?? (existing.version ?? 1) + 1;
    await this.database.transactions.update(id, {
      deletedAt: deletedAt.toISOString(),
      isDeleted: true,
      version: newVersion,
      updatedAt: new Date().toISOString()
    });
  }

  private toDomain(record: LocalTransactionRecord): Transaction {
    if (!record.userId) {
      throw new InvalidUserIdError(`Transaction record '${record.id}' is missing a valid userId.`);
    }
    const validatedUserId = validateUserId(record.userId);
    const resolvedTitle = record.title || record.description || 'Transaction';
    const resolvedDate = new Date(record.transactionDate || record.date || new Date().toISOString());
    const resolvedDestination = record.destinationAccountId || record.targetAccountId;
    const resolvedDeletedAt = record.deletedAt ? new Date(record.deletedAt) : (record.isDeleted ? new Date() : null);

    return new Transaction({
      id: createTransactionId(record.id),
      userId: validatedUserId,
      type: record.type as TransactionType,
      amountPaise: record.amountPaise ?? record.amountInPaise ?? 0,
      currency: record.currency || 'INR',
      accountId: createAccountId(record.accountId),
      destinationAccountId: resolvedDestination ? createAccountId(resolvedDestination) : undefined,
      categoryId: record.categoryId ? createCategoryId(record.categoryId) : undefined,
      title: resolvedTitle,
      note: record.note ?? record.notes,
      transactionDate: resolvedDate,
      deletedAt: resolvedDeletedAt,
      version: record.version ?? 1,
      deviceId: record.deviceId,
      idempotencyKey: record.idempotencyKey,
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt)
    });
  }

  private toRecord(transaction: Transaction): LocalTransactionRecord {
    return {
      id: transaction.id,
      userId: transaction.userId,
      type: transaction.type,
      amountPaise: transaction.amountPaise,
      currency: transaction.currency,
      accountId: transaction.accountId,
      destinationAccountId: transaction.destinationAccountId,
      categoryId: transaction.categoryId,
      title: transaction.title,
      note: transaction.note,
      transactionDate: transaction.transactionDate.toISOString(),
      deletedAt: transaction.deletedAt ? transaction.deletedAt.toISOString() : null,
      version: transaction.version,
      deviceId: transaction.deviceId,
      idempotencyKey: transaction.idempotencyKey,
      createdAt: transaction.createdAt.toISOString(),
      updatedAt: transaction.updatedAt.toISOString(),

      // Compatibility fields
      targetAccountId: transaction.destinationAccountId,
      description: transaction.title,
      notes: transaction.note,
      date: transaction.transactionDate.toISOString(),
      amountInPaise: transaction.amountPaise,
      isDeleted: transaction.isDeleted,
      status: transaction.status
    };
  }
}

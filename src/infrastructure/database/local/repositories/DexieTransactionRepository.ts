import { TransactionRepository, TransactionFilter } from '@/domain/repositories/TransactionRepository';
import { Transaction } from '@/domain/entities/Transaction';
import { TransactionId, AccountId, createTransactionId, createAccountId, createCategoryId } from '@/domain/value-objects/Identifiers';
import { Money } from '@/domain/value-objects/Money';
import { db, LaxmiLensDB } from '../DexieDatabase';
import { LocalTransactionRecord } from '../schema';

export class DexieTransactionRepository implements TransactionRepository {
  constructor(private readonly database: LaxmiLensDB = db) {}

  public async findById(id: TransactionId): Promise<Transaction | null> {
    const record = await this.database.transactions.get(id);
    return record ? this.toDomain(record) : null;
  }

  public async findByIdempotencyKey(key: string): Promise<Transaction | null> {
    const record = await this.database.transactions.where('idempotencyKey').equals(key).first();
    return record ? this.toDomain(record) : null;
  }

  public async findByAccount(accountId: AccountId): Promise<Transaction[]> {
    const records = await this.database.transactions
      .where('accountId')
      .equals(accountId)
      .or('targetAccountId')
      .equals(accountId)
      .toArray();

    return records.map((r) => this.toDomain(r));
  }

  public async findMany(filter: TransactionFilter): Promise<Transaction[]> {
    let collection = this.database.transactions.toCollection();

    if (filter.accountId) {
      collection = this.database.transactions.where('accountId').equals(filter.accountId);
    }

    let records = await collection.toArray();

    if (filter.categoryId) {
      records = records.filter((r) => r.categoryId === filter.categoryId);
    }

    if (filter.dateRange) {
      records = records.filter((r) => {
        const txDate = new Date(r.date);
        return filter.dateRange!.contains(txDate);
      });
    }

    if (filter.types && filter.types.length > 0) {
      records = records.filter((r) => filter.types!.includes(r.type));
    }

    if (filter.searchQuery) {
      const q = filter.searchQuery.toLowerCase();
      records = records.filter(
        (r) => r.description.toLowerCase().includes(q) || (r.notes && r.notes.toLowerCase().includes(q))
      );
    }

    // Sort descending by date
    records.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    if (filter.offset !== undefined) {
      records = records.slice(filter.offset);
    }
    if (filter.limit !== undefined) {
      records = records.slice(0, filter.limit);
    }

    return records.map((r) => this.toDomain(r));
  }

  public async save(transaction: Transaction): Promise<void> {
    const record = this.toRecord(transaction);
    await this.database.transactions.put(record);
  }

  public async saveBatch(transactions: Transaction[]): Promise<void> {
    const records = transactions.map((t) => this.toRecord(t));
    await this.database.transactions.bulkPut(records);
  }

  public async softDelete(id: TransactionId): Promise<void> {
    await this.database.transactions.update(id, {
      isDeleted: true,
      updatedAt: new Date().toISOString()
    });
  }

  private toDomain(record: LocalTransactionRecord): Transaction {
    return new Transaction({
      id: createTransactionId(record.id),
      type: record.type,
      amount: Money.fromPaise(record.amountInPaise),
      accountId: createAccountId(record.accountId),
      targetAccountId: record.targetAccountId ? createAccountId(record.targetAccountId) : undefined,
      categoryId: record.categoryId ? createCategoryId(record.categoryId) : undefined,
      date: new Date(record.date),
      description: record.description,
      notes: record.notes,
      status: record.status,
      idempotencyKey: record.idempotencyKey,
      version: record.version,
      isDeleted: record.isDeleted,
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt)
    });
  }

  private toRecord(transaction: Transaction): LocalTransactionRecord {
    return {
      id: transaction.id,
      type: transaction.type,
      amountInPaise: transaction.amount.paise,
      accountId: transaction.accountId,
      targetAccountId: transaction.targetAccountId,
      categoryId: transaction.categoryId,
      date: transaction.date.toISOString(),
      description: transaction.description,
      notes: transaction.notes,
      status: transaction.status,
      idempotencyKey: transaction.idempotencyKey,
      version: transaction.version,
      isDeleted: transaction.isDeleted,
      createdAt: transaction.createdAt.toISOString(),
      updatedAt: transaction.updatedAt.toISOString()
    };
  }
}

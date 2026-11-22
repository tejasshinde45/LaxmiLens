import { TransactionId, AccountId, CategoryId, UserId } from '../value-objects/Identifiers';
import { Transaction, TransactionType } from '../entities/Transaction';
import { DateRange } from '../value-objects/DateRange';

export interface TransactionFilter {
  userId: UserId;
  accountId?: AccountId;
  categoryId?: CategoryId;
  dateRange?: DateRange;
  searchQuery?: string;
  types?: TransactionType[];
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
}

export interface TransactionRepository {
  findById(id: TransactionId, userId: UserId): Promise<Transaction | null>;
  findByIdempotencyKey(key: string, userId: UserId): Promise<Transaction | null>;
  findByAccount(accountId: AccountId, userId: UserId): Promise<Transaction[]>;
  findMany(filter: TransactionFilter): Promise<Transaction[]>;
  save(transaction: Transaction): Promise<void>;
  saveBatch(transactions: Transaction[]): Promise<void>;
  softDelete(id: TransactionId, userId: UserId, deletedAt?: Date, version?: number): Promise<void>;
}

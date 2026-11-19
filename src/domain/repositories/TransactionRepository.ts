import { TransactionId, AccountId, CategoryId } from '../value-objects/Identifiers';
import { Transaction } from '../entities/Transaction';
import { DateRange } from '../value-objects/DateRange';

export interface TransactionFilter {
  accountId?: AccountId;
  categoryId?: CategoryId;
  dateRange?: DateRange;
  searchQuery?: string;
  types?: ('income' | 'expense' | 'transfer')[];
  limit?: number;
  offset?: number;
}

export interface TransactionRepository {
  findById(id: TransactionId): Promise<Transaction | null>;
  findByIdempotencyKey(key: string): Promise<Transaction | null>;
  findByAccount(accountId: AccountId): Promise<Transaction[]>;
  findMany(filter: TransactionFilter): Promise<Transaction[]>;
  save(transaction: Transaction): Promise<void>;
  saveBatch(transactions: Transaction[]): Promise<void>;
  softDelete(id: TransactionId): Promise<void>;
}

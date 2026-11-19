import { Transaction } from '@/domain/entities/Transaction';
import { Money } from '@/domain/value-objects/Money';
import {
  createTransactionId,
  createAccountId,
  createCategoryId
} from '@/domain/value-objects/Identifiers';

export interface CloudTransactionRow {
  id: string;
  user_id: string;
  type: 'income' | 'expense' | 'transfer';
  amount_in_paise: number;
  account_id: string;
  target_account_id: string | null;
  category_id: string | null;
  date: string;
  description: string;
  notes: string | null;
  status: 'cleared' | 'pending' | 'reconciled';
  idempotency_key: string;
  version: number;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export class TransactionMapper {
  public static toDomain(row: CloudTransactionRow): Transaction {
    return new Transaction({
      id: createTransactionId(row.id),
      type: row.type,
      amount: Money.fromPaise(row.amount_in_paise),
      accountId: createAccountId(row.account_id),
      targetAccountId: row.target_account_id ? createAccountId(row.target_account_id) : undefined,
      categoryId: row.category_id ? createCategoryId(row.category_id) : undefined,
      date: new Date(row.date),
      description: row.description,
      notes: row.notes ?? undefined,
      status: row.status,
      idempotencyKey: row.idempotency_key,
      version: row.version,
      isDeleted: row.is_deleted,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    });
  }

  public static toCloud(entity: Transaction, userId: string): CloudTransactionRow {
    return {
      id: entity.id,
      user_id: userId,
      type: entity.type,
      amount_in_paise: entity.amount.paise,
      account_id: entity.accountId,
      target_account_id: entity.targetAccountId ?? null,
      category_id: entity.categoryId ?? null,
      date: entity.date.toISOString(),
      description: entity.description,
      notes: entity.notes ?? null,
      status: entity.status,
      idempotency_key: entity.idempotencyKey,
      version: entity.version,
      is_deleted: entity.isDeleted,
      created_at: entity.createdAt.toISOString(),
      updated_at: entity.updatedAt.toISOString()
    };
  }
}

import { Transaction, TransactionType } from '@/domain/entities/Transaction';
import {
  createTransactionId,
  createAccountId,
  createCategoryId,
  createUserId
} from '@/domain/value-objects/Identifiers';

export interface CloudTransactionRow {
  id: string;
  user_id: string;
  type: 'income' | 'expense' | 'transfer';
  amount_paise?: number;
  amount_in_paise?: number;
  currency?: string;
  account_id: string;
  destination_account_id?: string | null;
  target_account_id?: string | null;
  category_id: string | null;
  title?: string;
  description?: string;
  note?: string | null;
  notes?: string | null;
  transaction_date?: string;
  date?: string;
  deleted_at?: string | null;
  is_deleted?: boolean;
  version: number;
  device_id?: string | null;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

export class TransactionMapper {
  public static toDomain(row: CloudTransactionRow): Transaction {
    const amountPaise = row.amount_paise ?? row.amount_in_paise ?? 0;
    const resolvedTitle = row.title || row.description || 'Transaction';
    const destinationId = row.destination_account_id || row.target_account_id;
    const resolvedDate = new Date(row.transaction_date || row.date || new Date().toISOString());
    const resolvedDeletedAt = row.deleted_at
      ? new Date(row.deleted_at)
      : row.is_deleted
        ? new Date()
        : null;

    return new Transaction({
      id: createTransactionId(row.id),
      userId: createUserId(row.user_id),
      type: row.type as TransactionType,
      amountPaise,
      currency: row.currency || 'INR',
      accountId: createAccountId(row.account_id),
      destinationAccountId: destinationId ? createAccountId(destinationId) : undefined,
      categoryId: row.category_id ? createCategoryId(row.category_id) : undefined,
      title: resolvedTitle,
      note: (row.note ?? row.notes) ?? undefined,
      transactionDate: resolvedDate,
      deletedAt: resolvedDeletedAt,
      version: row.version,
      deviceId: row.device_id ?? undefined,
      idempotencyKey: row.idempotency_key,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    });
  }

  public static toCloud(entity: Transaction): CloudTransactionRow {
    return {
      id: entity.id,
      user_id: entity.userId,
      type: entity.type,
      amount_paise: entity.amountPaise,
      currency: entity.currency,
      account_id: entity.accountId,
      destination_account_id: entity.destinationAccountId ?? null,
      category_id: entity.categoryId ?? null,
      title: entity.title,
      note: entity.note ?? null,
      transaction_date: entity.transactionDate.toISOString(),
      deleted_at: entity.deletedAt ? entity.deletedAt.toISOString() : null,
      version: entity.version,
      device_id: entity.deviceId ?? null,
      idempotency_key: entity.idempotencyKey,
      created_at: entity.createdAt.toISOString(),
      updated_at: entity.updatedAt.toISOString(),

      // Compatibility fields
      target_account_id: entity.destinationAccountId ?? null,
      description: entity.title,
      notes: entity.note ?? null,
      date: entity.transactionDate.toISOString(),
      amount_in_paise: entity.amountPaise,
      is_deleted: entity.isDeleted
    };
  }
}

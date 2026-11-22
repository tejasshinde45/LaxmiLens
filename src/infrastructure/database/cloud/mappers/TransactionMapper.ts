import { Transaction, TransactionType } from '@/domain/entities/Transaction';
import {
  createTransactionId,
  createAccountId,
  createCategoryId,
  isValidUuid,
  validateUserId
} from '@/domain/value-objects/Identifiers';
import {
  InvalidMoneyError,
  InvalidUserIdError,
  TransferAccountMismatchError
} from '@/domain/errors/DomainErrors';

export interface CloudTransactionRow {
  id: string; // UUID
  user_id: string; // UUID
  type: 'income' | 'expense' | 'transfer';
  amount_paise: number; // BIGINT (safe integer > 0)
  currency: string; // ISO 4217, default 'INR'
  account_id: string; // UUID
  destination_account_id: string | null; // UUID or null
  category_id: string | null; // UUID or null
  title: string; // VARCHAR(255)
  note: string | null; // TEXT or null
  transaction_date: string; // ISO 8601 TIMESTAMPTZ
  deleted_at: string | null; // ISO 8601 TIMESTAMPTZ or null
  version: number; // INT >= 1
  device_id: string | null; // VARCHAR(100) or null
  idempotency_key: string; // VARCHAR(100)
  created_at?: string; // TIMESTAMPTZ
  updated_at?: string; // TIMESTAMPTZ
}

const VALID_TRANSACTION_TYPES: ReadonlySet<string> = new Set([
  'income',
  'expense',
  'transfer'
]);

export class TransactionMapper {
  /**
   * Converts a raw PostgreSQL cloud transaction row to the domain Transaction entity.
   */
  public static toDomain(row: CloudTransactionRow): Transaction {
    const amountPaise = row.amount_paise;
    if (
      amountPaise === undefined ||
      amountPaise === null ||
      typeof amountPaise !== 'number' ||
      !Number.isSafeInteger(amountPaise) ||
      amountPaise <= 0
    ) {
      throw new InvalidMoneyError('amount_paise from cloud is not a positive safe integer in paise.');
    }

    if (!VALID_TRANSACTION_TYPES.has(row.type)) {
      throw new Error(`Invalid transaction type '${row.type}' from cloud row.`);
    }

    const resolvedDate = new Date(row.transaction_date);
    if (isNaN(resolvedDate.getTime())) {
      throw new Error(`Invalid transaction_date '${row.transaction_date}' from cloud row.`);
    }

    const resolvedDeletedAt = row.deleted_at ? new Date(row.deleted_at) : null;
    if (row.deleted_at && isNaN(resolvedDeletedAt!.getTime())) {
      throw new Error(`Invalid deleted_at '${row.deleted_at}' from cloud row.`);
    }

    return new Transaction({
      id: createTransactionId(row.id),
      userId: validateUserId(row.user_id),
      type: row.type as TransactionType,
      amountPaise,
      currency: row.currency || 'INR',
      accountId: createAccountId(row.account_id),
      destinationAccountId: row.destination_account_id ? createAccountId(row.destination_account_id) : undefined,
      categoryId: row.category_id ? createCategoryId(row.category_id) : undefined,
      title: row.title,
      note: row.note ?? undefined,
      transactionDate: resolvedDate,
      deletedAt: resolvedDeletedAt,
      version: row.version,
      deviceId: row.device_id ?? undefined,
      idempotencyKey: row.idempotency_key,
      createdAt: row.created_at ? new Date(row.created_at) : undefined,
      updatedAt: row.updated_at ? new Date(row.updated_at) : undefined
    });
  }

  /**
   * Converts a domain Transaction entity to a canonical CloudTransactionRow.
   * Excludes local-only status and any legacy compatibility fields.
   */
  public static toCloud(entity: Transaction): CloudTransactionRow {
    if (!Number.isSafeInteger(entity.amountPaise) || entity.amountPaise <= 0) {
      throw new InvalidMoneyError('Transaction amountPaise must be a valid positive safe integer.');
    }

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
      updated_at: entity.updatedAt.toISOString()
    };
  }

  /**
   * Maps an outbox INSERT payload to a complete CloudTransactionRow.
   * Strictly validates integer paise, UUIDs, structural transfer rules, and eliminates legacy keys.
   */
  public static mapCreatePayload(payload: Record<string, unknown>): CloudTransactionRow {
    const id = payload.id;
    if (typeof id !== 'string' || !isValidUuid(id)) {
      throw new Error(`Invalid transaction ID '${id}': must be a valid UUID.`);
    }

    const userId = payload.user_id;
    if (typeof userId !== 'string' || !isValidUuid(userId)) {
      throw new InvalidUserIdError(`Invalid user ID '${userId}': must be a valid UUID.`);
    }

    const type = payload.type as string;
    if (!VALID_TRANSACTION_TYPES.has(type)) {
      throw new Error(`Invalid transaction type '${type}'. Must be income, expense, or transfer.`);
    }

    const amountPaise = payload.amount_paise ?? payload.amountInPaise;
    if (
      amountPaise === undefined ||
      amountPaise === null ||
      typeof amountPaise !== 'number' ||
      !Number.isSafeInteger(amountPaise) ||
      amountPaise <= 0
    ) {
      throw new InvalidMoneyError('Transaction amount_paise must be a strictly positive safe integer in paise.');
    }

    const accountId = payload.account_id ?? payload.accountId;
    if (typeof accountId !== 'string' || !isValidUuid(accountId)) {
      throw new Error(`Invalid source account ID '${accountId}': must be a valid UUID.`);
    }

    // Destination account rules
    const rawDestination = payload.destination_account_id ?? payload.destinationAccountId ?? payload.targetAccountId ?? payload.target_account_id;
    let destinationAccountId: string | null = null;
    if (type === 'transfer') {
      if (!rawDestination || typeof rawDestination !== 'string' || !isValidUuid(rawDestination)) {
        throw new TransferAccountMismatchError('A transfer transaction must specify a valid destination account UUID.');
      }
      if (rawDestination === accountId) {
        throw new TransferAccountMismatchError('Source and destination accounts must be distinct.');
      }
      destinationAccountId = rawDestination;
    } else {
      if (rawDestination !== undefined && rawDestination !== null) {
        throw new Error('Only transfer transactions may specify a destination account.');
      }
      destinationAccountId = null;
    }

    // Category rules
    const rawCategory = payload.category_id ?? payload.categoryId;
    let categoryId: string | null = null;
    if (type === 'transfer') {
      categoryId = null; // Transfers do not hold a category
    } else if (rawCategory !== undefined && rawCategory !== null) {
      if (typeof rawCategory !== 'string' || !isValidUuid(rawCategory)) {
        throw new Error(`Invalid category ID '${rawCategory}': must be a valid UUID.`);
      }
      categoryId = rawCategory;
    }

    const rawTitle = payload.title ?? payload.description;
    if (typeof rawTitle !== 'string' || rawTitle.trim().length === 0) {
      throw new Error('Transaction title must not be empty.');
    }
    const title = rawTitle.trim();
    if (title.length > 255) {
      throw new Error('Transaction title exceeds maximum length of 255 characters.');
    }

    const idempotencyKey = payload.idempotency_key ?? payload.idempotencyKey;
    if (typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
      throw new Error('Transaction idempotency_key must not be empty.');
    }

    const rawDate = payload.transaction_date ?? payload.transactionDate ?? payload.date;
    if (typeof rawDate !== 'string') {
      throw new Error('Transaction transaction_date must be a valid ISO 8601 string.');
    }
    const parsedDate = new Date(rawDate);
    if (isNaN(parsedDate.getTime())) {
      throw new Error(`Invalid transaction_date '${rawDate}': cannot parse as valid date.`);
    }
    const transactionDate = parsedDate.toISOString();

    const currency = typeof payload.currency === 'string' && payload.currency.trim().length === 3
      ? payload.currency.trim().toUpperCase()
      : 'INR';

    const rawNote = payload.note ?? payload.notes;
    const note = typeof rawNote === 'string' && rawNote.trim().length > 0 ? rawNote.trim() : null;

    const deviceId = typeof payload.device_id === 'string' && payload.device_id.trim().length > 0
      ? payload.device_id.trim()
      : typeof payload.deviceId === 'string' && payload.deviceId.trim().length > 0
        ? payload.deviceId.trim()
        : null;

    const version = typeof payload.version === 'number' && Number.isSafeInteger(payload.version) && payload.version >= 1
      ? payload.version
      : 1;

    return {
      id,
      user_id: userId,
      type: type as 'income' | 'expense' | 'transfer',
      amount_paise: amountPaise,
      currency,
      account_id: accountId,
      destination_account_id: destinationAccountId,
      category_id: categoryId,
      title,
      note,
      transaction_date: transactionDate,
      deleted_at: null,
      version,
      device_id: deviceId,
      idempotency_key: idempotencyKey.trim()
    };
  }

  /**
   * Maps an outbox UPDATE payload to a partial CloudTransactionRow.
   * Strips immutable fields: id, user_id, created_at, currency, idempotency_key, and type.
   * Strips all legacy columns and sets updated_at.
   */
  public static mapUpdatePayload(payload: Record<string, unknown>): Partial<CloudTransactionRow> {
    const patch: Partial<CloudTransactionRow> = {};

    if (payload.version !== undefined) {
      if (typeof payload.version !== 'number' || !Number.isSafeInteger(payload.version) || payload.version < 2) {
        throw new Error(`Invalid target version '${payload.version}' in transaction update payload.`);
      }
      patch.version = payload.version;
    }

    if (payload.amount_paise !== undefined || payload.amountInPaise !== undefined) {
      const amountPaise = payload.amount_paise ?? payload.amountInPaise;
      if (
        typeof amountPaise !== 'number' ||
        !Number.isSafeInteger(amountPaise) ||
        amountPaise <= 0
      ) {
        throw new InvalidMoneyError('amount_paise must be a strictly positive safe integer in paise.');
      }
      patch.amount_paise = amountPaise;
    }

    if (payload.title !== undefined || payload.description !== undefined) {
      const rawTitle = payload.title ?? payload.description;
      if (typeof rawTitle !== 'string' || rawTitle.trim().length === 0) {
        throw new Error('Transaction title must not be empty.');
      }
      if (rawTitle.trim().length > 255) {
        throw new Error('Transaction title exceeds maximum length of 255 characters.');
      }
      patch.title = rawTitle.trim();
    }

    if (payload.account_id !== undefined || payload.accountId !== undefined) {
      const accId = payload.account_id ?? payload.accountId;
      if (typeof accId !== 'string' || !isValidUuid(accId)) {
        throw new Error(`Invalid account_id '${accId}': must be a valid UUID.`);
      }
      patch.account_id = accId;
    }

    const rawDestination = payload.destination_account_id ?? payload.destinationAccountId ?? payload.targetAccountId ?? payload.target_account_id;
    if (rawDestination !== undefined) {
      if (rawDestination === null) {
        patch.destination_account_id = null;
      } else if (typeof rawDestination === 'string' && isValidUuid(rawDestination)) {
        if (patch.account_id && rawDestination === patch.account_id) {
          throw new TransferAccountMismatchError('Source and destination accounts must be distinct.');
        }
        patch.destination_account_id = rawDestination;
      } else {
        throw new Error(`Invalid destination_account_id '${rawDestination}': must be a valid UUID or null.`);
      }
    }

    const rawCategory = payload.category_id ?? payload.categoryId;
    if (rawCategory !== undefined) {
      if (rawCategory === null) {
        patch.category_id = null;
      } else if (typeof rawCategory === 'string' && isValidUuid(rawCategory)) {
        patch.category_id = rawCategory;
      } else {
        throw new Error(`Invalid category_id '${rawCategory}': must be a valid UUID or null.`);
      }
    }

    if (payload.note !== undefined || payload.notes !== undefined) {
      const rawNote = payload.note ?? payload.notes;
      patch.note = typeof rawNote === 'string' && rawNote.trim().length > 0 ? rawNote.trim() : null;
    }

    if (payload.transaction_date !== undefined || payload.transactionDate !== undefined || payload.date !== undefined) {
      const rawDate = payload.transaction_date ?? payload.transactionDate ?? payload.date;
      if (typeof rawDate !== 'string') {
        throw new Error('Transaction transaction_date must be a valid string.');
      }
      const parsed = new Date(rawDate);
      if (isNaN(parsed.getTime())) {
        throw new Error(`Invalid transaction_date '${rawDate}'.`);
      }
      patch.transaction_date = parsed.toISOString();
    }

    if (payload.deleted_at !== undefined) {
      if (payload.deleted_at === null) {
        patch.deleted_at = null;
      } else if (typeof payload.deleted_at === 'string') {
        const parsed = new Date(payload.deleted_at);
        if (isNaN(parsed.getTime())) {
          throw new Error(`Invalid deleted_at '${payload.deleted_at}'.`);
        }
        patch.deleted_at = parsed.toISOString();
      }
    }

    // Always provide updated_at
    patch.updated_at = new Date().toISOString();

    // Strip immutable fields
    delete (patch as Record<string, unknown>).id;
    delete (patch as Record<string, unknown>).user_id;
    delete (patch as Record<string, unknown>).created_at;
    delete (patch as Record<string, unknown>).currency;
    delete (patch as Record<string, unknown>).idempotency_key;
    delete (patch as Record<string, unknown>).type;

    // Strip legacy Dexie fields
    delete (patch as Record<string, unknown>).targetAccountId;
    delete (patch as Record<string, unknown>).target_account_id;
    delete (patch as Record<string, unknown>).description;
    delete (patch as Record<string, unknown>).notes;
    delete (patch as Record<string, unknown>).date;
    delete (patch as Record<string, unknown>).amountInPaise;
    delete (patch as Record<string, unknown>).amount_in_paise;
    delete (patch as Record<string, unknown>).isDeleted;
    delete (patch as Record<string, unknown>).is_deleted;
    delete (patch as Record<string, unknown>).status;

    return patch;
  }

  /**
   * Maps an outbox soft-delete operation into a minimal cloud update patch.
   * Never executes a SQL hard DELETE.
   */
  public static mapSoftDeletePayload(
    payload: Record<string, unknown>
  ): Pick<CloudTransactionRow, 'deleted_at' | 'version' | 'updated_at'> {
    if (typeof payload.version !== 'number' || !Number.isSafeInteger(payload.version) || payload.version < 2) {
      throw new Error(`Invalid version '${payload.version}' in transaction soft-delete payload.`);
    }

    let deletedAt = new Date().toISOString();
    if (typeof payload.deleted_at === 'string') {
      const parsed = new Date(payload.deleted_at);
      if (!isNaN(parsed.getTime())) {
        deletedAt = parsed.toISOString();
      }
    }

    return {
      deleted_at: deletedAt,
      version: payload.version,
      updated_at: new Date().toISOString()
    };
  }
}

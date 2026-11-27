import { Borrowing, BorrowingStatus } from '@/domain/entities/Borrowing';
import {
  createBorrowingId,
  createLenderId,
  createAccountId,
  createTransactionId,
  validateUserId,
  isValidUuid
} from '@/domain/value-objects/Identifiers';
import { InvalidUserIdError } from '@/domain/errors/DomainErrors';
import { InvalidBorrowingAmountError } from '@/domain/errors/BorrowingErrors';
import { LocalBorrowingRecord } from '@/infrastructure/database/local/schema';

export interface CloudBorrowingRow {
  id: string; // UUID
  user_id: string; // UUID
  lender_id: string; // UUID
  amount_paise: number;
  borrowing_date: string; // ISO 8601
  due_date: string | null; // ISO 8601
  receiving_account_id: string; // UUID
  transaction_id: string; // UUID
  status: BorrowingStatus;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
}

const VALID_BORROWING_STATUSES: ReadonlySet<string> = new Set(['active', 'repaid']);

export class BorrowingMapper {
  /**
   * Validates structural, monetary, date, and relational UUID fields of a CloudBorrowingRow.
   */
  public static validateCloudRow(row: CloudBorrowingRow): void {
    if (!row || typeof row !== 'object') {
      throw new Error('Malformed cloud borrowing row: expected object.');
    }
    if (typeof row.id !== 'string' || !isValidUuid(row.id)) {
      throw new Error(`Invalid cloud borrowing ID '${row.id}': must be a valid UUID.`);
    }
    validateUserId(row.user_id);

    if (typeof row.lender_id !== 'string' || !isValidUuid(row.lender_id)) {
      throw new Error(`Invalid cloud borrowing lender_id '${row.lender_id}' on '${row.id}'.`);
    }
    if (
      typeof row.amount_paise !== 'number' ||
      !Number.isSafeInteger(row.amount_paise) ||
      row.amount_paise <= 0
    ) {
      throw new InvalidBorrowingAmountError();
    }
    if (isNaN(new Date(row.borrowing_date).getTime())) {
      throw new Error(`Invalid cloud borrowing_date '${row.borrowing_date}' on '${row.id}'.`);
    }
    if (row.due_date !== null && row.due_date !== undefined && isNaN(new Date(row.due_date).getTime())) {
      throw new Error(`Invalid cloud due_date '${row.due_date}' on '${row.id}'.`);
    }
    if (typeof row.receiving_account_id !== 'string' || !isValidUuid(row.receiving_account_id)) {
      throw new Error(
        `Invalid cloud receiving_account_id '${row.receiving_account_id}' on '${row.id}'.`
      );
    }
    if (typeof row.transaction_id !== 'string' || !isValidUuid(row.transaction_id)) {
      throw new Error(`Invalid cloud transaction_id '${row.transaction_id}' on '${row.id}'.`);
    }
    if (!VALID_BORROWING_STATUSES.has(row.status)) {
      throw new Error(`Invalid borrowing status '${row.status}' from cloud row.`);
    }
  }

  /**
   * Converts a CloudBorrowingRow to a LocalBorrowingRecord for Dexie persistence.
   */
  public static toLocalRecord(row: CloudBorrowingRow): LocalBorrowingRecord {
    this.validateCloudRow(row);
    const nowIso = new Date().toISOString();
    return {
      id: row.id.trim(),
      userId: validateUserId(row.user_id),
      lenderId: row.lender_id.trim(),
      amountPaise: row.amount_paise,
      borrowingDate: new Date(row.borrowing_date).toISOString(),
      dueDate: row.due_date ? new Date(row.due_date).toISOString() : null,
      receivingAccountId: row.receiving_account_id.trim(),
      transactionId: row.transaction_id.trim(),
      status: row.status,
      notes: row.notes ?? undefined,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : nowIso,
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : nowIso
    };
  }

  /**
   * Converts a raw PostgreSQL cloud borrowing row to the domain Borrowing entity.
   */
  public static toDomain(row: CloudBorrowingRow): Borrowing {
    if (!VALID_BORROWING_STATUSES.has(row.status)) {
      throw new Error(`Invalid borrowing status '${row.status}' from cloud row.`);
    }

    return new Borrowing({
      id: createBorrowingId(row.id),
      userId: validateUserId(row.user_id),
      lenderId: createLenderId(row.lender_id),
      amountPaise: row.amount_paise,
      borrowingDate: new Date(row.borrowing_date),
      dueDate: row.due_date ? new Date(row.due_date) : null,
      receivingAccountId: createAccountId(row.receiving_account_id),
      transactionId: createTransactionId(row.transaction_id),
      status: row.status as BorrowingStatus,
      notes: row.notes ?? undefined,
      createdAt: row.created_at ? new Date(row.created_at) : undefined,
      updatedAt: row.updated_at ? new Date(row.updated_at) : undefined
    });
  }

  /**
   * Converts a domain Borrowing entity to a complete CloudBorrowingRow.
   */
  public static toCloud(borrowing: Borrowing): CloudBorrowingRow {
    return {
      id: borrowing.id,
      user_id: borrowing.userId,
      lender_id: borrowing.lenderId,
      amount_paise: borrowing.amountPaise,
      borrowing_date: borrowing.borrowingDate.toISOString(),
      due_date: borrowing.dueDate ? borrowing.dueDate.toISOString() : null,
      receiving_account_id: borrowing.receivingAccountId,
      transaction_id: borrowing.transactionId,
      status: borrowing.status,
      notes: borrowing.notes ?? null,
      created_at: borrowing.createdAt.toISOString(),
      updated_at: borrowing.updatedAt.toISOString()
    };
  }

  /**
   * Maps an outbox INSERT payload to a complete CloudBorrowingRow.
   * Strictly validates UUIDs, positive integer paise, and date timestamps.
   */
  public static mapCreatePayload(payload: Record<string, unknown>): CloudBorrowingRow {
    const id = payload.id;
    if (typeof id !== 'string' || !isValidUuid(id)) {
      throw new Error(`Invalid borrowing ID '${id}': must be a valid UUID.`);
    }

    const userId = payload.user_id ?? payload.userId;
    if (typeof userId !== 'string' || !isValidUuid(userId)) {
      throw new InvalidUserIdError(`Invalid user ID '${userId}': must be a valid UUID.`);
    }

    const lenderId = payload.lender_id ?? payload.lenderId;
    if (typeof lenderId !== 'string' || !isValidUuid(lenderId)) {
      throw new Error(`Invalid lender ID '${lenderId}': must be a valid UUID.`);
    }

    const rawAmount = payload.amount_paise ?? payload.amountPaise;
    if (
      typeof rawAmount !== 'number' ||
      !Number.isSafeInteger(rawAmount) ||
      rawAmount <= 0
    ) {
      throw new InvalidBorrowingAmountError();
    }

    const rawBorrowingDate = payload.borrowing_date ?? payload.borrowingDate;
    if (typeof rawBorrowingDate !== 'string' || isNaN(new Date(rawBorrowingDate).getTime())) {
      throw new Error(`Invalid borrowing_date '${rawBorrowingDate}': must be a valid ISO string.`);
    }

    const rawDueDate = payload.due_date ?? payload.dueDate;
    let dueDate: string | null = null;
    if (rawDueDate !== null && rawDueDate !== undefined) {
      if (typeof rawDueDate !== 'string' || isNaN(new Date(rawDueDate).getTime())) {
        throw new Error(`Invalid due_date '${rawDueDate}': must be a valid ISO string.`);
      }
      dueDate = new Date(rawDueDate).toISOString();
    }

    const receivingAccountId = payload.receiving_account_id ?? payload.receivingAccountId;
    if (typeof receivingAccountId !== 'string' || !isValidUuid(receivingAccountId)) {
      throw new Error(`Invalid receiving_account_id '${receivingAccountId}': must be a valid UUID.`);
    }

    const transactionId = payload.transaction_id ?? payload.transactionId;
    if (typeof transactionId !== 'string' || !isValidUuid(transactionId)) {
      throw new Error(`Invalid transaction_id '${transactionId}': must be a valid UUID.`);
    }

    const status = (payload.status as string) || 'active';
    if (!VALID_BORROWING_STATUSES.has(status)) {
      throw new Error(`Invalid status '${status}'. Must be active or repaid.`);
    }

    const notes =
      typeof payload.notes === 'string' && payload.notes.trim().length > 0
        ? payload.notes.trim()
        : null;

    const createdAt =
      typeof payload.created_at === 'string'
        ? payload.created_at
        : typeof payload.createdAt === 'string'
          ? payload.createdAt
          : new Date().toISOString();

    const updatedAt =
      typeof payload.updated_at === 'string'
        ? payload.updated_at
        : typeof payload.updatedAt === 'string'
          ? payload.updatedAt
          : new Date().toISOString();

    return {
      id,
      user_id: userId,
      lender_id: lenderId,
      amount_paise: rawAmount,
      borrowing_date: new Date(rawBorrowingDate).toISOString(),
      due_date: dueDate,
      receiving_account_id: receivingAccountId,
      transaction_id: transactionId,
      status: status as BorrowingStatus,
      notes,
      created_at: createdAt,
      updated_at: updatedAt
    };
  }

  /**
   * Maps an outbox UPDATE payload to a partial CloudBorrowingRow.
   * Typically used when a borrowing transitions status to 'repaid'.
   */
  public static mapUpdatePayload(payload: Record<string, unknown>): Partial<CloudBorrowingRow> {
    const patch: Partial<CloudBorrowingRow> = {};

    if (payload.status !== undefined) {
      const status = payload.status as string;
      if (!VALID_BORROWING_STATUSES.has(status)) {
        throw new Error(`Invalid status '${status}'. Must be active or repaid.`);
      }
      patch.status = status as BorrowingStatus;
    }

    if (payload.due_date !== undefined || payload.dueDate !== undefined) {
      const rawDueDate = payload.due_date ?? payload.dueDate;
      if (rawDueDate === null) {
        patch.due_date = null;
      } else if (typeof rawDueDate === 'string' && !isNaN(new Date(rawDueDate).getTime())) {
        patch.due_date = new Date(rawDueDate).toISOString();
      } else {
        throw new Error(`Invalid due_date '${rawDueDate}'.`);
      }
    }

    if (payload.notes !== undefined) {
      patch.notes =
        typeof payload.notes === 'string' && payload.notes.trim().length > 0
          ? payload.notes.trim()
          : null;
    }

    patch.updated_at = new Date().toISOString();

    // Strip immutable fields
    delete (patch as Record<string, unknown>).id;
    delete (patch as Record<string, unknown>).user_id;
    delete (patch as Record<string, unknown>).lender_id;
    delete (patch as Record<string, unknown>).amount_paise;
    delete (patch as Record<string, unknown>).amountPaise;
    delete (patch as Record<string, unknown>).borrowing_date;
    delete (patch as Record<string, unknown>).borrowingDate;
    delete (patch as Record<string, unknown>).receiving_account_id;
    delete (patch as Record<string, unknown>).receivingAccountId;
    delete (patch as Record<string, unknown>).transaction_id;
    delete (patch as Record<string, unknown>).transactionId;
    delete (patch as Record<string, unknown>).created_at;

    return patch;
  }
}

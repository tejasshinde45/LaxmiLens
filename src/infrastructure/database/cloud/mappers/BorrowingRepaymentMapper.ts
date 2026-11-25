import { BorrowingRepayment } from '@/domain/entities/BorrowingRepayment';
import {
  createRepaymentId,
  createBorrowingId,
  createLenderId,
  createAccountId,
  createTransactionId,
  validateUserId,
  isValidUuid
} from '@/domain/value-objects/Identifiers';
import { InvalidUserIdError } from '@/domain/errors/DomainErrors';
import { InvalidRepaymentAmountError } from '@/domain/errors/BorrowingErrors';

export interface CloudBorrowingRepaymentRow {
  id: string; // UUID
  user_id: string; // UUID
  borrowing_id: string; // UUID
  lender_id: string; // UUID
  amount_paise: number;
  repayment_date: string; // ISO 8601
  payment_account_id: string; // UUID
  transaction_id: string; // UUID
  notes: string | null;
  created_at?: string;
  updated_at?: string;
}

export class BorrowingRepaymentMapper {
  /**
   * Converts a raw PostgreSQL cloud borrowing repayment row to the domain BorrowingRepayment entity.
   */
  public static toDomain(row: CloudBorrowingRepaymentRow): BorrowingRepayment {
    return new BorrowingRepayment({
      id: createRepaymentId(row.id),
      userId: validateUserId(row.user_id),
      borrowingId: createBorrowingId(row.borrowing_id),
      lenderId: createLenderId(row.lender_id),
      amountPaise: row.amount_paise,
      repaymentDate: new Date(row.repayment_date),
      paymentAccountId: createAccountId(row.payment_account_id),
      transactionId: createTransactionId(row.transaction_id),
      notes: row.notes ?? undefined,
      createdAt: row.created_at ? new Date(row.created_at) : undefined,
      updatedAt: row.updated_at ? new Date(row.updated_at) : undefined
    });
  }

  /**
   * Converts a domain BorrowingRepayment entity to a complete CloudBorrowingRepaymentRow.
   */
  public static toCloud(repayment: BorrowingRepayment): CloudBorrowingRepaymentRow {
    return {
      id: repayment.id,
      user_id: repayment.userId,
      borrowing_id: repayment.borrowingId,
      lender_id: repayment.lenderId,
      amount_paise: repayment.amountPaise,
      repayment_date: repayment.repaymentDate.toISOString(),
      payment_account_id: repayment.paymentAccountId,
      transaction_id: repayment.transactionId,
      notes: repayment.notes ?? null,
      created_at: repayment.createdAt.toISOString(),
      updated_at: repayment.updatedAt.toISOString()
    };
  }

  /**
   * Maps an outbox INSERT payload to a complete CloudBorrowingRepaymentRow.
   * Strictly validates UUIDs, positive integer paise, and date timestamps.
   */
  public static mapCreatePayload(payload: Record<string, unknown>): CloudBorrowingRepaymentRow {
    const id = payload.id;
    if (typeof id !== 'string' || !isValidUuid(id)) {
      throw new Error(`Invalid repayment ID '${id}': must be a valid UUID.`);
    }

    const userId = payload.user_id ?? payload.userId;
    if (typeof userId !== 'string' || !isValidUuid(userId)) {
      throw new InvalidUserIdError(`Invalid user ID '${userId}': must be a valid UUID.`);
    }

    const borrowingId = payload.borrowing_id ?? payload.borrowingId;
    if (typeof borrowingId !== 'string' || !isValidUuid(borrowingId)) {
      throw new Error(`Invalid borrowing ID '${borrowingId}': must be a valid UUID.`);
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
      throw new InvalidRepaymentAmountError();
    }

    const rawRepaymentDate = payload.repayment_date ?? payload.repaymentDate;
    if (typeof rawRepaymentDate !== 'string' || isNaN(new Date(rawRepaymentDate).getTime())) {
      throw new Error(`Invalid repayment_date '${rawRepaymentDate}': must be a valid ISO string.`);
    }

    const paymentAccountId = payload.payment_account_id ?? payload.paymentAccountId;
    if (typeof paymentAccountId !== 'string' || !isValidUuid(paymentAccountId)) {
      throw new Error(`Invalid payment_account_id '${paymentAccountId}': must be a valid UUID.`);
    }

    const transactionId = payload.transaction_id ?? payload.transactionId;
    if (typeof transactionId !== 'string' || !isValidUuid(transactionId)) {
      throw new Error(`Invalid transaction_id '${transactionId}': must be a valid UUID.`);
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
      borrowing_id: borrowingId,
      lender_id: lenderId,
      amount_paise: rawAmount,
      repayment_date: new Date(rawRepaymentDate).toISOString(),
      payment_account_id: paymentAccountId,
      transaction_id: transactionId,
      notes,
      created_at: createdAt,
      updated_at: updatedAt
    };
  }
}

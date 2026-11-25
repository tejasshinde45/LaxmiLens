import { BorrowingRepository } from '@/domain/repositories/BorrowingRepository';
import { Borrowing } from '@/domain/entities/Borrowing';
import { BorrowingRepayment } from '@/domain/entities/BorrowingRepayment';
import {
  BorrowingId,
  LenderId,
  RepaymentId,
  UserId,
  createBorrowingId,
  createLenderId,
  createRepaymentId,
  createAccountId,
  createTransactionId,
  validateUserId
} from '@/domain/value-objects/Identifiers';
import { UnauthorizedEntityAccessError } from '@/domain/errors/DomainErrors';
import { db, LaxmiLensDB } from '../DexieDatabase';
import { LocalBorrowingRecord, LocalBorrowingRepaymentRecord } from '../schema';

export class DexieBorrowingRepository implements BorrowingRepository {
  constructor(private readonly database: LaxmiLensDB = db) {}

  public async findById(id: BorrowingId, userId: UserId): Promise<Borrowing | null> {
    const validatedUserId = validateUserId(userId);
    let record: LocalBorrowingRecord | undefined | null;

    if (typeof this.database.borrowings.where === 'function') {
      record = await this.database.borrowings
        .where('[userId+id]')
        .equals([validatedUserId, id])
        .first();
    } else {
      const candidate = await this.database.borrowings.get(id);
      if (candidate && candidate.userId === validatedUserId) {
        record = candidate;
      }
    }

    if (!record) {
      const raw = await this.database.borrowings.get(id);
      if (raw && raw.userId && raw.userId !== validatedUserId) {
        throw new UnauthorizedEntityAccessError('Borrowing', id);
      }
      return null;
    }

    return this.toDomainBorrowing(record);
  }

  public async findByUserId(userId: UserId): Promise<Borrowing[]> {
    const validatedUserId = validateUserId(userId);
    const records = await this.database.borrowings
      .where('userId')
      .equals(validatedUserId)
      .toArray();

    return records.map((r) => this.toDomainBorrowing(r));
  }

  public async findByLenderId(lenderId: LenderId, userId: UserId): Promise<Borrowing[]> {
    const validatedUserId = validateUserId(userId);
    const records = await this.database.borrowings
      .where('[userId+lenderId]')
      .equals([validatedUserId, lenderId])
      .toArray();

    return records.map((r) => this.toDomainBorrowing(r));
  }

  public async save(borrowing: Borrowing): Promise<void> {
    const validatedUserId = validateUserId(borrowing.userId);
    const existing = await this.database.borrowings.get(borrowing.id);

    if (existing && existing.userId && existing.userId !== validatedUserId) {
      throw new UnauthorizedEntityAccessError('Borrowing', borrowing.id);
    }

    const record = this.toRecordBorrowing(borrowing);
    await this.database.borrowings.put(record);
  }

  public async findRepaymentById(id: RepaymentId, userId: UserId): Promise<BorrowingRepayment | null> {
    const validatedUserId = validateUserId(userId);
    let record: LocalBorrowingRepaymentRecord | undefined | null;

    if (typeof this.database.borrowingRepayments.where === 'function') {
      record = await this.database.borrowingRepayments
        .where('[userId+id]')
        .equals([validatedUserId, id])
        .first();
    } else {
      const candidate = await this.database.borrowingRepayments.get(id);
      if (candidate && candidate.userId === validatedUserId) {
        record = candidate;
      }
    }

    if (!record) {
      const raw = await this.database.borrowingRepayments.get(id);
      if (raw && raw.userId && raw.userId !== validatedUserId) {
        throw new UnauthorizedEntityAccessError('BorrowingRepayment', id);
      }
      return null;
    }

    return this.toDomainRepayment(record);
  }

  public async findRepaymentsByBorrowingId(
    borrowingId: BorrowingId,
    userId: UserId
  ): Promise<BorrowingRepayment[]> {
    const validatedUserId = validateUserId(userId);
    const records = await this.database.borrowingRepayments
      .where('[userId+borrowingId]')
      .equals([validatedUserId, borrowingId])
      .toArray();

    return records.map((r) => this.toDomainRepayment(r));
  }

  public async findRepaymentsByLenderId(
    lenderId: LenderId,
    userId: UserId
  ): Promise<BorrowingRepayment[]> {
    const validatedUserId = validateUserId(userId);
    const records = await this.database.borrowingRepayments
      .where('[userId+lenderId]')
      .equals([validatedUserId, lenderId])
      .toArray();

    return records.map((r) => this.toDomainRepayment(r));
  }

  public async findRepaymentsByUserId(userId: UserId): Promise<BorrowingRepayment[]> {
    const validatedUserId = validateUserId(userId);
    const records = await this.database.borrowingRepayments
      .where('userId')
      .equals(validatedUserId)
      .toArray();

    return records.map((r) => this.toDomainRepayment(r));
  }

  public async saveRepayment(repayment: BorrowingRepayment): Promise<void> {
    const validatedUserId = validateUserId(repayment.userId);
    const existing = await this.database.borrowingRepayments.get(repayment.id);

    if (existing && existing.userId && existing.userId !== validatedUserId) {
      throw new UnauthorizedEntityAccessError('BorrowingRepayment', repayment.id);
    }

    const record = this.toRecordRepayment(repayment);
    await this.database.borrowingRepayments.put(record);
  }

  private toDomainBorrowing(record: LocalBorrowingRecord): Borrowing {
    return new Borrowing({
      id: createBorrowingId(record.id),
      userId: validateUserId(record.userId),
      lenderId: createLenderId(record.lenderId),
      amountPaise: record.amountPaise,
      borrowingDate: new Date(record.borrowingDate),
      dueDate: record.dueDate ? new Date(record.dueDate) : null,
      receivingAccountId: createAccountId(record.receivingAccountId),
      transactionId: createTransactionId(record.transactionId),
      status: record.status,
      notes: record.notes,
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt)
    });
  }

  private toRecordBorrowing(borrowing: Borrowing): LocalBorrowingRecord {
    return {
      id: borrowing.id,
      userId: borrowing.userId,
      lenderId: borrowing.lenderId,
      amountPaise: borrowing.amountPaise,
      borrowingDate: borrowing.borrowingDate.toISOString(),
      dueDate: borrowing.dueDate ? borrowing.dueDate.toISOString() : null,
      receivingAccountId: borrowing.receivingAccountId,
      transactionId: borrowing.transactionId,
      status: borrowing.status,
      notes: borrowing.notes,
      createdAt: borrowing.createdAt.toISOString(),
      updatedAt: borrowing.updatedAt.toISOString()
    };
  }

  private toDomainRepayment(record: LocalBorrowingRepaymentRecord): BorrowingRepayment {
    return new BorrowingRepayment({
      id: createRepaymentId(record.id),
      userId: validateUserId(record.userId),
      borrowingId: createBorrowingId(record.borrowingId),
      lenderId: createLenderId(record.lenderId),
      amountPaise: record.amountPaise,
      repaymentDate: new Date(record.repaymentDate),
      paymentAccountId: createAccountId(record.paymentAccountId),
      transactionId: createTransactionId(record.transactionId),
      notes: record.notes,
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt)
    });
  }

  private toRecordRepayment(repayment: BorrowingRepayment): LocalBorrowingRepaymentRecord {
    return {
      id: repayment.id,
      userId: repayment.userId,
      borrowingId: repayment.borrowingId,
      lenderId: repayment.lenderId,
      amountPaise: repayment.amountPaise,
      repaymentDate: repayment.repaymentDate.toISOString(),
      paymentAccountId: repayment.paymentAccountId,
      transactionId: repayment.transactionId,
      notes: repayment.notes,
      createdAt: repayment.createdAt.toISOString(),
      updatedAt: repayment.updatedAt.toISOString()
    };
  }
}

import { BorrowingRepository } from '@/domain/repositories/BorrowingRepository';
import { LenderRepository } from '@/domain/repositories/LenderRepository';
import { AccountRepository } from '@/domain/repositories/AccountRepository';
import { TransactionRepository } from '@/domain/repositories/TransactionRepository';
import { SyncPort } from '@/application/ports/SyncPort';
import { UnitOfWork } from '@/application/ports/UnitOfWork';
import { EnsurePersonalBorrowingsAccountUseCase } from './EnsurePersonalBorrowingsAccountUseCase';
import { Borrowing } from '@/domain/entities/Borrowing';
import { BorrowingRepayment } from '@/domain/entities/BorrowingRepayment';
import { Transaction } from '@/domain/entities/Transaction';
import {
  createLenderId,
  createBorrowingId,
  createRepaymentId,
  createTransactionId,
  createAccountId,
  validateUserId
} from '@/domain/value-objects/Identifiers';
import {
  AccountNotFoundError,
  UnauthorizedEntityAccessError
} from '@/domain/errors/DomainErrors';
import {
  LenderNotFoundError,
  BorrowingNotFoundError,
  InvalidRepaymentAmountError,
  RepaymentExceedsOutstandingBalanceError
} from '@/domain/errors/BorrowingErrors';
import { BorrowingRepaymentDTO } from '@/application/dto/BorrowingDTO';
import { formatPaiseToINR } from '@/utils/formatters';

export interface RecordRepaymentRequest {
  userId: string;
  borrowingId?: string;
  lenderId?: string;
  amountPaise?: number;
  amountInPaise?: number;
  repaymentDate?: string | Date;
  paymentAccountId: string;
  notes?: string;
}

export class RecordRepaymentUseCase {
  constructor(
    private readonly borrowingRepo: BorrowingRepository,
    private readonly lenderRepo: LenderRepository,
    private readonly accountRepo: AccountRepository,
    private readonly transactionRepo: TransactionRepository,
    private readonly ensureAccountUseCase: EnsurePersonalBorrowingsAccountUseCase,
    private readonly syncPort: SyncPort,
    private readonly unitOfWork: UnitOfWork
  ) {}

  public async execute(req: RecordRepaymentRequest): Promise<BorrowingRepaymentDTO> {
    const userId = validateUserId(req.userId);

    const amountPaise = req.amountPaise ?? req.amountInPaise ?? 0;
    if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
      throw new InvalidRepaymentAmountError();
    }

    const paymentAccountId = createAccountId(req.paymentAccountId);
    const paymentAccount = await this.accountRepo.findById(paymentAccountId, userId);
    if (!paymentAccount) {
      throw new AccountNotFoundError(req.paymentAccountId);
    }
    if (paymentAccount.userId !== userId) {
      throw new UnauthorizedEntityAccessError('Account', req.paymentAccountId);
    }

    // 1. Resolve Target Borrowing
    let targetBorrowing: Borrowing | null = null;

    if (req.borrowingId) {
      targetBorrowing = await this.borrowingRepo.findById(
        createBorrowingId(req.borrowingId),
        userId
      );
      if (!targetBorrowing) {
        throw new BorrowingNotFoundError(req.borrowingId);
      }
    } else if (req.lenderId) {
      const lenderId = createLenderId(req.lenderId);
      const borrowings = await this.borrowingRepo.findByLenderId(lenderId, userId);
      const activeBorrowings = borrowings.filter((b) => b.status === 'active');

      if (activeBorrowings.length === 0) {
        throw new BorrowingNotFoundError(
          `No active outstanding borrowings found for lender '${req.lenderId}'.`
        );
      }

      // Pick earliest active borrowing
      activeBorrowings.sort(
        (a, b) => a.borrowingDate.getTime() - b.borrowingDate.getTime()
      );
      targetBorrowing = activeBorrowings[0];
    } else {
      throw new Error('Either borrowingId or lenderId must be provided to record a repayment.');
    }

    if (targetBorrowing.userId !== userId) {
      throw new UnauthorizedEntityAccessError('Borrowing', targetBorrowing.id);
    }

    if (targetBorrowing.status === 'repaid' || targetBorrowing.isRepaid()) {
      throw new RepaymentExceedsOutstandingBalanceError(amountPaise, 0);
    }

    // 2. Resolve Lender
    const lender = await this.lenderRepo.findById(targetBorrowing.lenderId, userId);
    if (!lender) {
      throw new LenderNotFoundError(targetBorrowing.lenderId);
    }

    // 3. Outstanding Balance Verification
    const existingRepayments = await this.borrowingRepo.findRepaymentsByBorrowingId(
      targetBorrowing.id,
      userId
    );
    const alreadyRepaidPaise = existingRepayments.reduce(
      (sum, r) => sum + r.amountPaise,
      0
    );
    const outstandingPaise = Math.max(0, targetBorrowing.amountPaise - alreadyRepaidPaise);

    if (outstandingPaise <= 0 || amountPaise > outstandingPaise) {
      throw new RepaymentExceedsOutstandingBalanceError(amountPaise, outstandingPaise);
    }

    // 4. Ensure Aggregate 'Personal Borrowings' Account
    const personalBorrowingsAccount = await this.ensureAccountUseCase.execute(userId);

    // 5. Create Transfer Transaction: Payment Account (Cash/Bank) -> Personal Borrowings
    const now = new Date();
    const resolvedRepaymentDate = req.repaymentDate
      ? new Date(req.repaymentDate)
      : now;
    const transactionId = createTransactionId(crypto.randomUUID());
    const txIdempotencyKey = crypto.randomUUID();

    const transferTx = new Transaction({
      id: transactionId,
      userId,
      type: 'transfer',
      amountPaise,
      currency: paymentAccount.currency,
      accountId: paymentAccount.id,
      destinationAccountId: personalBorrowingsAccount.id,
      title: `Repayment to ${lender.name}`,
      note: req.notes?.trim() || `Personal loan repayment to ${lender.name}`,
      transactionDate: resolvedRepaymentDate,
      deletedAt: null,
      status: 'cleared',
      idempotencyKey: txIdempotencyKey,
      version: 1,
      createdAt: now,
      updatedAt: now
    });

    const txOutboxPayload = {
      id: transferTx.id,
      user_id: transferTx.userId,
      type: transferTx.type,
      amount_paise: transferTx.amountPaise,
      currency: transferTx.currency,
      account_id: transferTx.accountId,
      destination_account_id: transferTx.destinationAccountId ?? null,
      category_id: null,
      title: transferTx.title,
      note: transferTx.note ?? null,
      transaction_date: transferTx.transactionDate.toISOString(),
      deleted_at: null,
      version: transferTx.version,
      device_id: null,
      idempotency_key: transferTx.idempotencyKey
    };

    // 6. Create Repayment Record
    const repaymentId = createRepaymentId(crypto.randomUUID());
    const repayment = new BorrowingRepayment({
      id: repaymentId,
      userId,
      borrowingId: targetBorrowing.id,
      lenderId: lender.id,
      amountPaise,
      repaymentDate: resolvedRepaymentDate,
      paymentAccountId: paymentAccount.id,
      transactionId: transferTx.id,
      notes: req.notes?.trim(),
      createdAt: now,
      updatedAt: now
    });

    const repaymentOutboxPayload = {
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

    // 7. Check if Borrowing is now Fully Repaid
    const cumulativeRepaidPaise = alreadyRepaidPaise + amountPaise;
    const isNowFullyRepaid = cumulativeRepaidPaise >= targetBorrowing.amountPaise;
    const nextStatus = isNowFullyRepaid ? 'repaid' : 'active';

    const updatedBorrowing = new Borrowing({
      id: targetBorrowing.id,
      userId: targetBorrowing.userId,
      lenderId: targetBorrowing.lenderId,
      amountPaise: targetBorrowing.amountPaise,
      borrowingDate: targetBorrowing.borrowingDate,
      dueDate: targetBorrowing.dueDate,
      receivingAccountId: targetBorrowing.receivingAccountId,
      transactionId: targetBorrowing.transactionId,
      status: nextStatus,
      notes: targetBorrowing.notes,
      createdAt: targetBorrowing.createdAt,
      updatedAt: now
    });

    // 8. Atomic Persistence via Unit of Work
    await this.unitOfWork.run(async () => {
      await this.transactionRepo.save(transferTx);
      await this.syncPort.enqueue({
        userId,
        entity: 'transactions',
        entityId: transferTx.id,
        operation: 'INSERT',
        payload: txOutboxPayload,
        idempotencyKey: txIdempotencyKey
      });

      await this.borrowingRepo.saveRepayment(repayment);
      await this.syncPort.enqueue({
        userId,
        entity: 'borrowing_repayments',
        entityId: repayment.id,
        operation: 'INSERT',
        payload: repaymentOutboxPayload,
        idempotencyKey: crypto.randomUUID()
      });

      // Always persist the updated borrowing entity to local Dexie with its authoritative status
      // ('active' for partial repayment, 'repaid' for full repayment).
      await this.borrowingRepo.save(updatedBorrowing);

      // Cloud status synchronization note:
      // When the repayment record is synchronized to Supabase in Stage 6, PostgreSQL's
      // `trg_sync_borrowing_repaid_status` trigger automatically checks cumulative repayments
      // and transitions `public.borrowings.status` to 'repaid' when fully settled.
      // We strictly do NOT enqueue a redundant client-side `borrowings` UPDATE for status
      // transitions. This prevents race conditions where an update dispatched before or during
      // repayment sync would violate database triggers (e.g. error 22000).
    });

    return {
      id: repayment.id,
      borrowingId: repayment.borrowingId,
      lenderId: repayment.lenderId,
      lenderName: lender.name,
      amountPaise: repayment.amountPaise,
      amountFormatted: formatPaiseToINR(repayment.amountPaise),
      repaymentDate: repayment.repaymentDate.toISOString(),
      paymentAccountId: paymentAccount.id,
      paymentAccountName: paymentAccount.name,
      transactionId: transferTx.id,
      notes: repayment.notes,
      createdAt: repayment.createdAt.toISOString(),
      updatedAt: repayment.updatedAt.toISOString()
    };
  }
}

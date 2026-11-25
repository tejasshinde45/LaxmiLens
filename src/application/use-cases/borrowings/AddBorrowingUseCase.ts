import { BorrowingRepository } from '@/domain/repositories/BorrowingRepository';
import { LenderRepository } from '@/domain/repositories/LenderRepository';
import { AccountRepository } from '@/domain/repositories/AccountRepository';
import { TransactionRepository } from '@/domain/repositories/TransactionRepository';
import { SyncPort } from '@/application/ports/SyncPort';
import { UnitOfWork } from '@/application/ports/UnitOfWork';
import { EnsurePersonalBorrowingsAccountUseCase } from './EnsurePersonalBorrowingsAccountUseCase';
import { Lender } from '@/domain/entities/Lender';
import { Borrowing } from '@/domain/entities/Borrowing';
import { Transaction } from '@/domain/entities/Transaction';
import {
  createLenderId,
  createBorrowingId,
  createTransactionId,
  createAccountId,
  validateUserId
} from '@/domain/value-objects/Identifiers';
import {
  AccountNotFoundError,
  UnauthorizedEntityAccessError
} from '@/domain/errors/DomainErrors';
import {
  InvalidLenderNameError,
  InvalidBorrowingAmountError
} from '@/domain/errors/BorrowingErrors';
import { BorrowingDTO } from '@/application/dto/BorrowingDTO';
import { formatPaiseToINR } from '@/utils/formatters';

export interface AddBorrowingRequest {
  userId: string;
  lenderName: string;
  lenderPhone?: string;
  lenderEmail?: string;
  amountPaise?: number;
  amountInPaise?: number;
  borrowingDate?: string | Date;
  dueDate?: string | Date | null;
  receivingAccountId: string;
  notes?: string;
}

export class AddBorrowingUseCase {
  constructor(
    private readonly borrowingRepo: BorrowingRepository,
    private readonly lenderRepo: LenderRepository,
    private readonly accountRepo: AccountRepository,
    private readonly transactionRepo: TransactionRepository,
    private readonly ensureAccountUseCase: EnsurePersonalBorrowingsAccountUseCase,
    private readonly syncPort: SyncPort,
    private readonly unitOfWork: UnitOfWork
  ) {}

  public async execute(req: AddBorrowingRequest): Promise<BorrowingDTO> {
    const userId = validateUserId(req.userId);

    const lenderName = req.lenderName?.trim();
    if (!lenderName) {
      throw new InvalidLenderNameError();
    }

    const amountPaise = req.amountPaise ?? req.amountInPaise ?? 0;
    if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
      throw new InvalidBorrowingAmountError();
    }

    const receivingAccountId = createAccountId(req.receivingAccountId);
    const receivingAccount = await this.accountRepo.findById(receivingAccountId, userId);
    if (!receivingAccount) {
      throw new AccountNotFoundError(req.receivingAccountId);
    }
    if (receivingAccount.userId !== userId) {
      throw new UnauthorizedEntityAccessError('Account', req.receivingAccountId);
    }

    // 1. Ensure aggregate 'Personal Borrowings' liability account exists
    const personalBorrowingsAccount = await this.ensureAccountUseCase.execute(userId);

    // 2. Find or create Lender
    let lender = await this.lenderRepo.findByName(lenderName, userId);
    let isNewLender = false;
    const now = new Date();

    if (!lender) {
      isNewLender = true;
      lender = new Lender({
        id: createLenderId(crypto.randomUUID()),
        userId,
        name: lenderName,
        phone: req.lenderPhone?.trim(),
        email: req.lenderEmail?.trim(),
        isArchived: false,
        createdAt: now,
        updatedAt: now
      });
    }

    // 3. Resolve Dates
    const resolvedBorrowingDate = req.borrowingDate
      ? new Date(req.borrowingDate)
      : now;
    const resolvedDueDate = req.dueDate ? new Date(req.dueDate) : null;

    // 4. Create Transfer Transaction: Personal Borrowings -> Receiving Account
    const transactionId = createTransactionId(crypto.randomUUID());
    const idempotencyKey = crypto.randomUUID();

    const transferTx = new Transaction({
      id: transactionId,
      userId,
      type: 'transfer',
      amountPaise,
      currency: receivingAccount.currency,
      accountId: personalBorrowingsAccount.id,
      destinationAccountId: receivingAccount.id,
      title: `Borrowing from ${lender.name}`,
      note: req.notes?.trim() || `Personal borrowing from ${lender.name}`,
      transactionDate: resolvedBorrowingDate,
      deletedAt: null,
      status: 'cleared',
      idempotencyKey,
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

    // 5. Create Borrowing record
    const borrowingId = createBorrowingId(crypto.randomUUID());
    const borrowing = new Borrowing({
      id: borrowingId,
      userId,
      lenderId: lender.id,
      amountPaise,
      borrowingDate: resolvedBorrowingDate,
      dueDate: resolvedDueDate,
      receivingAccountId: receivingAccount.id,
      transactionId: transferTx.id,
      status: 'active',
      notes: req.notes?.trim(),
      createdAt: now,
      updatedAt: now
    });

    const borrowingOutboxPayload = {
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

    // 6. Atomic Persistence via Unit of Work
    await this.unitOfWork.run(async () => {
      if (isNewLender) {
        await this.lenderRepo.save(lender);
        await this.syncPort.enqueue({
          userId,
          entity: 'lenders',
          entityId: lender.id,
          operation: 'INSERT',
          payload: {
            id: lender.id,
            user_id: lender.userId,
            name: lender.name,
            phone: lender.phone ?? null,
            email: lender.email ?? null,
            notes: lender.notes ?? null,
            is_archived: lender.isArchived,
            created_at: lender.createdAt.toISOString(),
            updated_at: lender.updatedAt.toISOString()
          },
          idempotencyKey: crypto.randomUUID()
        });
      }

      await this.transactionRepo.save(transferTx);
      await this.syncPort.enqueue({
        userId,
        entity: 'transactions',
        entityId: transferTx.id,
        operation: 'INSERT',
        payload: txOutboxPayload,
        idempotencyKey
      });

      await this.borrowingRepo.save(borrowing);
      await this.syncPort.enqueue({
        userId,
        entity: 'borrowings',
        entityId: borrowing.id,
        operation: 'INSERT',
        payload: borrowingOutboxPayload,
        idempotencyKey: crypto.randomUUID()
      });
    });

    return {
      id: borrowing.id,
      lenderId: lender.id,
      lenderName: lender.name,
      amountPaise: borrowing.amountPaise,
      amountFormatted: formatPaiseToINR(borrowing.amountPaise),
      repaidPaise: 0,
      repaidFormatted: formatPaiseToINR(0),
      outstandingPaise: borrowing.amountPaise,
      outstandingFormatted: formatPaiseToINR(borrowing.amountPaise),
      borrowingDate: borrowing.borrowingDate.toISOString(),
      dueDate: borrowing.dueDate ? borrowing.dueDate.toISOString() : null,
      receivingAccountId: receivingAccount.id,
      receivingAccountName: receivingAccount.name,
      transactionId: transferTx.id,
      status: borrowing.status,
      notes: borrowing.notes,
      repayments: [],
      createdAt: borrowing.createdAt.toISOString(),
      updatedAt: borrowing.updatedAt.toISOString()
    };
  }
}

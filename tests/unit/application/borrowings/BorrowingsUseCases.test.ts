import { describe, it, expect, beforeEach } from 'vitest';
import { EnsurePersonalBorrowingsAccountUseCase } from '@/application/use-cases/borrowings/EnsurePersonalBorrowingsAccountUseCase';
import { AddBorrowingUseCase } from '@/application/use-cases/borrowings/AddBorrowingUseCase';
import { RecordRepaymentUseCase } from '@/application/use-cases/borrowings/RecordRepaymentUseCase';
import { GetBorrowingsUseCase } from '@/application/use-cases/borrowings/GetBorrowingsUseCase';

import { AccountRepository } from '@/domain/repositories/AccountRepository';
import { TransactionRepository } from '@/domain/repositories/TransactionRepository';
import { LenderRepository } from '@/domain/repositories/LenderRepository';
import { BorrowingRepository } from '@/domain/repositories/BorrowingRepository';
import { SyncPort, OutboxEntry, SyncResult } from '@/application/ports/SyncPort';
import { UnitOfWork } from '@/application/ports/UnitOfWork';

import { Account } from '@/domain/entities/Account';
import { Transaction } from '@/domain/entities/Transaction';
import { Lender } from '@/domain/entities/Lender';
import { Borrowing } from '@/domain/entities/Borrowing';
import { BorrowingRepayment } from '@/domain/entities/BorrowingRepayment';

import {
  AccountId,
  TransactionId,
  LenderId,
  BorrowingId,
  RepaymentId,
  UserId,
  createAccountId,
  createTransactionId,
  createLenderId,
  createBorrowingId,
  createRepaymentId,
  createUserId
} from '@/domain/value-objects/Identifiers';
import {
  UnauthorizedEntityAccessError,
  AccountNotFoundError
} from '@/domain/errors/DomainErrors';
import {
  InvalidBorrowingAmountError,
  InvalidRepaymentAmountError,
  InvalidLenderNameError,
  RepaymentExceedsOutstandingBalanceError,
  BorrowingNotFoundError
} from '@/domain/errors/BorrowingErrors';

// In-Memory Test Doubles
class InMemoryAccountRepository implements AccountRepository {
  public accounts = new Map<string, Account>();

  async findById(id: AccountId, userId?: UserId): Promise<Account | null> {
    const acc = this.accounts.get(id);
    if (!acc) return null;
    if (userId && acc.userId !== userId) {
      throw new UnauthorizedEntityAccessError('Account', id);
    }
    return acc;
  }
  async findByUserId(userId: UserId): Promise<Account[]> {
    return Array.from(this.accounts.values()).filter((a) => a.userId === userId);
  }
  async findAll(userId: UserId): Promise<Account[]> {
    return this.findByUserId(userId);
  }
  async save(account: Account): Promise<void> {
    this.accounts.set(account.id, account);
  }
  async saveBatch(accounts: Account[]): Promise<void> {
    accounts.forEach((a) => this.accounts.set(a.id, a));
  }
  async archive(id: AccountId, userId: UserId): Promise<void> {
    const acc = this.accounts.get(id);
    if (acc && acc.userId === userId) {
      this.accounts.set(id, new Account({ ...acc, isArchived: true }));
    }
  }
  async restore(id: AccountId, userId: UserId): Promise<void> {
    const acc = this.accounts.get(id);
    if (acc && acc.userId === userId) {
      this.accounts.set(id, new Account({ ...acc, isArchived: false }));
    }
  }
}

class InMemoryTransactionRepository implements TransactionRepository {
  public transactions = new Map<string, Transaction>();

  async findById(id: TransactionId, userId?: UserId): Promise<Transaction | null> {
    const tx = this.transactions.get(id);
    if (!tx) return null;
    if (userId && tx.userId !== userId) {
      throw new UnauthorizedEntityAccessError('Transaction', id);
    }
    return tx;
  }
  async findByUserId(userId: UserId): Promise<Transaction[]> {
    return Array.from(this.transactions.values()).filter((t) => t.userId === userId);
  }
  async findByAccountId(accountId: AccountId, userId: UserId): Promise<Transaction[]> {
    return Array.from(this.transactions.values()).filter(
      (t) =>
        t.userId === userId &&
        (t.accountId === accountId || t.destinationAccountId === accountId)
    );
  }
  async save(transaction: Transaction): Promise<void> {
    this.transactions.set(transaction.id, transaction);
  }
  async saveBatch(transactions: Transaction[]): Promise<void> {
    transactions.forEach((t) => this.transactions.set(t.id, t));
  }
  async delete(id: TransactionId, userId: UserId): Promise<void> {
    this.transactions.delete(id);
  }
  async softDelete(id: TransactionId, userId: UserId): Promise<void> {
    const tx = this.transactions.get(id);
    if (tx && tx.userId === userId) {
      this.transactions.set(id, new Transaction({ ...tx, deletedAt: new Date() }));
    }
  }
}

class InMemoryLenderRepository implements LenderRepository {
  public lenders = new Map<string, Lender>();

  async findById(id: LenderId, userId: UserId): Promise<Lender | null> {
    const l = this.lenders.get(id);
    if (!l) return null;
    if (l.userId !== userId) {
      throw new UnauthorizedEntityAccessError('Lender', id);
    }
    return l;
  }
  async findByName(name: string, userId: UserId): Promise<Lender | null> {
    const trimmed = name.trim().toLowerCase();
    for (const l of this.lenders.values()) {
      if (l.userId === userId && l.name.toLowerCase() === trimmed && !l.isArchived) {
        return l;
      }
    }
    return null;
  }
  async findByUserId(userId: UserId): Promise<Lender[]> {
    return Array.from(this.lenders.values()).filter((l) => l.userId === userId);
  }
  async save(lender: Lender): Promise<void> {
    this.lenders.set(lender.id, lender);
  }
  async archive(id: LenderId, userId: UserId): Promise<void> {
    const l = this.lenders.get(id);
    if (l && l.userId === userId) {
      this.lenders.set(id, new Lender({ ...l, isArchived: true }));
    }
  }
}

class InMemoryBorrowingRepository implements BorrowingRepository {
  public borrowings = new Map<string, Borrowing>();
  public repayments = new Map<string, BorrowingRepayment>();

  async findById(id: BorrowingId, userId: UserId): Promise<Borrowing | null> {
    const b = this.borrowings.get(id);
    if (!b) return null;
    if (b.userId !== userId) {
      throw new UnauthorizedEntityAccessError('Borrowing', id);
    }
    return b;
  }
  async findByUserId(userId: UserId): Promise<Borrowing[]> {
    return Array.from(this.borrowings.values()).filter((b) => b.userId === userId);
  }
  async findByLenderId(lenderId: LenderId, userId: UserId): Promise<Borrowing[]> {
    return Array.from(this.borrowings.values()).filter(
      (b) => b.userId === userId && b.lenderId === lenderId
    );
  }
  async save(borrowing: Borrowing): Promise<void> {
    this.borrowings.set(borrowing.id, borrowing);
  }
  async findRepaymentById(id: RepaymentId, userId: UserId): Promise<BorrowingRepayment | null> {
    const r = this.repayments.get(id);
    if (!r) return null;
    if (r.userId !== userId) {
      throw new UnauthorizedEntityAccessError('BorrowingRepayment', id);
    }
    return r;
  }
  async findRepaymentsByBorrowingId(borrowingId: BorrowingId, userId: UserId): Promise<BorrowingRepayment[]> {
    return Array.from(this.repayments.values()).filter(
      (r) => r.userId === userId && r.borrowingId === borrowingId
    );
  }
  async findRepaymentsByLenderId(lenderId: LenderId, userId: UserId): Promise<BorrowingRepayment[]> {
    return Array.from(this.repayments.values()).filter(
      (r) => r.userId === userId && r.lenderId === lenderId
    );
  }
  async findRepaymentsByUserId(userId: UserId): Promise<BorrowingRepayment[]> {
    return Array.from(this.repayments.values()).filter((r) => r.userId === userId);
  }
  async saveRepayment(repayment: BorrowingRepayment): Promise<void> {
    this.repayments.set(repayment.id, repayment);
  }
}

class InMemorySyncPort implements SyncPort {
  public queue: OutboxEntry[] = [];
  async enqueue(entry: OutboxEntry): Promise<void> {
    this.queue.push(entry);
  }
  async processOutbox(): Promise<SyncResult> {
    return { success: true, processedCount: 0, failedCount: 0, errors: [] };
  }
}

class FakeUnitOfWork implements UnitOfWork {
  async run<T>(work: () => Promise<T>): Promise<T> {
    return await work();
  }
}

describe('Personal Borrowings Application Use Cases', () => {
  const userId = createUserId('11111111-1111-4111-8111-111111111111');
  const otherUserId = createUserId('22222222-2222-4222-8222-222222222222');
  const bankAccountId = createAccountId('33333333-3333-4333-8333-333333333333');

  let accountRepo: InMemoryAccountRepository;
  let transactionRepo: InMemoryTransactionRepository;
  let lenderRepo: InMemoryLenderRepository;
  let borrowingRepo: InMemoryBorrowingRepository;
  let syncPort: InMemorySyncPort;
  let unitOfWork: FakeUnitOfWork;

  let ensureAccountUseCase: EnsurePersonalBorrowingsAccountUseCase;
  let addBorrowingUseCase: AddBorrowingUseCase;
  let recordRepaymentUseCase: RecordRepaymentUseCase;
  let getBorrowingsUseCase: GetBorrowingsUseCase;

  beforeEach(async () => {
    accountRepo = new InMemoryAccountRepository();
    transactionRepo = new InMemoryTransactionRepository();
    lenderRepo = new InMemoryLenderRepository();
    borrowingRepo = new InMemoryBorrowingRepository();
    syncPort = new InMemorySyncPort();
    unitOfWork = new FakeUnitOfWork();

    ensureAccountUseCase = new EnsurePersonalBorrowingsAccountUseCase(
      accountRepo,
      syncPort,
      unitOfWork
    );

    addBorrowingUseCase = new AddBorrowingUseCase(
      borrowingRepo,
      lenderRepo,
      accountRepo,
      transactionRepo,
      ensureAccountUseCase,
      syncPort,
      unitOfWork
    );

    recordRepaymentUseCase = new RecordRepaymentUseCase(
      borrowingRepo,
      lenderRepo,
      accountRepo,
      transactionRepo,
      ensureAccountUseCase,
      syncPort,
      unitOfWork
    );

    getBorrowingsUseCase = new GetBorrowingsUseCase(
      borrowingRepo,
      lenderRepo,
      accountRepo
    );

    // Seed User Bank Account
    await accountRepo.save(
      new Account({
        id: bankAccountId,
        userId,
        name: 'HDFC Savings',
        accountType: 'bank',
        openingBalancePaise: 5000000 // ₹50,000
      })
    );
  });

  it('1. should create a borrowing and automatically establish the Personal Borrowings account', async () => {
    const borrowing = await addBorrowingUseCase.execute({
      userId,
      lenderName: 'Rahul',
      amountPaise: 500000, // ₹5,000
      borrowingDate: '2026-11-20',
      receivingAccountId: bankAccountId,
      notes: 'Emergency loan'
    });

    expect(borrowing.lenderName).toBe('Rahul');
    expect(borrowing.amountPaise).toBe(500000);
    expect(borrowing.amountFormatted).toBe('₹5,000.00');
    expect(borrowing.outstandingPaise).toBe(500000);
    expect(borrowing.status).toBe('active');

    // Verify Personal Borrowings account was created
    const accounts = await accountRepo.findByUserId(userId);
    const pbAccount = accounts.find((a) => a.name === 'Personal Borrowings');
    expect(pbAccount).toBeDefined();
    expect(pbAccount?.accountType).toBe('other');

    // Verify transaction created is a transfer from Personal Borrowings -> HDFC Savings
    const transactions = await transactionRepo.findByUserId(userId);
    expect(transactions).toHaveLength(1);
    const tx = transactions[0];
    expect(tx.type).toBe('transfer');
    expect(tx.accountId).toBe(pbAccount?.id);
    expect(tx.destinationAccountId).toBe(bankAccountId);
    expect(tx.amountPaise).toBe(500000);

    // Verify outbox entries were queued
    expect(syncPort.queue.some((e) => e.entity === 'accounts')).toBe(true);
    expect(syncPort.queue.some((e) => e.entity === 'transactions')).toBe(true);
    expect(syncPort.queue.some((e) => e.entity === 'lenders')).toBe(true);
    expect(syncPort.queue.some((e) => e.entity === 'borrowings')).toBe(true);
  });

  it('2. should manage multiple lenders under ONE aggregate liability account', async () => {
    // Add 3 borrowings as per prompt example:
    // Rahul: ₹5,000
    // Amit: ₹3,000
    // Pratik: ₹2,000
    await addBorrowingUseCase.execute({
      userId,
      lenderName: 'Rahul',
      amountPaise: 500000,
      receivingAccountId: bankAccountId
    });

    await addBorrowingUseCase.execute({
      userId,
      lenderName: 'Amit',
      amountPaise: 300000,
      receivingAccountId: bankAccountId
    });

    await addBorrowingUseCase.execute({
      userId,
      lenderName: 'Pratik',
      amountPaise: 200000,
      receivingAccountId: bankAccountId
    });

    // Check accounts: exactly ONE 'Personal Borrowings' account exists
    const accounts = await accountRepo.findByUserId(userId);
    const pbAccounts = accounts.filter((a) => a.name === 'Personal Borrowings');
    expect(pbAccounts).toHaveLength(1);

    // Check overview summary
    const overview = await getBorrowingsUseCase.execute(userId);
    expect(overview.summary.totalBorrowedPaise).toBe(1000000); // ₹10,000
    expect(overview.summary.totalOutstandingPaise).toBe(1000000);
    expect(overview.summary.totalRepaidPaise).toBe(0);
    expect(overview.summary.activeLendersCount).toBe(3);

    // Check individual lender breakdowns
    expect(overview.lenders).toHaveLength(3);
    const rahul = overview.lenders.find((l) => l.name === 'Rahul');
    const amit = overview.lenders.find((l) => l.name === 'Amit');
    const pratik = overview.lenders.find((l) => l.name === 'Pratik');

    expect(rahul?.outstandingPaise).toBe(500000);
    expect(amit?.outstandingPaise).toBe(300000);
    expect(pratik?.outstandingPaise).toBe(200000);
  });

  it('3. should process partial repayment correctly', async () => {
    const borrowing = await addBorrowingUseCase.execute({
      userId,
      lenderName: 'Rahul',
      amountPaise: 500000, // ₹5,000
      receivingAccountId: bankAccountId
    });

    // Partially repay ₹2,000
    const repayment = await recordRepaymentUseCase.execute({
      userId,
      borrowingId: borrowing.id,
      amountPaise: 200000,
      paymentAccountId: bankAccountId,
      notes: 'First installment'
    });

    expect(repayment.amountPaise).toBe(200000);
    expect(repayment.amountFormatted).toBe('₹2,000.00');

    // Verify transfer transaction: HDFC Savings -> Personal Borrowings
    const transactions = await transactionRepo.findByUserId(userId);
    expect(transactions).toHaveLength(2); // 1 borrowing + 1 repayment
    const repaymentTx = transactions.find((t) => t.id === repayment.transactionId);
    expect(repaymentTx).toBeDefined();
    expect(repaymentTx?.type).toBe('transfer');
    expect(repaymentTx?.accountId).toBe(bankAccountId); // from Bank

    // Check overview
    const overview = await getBorrowingsUseCase.execute(userId);
    expect(overview.summary.totalBorrowedPaise).toBe(500000);
    expect(overview.summary.totalRepaidPaise).toBe(200000);
    expect(overview.summary.totalOutstandingPaise).toBe(300000); // ₹3,000 remaining
    expect(overview.borrowings[0].status).toBe('active');

    // Regression check: verify borrowing in repository remains strictly 'active'
    const storedBorrowing = await borrowingRepo.findById(borrowing.id, userId);
    expect(storedBorrowing).toBeDefined();
    expect(storedBorrowing?.status).toBe('active');

    // Regression check: verify no premature or redundant borrowings UPDATE outbox entry was enqueued
    const borrowingUpdateEvents = syncPort.queue.filter(
      (e) => e.entity === 'borrowings' && e.operation === 'UPDATE'
    );
    expect(borrowingUpdateEvents).toHaveLength(0);
  });

  it('4. should process full repayment and mark borrowing as repaid', async () => {
    const borrowing = await addBorrowingUseCase.execute({
      userId,
      lenderName: 'Amit',
      amountPaise: 300000, // ₹3,000
      receivingAccountId: bankAccountId
    });

    // Repay full ₹3,000
    await recordRepaymentUseCase.execute({
      userId,
      borrowingId: borrowing.id,
      amountPaise: 300000,
      paymentAccountId: bankAccountId
    });

    const overview = await getBorrowingsUseCase.execute(userId);
    expect(overview.summary.totalOutstandingPaise).toBe(0);
    expect(overview.summary.totalRepaidPaise).toBe(300000);
    expect(overview.summary.activeLendersCount).toBe(0);
    expect(overview.borrowings[0].status).toBe('repaid');
    expect(overview.borrowings[0].outstandingPaise).toBe(0);

    // Verify stored borrowing in repository transitioned to 'repaid'
    const storedBorrowing = await borrowingRepo.findById(borrowing.id, userId);
    expect(storedBorrowing).toBeDefined();
    expect(storedBorrowing?.status).toBe('repaid');
  });

  it('5. should reject repayment exceeding the outstanding balance', async () => {
    const borrowing = await addBorrowingUseCase.execute({
      userId,
      lenderName: 'Pratik',
      amountPaise: 200000, // ₹2,000
      receivingAccountId: bankAccountId
    });

    // Attempting to repay ₹2,500 must throw RepaymentExceedsOutstandingBalanceError
    await expect(
      recordRepaymentUseCase.execute({
        userId,
        borrowingId: borrowing.id,
        amountPaise: 250000, // ₹2,500
        paymentAccountId: bankAccountId
      })
    ).rejects.toThrow(RepaymentExceedsOutstandingBalanceError);
  });

  it('6. should reject invalid input: negative amounts or empty lender name', async () => {
    await expect(
      addBorrowingUseCase.execute({
        userId,
        lenderName: '',
        amountPaise: 50000,
        receivingAccountId: bankAccountId
      })
    ).rejects.toThrow(InvalidLenderNameError);

    await expect(
      addBorrowingUseCase.execute({
        userId,
        lenderName: 'Rahul',
        amountPaise: -500,
        receivingAccountId: bankAccountId
      })
    ).rejects.toThrow(InvalidBorrowingAmountError);

    await expect(
      recordRepaymentUseCase.execute({
        userId,
        lenderId: 'non-existent',
        amountPaise: 0,
        paymentAccountId: bankAccountId
      })
    ).rejects.toThrow(InvalidRepaymentAmountError);
  });

  it('7. should enforce strict user isolation for borrowings and repayments', async () => {
    const borrowing = await addBorrowingUseCase.execute({
      userId,
      lenderName: 'Rahul',
      amountPaise: 500000,
      receivingAccountId: bankAccountId
    });

    // Other user attempts to record repayment for user's borrowing using user's bank account
    await expect(
      recordRepaymentUseCase.execute({
        userId: otherUserId,
        borrowingId: borrowing.id,
        amountPaise: 100000,
        paymentAccountId: bankAccountId
      })
    ).rejects.toThrow(UnauthorizedEntityAccessError); // other user cannot access user's bank account

    // Other user with their own bank account cannot access user's borrowing
    const otherBankId = createAccountId('44444444-4444-4444-8444-444444444444');
    await accountRepo.save(
      new Account({
        id: otherBankId,
        userId: otherUserId,
        name: 'Other Bank',
        accountType: 'bank',
        openingBalancePaise: 100000
      })
    );

    await expect(
      recordRepaymentUseCase.execute({
        userId: otherUserId,
        borrowingId: borrowing.id,
        amountPaise: 100000,
        paymentAccountId: otherBankId
      })
    ).rejects.toThrow(UnauthorizedEntityAccessError);
  });

  it('8. should process multi-step partial repayments correctly: remaining active until 100% principal settled', async () => {
    // Borrow ₹1,000 (100,000 paise)
    const borrowing = await addBorrowingUseCase.execute({
      userId,
      lenderName: 'Karan',
      amountPaise: 100000, // ₹1,000
      receivingAccountId: bankAccountId
    });

    // Step 1: First partial repayment of ₹500 (50,000 paise)
    const repayment1 = await recordRepaymentUseCase.execute({
      userId,
      borrowingId: borrowing.id,
      amountPaise: 50000, // ₹500
      paymentAccountId: bankAccountId,
      notes: 'Partial installment 1'
    });

    expect(repayment1.amountPaise).toBe(50000);

    // Repository status must remain strictly 'active'
    let stored = await borrowingRepo.findById(borrowing.id, userId);
    expect(stored?.status).toBe('active');

    // Overview metrics must show ₹500 outstanding and active status
    let overview = await getBorrowingsUseCase.execute(userId);
    const targetBorrowing1 = overview.borrowings.find((b) => b.id === borrowing.id);
    expect(targetBorrowing1?.outstandingPaise).toBe(50000);
    expect(targetBorrowing1?.repaidPaise).toBe(50000);
    expect(targetBorrowing1?.status).toBe('active');

    // Outbox must contain NO borrowings UPDATE
    const borrowingUpdatesAfterPart1 = syncPort.queue.filter(
      (e) => e.entity === 'borrowings' && e.operation === 'UPDATE'
    );
    expect(borrowingUpdatesAfterPart1).toHaveLength(0);

    // Step 2: Second partial repayment of ₹500 (50,000 paise) completing the debt
    const repayment2 = await recordRepaymentUseCase.execute({
      userId,
      borrowingId: borrowing.id,
      amountPaise: 50000, // Remaining ₹500
      paymentAccountId: bankAccountId,
      notes: 'Final installment'
    });

    expect(repayment2.amountPaise).toBe(50000);

    // Repository status must now transition to 'repaid'
    stored = await borrowingRepo.findById(borrowing.id, userId);
    expect(stored?.status).toBe('repaid');

    // Overview metrics must show ₹0 outstanding and repaid status
    overview = await getBorrowingsUseCase.execute(userId);
    const targetBorrowing2 = overview.borrowings.find((b) => b.id === borrowing.id);
    expect(targetBorrowing2?.outstandingPaise).toBe(0);
    expect(targetBorrowing2?.repaidPaise).toBe(100000);
    expect(targetBorrowing2?.status).toBe('repaid');
  });

  it('9. should reject repayment against an already settled (repaid) borrowing', async () => {
    // Borrow ₹500
    const borrowing = await addBorrowingUseCase.execute({
      userId,
      lenderName: 'Pooja',
      amountPaise: 50000,
      receivingAccountId: bankAccountId
    });

    // Settle 100%
    await recordRepaymentUseCase.execute({
      userId,
      borrowingId: borrowing.id,
      amountPaise: 50000,
      paymentAccountId: bankAccountId
    });

    // Attempt further repayment on settled borrowing must fail
    await expect(
      recordRepaymentUseCase.execute({
        userId,
        borrowingId: borrowing.id,
        amountPaise: 10000,
        paymentAccountId: bankAccountId
      })
    ).rejects.toThrow(RepaymentExceedsOutstandingBalanceError);
  });
});

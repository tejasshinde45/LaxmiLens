import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  computeTransactionSummary
} from '@/features/transactions/hooks/useTransactions';
import { TransactionResponseDTO } from '@/application/dto/TransactionDTO';
import { CreateTransactionUseCase } from '@/application/use-cases/transactions/CreateTransactionUseCase';
import { UpdateTransactionUseCase } from '@/application/use-cases/transactions/UpdateTransactionUseCase';
import { DeleteTransactionUseCase } from '@/application/use-cases/transactions/DeleteTransactionUseCase';
import { ExecuteTransferUseCase } from '@/application/use-cases/transactions/ExecuteTransferUseCase';
import { Account, AccountType } from '@/domain/entities/Account';
import { Category } from '@/domain/entities/Category';
import { Transaction } from '@/domain/entities/Transaction';
import { Money } from '@/domain/value-objects/Money';
import {
  createAccountId,
  createCategoryId,
  createTransactionId,
  createUserId
} from '@/domain/value-objects/Identifiers';

describe('useTransactions Application Integration & Precision (Phase 2D.7.4.1)', () => {
  const userId = '22222222-2222-4222-8222-222222222222';

  // In-memory mock repositories and UnitOfWork
  let accountStorage: Map<string, Account>;
  let transactionStorage: Map<string, Transaction>;
  let categoryStorage: Map<string, Category>;
  let outboxStorage: any[];

  let mockAccountRepo: any;
  let mockTransactionRepo: any;
  let mockCategoryRepo: any;
  let mockSyncPort: any;
  let mockUow: any;

  let createUseCase: CreateTransactionUseCase;
  let updateUseCase: UpdateTransactionUseCase;
  let deleteUseCase: DeleteTransactionUseCase;
  let transferUseCase: ExecuteTransferUseCase;

  beforeEach(() => {
    accountStorage = new Map();
    transactionStorage = new Map();
    categoryStorage = new Map();
    outboxStorage = [];

    // Setup accounts
    const sourceAcc = new Account({
      id: createAccountId('acc-bank-1'),
      userId: createUserId(userId),
      name: 'Salary Account',
      accountType: 'bank',
      currency: 'INR',
      openingBalance: Money.fromPaise(5000000)
    });
    const destAcc = new Account({
      id: createAccountId('acc-cash-1'),
      userId: createUserId(userId),
      name: 'Cash Pocket',
      accountType: 'cash',
      currency: 'INR',
      openingBalance: Money.fromPaise(1000000)
    });
    accountStorage.set(sourceAcc.id, sourceAcc);
    accountStorage.set(destAcc.id, destAcc);

    // Setup category
    const catExpense = new Category({
      id: createCategoryId('cat-food-1'),
      userId: createUserId(userId),
      name: 'Food',
      type: 'expense'
    });
    categoryStorage.set(catExpense.id, catExpense);

    mockAccountRepo = {
      findById: vi.fn(async (id: string, uid: string) => {
        const acc = accountStorage.get(id);
        return acc && acc.userId === uid ? acc : null;
      })
    };

    mockTransactionRepo = {
      findById: vi.fn(async (id: string, uid: string) => {
        const tx = transactionStorage.get(id);
        return tx && tx.userId === uid ? tx : null;
      }),
      findByIdempotencyKey: vi.fn(async (key: string, uid: string) => {
        for (const tx of transactionStorage.values()) {
          if (tx.idempotencyKey === key && tx.userId === uid) return tx;
        }
        return null;
      }),
      save: vi.fn(async (tx: Transaction) => {
        transactionStorage.set(tx.id, tx);
      }),
      softDelete: vi.fn(async (id: string, uid: string, deletedAt: Date, version: number) => {
        const existing = transactionStorage.get(id);
        if (existing && existing.userId === uid) {
          const softDeleted = new Transaction({
            id: existing.id,
            userId: existing.userId,
            type: existing.type,
            amountPaise: existing.amountPaise,
            currency: existing.currency,
            accountId: existing.accountId,
            destinationAccountId: existing.destinationAccountId,
            categoryId: existing.categoryId,
            title: existing.title,
            note: existing.note,
            transactionDate: existing.transactionDate,
            deletedAt,
            version,
            deviceId: existing.deviceId,
            idempotencyKey: existing.idempotencyKey,
            createdAt: existing.createdAt,
            updatedAt: new Date()
          });
          transactionStorage.set(id, softDeleted);
        }
      })
    };

    mockCategoryRepo = {
      findById: vi.fn(async (id: string, uid: string) => {
        const cat = categoryStorage.get(id);
        return cat && (cat.userId === uid || cat.isDefault) ? cat : null;
      })
    };

    mockSyncPort = {
      enqueue: vi.fn(async (entry: any) => {
        outboxStorage.push(entry);
      })
    };

    mockUow = {
      run: vi.fn(async (work: () => Promise<any>) => work())
    };

    createUseCase = new CreateTransactionUseCase(
      mockTransactionRepo,
      mockAccountRepo,
      mockCategoryRepo,
      mockSyncPort,
      mockUow
    );

    updateUseCase = new UpdateTransactionUseCase(
      mockTransactionRepo,
      mockAccountRepo,
      mockCategoryRepo,
      mockSyncPort,
      mockUow
    );

    deleteUseCase = new DeleteTransactionUseCase(
      mockTransactionRepo,
      mockSyncPort,
      mockUow
    );

    transferUseCase = new ExecuteTransferUseCase(
      mockTransactionRepo,
      mockAccountRepo,
      mockSyncPort,
      mockUow
    );
  });

  describe('Financial Precision & Integer Paise Conversion', () => {
    it('creates an expense with integer paise and stages outbox INSERT atomically', async () => {
      // User inputs ₹450.75 -> 45075 paise
      const amountPaise = Math.round(450.75 * 100);
      expect(amountPaise).toBe(45075);

      const result = await createUseCase.execute({
        userId,
        type: 'expense',
        amountPaise,
        accountId: 'acc-bank-1',
        categoryId: 'cat-food-1',
        title: 'Dinner at Bistro',
        transactionDate: '2026-11-23T19:00:00.000Z'
      });

      expect(result.amountPaise).toBe(45075);
      expect(result.amountFormatted).toBe('₹450.75');
      expect(result.version).toBe(1);

      // Verify persisted in repository
      const saved = transactionStorage.get(result.id);
      expect(saved).toBeDefined();
      expect(saved?.amountPaise).toBe(45075);
      expect(saved?.title).toBe('Dinner at Bistro');

      // Verify staged in Transactional Outbox
      expect(outboxStorage).toHaveLength(1);
      expect(outboxStorage[0]).toMatchObject({
        userId,
        entity: 'transactions',
        entityId: result.id,
        operation: 'INSERT',
        payload: expect.objectContaining({
          amount_paise: 45075,
          account_id: 'acc-bank-1',
          category_id: 'cat-food-1',
          version: 1
        })
      });
    });

    it('records transfer as ONE atomic record containing source and destination accounts', async () => {
      // User inputs ₹5,000.00 -> 500000 paise
      const amountPaise = 500000;

      const result = await createUseCase.execute({
        userId,
        type: 'transfer',
        amountPaise,
        accountId: 'acc-bank-1',
        destinationAccountId: 'acc-cash-1',
        title: 'ATM Withdrawal',
        transactionDate: '2026-11-23T11:00:00.000Z'
      });

      expect(result.type).toBe('transfer');
      expect(result.accountId).toBe('acc-bank-1');
      expect(result.destinationAccountId).toBe('acc-cash-1');
      expect(result.categoryId).toBeUndefined(); // Transfers have no category

      // Must be saved as ONE record, not two separate records
      expect(transactionStorage.size).toBe(1);
      const saved = transactionStorage.get(result.id);
      expect(saved?.accountId).toBe('acc-bank-1');
      expect(saved?.destinationAccountId).toBe('acc-cash-1');

      // Staged in outbox with destination_account_id
      expect(outboxStorage[0].payload.destination_account_id).toBe('acc-cash-1');
    });

    it('updates an existing transaction, increments version, and stages outbox UPDATE', async () => {
      // 1. Create initial transaction
      const initial = await createUseCase.execute({
        userId,
        type: 'expense',
        amountPaise: 20000,
        accountId: 'acc-bank-1',
        categoryId: 'cat-food-1',
        title: 'Lunch',
        transactionDate: '2026-11-23T12:00:00.000Z'
      });

      expect(initial.version).toBe(1);

      // 2. Update to ₹250.00 (25000 paise) and new title
      const updated = await updateUseCase.execute({
        id: initial.id,
        userId,
        amountPaise: 25000,
        title: 'Buffet Lunch'
      });

      expect(updated.version).toBe(2);
      expect(updated.amountPaise).toBe(25000);
      expect(updated.title).toBe('Buffet Lunch');

      // Outbox now has INSERT and UPDATE
      expect(outboxStorage).toHaveLength(2);
      expect(outboxStorage[1]).toMatchObject({
        entity: 'transactions',
        entityId: initial.id,
        operation: 'UPDATE',
        payload: expect.objectContaining({
          amount_paise: 25000,
          title: 'Buffet Lunch',
          version: 2
        })
      });
    });

    it('normalizes cleared or empty optional notes to undefined locally and null in outbox', async () => {
      const created = await createUseCase.execute({
        userId,
        type: 'expense',
        amountPaise: 12000,
        accountId: 'acc-bank-1',
        categoryId: 'cat-food-1',
        title: 'Dinner',
        note: 'Initial note',
        transactionDate: '2026-11-23T20:00:00.000Z'
      });
      expect(transactionStorage.get(created.id)?.note).toBe('Initial note');

      const cleared = await updateUseCase.execute({
        id: created.id,
        userId,
        note: '   '
      });

      expect(cleared.note).toBeUndefined();
      expect(transactionStorage.get(created.id)?.note).toBeUndefined();
      expect(outboxStorage[1].payload.note).toBeNull();
    });

    it('performs soft-delete, increments version, and leaves audit trail', async () => {
      const initial = await createUseCase.execute({
        userId,
        type: 'expense',
        amountPaise: 10000,
        accountId: 'acc-bank-1',
        categoryId: 'cat-food-1',
        title: 'Coffee',
        transactionDate: '2026-11-23T10:00:00.000Z'
      });

      // Soft delete
      await deleteUseCase.execute(initial.id, userId);

      const inStore = transactionStorage.get(initial.id);
      expect(inStore).toBeDefined();
      expect(inStore?.isDeleted).toBe(true);
      expect(inStore?.deletedAt).not.toBeNull();
      expect(inStore?.version).toBe(2);

      // Outbox has DELETE operation
      expect(outboxStorage).toHaveLength(2);
      expect(outboxStorage[1]).toMatchObject({
        entity: 'transactions',
        entityId: initial.id,
        operation: 'DELETE',
        payload: expect.objectContaining({
          id: initial.id,
          version: 2
        })
      });
    });
  });

  describe('Ledger Cashflow Calculation & Transfers Neutrality', () => {
    it('accurately computes summary totals while keeping transfers strictly neutral', () => {
      const dummyTransactions: TransactionResponseDTO[] = [
        {
          id: '1',
          userId,
          type: 'income',
          amountPaise: 8000000, // ₹80,000
          amountFormatted: '₹80,000.00',
          currency: 'INR',
          accountId: 'acc-1',
          title: 'Salary',
          transactionDate: '2026-11-01',
          deletedAt: null,
          isDeleted: false,
          version: 1,
          idempotencyKey: 'k1',
          createdAt: '',
          updatedAt: '',
          amountInPaise: 8000000,
          description: '',
          date: '',
          status: ''
        },
        {
          id: '2',
          userId,
          type: 'expense',
          amountPaise: 3000000, // ₹30,000
          amountFormatted: '₹30,000.00',
          currency: 'INR',
          accountId: 'acc-1',
          title: 'Rent',
          transactionDate: '2026-11-02',
          deletedAt: null,
          isDeleted: false,
          version: 1,
          idempotencyKey: 'k2',
          createdAt: '',
          updatedAt: '',
          amountInPaise: 3000000,
          description: '',
          date: '',
          status: ''
        },
        {
          id: '3',
          userId,
          type: 'transfer',
          amountPaise: 1500000, // ₹15,000 (transfer between accounts)
          amountFormatted: '₹15,000.00',
          currency: 'INR',
          accountId: 'acc-1',
          destinationAccountId: 'acc-2',
          title: 'Transfer to Cash',
          transactionDate: '2026-11-03',
          deletedAt: null,
          isDeleted: false,
          version: 1,
          idempotencyKey: 'k3',
          createdAt: '',
          updatedAt: '',
          amountInPaise: 1500000,
          description: '',
          date: '',
          status: ''
        },
        {
          id: '4-deleted',
          userId,
          type: 'expense',
          amountPaise: 500000, // ₹5,000 (soft deleted)
          amountFormatted: '₹5,000.00',
          currency: 'INR',
          accountId: 'acc-1',
          title: 'Cancelled Expense',
          transactionDate: '2026-11-04',
          deletedAt: '2026-11-04',
          isDeleted: true,
          version: 2,
          idempotencyKey: 'k4',
          createdAt: '',
          updatedAt: '',
          amountInPaise: 500000,
          description: '',
          date: '',
          status: ''
        }
      ];

      const summary = computeTransactionSummary(dummyTransactions);

      // Only 3 active transactions (soft-deleted is excluded)
      expect(summary.totalCount).toBe(3);

      // Total income: exactly ₹80,000
      expect(summary.totalIncomePaise).toBe(8000000);
      expect(summary.totalIncomeFormatted).toBe('₹80,000.00');

      // Total expense: exactly ₹30,000 (transfer is NOT included, deleted is NOT included)
      expect(summary.totalExpensePaise).toBe(3000000);
      expect(summary.totalExpenseFormatted).toBe('₹30,000.00');

      // Net Cash Flow: ₹80,000 - ₹30,000 = ₹50,000
      expect(summary.netCashFlowPaise).toBe(5000000);
      expect(summary.netCashFlowFormatted).toBe('₹50,000.00');
    });
  });
});

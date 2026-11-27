import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import { QuickAddModal } from '@/components/forms/QuickAddModal';
import * as useTransactionsModule from '@/features/transactions/hooks/useTransactions';
import * as useAccountsModule from '@/features/accounts/hooks/useAccounts';
import * as useCategoriesModule from '@/features/categories/hooks/useCategories';
import { AuthContext, AuthContextType } from '@/features/auth/context/AuthContext';
import { CreateTransactionUseCase } from '@/application/use-cases/transactions/CreateTransactionUseCase';
import { GetTransactionsUseCase } from '@/application/use-cases/transactions/GetTransactionsUseCase';
import { GetAccountsWithBalanceUseCase } from '@/application/use-cases/accounts/GetAccountsWithBalanceUseCase';
import { AccountWithBalanceDTO } from '@/application/dto/AccountDTO';
import { TransactionResponseDTO } from '@/application/dto/TransactionDTO';
import { Account } from '@/domain/entities/Account';
import { Category } from '@/domain/entities/Category';
import { Transaction } from '@/domain/entities/Transaction';
import { Money } from '@/domain/value-objects/Money';
import { LedgerRules } from '@/domain/rules/LedgerRules';
import {
  createAccountId,
  createCategoryId,
  createTransactionId,
  createUserId
} from '@/domain/value-objects/Identifiers';
import { defaultDatabaseManager } from '@/infrastructure/database/local/DatabaseManager';
import { defaultManualSyncCoordinator } from '@/infrastructure/sync/ManualSyncCoordinator';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn()
  }
}));

describe('Phase 12 Stage 1C: QuickAddModal Functional Implementation', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const bankAccId = '22222222-2222-4222-8222-222222222221';
  const cashAccId = '22222222-2222-4222-8222-222222222222';
  const archivedAccId = '22222222-2222-4222-8222-222222222223';

  const foodCatId = '33333333-3333-4333-8333-333333333331';
  const travelCatId = '33333333-3333-4333-8333-333333333332';
  const archivedCatId = '33333333-3333-4333-8333-333333333333';
  const salaryCatId = '33333333-3333-4333-8333-333333333334';
  const dividendCatId = '33333333-3333-4333-8333-333333333335';

  const sampleAccountDTOs: AccountWithBalanceDTO[] = [
    {
      id: bankAccId as any,
      name: 'Axis Priority Bank',
      accountType: 'bank',
      openingBalancePaise: 5000000,
      openingBalanceFormatted: '₹50,000.00',
      currentBalancePaise: 5000000,
      currentBalanceFormatted: '₹50,000.00',
      currency: 'INR',
      isArchived: false,
      isCreditCard: false,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z'
    },
    {
      id: cashAccId as any,
      name: 'Petty Cash Wallet',
      accountType: 'cash',
      openingBalancePaise: 500000,
      openingBalanceFormatted: '₹5,000.00',
      currentBalancePaise: 500000,
      currentBalanceFormatted: '₹5,000.00',
      currency: 'INR',
      isArchived: false,
      isCreditCard: false,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z'
    },
    {
      id: archivedAccId as any,
      name: 'Closed Vault Account',
      accountType: 'bank',
      openingBalancePaise: 0,
      openingBalanceFormatted: '₹0.00',
      currentBalancePaise: 0,
      currentBalanceFormatted: '₹0.00',
      currency: 'INR',
      isArchived: true,
      isCreditCard: false,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z'
    }
  ];

  const sampleCategories: Category[] = [
    new Category({
      id: createCategoryId(foodCatId),
      userId: createUserId(userId),
      name: 'Food & Dining Out',
      type: 'expense',
      isDefault: true
    }),
    new Category({
      id: createCategoryId(travelCatId),
      userId: createUserId(userId),
      name: 'Commute & Fuel',
      type: 'expense',
      isDefault: false
    }),
    new Category({
      id: createCategoryId(archivedCatId),
      userId: createUserId(userId),
      name: 'Deprecated Expense',
      type: 'expense',
      isArchived: true
    }),
    new Category({
      id: createCategoryId(salaryCatId),
      userId: createUserId(userId),
      name: 'Salary & Wages',
      type: 'income',
      isDefault: true
    }),
    new Category({
      id: createCategoryId(dividendCatId),
      userId: createUserId(userId),
      name: 'Dividends & Yield',
      type: 'income',
      isDefault: false
    })
  ];

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  describe('A. Form Validation, Filtering & Submission Behavior', () => {
    let mockCreateTransaction: ReturnType<typeof vi.fn>;
    let mockOnClose: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockCreateTransaction = vi.fn().mockResolvedValue({
        id: 'tx-created',
        type: 'expense',
        amountPaise: 10000
      } as TransactionResponseDTO);
      mockOnClose = vi.fn();

      vi.spyOn(useAccountsModule, 'useAccounts').mockReturnValue({
        accounts: sampleAccountDTOs,
        summary: {} as any,
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
        createAccount: vi.fn(),
        isCreating: false,
        updateAccount: vi.fn(),
        isUpdating: false,
        archiveAccount: vi.fn(),
        isArchiving: false,
        restoreAccount: vi.fn(),
        isRestoring: false
      });

      const activeIncomeCats = sampleCategories.filter((c) => c.type === 'income' && !c.isArchived);
      const activeExpenseCats = sampleCategories.filter((c) => c.type === 'expense' && !c.isArchived);

      vi.spyOn(useCategoriesModule, 'useCategories').mockReturnValue({
        categories: sampleCategories,
        incomeCategories: activeIncomeCats,
        expenseCategories: activeExpenseCats,
        categoryMap: new Map(sampleCategories.map((c) => [c.id, c])),
        getCategoryById: (id) => (id ? sampleCategories.find((c) => c.id === id) : undefined),
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn()
      });

      vi.spyOn(useTransactionsModule, 'useTransactions').mockReturnValue({
        transactions: [],
        summary: useTransactionsModule.computeTransactionSummary([]),
        pendingTxIdSet: new Set(),
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
        isAuthenticated: true,
        createTransaction: mockCreateTransaction,
        isCreating: false,
        updateTransaction: vi.fn(),
        isUpdating: false,
        deleteTransaction: vi.fn(),
        isDeleting: false
      });
    });

    it('uses real active accounts and eligible categories rather than hardcoded placeholders', () => {
      render(<QuickAddModal isOpen={true} onClose={mockOnClose} />);

      const accountSelect = screen.getByLabelText(/^Account$/i);
      const accountOptions = Array.from(accountSelect.querySelectorAll('option')).map(
        (o) => o.textContent
      );
      expect(accountOptions).toContain('Axis Priority Bank (bank)');
      expect(accountOptions).toContain('Petty Cash Wallet (cash)');
      expect(accountOptions).not.toContain('Closed Vault Account (bank)');
      expect(accountOptions.join(' ')).not.toContain('HDFC Salary Bank');

      const categorySelect = screen.getByLabelText(/^Category$/i);
      const categoryOptions = Array.from(categorySelect.querySelectorAll('option')).map(
        (o) => o.textContent
      );
      expect(categoryOptions).toContain('Food & Dining Out');
      expect(categoryOptions).toContain('Commute & Fuel');
      expect(categoryOptions).not.toContain('Deprecated Expense');
      expect(categoryOptions).not.toContain('Salary & Wages');
    });

    it('submits a valid expense transaction with notes and closes cleanly', async () => {
      render(<QuickAddModal isOpen={true} onClose={mockOnClose} />);

      fireEvent.change(screen.getByLabelText(/Amount \(INR\)/i), {
        target: { value: '245.50' }
      });
      fireEvent.change(screen.getByLabelText(/Title \/ Description/i), {
        target: { value: 'Team Lunch' }
      });
      fireEvent.change(screen.getByLabelText(/^Account$/i), {
        target: { value: cashAccId }
      });
      fireEvent.change(screen.getByLabelText(/^Category$/i), {
        target: { value: travelCatId }
      });
      fireEvent.change(screen.getByLabelText(/Transaction Date/i), {
        target: { value: '2026-11-26' }
      });
      fireEvent.change(screen.getByLabelText(/Notes \(Optional\)/i), {
        target: { value: 'Client visit lunch receipt' }
      });

      fireEvent.click(screen.getByRole('button', { name: /Save Transaction/i }));

      await waitFor(() => {
        expect(mockCreateTransaction).toHaveBeenCalledTimes(1);
        expect(mockCreateTransaction).toHaveBeenCalledWith({
          type: 'expense',
          amount: '245.50',
          title: 'Team Lunch',
          accountId: cashAccId,
          destinationAccountId: undefined,
          categoryId: travelCatId,
          transactionDate: '2026-11-26',
          note: 'Client visit lunch receipt'
        });
        expect(mockOnClose).toHaveBeenCalledTimes(1);
      });
    });

    it('switches eligible categories on Income and submits valid income transaction', async () => {
      render(<QuickAddModal isOpen={true} onClose={mockOnClose} />);

      fireEvent.click(screen.getByRole('radio', { name: /Income/i }));

      const categorySelect = screen.getByLabelText(/^Category$/i);
      const categoryOptions = Array.from(categorySelect.querySelectorAll('option')).map(
        (o) => o.textContent
      );
      expect(categoryOptions).toContain('Salary & Wages');
      expect(categoryOptions).toContain('Dividends & Yield');
      expect(categoryOptions).not.toContain('Food & Dining Out');

      fireEvent.change(screen.getByLabelText(/Amount \(INR\)/i), {
        target: { value: '85000' }
      });
      fireEvent.change(screen.getByLabelText(/Title \/ Description/i), {
        target: { value: 'November Salary' }
      });
      fireEvent.change(categorySelect, { target: { value: dividendCatId } });

      fireEvent.click(screen.getByRole('button', { name: /Save Transaction/i }));

      await waitFor(() => {
        expect(mockCreateTransaction).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'income',
            amount: '85000',
            title: 'November Salary',
            accountId: bankAccId,
            destinationAccountId: undefined,
            categoryId: dividendCatId
          })
        );
        expect(mockOnClose).toHaveBeenCalledTimes(1);
      });
    });

    it('submits valid single-row transfer without category and disables same destination option', async () => {
      render(<QuickAddModal isOpen={true} onClose={mockOnClose} />);

      fireEvent.click(screen.getByRole('radio', { name: /Transfer/i }));

      expect(screen.queryByLabelText(/^Category$/i)).not.toBeInTheDocument();

      const destSelect = screen.getByLabelText(/Destination Account/i);
      const sourceOptionInDest = destSelect.querySelector(
        `option[value="${bankAccId}"]`
      ) as HTMLOptionElement;
      expect(sourceOptionInDest.disabled).toBe(true);

      fireEvent.change(screen.getByLabelText(/Amount \(INR\)/i), {
        target: { value: '3000' }
      });
      fireEvent.change(destSelect, { target: { value: cashAccId } });

      fireEvent.click(screen.getByRole('button', { name: /Save Transaction/i }));

      await waitFor(() => {
        expect(mockCreateTransaction).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'transfer',
            amount: '3000',
            accountId: bankAccId,
            destinationAccountId: cashAccId,
            categoryId: undefined
          })
        );
        expect(mockOnClose).toHaveBeenCalledTimes(1);
      });
    });

    it('rejects missing and invalid fields while preserving form state and never emitting false toast', async () => {
      render(<QuickAddModal isOpen={true} onClose={mockOnClose} />);

      const submitBtn = screen.getByRole('button', { name: /Save Transaction/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByText('Amount is required')).toBeInTheDocument();
        expect(screen.getByText('Title is required')).toBeInTheDocument();
      });

      const amountInput = screen.getByLabelText(/Amount \(INR\)/i);
      const titleInput = screen.getByLabelText(/Title \/ Description/i);
      fireEvent.change(titleInput, { target: { value: 'Coffee' } });

      fireEvent.change(amountInput, { target: { value: '-10' } });
      fireEvent.click(submitBtn);
      await waitFor(() => {
        expect(screen.getByText('Amount must be greater than zero')).toBeInTheDocument();
      });

      fireEvent.change(amountInput, { target: { value: '99.999' } });
      fireEvent.click(submitBtn);
      await waitFor(() => {
        expect(screen.getByText('Amount must have at most 2 decimal places')).toBeInTheDocument();
      });

      expect((titleInput as HTMLInputElement).value).toBe('Coffee');
      expect((amountInput as HTMLInputElement).value).toBe('99.999');
      expect(mockCreateTransaction).not.toHaveBeenCalled();
      expect(mockOnClose).not.toHaveBeenCalled();
      expect(toast.success).not.toHaveBeenCalled();
    });

    it('rejects missing destination and same-account transfer cleanly', async () => {
      render(<QuickAddModal isOpen={true} onClose={mockOnClose} />);

      fireEvent.click(screen.getByRole('radio', { name: /Transfer/i }));
      fireEvent.change(screen.getByLabelText(/Amount \(INR\)/i), {
        target: { value: '500' }
      });

      const submitBtn = screen.getByRole('button', { name: /Save Transaction/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(
          screen.getByText('Destination account is required for transfers')
        ).toBeInTheDocument();
      });

      // Pick Destination first, then switch Source to match it
      const destSelect = screen.getByLabelText(/Destination Account/i);
      fireEvent.change(destSelect, { target: { value: cashAccId } });
      const sourceSelect = screen.getByLabelText(/Source Account/i);
      fireEvent.change(sourceSelect, { target: { value: cashAccId } });

      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(
          screen.getByText('Destination account must be different from source account')
        ).toBeInTheDocument();
      });
      expect(mockCreateTransaction).not.toHaveBeenCalled();
      expect(mockOnClose).not.toHaveBeenCalled();
    });

    it('prevents duplicate submissions on rapid clicks while persistence is in flight', async () => {
      let resolveSave!: (value: TransactionResponseDTO) => void;
      mockCreateTransaction.mockImplementation(
        () =>
          new Promise<TransactionResponseDTO>((resolve) => {
            resolveSave = resolve;
          })
      );

      render(<QuickAddModal isOpen={true} onClose={mockOnClose} />);

      fireEvent.change(screen.getByLabelText(/Amount \(INR\)/i), {
        target: { value: '120' }
      });
      fireEvent.change(screen.getByLabelText(/Title \/ Description/i), {
        target: { value: 'Metro Recharge' }
      });

      const submitBtn = screen.getByRole('button', { name: /Save Transaction/i });
      fireEvent.click(submitBtn);
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(mockCreateTransaction).toHaveBeenCalledTimes(1);
        expect(submitBtn).toBeDisabled();
      });
      expect(toast.success).not.toHaveBeenCalled();
      expect(mockOnClose).not.toHaveBeenCalled();

      resolveSave({ id: 'tx-1', type: 'expense', amountPaise: 12000 } as TransactionResponseDTO);

      await waitFor(() => {
        expect(mockOnClose).toHaveBeenCalledTimes(1);
      });
    });

    it('keeps modal open and preserves entered values when persistence fails', async () => {
      mockCreateTransaction.mockRejectedValueOnce(
        new Error('IndexedDB write failed: Disk quota exceeded')
      );

      render(<QuickAddModal isOpen={true} onClose={mockOnClose} />);

      const amountInput = screen.getByLabelText(/Amount \(INR\)/i) as HTMLInputElement;
      const titleInput = screen.getByLabelText(/Title \/ Description/i) as HTMLInputElement;
      const noteInput = screen.getByLabelText(/Notes \(Optional\)/i) as HTMLTextAreaElement;

      fireEvent.change(amountInput, { target: { value: '499.75' } });
      fireEvent.change(titleInput, { target: { value: 'Weekly Groceries' } });
      fireEvent.change(noteInput, { target: { value: 'Keep values on error' } });

      fireEvent.click(screen.getByRole('button', { name: /Save Transaction/i }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(
          'IndexedDB write failed: Disk quota exceeded'
        );
      });

      expect(mockOnClose).not.toHaveBeenCalled();
      expect(toast.success).not.toHaveBeenCalled();
      expect(amountInput.value).toBe('499.75');
      expect(titleInput.value).toBe('Weekly Groceries');
      expect(noteInput.value).toBe('Keep values on error');
    });
  });

  describe('B. End-to-End Integration with UseCase, Outbox, Query Invalidation & Sync Safety', () => {
    it('persists expense, income, and single-row transfer in integer paise, invalidates queries, enqueues outbox, preserves historical data, and triggers zero automatic cloud sync', async () => {
      const testQueryClient = new QueryClient({
        defaultOptions: {
          queries: { retry: false }
        }
      });
      const invalidateSpy = vi.spyOn(testQueryClient, 'invalidateQueries');
      const syncCoordinatorSpy = vi
        .spyOn(defaultManualSyncCoordinator, 'run')
        .mockResolvedValue({} as any);

      const historicalTx = new Transaction({
        id: createTransactionId('44444444-4444-4444-8444-444444444441'),
        userId: createUserId(userId),
        type: 'expense',
        amountPaise: 50000,
        currency: 'INR',
        accountId: createAccountId(bankAccId),
        categoryId: createCategoryId(foodCatId),
        title: 'Historical Dinner',
        transactionDate: new Date('2026-11-10T12:00:00.000Z'),
        idempotencyKey: 'historical-tx-key'
      });

      const accountStore = new Map<string, Account>([
        [
          bankAccId,
          new Account({
            id: createAccountId(bankAccId),
            userId: createUserId(userId),
            name: 'Axis Priority Bank',
            accountType: 'bank',
            openingBalancePaise: 5000000,
            currency: 'INR'
          })
        ],
        [
          cashAccId,
          new Account({
            id: createAccountId(cashAccId),
            userId: createUserId(userId),
            name: 'Petty Cash Wallet',
            accountType: 'cash',
            openingBalancePaise: 500000,
            currency: 'INR'
          })
        ]
      ]);

      const categoryStore = new Map<string, Category>(
        sampleCategories.map((c) => [c.id, c])
      );
      const transactionStore = new Map<string, Transaction>([
        [historicalTx.id, historicalTx]
      ]);
      const outboxEntries: Array<{ entity: string; entityId: string; operation: string; payload: any }> = [];

      const accountRepo: any = {
        findById: vi.fn(async (id: string, uid: string) => {
          const acc = accountStore.get(id);
          return acc && acc.userId === uid ? acc : null;
        }),
        findByUserId: vi.fn(async (uid: string) =>
          Array.from(accountStore.values()).filter((a) => a.userId === uid)
        )
      };
      const categoryRepo: any = {
        findById: vi.fn(async (id: string, uid: string) => {
          const cat = categoryStore.get(id);
          return cat && (cat.userId === uid || cat.isDefault) ? cat : null;
        }),
        findByUserId: vi.fn(async (uid: string) =>
          Array.from(categoryStore.values()).filter((c) => c.userId === uid)
        )
      };
      const transactionRepo: any = {
        findById: vi.fn(async (id: string, uid: string) => {
          const tx = transactionStore.get(id);
          return tx && tx.userId === uid ? tx : null;
        }),
        findByUserId: vi.fn(async (uid: string) =>
          Array.from(transactionStore.values()).filter((t) => t.userId === uid)
        ),
        findByAccount: vi.fn(async (accountId: string, uid: string) =>
          Array.from(transactionStore.values()).filter(
            (t) =>
              t.userId === uid &&
              (t.accountId === accountId || t.destinationAccountId === accountId)
          )
        ),
        findMany: vi.fn(async (filter: { userId?: string }) =>
          Array.from(transactionStore.values()).filter(
            (t) => !filter.userId || t.userId === filter.userId
          )
        ),
        findByIdempotencyKey: vi.fn(async (key: string, uid: string) => {
          for (const tx of transactionStore.values()) {
            if (tx.idempotencyKey === key && tx.userId === uid) return tx;
          }
          return null;
        }),
        save: vi.fn(async (tx: Transaction) => {
          transactionStore.set(tx.id, tx);
        })
      };
      const syncPort: any = {
        enqueue: vi.fn(async (entry: any) => {
          outboxEntries.push(entry);
        })
      };
      const unitOfWork: any = {
        run: vi.fn(async (fn: () => Promise<void>) => fn())
      };
      const outboxManager: any = {
        getPendingEntries: vi.fn(async () => outboxEntries)
      };

      const createUseCase = new CreateTransactionUseCase(
        transactionRepo,
        accountRepo,
        categoryRepo,
        syncPort,
        unitOfWork
      );
      const getTransactionsUseCase = new GetTransactionsUseCase(transactionRepo);
      const getAccountsUseCase = new GetAccountsWithBalanceUseCase(
        accountRepo,
        transactionRepo
      );

      vi.spyOn(defaultDatabaseManager, 'getActiveUserId').mockReturnValue(userId);
      vi.spyOn(defaultDatabaseManager, 'getActiveRepositories').mockResolvedValue({
        accountRepo,
        categoryRepo,
        transactionRepo,
        outboxManager,
        createTransactionUseCase: createUseCase,
        getTransactionsUseCase,
        getAccountsUseCase,
        evaluateFinancialAlertsUseCase: {
          execute: vi.fn().mockResolvedValue({ createdCount: 0, updatedCount: 0 })
        }
      } as any);

      const authContextValue: AuthContextType = {
        user: { id: userId, email: 'arjun@laxmilens.app' },
        isLoading: false,
        isAuthenticated: true,
        signIn: vi.fn(),
        signUp: vi.fn(),
        signInWithGoogle: vi.fn(),
        signOut: vi.fn(),
        resetPassword: vi.fn(),
        updatePassword: vi.fn()
      };

      const onClose = vi.fn();

      const Wrapper: React.FC<{ isOpen: boolean }> = ({ isOpen }) => (
        <AuthContext.Provider value={authContextValue}>
          <QueryClientProvider client={testQueryClient}>
            <QuickAddModal isOpen={isOpen} onClose={onClose} />
          </QueryClientProvider>
        </AuthContext.Provider>
      );

      const { rerender } = render(<Wrapper isOpen={true} />);

      // Wait for real async queries to load active accounts & categories
      await waitFor(() => {
        expect(screen.getByLabelText(/^Account$/i)).toHaveValue(bankAccId);
      });

      // 1. Persist Expense (₹19.99 -> 1999 paise, testing floating-point safe rounding)
      fireEvent.change(screen.getByLabelText(/Amount \(INR\)/i), { target: { value: '19.99' } });
      fireEvent.change(screen.getByLabelText(/Title \/ Description/i), {
        target: { value: 'Chai & Snacks' }
      });
      fireEvent.change(screen.getByLabelText(/^Category$/i), { target: { value: foodCatId } });
      fireEvent.click(screen.getByRole('button', { name: /Save Transaction/i }));

      await waitFor(() => {
        expect(onClose).toHaveBeenCalledTimes(1);
      });
      expect(toast.success).toHaveBeenCalledWith('Expense saved locally');

      // Reopen for Income
      rerender(<Wrapper isOpen={false} />);
      rerender(<Wrapper isOpen={true} />);

      // 2. Persist Income (₹1000.50 -> 100050 paise)
      fireEvent.click(screen.getByRole('radio', { name: /Income/i }));
      fireEvent.change(screen.getByLabelText(/Amount \(INR\)/i), { target: { value: '1000.50' } });
      fireEvent.change(screen.getByLabelText(/Title \/ Description/i), {
        target: { value: 'Dividend Payout' }
      });
      fireEvent.change(screen.getByLabelText(/^Category$/i), { target: { value: salaryCatId } });
      fireEvent.click(screen.getByRole('button', { name: /Save Transaction/i }));

      await waitFor(() => {
        expect(onClose).toHaveBeenCalledTimes(2);
      });
      expect(toast.success).toHaveBeenCalledWith('Income saved locally');

      // Reopen for Transfer
      rerender(<Wrapper isOpen={false} />);
      rerender(<Wrapper isOpen={true} />);

      // 3. Persist single-row Transfer (₹2500.00 -> 250000 paise)
      fireEvent.click(screen.getByRole('radio', { name: /Transfer/i }));
      fireEvent.change(screen.getByLabelText(/Amount \(INR\)/i), { target: { value: '2500' } });
      fireEvent.change(screen.getByLabelText(/Destination Account/i), {
        target: { value: cashAccId }
      });
      fireEvent.click(screen.getByRole('button', { name: /Save Transaction/i }));

      await waitFor(() => {
        expect(onClose).toHaveBeenCalledTimes(3);
      });
      expect(toast.success).toHaveBeenCalledWith('Transfer saved locally');

      // Verify stored domain entities: historical + 3 new transactions (4 total; transfer is single-row)
      expect(transactionStore.size).toBe(4);
      const savedHistorical = transactionStore.get(historicalTx.id);
      expect(savedHistorical?.amountPaise).toBe(50000);
      expect(savedHistorical?.title).toBe('Historical Dinner');

      const allTxs = Array.from(transactionStore.values());
      const chaiExpense = allTxs.find((t) => t.title === 'Chai & Snacks');
      const salaryIncome = allTxs.find((t) => t.title === 'Dividend Payout');
      const bankToCashTransfer = allTxs.find((t) => t.type === 'transfer');

      expect(chaiExpense?.amountPaise).toBe(1999);
      expect(chaiExpense?.userId).toBe(userId);
      expect(salaryIncome?.amountPaise).toBe(100050);
      expect(bankToCashTransfer?.amountPaise).toBe(250000);
      expect(bankToCashTransfer?.accountId).toBe(bankAccId);
      expect(bankToCashTransfer?.destinationAccountId).toBe(cashAccId);
      expect(bankToCashTransfer?.categoryId).toBeUndefined();
      expect(bankToCashTransfer?.title).toBe('Account Transfer');

      // Verify LedgerRules cashflow excludes the transfer and respects paise totals
      const totals = LedgerRules.calculateTotals(allTxs);
      expect(totals.totalIncome.paise).toBe(100050);
      expect(totals.totalExpense.paise).toBe(50000 + 1999);

      // Verify outbox recorded all 3 INSERT entries without triggering cloud sync
      expect(outboxEntries).toHaveLength(3);
      expect(outboxEntries.every((e) => e.entity === 'transactions' && e.operation === 'INSERT')).toBe(
        true
      );
      expect(syncCoordinatorSpy).not.toHaveBeenCalled();

      // Verify all expected React Query keys were invalidated
      const invalidatedKeys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
      expect(invalidatedKeys).toContain(JSON.stringify(['transactions', userId]));
      expect(invalidatedKeys).toContain(JSON.stringify(['accounts', userId]));
      expect(invalidatedKeys).toContain(JSON.stringify(['budgets', userId]));
      expect(invalidatedKeys).toContain(JSON.stringify(['reports', userId]));
      expect(invalidatedKeys).toContain(JSON.stringify(['syncPendingCount', userId]));
      expect(invalidatedKeys).toContain(JSON.stringify(['pendingOutboxTxIds', userId]));

      testQueryClient.clear();
    });
  });
});

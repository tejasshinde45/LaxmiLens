import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BudgetsPage } from '@/features/budgets/BudgetsPage';
import * as useBudgetsModule from '@/features/budgets/hooks/useBudgets';
import * as useCategoriesModule from '@/features/categories/hooks/useCategories';
import * as useAccountSyncModule from '@/features/accounts/hooks/useAccountSync';
import * as useAuthModule from '@/features/auth/hooks/useAuth';
import {
  getCurrentBudgetPeriod,
  parseInrToPaise,
  formatPaiseForInput
} from '@/features/budgets/schemas/budgetSchemas';
import {
  BudgetsOverviewSummaryDTO,
  BudgetOverviewItemDTO
} from '@/application/dto/BudgetDTO';
import { Category } from '@/domain/entities/Category';
import { Budget } from '@/domain/entities/Budget';
import { Transaction } from '@/domain/entities/Transaction';
import { BudgetRepository } from '@/domain/repositories/BudgetRepository';
import { TransactionRepository } from '@/domain/repositories/TransactionRepository';
import { CategoryRepository } from '@/domain/repositories/CategoryRepository';
import { OutboxEntry, SyncPort } from '@/application/ports/SyncPort';
import { UnitOfWork } from '@/application/ports/UnitOfWork';
import { CreateBudgetUseCase } from '@/application/use-cases/budgets/CreateBudgetUseCase';
import { UpdateBudgetUseCase } from '@/application/use-cases/budgets/UpdateBudgetUseCase';
import { DeleteBudgetUseCase } from '@/application/use-cases/budgets/DeleteBudgetUseCase';
import { GetBudgetsOverviewUseCase } from '@/application/use-cases/budgets/GetBudgetsOverviewUseCase';
import {
  createAccountId,
  createCategoryId,
  createTransactionId,
  createUserId
} from '@/domain/value-objects/Identifiers';
import { defaultDatabaseManager } from '@/infrastructure/database/local/DatabaseManager';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn()
  }
}));

describe('BudgetsPage & Phase 5 Budget Integration', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const currentPeriod = getCurrentBudgetPeriod();
  const catGroceries = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  const catDining = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
  const catFuel = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
  const catUtilities = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
  const catSalary = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5';
  const catArchived = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6';

  const mockCreateBudget = vi.fn();
  const mockUpdateBudget = vi.fn();
  const mockDeleteBudget = vi.fn();
  const mockRefetch = vi.fn();
  const mockSyncNow = vi.fn();

  const sampleCategories: Category[] = [
    new Category({
      id: createCategoryId(catGroceries),
      userId: createUserId(userId),
      name: 'Groceries & Household',
      type: 'expense',
      icon: 'ShoppingCart',
      color: '#D9827C',
      isArchived: false
    }),
    new Category({
      id: createCategoryId(catDining),
      userId: createUserId(userId),
      name: 'Food & Dining Out',
      type: 'expense',
      icon: 'Utensils',
      color: '#E4B66D',
      isArchived: false
    }),
    new Category({
      id: createCategoryId(catFuel),
      userId: createUserId(userId),
      name: 'Transport & Fuel',
      type: 'expense',
      icon: 'Car',
      color: '#72B895',
      isArchived: false
    }),
    new Category({
      id: createCategoryId(catUtilities),
      userId: createUserId(userId),
      name: 'Utilities & Bills',
      type: 'expense',
      icon: 'Zap',
      color: '#82A9CF',
      isArchived: false
    }),
    new Category({
      id: createCategoryId(catSalary),
      userId: createUserId(userId),
      name: 'Salary & Wages',
      type: 'income',
      icon: 'Briefcase',
      color: '#72B895',
      isArchived: false
    }),
    new Category({
      id: createCategoryId(catArchived),
      userId: createUserId(userId),
      name: 'Archived Expense',
      type: 'expense',
      icon: 'Tag',
      color: '#858078',
      isArchived: true
    })
  ];

  const sampleSummary: BudgetsOverviewSummaryDTO = {
    period: currentPeriod,
    totalBudgetLimitPaise: 2500000,
    totalBudgetLimitFormatted: '₹25,000.00',
    totalSpentPaise: 2450000,
    totalSpentFormatted: '₹24,500.00',
    totalRemainingPaise: 50000,
    totalRemainingFormatted: '₹500.00',
    overallUtilizationPercentage: 98,
    budgetCount: 3,
    exceededCount: 1
  };

  const sampleBudgets: BudgetOverviewItemDTO[] = [
    {
      budgetId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
      userId,
      categoryId: catGroceries,
      categoryName: 'Groceries & Household',
      categoryIcon: 'ShoppingCart',
      categoryColor: '#D9827C',
      categoryIsArchived: false,
      period: currentPeriod,
      limitPaise: 1000000,
      limitFormatted: '₹10,000.00',
      spentPaise: 500000,
      spentFormatted: '₹5,000.00',
      remainingPaise: 500000,
      remainingFormatted: '₹5,000.00',
      utilizationPercentage: 50,
      isExceeded: false,
      version: 1,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z'
    },
    {
      budgetId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
      userId,
      categoryId: catDining,
      categoryName: 'Food & Dining Out',
      categoryIcon: 'Utensils',
      categoryColor: '#E4B66D',
      categoryIsArchived: false,
      period: currentPeriod,
      limitPaise: 1000000,
      limitFormatted: '₹10,000.00',
      spentPaise: 850000,
      spentFormatted: '₹8,500.00',
      remainingPaise: 150000,
      remainingFormatted: '₹1,500.00',
      utilizationPercentage: 85,
      isExceeded: false,
      version: 2,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-05T00:00:00.000Z'
    },
    {
      budgetId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',
      userId,
      categoryId: catFuel,
      categoryName: 'Transport & Fuel',
      categoryIcon: 'Car',
      categoryColor: '#D9827C',
      categoryIsArchived: false,
      period: currentPeriod,
      limitPaise: 500000,
      limitFormatted: '₹5,000.00',
      spentPaise: 1100000,
      spentFormatted: '₹11,000.00',
      remainingPaise: 0,
      remainingFormatted: '₹0.00',
      utilizationPercentage: 220,
      isExceeded: true,
      version: 1,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-06T00:00:00.000Z'
    }
  ];

  function setupDefaultHookMocks(overrides?: {
    budgets?: BudgetOverviewItemDTO[];
    summary?: BudgetsOverviewSummaryDTO;
    isLoading?: boolean;
    isError?: boolean;
    error?: Error | null;
    isCreating?: boolean;
    isUpdating?: boolean;
    isDeleting?: boolean;
    pendingCount?: number;
  }) {
    vi.spyOn(useBudgetsModule, 'useBudgets').mockReturnValue({
      period: currentPeriod,
      summary: overrides?.summary ?? sampleSummary,
      budgets: overrides?.budgets ?? sampleBudgets,
      pendingBudgetIdSet: new Set(['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2']),
      isLoading: overrides?.isLoading ?? false,
      isError: overrides?.isError ?? false,
      error: overrides?.error ?? null,
      refetch: mockRefetch,
      isAuthenticated: true,
      createBudget: mockCreateBudget,
      isCreating: overrides?.isCreating ?? false,
      updateBudget: mockUpdateBudget,
      isUpdating: overrides?.isUpdating ?? false,
      deleteBudget: mockDeleteBudget,
      isDeleting: overrides?.isDeleting ?? false
    });

    vi.spyOn(useCategoriesModule, 'useCategories').mockReturnValue({
      categories: sampleCategories,
      incomeCategories: sampleCategories.filter((c) => c.type === 'income' && !c.isArchived),
      expenseCategories: sampleCategories.filter((c) => c.type === 'expense' && !c.isArchived),
      categoryMap: new Map(sampleCategories.map((c) => [c.id, c])),
      getCategoryById: (id) => sampleCategories.find((c) => c.id === id),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn()
    });

    vi.spyOn(useAccountSyncModule, 'useAccountSync').mockReturnValue({
      syncNow: mockSyncNow,
      isSyncing: false,
      pendingCount: overrides?.pendingCount ?? 2,
      lastResult: undefined,
      isAuthenticated: true
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateBudget.mockResolvedValue({});
    mockUpdateBudget.mockResolvedValue({});
    mockDeleteBudget.mockResolvedValue(undefined);
    mockSyncNow.mockResolvedValue({});
  });

  describe('INR conversion & status helpers', () => {
    it('evaluates budget utilization status boundaries strictly (<80 Normal, 80-99 Warning, >=100 Exceeded)', () => {
      expect(useBudgetsModule.getBudgetUtilizationStatus(0, false)).toBe('normal');
      expect(useBudgetsModule.getBudgetUtilizationStatus(79, false)).toBe('normal');
      expect(useBudgetsModule.getBudgetUtilizationStatus(80, false)).toBe('warning');
      expect(useBudgetsModule.getBudgetUtilizationStatus(99, false)).toBe('warning');
      expect(useBudgetsModule.getBudgetUtilizationStatus(100, false)).toBe('exceeded');
      expect(useBudgetsModule.getBudgetUtilizationStatus(105, true)).toBe('exceeded');
    });

    it('converts decimal INR inputs into exact integer paise without floating-point drift', () => {
      expect(parseInrToPaise('19.99')).toBe(1999);
      expect(parseInrToPaise('15000')).toBe(1500000);
      expect(parseInrToPaise('0.5')).toBe(50);
      expect(formatPaiseForInput(150050)).toBe('1500.50');
      expect(formatPaiseForInput(150000)).toBe('1500');

      expect(() => parseInrToPaise('0')).toThrow(/greater than zero/i);
      expect(() => parseInrToPaise('-100')).toThrow(/valid amount/i);
      expect(() => parseInrToPaise('12.345')).toThrow(/at most 2 decimal places/i);
      expect(() => parseInrToPaise('999999999999999')).toThrow(/maximum supported safe integer/i);
    });
  });

  describe('Overview rendering, statuses, loading, error, and empty state', () => {
    it('renders summary metrics, category budgets in INR, progress bars, and Normal/Warning/Exceeded statuses', () => {
      setupDefaultHookMocks();
      render(<BudgetsPage />);

      // Summary metrics
      expect(screen.getByText('₹25,000.00')).toBeInTheDocument();
      expect(screen.getByText('₹24,500.00')).toBeInTheDocument();
      expect(screen.getByText('₹500.00')).toBeInTheDocument();
      expect(screen.getByText('98%')).toBeInTheDocument();

      // Category items & spent / remaining values
      expect(screen.getByText('Groceries & Household')).toBeInTheDocument();
      expect(screen.getByText('Food & Dining Out')).toBeInTheDocument();
      expect(screen.getByText('Transport & Fuel')).toBeInTheDocument();
      expect(screen.getAllByText('₹5,000.00').length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText('₹8,500.00')).toBeInTheDocument();
      expect(screen.getByText('₹1,500.00')).toBeInTheDocument();
      expect(screen.getByText('₹11,000.00')).toBeInTheDocument();
      expect(screen.getByText('₹6,000.00')).toBeInTheDocument(); // Over budget by

      // Utilization & status badges
      expect(screen.getByText('50%')).toBeInTheDocument();
      expect(screen.getByText('85%')).toBeInTheDocument();
      expect(screen.getByText('220%')).toBeInTheDocument();
      expect(screen.getByText('Normal')).toBeInTheDocument();
      expect(screen.getByText('Warning')).toBeInTheDocument();
      expect(screen.getByText('Exceeded')).toBeInTheDocument();

      // Pending sync indicator & progress bars
      expect(screen.getByText('Pending Sync')).toBeInTheDocument();
      expect(screen.getAllByRole('progressbar')).toHaveLength(3);
    });

    it('switches calendar month via previous/next period buttons and calls useBudgets with shifted period', () => {
      setupDefaultHookMocks();
      const spy = vi.spyOn(useBudgetsModule, 'useBudgets');
      render(<BudgetsPage />);

      expect(spy).toHaveBeenCalledWith(currentPeriod);

      fireEvent.click(screen.getByRole('button', { name: /previous month/i }));
      expect(spy).toHaveBeenCalledTimes(2);
      const prevPeriodCall = spy.mock.calls[1][0];
      expect(prevPeriodCall).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
      expect(prevPeriodCall).not.toBe(currentPeriod);

      fireEvent.click(screen.getByRole('button', { name: /next month/i }));
      expect(spy.mock.calls[2][0]).toBe(currentPeriod);
    });

    it('renders empty state and opens Create Monthly Budget modal from action button', () => {
      setupDefaultHookMocks({
        budgets: [],
        summary: {
          ...sampleSummary,
          totalBudgetLimitPaise: 0,
          totalBudgetLimitFormatted: '₹0.00',
          totalSpentPaise: 0,
          totalSpentFormatted: '₹0.00',
          totalRemainingPaise: 0,
          totalRemainingFormatted: '₹0.00',
          overallUtilizationPercentage: 0,
          budgetCount: 0,
          exceededCount: 0
        }
      });

      render(<BudgetsPage />);

      expect(screen.getByText(/No budgets for/i)).toBeInTheDocument();
      const emptyCreateBtn = screen.getAllByRole('button', { name: /create budget/i })[1];
      fireEvent.click(emptyCreateBtn);

      expect(screen.getByRole('heading', { name: /create monthly budget/i })).toBeInTheDocument();
    });

    it('renders loading skeletons and error state with retry action', () => {
      setupDefaultHookMocks({ isLoading: true });
      const { unmount } = render(<BudgetsPage />);
      expect(screen.getByLabelText('Loading budgets')).toBeInTheDocument();
      unmount();

      setupDefaultHookMocks({
        isError: true,
        error: new Error('Dexie storage temporarily unavailable')
      });
      render(<BudgetsPage />);
      expect(screen.getByText('Failed to Load Budgets')).toBeInTheDocument();
      expect(screen.getByText('Dexie storage temporarily unavailable')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /retry/i }));
      expect(mockRefetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('Create, Edit, and Delete workflows', () => {
    it('filters active expense categories only, validates inputs, prevents duplicates, and submits valid budgets', async () => {
      setupDefaultHookMocks();
      render(<BudgetsPage />);

      fireEvent.click(screen.getByRole('button', { name: /^create budget$/i }));
      const dialog = screen.getByRole('dialog');

      const categorySelect = within(dialog).getByLabelText(/expense category/i);
      const optionTexts = Array.from(categorySelect.querySelectorAll('option')).map(
        (opt) => opt.textContent
      );

      // Active expense categories present; income and archived categories excluded
      expect(optionTexts).toContain('Utilities & Bills');
      expect(optionTexts).toContain('Groceries & Household (Already budgeted)');
      expect(optionTexts.some((t) => t?.includes('Salary & Wages'))).toBe(false);
      expect(optionTexts.some((t) => t?.includes('Archived Expense'))).toBe(false);

      // Validation: invalid limit ("0")
      const limitInput = within(dialog).getByLabelText(/monthly budget limit/i);
      fireEvent.change(limitInput, { target: { value: '0' } });
      fireEvent.click(within(dialog).getByRole('button', { name: /^create budget$/i }));

      await waitFor(() => {
        expect(screen.getByText(/must be greater than zero/i)).toBeInTheDocument();
      });
      expect(mockCreateBudget).not.toHaveBeenCalled();

      // Reject already-budgeted category in the same period
      fireEvent.change(categorySelect, { target: { value: catGroceries } });
      fireEvent.change(limitInput, { target: { value: '4500' } });
      fireEvent.click(within(dialog).getByRole('button', { name: /^create budget$/i }));

      await waitFor(() => {
        expect(within(dialog).getByRole('alert')).toHaveTextContent(/already exists/i);
      });
      expect(mockCreateBudget).not.toHaveBeenCalled();

      // Valid submission
      fireEvent.change(categorySelect, { target: { value: catUtilities } });
      fireEvent.change(limitInput, { target: { value: '3500.50' } });
      fireEvent.click(within(dialog).getByRole('button', { name: /^create budget$/i }));

      await waitFor(() => {
        expect(mockCreateBudget).toHaveBeenCalledWith({
          categoryId: catUtilities,
          period: currentPeriod,
          limit: '3500.50'
        });
      });
    });

    it('preserves category & period during Edit Budget and submits updated limit or shows conflict error', async () => {
      setupDefaultHookMocks();
      render(<BudgetsPage />);

      fireEvent.click(screen.getByRole('button', { name: /edit groceries & household budget/i }));
      const dialog = screen.getByRole('dialog');

      expect(within(dialog).getByText('Groceries & Household')).toBeInTheDocument();
      expect(within(dialog).queryByLabelText(/expense category/i)).not.toBeInTheDocument();

      const limitInput = within(dialog).getByLabelText(/monthly budget limit/i) as HTMLInputElement;
      expect(limitInput.value).toBe('10000');

      mockUpdateBudget.mockRejectedValueOnce(new Error('Version conflict on budget'));
      fireEvent.change(limitInput, { target: { value: '12500' } });
      fireEvent.click(within(dialog).getByRole('button', { name: /save changes/i }));

      await waitFor(() => {
        expect(within(dialog).getByRole('alert')).toHaveTextContent('Version conflict on budget');
      });

      mockUpdateBudget.mockResolvedValueOnce({});
      fireEvent.click(within(dialog).getByRole('button', { name: /save changes/i }));

      await waitFor(() => {
        expect(mockUpdateBudget).toHaveBeenLastCalledWith({
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
          limit: '12500'
        });
      });
    });

    it('confirms transaction preservation on Delete Budget and triggers deleteBudget without duplicate calls', async () => {
      setupDefaultHookMocks();
      render(<BudgetsPage />);

      fireEvent.click(screen.getByRole('button', { name: /delete food & dining out budget/i }));
      const dialog = screen.getByRole('dialog');

      expect(
        within(dialog).getByText(/Deleting a budget does not delete historical transactions/i)
      ).toBeInTheDocument();

      let resolveDelete!: () => void;
      mockDeleteBudget.mockReturnValueOnce(
        new Promise<void>((res) => {
          resolveDelete = res;
        })
      );

      const confirmBtn = within(dialog).getByRole('button', { name: /^delete budget$/i });
      fireEvent.click(confirmBtn);
      fireEvent.click(confirmBtn); // Attempt duplicate click while pending

      expect(mockDeleteBudget).toHaveBeenCalledTimes(1);
      expect(mockDeleteBudget).toHaveBeenCalledWith('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2');

      resolveDelete();
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
    });
  });

  describe('Automatic synchronization & real budget spending use-case integration', () => {
    it('omits manual Sync Cloud button on BudgetsPage and preserves budget query invalidation in useAccountSync', async () => {
      setupDefaultHookMocks({ pendingCount: 3 });
      render(<BudgetsPage />);

      expect(screen.queryByRole('button', { name: /sync cloud|sync now/i })).not.toBeInTheDocument();

      // Verify real useAccountSync hook wires budgets query invalidation via ManualSyncCoordinator
      vi.restoreAllMocks();
      vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
        user: { id: userId, email: 'user@laxmilens.app' },
        isAuthenticated: true,
        isLoading: false,
        signInWithEmail: vi.fn(),
        signUpWithEmail: vi.fn(),
        signInWithGoogle: vi.fn(),
        signOut: vi.fn(),
        sendPasswordReset: vi.fn(),
        updatePassword: vi.fn()
      } as any);

      const mockRun = vi.fn().mockResolvedValue({
        totalPending: 0,
        totalProcessed: 0,
        syncedCount: 0,
        failedCount: 0,
        skippedCount: 0,
        unsupportedCount: 0,
        stillPendingCount: 0,
        pulledCount: 2
      });
      vi.spyOn(defaultDatabaseManager, 'getActiveSyncCoordinator').mockResolvedValue({
        getPendingCount: vi.fn().mockResolvedValue(0),
        run: mockRun
      } as any);

      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

      const SyncProbe: React.FC = () => {
        const { syncNow } = useAccountSyncModule.useAccountSync(qc);
        return (
          <button type="button" onClick={() => syncNow()}>
            TriggerRealSync
          </button>
        );
      };

      render(
        <QueryClientProvider client={qc}>
          <SyncProbe />
        </QueryClientProvider>
      );

      fireEvent.click(screen.getByRole('button', { name: 'TriggerRealSync' }));

      await waitFor(() => {
        expect(mockRun).toHaveBeenCalledTimes(1);
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['budgets', userId] });
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['pendingOutboxBudgetIds', userId] });
      });
    });

    it('connects Create, Update, Delete, and GetBudgetsOverview with accurate paise aggregation & transaction exclusion', async () => {
      const budgetStore = new Map<string, Budget>();
      const outboxEntries: OutboxEntry[] = [];
      const accId = createAccountId('99999999-9999-4999-8999-999999999991');
      const uId = createUserId(userId);
      const period = '2026-04';

      const transactions: Transaction[] = [
        // 1. Valid expense inside April 2026 for budgeted category Groceries -> INCLUDED (₹2,500)
        new Transaction({
          id: createTransactionId('77777777-7777-4777-8777-777777777701'),
          userId: uId,
          type: 'expense',
          amountPaise: 250000,
          currency: 'INR',
          accountId: accId,
          categoryId: createCategoryId(catGroceries),
          title: 'Monthly Groceries',
          transactionDate: new Date(2026, 3, 12, 14, 0, 0),
          deletedAt: null,
          idempotencyKey: 'tx-1'
        }),
        // 2. Soft-deleted expense -> EXCLUDED
        new Transaction({
          id: createTransactionId('77777777-7777-4777-8777-777777777702'),
          userId: uId,
          type: 'expense',
          amountPaise: 90000,
          currency: 'INR',
          accountId: accId,
          categoryId: createCategoryId(catGroceries),
          title: 'Deleted Grocery',
          transactionDate: new Date(2026, 3, 15, 12, 0, 0),
          deletedAt: new Date(2026, 3, 16, 12, 0, 0),
          idempotencyKey: 'tx-2'
        }),
        // 3. Income transaction -> EXCLUDED
        new Transaction({
          id: createTransactionId('77777777-7777-4777-8777-777777777703'),
          userId: uId,
          type: 'income',
          amountPaise: 5000000,
          currency: 'INR',
          accountId: accId,
          categoryId: createCategoryId(catSalary),
          title: 'April Salary',
          transactionDate: new Date(2026, 3, 1, 10, 0, 0),
          deletedAt: null,
          idempotencyKey: 'tx-3'
        }),
        // 4. Transfer transaction -> EXCLUDED
        new Transaction({
          id: createTransactionId('77777777-7777-4777-8777-777777777704'),
          userId: uId,
          type: 'transfer',
          amountPaise: 100000,
          currency: 'INR',
          accountId: accId,
          destinationAccountId: createAccountId('99999999-9999-4999-8999-999999999992'),
          title: 'Self Transfer',
          transactionDate: new Date(2026, 3, 20, 10, 0, 0),
          deletedAt: null,
          idempotencyKey: 'tx-4'
        }),
        // 5. Expense on UNBUDGETED category -> EXCLUDED from budget totals
        new Transaction({
          id: createTransactionId('77777777-7777-4777-8777-777777777705'),
          userId: uId,
          type: 'expense',
          amountPaise: 400000,
          currency: 'INR',
          accountId: accId,
          categoryId: createCategoryId(catDining),
          title: 'Unbudgeted Dinner',
          transactionDate: new Date(2026, 3, 18, 20, 0, 0),
          deletedAt: null,
          idempotencyKey: 'tx-5'
        })
      ];

      const budgetRepo: BudgetRepository = {
        findById: async (id) => budgetStore.get(id) ?? null,
        findByUserId: async () => Array.from(budgetStore.values()),
        findByPeriod: async (p) =>
          Array.from(budgetStore.values()).filter((b) => b.period === p),
        findByCategoryAndPeriod: async (cId, p) =>
          Array.from(budgetStore.values()).find(
            (b) => b.categoryId === cId && b.period === p
          ) ?? null,
        save: async (b) => {
          budgetStore.set(b.id, b);
        },
        delete: async (id) => {
          budgetStore.delete(id);
        }
      };

      const txRepo: TransactionRepository = {
        findMany: async () => transactions
      } as unknown as TransactionRepository;

      const catRepo: CategoryRepository = {
        findById: async (id) => sampleCategories.find((c) => c.id === id) ?? null,
        findByUserId: async () => sampleCategories,
        findAll: async () => sampleCategories,
        save: async () => {},
        saveBatch: async () => {},
        archive: async () => {},
        seedDefaults: async () => sampleCategories
      };

      const syncPort: SyncPort = {
        enqueue: async (entry) => {
          outboxEntries.push(entry);
        }
      } as unknown as SyncPort;

      const uow: UnitOfWork = {
        run: async <T,>(fn: () => Promise<T>) => fn()
      };

      const createUseCase = new CreateBudgetUseCase(budgetRepo, catRepo, syncPort, uow);
      const updateUseCase = new UpdateBudgetUseCase(budgetRepo, syncPort, uow);
      const deleteUseCase = new DeleteBudgetUseCase(budgetRepo, syncPort, uow);
      const overviewUseCase = new GetBudgetsOverviewUseCase(budgetRepo, txRepo, catRepo);

      const created = await createUseCase.execute({
        userId,
        categoryId: catGroceries,
        period,
        limitPaise: parseInrToPaise('3000.00')
      });

      const initialOverview = await overviewUseCase.execute(userId, period);
      expect(initialOverview.summary.totalBudgetLimitPaise).toBe(300000);
      expect(initialOverview.summary.totalSpentPaise).toBe(250000);
      expect(initialOverview.summary.totalRemainingPaise).toBe(50000);
      expect(initialOverview.summary.overallUtilizationPercentage).toBe(83);
      expect(initialOverview.budgets[0].utilizationPercentage).toBe(83);

      await updateUseCase.execute({
        id: created.id,
        userId,
        limitPaise: parseInrToPaise('5000.00')
      });

      const updatedOverview = await overviewUseCase.execute(userId, period);
      expect(updatedOverview.budgets[0].limitPaise).toBe(500000);
      expect(updatedOverview.budgets[0].version).toBe(2);
      expect(updatedOverview.budgets[0].utilizationPercentage).toBe(50);

      await deleteUseCase.execute(created.id, userId);

      const afterDeleteOverview = await overviewUseCase.execute(userId, period);
      expect(afterDeleteOverview.budgets).toHaveLength(0);
      // Historical transactions remain untouched
      expect(transactions).toHaveLength(5);
      expect(outboxEntries.map((e) => e.operation)).toEqual(['INSERT', 'UPDATE', 'DELETE']);
    });
  });
});

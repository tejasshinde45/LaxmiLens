import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import * as useAccountsModule from '@/features/accounts/hooks/useAccounts';
import * as useTransactionsModule from '@/features/transactions/hooks/useTransactions';
import * as useCategoriesModule from '@/features/categories/hooks/useCategories';
import * as useAccountSyncModule from '@/features/accounts/hooks/useAccountSync';
import * as useBudgetsModule from '@/features/budgets/hooks/useBudgets';
import * as useAuthModule from '@/features/auth/hooks/useAuth';
import { getCurrentBudgetPeriod } from '@/features/budgets/schemas/budgetSchemas';
import {
  BudgetsOverviewSummaryDTO,
  BudgetOverviewItemDTO
} from '@/application/dto/BudgetDTO';
import { TransactionResponseDTO } from '@/application/dto/TransactionDTO';
import { AccountWithBalanceDTO } from '@/application/dto/AccountDTO';
import { Category } from '@/domain/entities/Category';
import { Budget } from '@/domain/entities/Budget';
import { Transaction } from '@/domain/entities/Transaction';
import { BudgetRepository } from '@/domain/repositories/BudgetRepository';
import { TransactionRepository } from '@/domain/repositories/TransactionRepository';
import { CategoryRepository } from '@/domain/repositories/CategoryRepository';
import { AccountRepository } from '@/domain/repositories/AccountRepository';
import { Account } from '@/domain/entities/Account';
import { Money } from '@/domain/value-objects/Money';
import { CreateTransactionUseCase } from '@/application/use-cases/transactions/CreateTransactionUseCase';
import { GetBudgetsOverviewUseCase } from '@/application/use-cases/budgets/GetBudgetsOverviewUseCase';
import {
  createAccountId,
  createBudgetId,
  createCategoryId,
  createTransactionId,
  createUserId
} from '@/domain/value-objects/Identifiers';
import { defaultDatabaseManager } from '@/infrastructure/database/local/DatabaseManager';

describe('DashboardPage Data Integration Feature', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const mockSyncNow = vi.fn();

  const now = new Date();
  const currentMonthDateIso = new Date(now.getFullYear(), now.getMonth(), 15, 10, 0, 0).toISOString();
  const previousMonthDateIso = new Date(now.getFullYear(), now.getMonth() - 1, 15, 10, 0, 0).toISOString();

  const sampleAccounts: AccountWithBalanceDTO[] = [
    {
      id: 'acc-1',
      userId,
      name: 'Salary Account',
      accountType: 'bank',
      openingBalancePaise: 0,
      openingBalanceFormatted: '₹0.00',
      currentBalancePaise: 7275000, // ₹72,750.00
      currentBalanceFormatted: '₹72,750.00',
      currency: 'INR',
      isArchived: false,
      isCreditCard: false,
      version: 1,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    },
    {
      id: 'acc-2',
      userId,
      name: 'Wallet',
      accountType: 'wallet',
      openingBalancePaise: 0,
      openingBalanceFormatted: '₹0.00',
      currentBalancePaise: 0,
      currentBalanceFormatted: '₹0.00',
      currency: 'INR',
      isArchived: false,
      isCreditCard: false,
      version: 1,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    }
  ];

  const sampleCategories: Category[] = [
    new Category({
      id: createCategoryId('cat-salary'),
      userId: createUserId(userId),
      name: 'Salary & Wages',
      type: 'income',
      icon: 'Briefcase',
      color: '#72B895',
      isDefault: true
    }),
    new Category({
      id: createCategoryId('cat-groceries'),
      userId: createUserId(userId),
      name: 'Groceries & Household',
      type: 'expense',
      icon: 'ShoppingCart',
      color: '#D9827C',
      isDefault: true
    })
  ];

  // The 10 transactions matching the user's reported state:
  // Total Income: ₹80,000 (8,000,000 paise)
  // Total Expenses: ₹7,250 (725,000 paise)
  // Net Cash Flow: ₹72,750 (7,275,000 paise)
  const sampleTransactions: TransactionResponseDTO[] = [
    {
      id: 'tx-1',
      userId,
      type: 'income',
      amountPaise: 8000000, // ₹80,000
      amountFormatted: '₹80,000.00',
      currency: 'INR',
      accountId: 'acc-1',
      categoryId: 'cat-salary',
      title: 'Monthly Salary',
      transactionDate: currentMonthDateIso,
      isDeleted: false,
      version: 1,
      idempotencyKey: 'k-1',
      createdAt: currentMonthDateIso,
      updatedAt: currentMonthDateIso
    },
    {
      id: 'tx-2',
      userId,
      type: 'expense',
      amountPaise: 500000, // ₹5,000
      amountFormatted: '₹5,000.00',
      currency: 'INR',
      accountId: 'acc-1',
      categoryId: 'cat-groceries',
      title: 'Monthly Groceries',
      transactionDate: currentMonthDateIso,
      isDeleted: false,
      version: 1,
      idempotencyKey: 'k-2',
      createdAt: currentMonthDateIso,
      updatedAt: currentMonthDateIso
    },
    {
      id: 'tx-3',
      userId,
      type: 'expense',
      amountPaise: 225000, // ₹2,250
      amountFormatted: '₹2,250.00',
      currency: 'INR',
      accountId: 'acc-1',
      categoryId: 'cat-groceries',
      title: 'Supermarket Bill',
      transactionDate: currentMonthDateIso,
      isDeleted: false,
      version: 1,
      idempotencyKey: 'k-3',
      createdAt: currentMonthDateIso,
      updatedAt: currentMonthDateIso
    },
    // Account transfer: ₹10,000 between accounts (cashflow neutral)
    {
      id: 'tx-4',
      userId,
      type: 'transfer',
      amountPaise: 1000000, // ₹10,000
      amountFormatted: '₹10,000.00',
      currency: 'INR',
      accountId: 'acc-1',
      destinationAccountId: 'acc-2',
      title: 'Transfer to Wallet',
      transactionDate: currentMonthDateIso,
      isDeleted: false,
      version: 1,
      idempotencyKey: 'k-4',
      createdAt: currentMonthDateIso,
      updatedAt: currentMonthDateIso
    }
  ];

  beforeEach(() => {
    vi.clearAllMocks();

    vi.spyOn(useAccountsModule, 'useAccounts').mockReturnValue({
      accounts: sampleAccounts,
      summary: {
        totalNetWorthPaise: 7275000,
        totalNetWorthFormatted: '₹72,750.00',
        totalAssetsPaise: 7275000,
        totalAssetsFormatted: '₹72,750.00',
        totalLiabilitiesPaise: 0,
        totalLiabilitiesFormatted: '₹0.00',
        activeAccountsCount: 2,
        archivedAccountsCount: 0
      },
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

    vi.spyOn(useTransactionsModule, 'useTransactions').mockReturnValue({
      transactions: sampleTransactions,
      pendingTxIdSet: new Set(['tx-1']), // tx-1 is pending local sync, others synced
      summary: {
        totalCount: 4,
        totalIncomePaise: 8000000,
        totalIncomeFormatted: '₹80,000.00',
        totalExpensePaise: 725000,
        totalExpenseFormatted: '₹7,250.00',
        netCashFlowPaise: 7275000,
        netCashFlowFormatted: '₹72,750.00'
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      createTransaction: vi.fn(),
      isCreating: false,
      updateTransaction: vi.fn(),
      isUpdating: false,
      deleteTransaction: vi.fn(),
      isDeleting: false
    });

    vi.spyOn(useCategoriesModule, 'useCategories').mockReturnValue({
      categories: sampleCategories,
      incomeCategories: [sampleCategories[0]],
      expenseCategories: [sampleCategories[1]],
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
      pendingCount: 1,
      lastResult: undefined,
      isAuthenticated: true
    });

    const currentBudgetPeriod = getCurrentBudgetPeriod();
    vi.spyOn(useBudgetsModule, 'useBudgets').mockReturnValue({
      period: currentBudgetPeriod,
      summary: {
        period: currentBudgetPeriod,
        totalBudgetLimitPaise: 0,
        totalBudgetLimitFormatted: '₹0.00',
        totalSpentPaise: 0,
        totalSpentFormatted: '₹0.00',
        totalRemainingPaise: 0,
        totalRemainingFormatted: '₹0.00',
        overallUtilizationPercentage: 0,
        budgetCount: 0,
        exceededCount: 0
      },
      budgets: [],
      pendingBudgetIdSet: new Set(),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isAuthenticated: true,
      createBudget: vi.fn(),
      isCreating: false,
      updateBudget: vi.fn(),
      isUpdating: false,
      deleteBudget: vi.fn(),
      isDeleting: false
    });
  });

  it('displays accurate Net Worth derived across active accounts from the ledger', () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );

    // Net worth should display ₹72,750.00 instead of ₹0.00
    const netWorthTitle = screen.getByText('Net Worth');
    expect(netWorthTitle).toBeInTheDocument();
    const netWorthCard = netWorthTitle.closest('.space-y-2') as HTMLElement;
    expect(within(netWorthCard).getByText('₹72,750.00')).toBeInTheDocument();
    expect(within(netWorthCard).getByText('Derived across 2 active accounts')).toBeInTheDocument();
  });

  it('displays accurate Monthly Inflow and Monthly Outflow strictly for current month', () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );

    // Monthly Inflow: ₹80,000.00 (income only)
    expect(screen.getByText('Monthly Inflow')).toBeInTheDocument();
    expect(screen.getByText('₹80,000.00')).toBeInTheDocument();
    expect(screen.getByText('1 income record this month')).toBeInTheDocument();

    // Monthly Outflow: ₹7,250.00 (5,000 + 2,250)
    expect(screen.getByText('Monthly Outflow')).toBeInTheDocument();
    expect(screen.getByText('₹7,250.00')).toBeInTheDocument();
    expect(screen.getByText('2 transactions recorded')).toBeInTheDocument();
  });

  it('excludes transfers from Monthly Inflow and Monthly Outflow totals', () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );

    // The transfer of ₹10,000 must NOT be added to inflow (remains ₹80,000) or outflow (remains ₹7,250)
    expect(screen.getByText('₹80,000.00')).toBeInTheDocument();
    expect(screen.getByText('₹7,250.00')).toBeInTheDocument();
    // Outflow count is 2 (2 expenses, transfer excluded from expense count)
    expect(screen.getByText('2 transactions recorded')).toBeInTheDocument();
  });

  it('renders Recent Transactions list with transaction details instead of empty state', () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );

    // Empty state should NOT be rendered
    expect(screen.queryByText('No transactions logged yet')).not.toBeInTheDocument();

    // Recent transactions should be listed
    expect(screen.getByText('Monthly Salary')).toBeInTheDocument();
    expect(screen.getByText('Monthly Groceries')).toBeInTheDocument();
    expect(screen.getByText('Supermarket Bill')).toBeInTheDocument();
    expect(screen.getByText('Transfer to Wallet')).toBeInTheDocument();

    // Verification of formatted amounts with signs
    expect(screen.getByText('+₹80,000.00')).toBeInTheDocument();
    expect(screen.getByText('-₹5,000.00')).toBeInTheDocument();
    expect(screen.getByText('-₹2,250.00')).toBeInTheDocument();
    expect(screen.getByText('₹10,000.00')).toBeInTheDocument(); // Transfer has no + or - sign

    // Verification of sync status badges
    expect(screen.getByText('Saved Locally')).toBeInTheDocument();
    const syncedBadges = screen.getAllByText('Synced');
    expect(syncedBadges.length).toBeGreaterThanOrEqual(1);
  });

  it('displays empty state when user has zero transactions logged', () => {
    vi.spyOn(useTransactionsModule, 'useTransactions').mockReturnValue({
      transactions: [],
      pendingTxIdSet: new Set(),
      summary: {
        totalCount: 0,
        totalIncomePaise: 0,
        totalIncomeFormatted: '₹0.00',
        totalExpensePaise: 0,
        totalExpenseFormatted: '₹0.00',
        netCashFlowPaise: 0,
        netCashFlowFormatted: '₹0.00'
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      createTransaction: vi.fn(),
      isCreating: false,
      updateTransaction: vi.fn(),
      isUpdating: false,
      deleteTransaction: vi.fn(),
      isDeleting: false
    });

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );

    expect(screen.getByText('No transactions logged yet')).toBeInTheDocument();
    // Both monthly inflow and monthly outflow display ₹0.00
    expect(screen.getAllByText('₹0.00').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('0 transactions recorded')).toBeInTheDocument();
  });

  it('opens TransactionDetailModal when clicking on a recent transaction item', async () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );

    const salaryItem = screen.getByText('Monthly Salary');
    fireEvent.click(salaryItem);

    // Detail modal opens with transaction title in heading
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getAllByText('Monthly Salary').length).toBeGreaterThan(1);
    });
  });

  it('omits normal-workflow Sync Cloud / Sync Now buttons now that AutoSyncScheduler runs automatically', () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );

    expect(screen.queryByRole('button', { name: /Sync Cloud|Sync Now/i })).not.toBeInTheDocument();
  });

  it('filters out previous month transactions from monthly inflow/outflow while keeping them in recent list', () => {
    const mixedTransactions: TransactionResponseDTO[] = [
      ...sampleTransactions,
      {
        id: 'tx-old',
        userId,
        type: 'income',
        amountPaise: 5000000, // ₹50,000 from previous month
        amountFormatted: '₹50,000.00',
        currency: 'INR',
        accountId: 'acc-1',
        title: 'Previous Month Bonus',
        transactionDate: previousMonthDateIso,
        isDeleted: false,
        version: 1,
        idempotencyKey: 'k-old',
        createdAt: previousMonthDateIso,
        updatedAt: previousMonthDateIso
      }
    ];

    vi.spyOn(useTransactionsModule, 'useTransactions').mockReturnValue({
      transactions: mixedTransactions,
      pendingTxIdSet: new Set(),
      summary: {
        totalCount: 5,
        totalIncomePaise: 13000000,
        totalIncomeFormatted: '₹1,30,000.00',
        totalExpensePaise: 725000,
        totalExpenseFormatted: '₹7,250.00',
        netCashFlowPaise: 12275000,
        netCashFlowFormatted: '₹1,22,750.00'
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      createTransaction: vi.fn(),
      isCreating: false,
      updateTransaction: vi.fn(),
      isUpdating: false,
      deleteTransaction: vi.fn(),
      isDeleting: false
    });

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );

    // Monthly Inflow card must ONLY count current month income (₹80,000.00, not ₹1,30,000.00)
    expect(screen.getByText('₹80,000.00')).toBeInTheDocument();
    expect(screen.queryByText('₹1,30,000.00')).not.toBeInTheDocument();

    // But Recent Transactions still includes the active transactions
    expect(screen.getByText('Monthly Salary')).toBeInTheDocument();
  });

  it('omits Security & Storage and Dev Recovery UI and renders all 4 summary cards equally across the desktop row', () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );

    // Security & Storage card and internal IndexedDB copy must remain hidden
    expect(screen.queryByText('Security & Storage')).not.toBeInTheDocument();
    expect(screen.queryByText('IndexedDB Active')).not.toBeInTheDocument();
    expect(screen.queryByText('Local & cloud ledger in sync')).not.toBeInTheDocument();

    // Developer recovery dialog/panel must remain hidden
    expect(screen.queryByText(/Controlled Account Lifecycle Recovery/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /dev recovery/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/DEV ONLY/i)).not.toBeInTheDocument();

    // Desktop summary grid displays all 4 cards equally with no empty slot
    const netWorthTitle = screen.getByText('Net Worth');
    const summaryGrid = netWorthTitle.closest('.grid');
    expect(summaryGrid).not.toBeNull();
    expect(summaryGrid).toHaveClass('grid-cols-1', 'sm:grid-cols-2', 'lg:grid-cols-4', 'gap-4');
    expect(summaryGrid?.children).toHaveLength(4);

    expect(screen.getByText('Monthly Inflow')).toBeInTheDocument();
    expect(screen.getByText('Monthly Outflow')).toBeInTheDocument();
    expect(screen.getByText('Cash & Bank Balance')).toBeInTheDocument();
  });

  it('calculates Cash & Bank Balance from active cash and bank accounts while excluding liabilities and archived accounts', async () => {
    const { GetAccountsWithBalanceUseCase } = await import(
      '@/application/use-cases/accounts/GetAccountsWithBalanceUseCase'
    );

    const activeBank = new Account({
      id: createAccountId('10000000-0000-4000-8000-000000000001'),
      userId: createUserId(userId),
      name: 'HDFC Salary',
      accountType: 'bank',
      openingBalancePaise: 5000000, // ₹50,000.00
      isArchived: false
    });
    const activeSavings = new Account({
      id: createAccountId('10000000-0000-4000-8000-000000000002'),
      userId: createUserId(userId),
      name: 'SBI Savings',
      accountType: 'savings',
      openingBalancePaise: 2500000, // ₹25,000.00
      isArchived: false
    });
    const activeCash = new Account({
      id: createAccountId('10000000-0000-4000-8000-000000000003'),
      userId: createUserId(userId),
      name: 'Physical Cash',
      accountType: 'cash',
      openingBalancePaise: 500000, // ₹5,000.00
      isArchived: false
    });
    const creditCard = new Account({
      id: createAccountId('10000000-0000-4000-8000-000000000004'),
      userId: createUserId(userId),
      name: 'Credit Card',
      accountType: 'credit_card',
      openingBalancePaise: -1500000, // -₹15,000.00 (excluded)
      isArchived: false
    });
    const personalBorrowings = new Account({
      id: createAccountId('10000000-0000-4000-8000-000000000005'),
      userId: createUserId(userId),
      name: 'Personal Borrowings',
      accountType: 'other',
      systemTag: 'personal_borrowings',
      openingBalancePaise: -1000000, // -₹10,000.00 (excluded)
      isArchived: false
    });
    const loanLiability = new Account({
      id: createAccountId('10000000-0000-4000-8000-000000000006'),
      userId: createUserId(userId),
      name: 'Car Loan',
      accountType: 'other',
      openingBalancePaise: 4000000, // excluded non-cash/bank account
      isArchived: false
    });
    const digitalWallet = new Account({
      id: createAccountId('10000000-0000-4000-8000-000000000007'),
      userId: createUserId(userId),
      name: 'Paytm Wallet',
      accountType: 'wallet',
      openingBalancePaise: 200000, // ₹2,000.00 (excluded non-cash/bank)
      isArchived: false
    });
    const archivedBank = new Account({
      id: createAccountId('10000000-0000-4000-8000-000000000008'),
      userId: createUserId(userId),
      name: 'Old Closed Bank',
      accountType: 'bank',
      openingBalancePaise: 9000000, // ₹90,000.00 (excluded archived)
      isArchived: true
    });

    const accountsStore = [
      activeBank,
      activeSavings,
      activeCash,
      creditCard,
      personalBorrowings,
      loanLiability,
      digitalWallet,
      archivedBank
    ];
    const txStore: Transaction[] = [
      new Transaction({
        id: createTransactionId('20000000-0000-4000-8000-000000000001'),
        userId: createUserId(userId),
        type: 'expense',
        amountPaise: 100000, // -₹1,000.00 on Physical Cash -> ₹4,000.00
        accountId: activeCash.id,
        title: 'Cash Groceries',
        transactionDate: now,
        idempotencyKey: 'idem-cash-1'
      })
    ];

    const fakeAccountRepo: AccountRepository = {
      findById: async (id) => accountsStore.find((a) => a.id === id) ?? null,
      findByUserId: async () => accountsStore,
      save: async () => {},
      update: async () => {},
      archive: async () => {}
    };
    const fakeTxRepo: TransactionRepository = {
      findById: async () => null,
      findByIdempotencyKey: async () => null,
      findMany: async () => txStore,
      save: async () => {},
      update: async () => {},
      softDelete: async () => {}
    };

    const accountsUseCase = new GetAccountsWithBalanceUseCase(fakeAccountRepo, fakeTxRepo);
    const derivedAccounts = await accountsUseCase.execute(userId, true);
    const computedSummary = useAccountsModule.computeCashAndBankBalance(derivedAccounts);

    // Expect ₹50,000 (bank) + ₹25,000 (savings) + ₹4,000 (cash after expense) = ₹79,000.00 across 3 accounts
    expect(computedSummary.balancePaise).toBe(7900000);
    expect(computedSummary.formattedBalance).toBe('₹79,000.00');
    expect(computedSummary.accountCount).toBe(3);

    vi.spyOn(useAccountsModule, 'useAccounts').mockReturnValue({
      accounts: derivedAccounts,
      summary: {
        totalNetWorthPaise: 9600000,
        totalNetWorthFormatted: '₹96,000.00',
        totalAssetsPaise: 12100000,
        totalAssetsFormatted: '₹1,21,000.00',
        totalLiabilitiesPaise: 2500000,
        totalLiabilitiesFormatted: '₹25,000.00',
        activeAccountsCount: 7,
        archivedAccountsCount: 1
      },
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

    const { rerender } = render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );

    const cardEl = screen.getByText('Cash & Bank Balance').closest('.space-y-2') as HTMLElement;
    expect(within(cardEl).getByText('₹79,000.00')).toBeInTheDocument();
    expect(within(cardEl).getByText('Across 3 active cash & bank accounts')).toBeInTheDocument();

    // Add bank income (+₹11,000.00) and recompute via GetAccountsWithBalanceUseCase -> ₹90,000.00
    txStore.push(
      new Transaction({
        id: createTransactionId('20000000-0000-4000-8000-000000000002'),
        userId: createUserId(userId),
        type: 'income',
        amountPaise: 1100000,
        accountId: activeBank.id,
        title: 'Freelance Payout',
        transactionDate: now,
        idempotencyKey: 'idem-bank-2'
      })
    );
    const updatedDerivedAccounts = await accountsUseCase.execute(userId, true);

    vi.spyOn(useAccountsModule, 'useAccounts').mockReturnValue({
      accounts: updatedDerivedAccounts,
      summary: {
        totalNetWorthPaise: 10700000,
        totalNetWorthFormatted: '₹1,07,000.00',
        totalAssetsPaise: 13200000,
        totalAssetsFormatted: '₹1,32,000.00',
        totalLiabilitiesPaise: 2500000,
        totalLiabilitiesFormatted: '₹25,000.00',
        activeAccountsCount: 7,
        archivedAccountsCount: 1
      },
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

    rerender(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );

    const updatedCardEl = screen.getByText('Cash & Bank Balance').closest('.space-y-2') as HTMLElement;
    expect(within(updatedCardEl).getByText('₹90,000.00')).toBeInTheDocument();
  });
});

describe('Phase 6: Dashboard Budget Intelligence & Integration', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const currentPeriod = getCurrentBudgetPeriod();
  const catGroceries = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  const catDining = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
  const catFuel = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
  const catUtilities = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
  const catShopping = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5';

  const mockSummary: BudgetsOverviewSummaryDTO = {
    period: currentPeriod,
    totalBudgetLimitPaise: 3000000,
    totalBudgetLimitFormatted: '₹30,000.00',
    totalSpentPaise: 2450000,
    totalSpentFormatted: '₹24,500.00',
    totalRemainingPaise: 550000,
    totalRemainingFormatted: '₹5,500.00',
    overallUtilizationPercentage: 82,
    budgetCount: 5,
    exceededCount: 2
  };

  const fiveBudgets: BudgetOverviewItemDTO[] = [
    {
      budgetId: 'b-1',
      userId,
      categoryId: catUtilities,
      categoryName: 'Utilities & Bills',
      categoryIcon: 'Zap',
      categoryColor: '#82A9CF',
      categoryIsArchived: false,
      period: currentPeriod,
      limitPaise: 500000,
      limitFormatted: '₹5,000.00',
      spentPaise: 150000,
      spentFormatted: '₹1,500.00',
      remainingPaise: 350000,
      remainingFormatted: '₹3,500.00',
      utilizationPercentage: 30,
      isExceeded: false,
      version: 1,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z'
    },
    {
      budgetId: 'b-2',
      userId,
      categoryId: catDining,
      categoryName: 'Food & Dining Out',
      categoryIcon: 'Utensils',
      categoryColor: '#E4B66D',
      categoryIsArchived: false,
      period: currentPeriod,
      limitPaise: 500000,
      limitFormatted: '₹5,000.00',
      spentPaise: 400000,
      spentFormatted: '₹4,000.00',
      remainingPaise: 100000,
      remainingFormatted: '₹1,000.00',
      utilizationPercentage: 80, // Exactly 80% warning boundary
      isExceeded: false,
      version: 1,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-05T00:00:00.000Z'
    },
    {
      budgetId: 'b-3',
      userId,
      categoryId: catFuel,
      categoryName: 'Transport & Fuel',
      categoryIcon: 'Car',
      categoryColor: '#D9827C',
      categoryIsArchived: false,
      period: currentPeriod,
      limitPaise: 500000,
      limitFormatted: '₹5,000.00',
      spentPaise: 500000,
      spentFormatted: '₹5,000.00',
      remainingPaise: 0,
      remainingFormatted: '₹0.00',
      utilizationPercentage: 100, // Exact 100% exceeded boundary
      isExceeded: false,
      version: 1,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-06T00:00:00.000Z'
    },
    {
      budgetId: 'b-4',
      userId,
      categoryId: catGroceries,
      categoryName: 'Groceries & Household',
      categoryIcon: 'ShoppingCart',
      categoryColor: '#D9827C',
      categoryIsArchived: false,
      period: currentPeriod,
      limitPaise: 1000000,
      limitFormatted: '₹10,000.00',
      spentPaise: 1200000,
      spentFormatted: '₹12,000.00',
      remainingPaise: 0,
      remainingFormatted: '₹0.00',
      utilizationPercentage: 120,
      isExceeded: true,
      version: 1,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-08T00:00:00.000Z'
    },
    {
      budgetId: 'b-5',
      userId,
      categoryId: catShopping,
      categoryName: 'Shopping & Apparel',
      categoryIcon: 'ShoppingBag',
      categoryColor: '#72B895',
      categoryIsArchived: false,
      period: currentPeriod,
      limitPaise: 500000,
      limitFormatted: '₹5,000.00',
      spentPaise: 200000,
      spentFormatted: '₹2,000.00',
      remainingPaise: 300000,
      remainingFormatted: '₹3,000.00',
      utilizationPercentage: 40,
      isExceeded: false,
      version: 1,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-09T00:00:00.000Z'
    }
  ];

  function setupDashboardMocks(budgetOverrides?: Partial<ReturnType<typeof useBudgetsModule.useBudgets>>) {
    vi.spyOn(useAccountsModule, 'useAccounts').mockReturnValue({
      accounts: [],
      summary: {
        totalNetWorthPaise: 0,
        totalNetWorthFormatted: '₹0.00',
        totalAssetsPaise: 0,
        totalAssetsFormatted: '₹0.00',
        totalLiabilitiesPaise: 0,
        totalLiabilitiesFormatted: '₹0.00',
        activeAccountsCount: 0,
        archivedAccountsCount: 0
      },
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

    vi.spyOn(useTransactionsModule, 'useTransactions').mockReturnValue({
      transactions: [],
      pendingTxIdSet: new Set(),
      summary: {
        totalCount: 0,
        totalIncomePaise: 0,
        totalIncomeFormatted: '₹0.00',
        totalExpensePaise: 0,
        totalExpenseFormatted: '₹0.00',
        netCashFlowPaise: 0,
        netCashFlowFormatted: '₹0.00'
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      createTransaction: vi.fn(),
      isCreating: false,
      updateTransaction: vi.fn(),
      isUpdating: false,
      deleteTransaction: vi.fn(),
      isDeleting: false
    } as any);

    vi.spyOn(useCategoriesModule, 'useCategories').mockReturnValue({
      categories: [],
      incomeCategories: [],
      expenseCategories: [],
      categoryMap: new Map(),
      getCategoryById: () => undefined,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn()
    });

    vi.spyOn(useAccountSyncModule, 'useAccountSync').mockReturnValue({
      syncNow: vi.fn(),
      isSyncing: false,
      pendingCount: 0,
      lastResult: undefined,
      isAuthenticated: true
    });

    vi.spyOn(useBudgetsModule, 'useBudgets').mockReturnValue({
      period: currentPeriod,
      summary: mockSummary,
      budgets: fiveBudgets,
      pendingBudgetIdSet: new Set(),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isAuthenticated: true,
      createBudget: vi.fn(),
      isCreating: false,
      updateBudget: vi.fn(),
      isUpdating: false,
      deleteBudget: vi.fn(),
      isDeleting: false,
      ...budgetOverrides
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Dashboard Budget Overview, INR metrics, 80% Warning, 100%+ Exceeded, overspent amounts, and caps insights at 4', () => {
    setupDashboardMocks();

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );

    const budgetSection = screen.getByRole('region', { name: /budget overview/i });

    // Summary metrics in INR
    expect(within(budgetSection).getByText('₹30,000.00')).toBeInTheDocument();
    expect(within(budgetSection).getByText('₹24,500.00')).toBeInTheDocument();
    expect(within(budgetSection).getByText('₹5,500.00')).toBeInTheDocument();
    expect(within(budgetSection).getByText('82%')).toBeInTheDocument();
    expect(within(budgetSection).getByText('5 budgets configured')).toBeInTheDocument();
    expect(within(budgetSection).getByText('2 exceeded')).toBeInTheDocument();

    // Non-intrusive threshold banner
    const statusBanner = within(budgetSection).getByRole('status');
    expect(statusBanner).toHaveTextContent(
      /2 category budgets exceeded • 1 category budget at 80%\+ threshold/i
    );

    // Compact list limited to top 4 highest-risk budgets (Utilities 30% omitted when 5 exist)
    expect(within(budgetSection).getByText('Showing top 4 of 5 budgets')).toBeInTheDocument();
    expect(within(budgetSection).getByText('Groceries & Household')).toBeInTheDocument();
    expect(within(budgetSection).getByText('Transport & Fuel')).toBeInTheDocument();
    expect(within(budgetSection).getByText('Food & Dining Out')).toBeInTheDocument();
    expect(within(budgetSection).getByText('Shopping & Apparel')).toBeInTheDocument();
    expect(within(budgetSection).queryByText('Utilities & Bills')).not.toBeInTheDocument();

    // Status classifications & overspent / remaining copy
    expect(within(budgetSection).getAllByText('Exceeded')).toHaveLength(2);
    expect(within(budgetSection).getAllByText('Warning').length).toBeGreaterThanOrEqual(2); // overall 82% + Food 80%
    expect(within(budgetSection).getByText('Normal')).toBeInTheDocument();
    expect(within(budgetSection).getByText('Over by ₹2,000.00')).toBeInTheDocument();
    expect(within(budgetSection).getByText('Remaining ₹0.00')).toBeInTheDocument();
    expect(within(budgetSection).getByText('Remaining ₹1,000.00')).toBeInTheDocument();
    expect(within(budgetSection).getByText('Remaining ₹3,000.00')).toBeInTheDocument();

    // Progress bars & View All Budgets link to /budgets
    expect(within(budgetSection).getAllByRole('progressbar')).toHaveLength(4);
    const viewAllLink = within(budgetSection).getByRole('link', { name: /view all budgets/i });
    expect(viewAllLink).toHaveAttribute('href', '/budgets');
  });

  it('renders clean empty budget state and navigates to /budgets when clicking Set Up Budget', () => {
    setupDashboardMocks({
      budgets: [],
      summary: {
        period: currentPeriod,
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

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/budgets" element={<div>Budgets Destination Route</div>} />
        </Routes>
      </MemoryRouter>
    );

    const budgetSection = screen.getByRole('region', { name: /budget overview/i });
    expect(within(budgetSection).getByText(/No monthly budgets for/i)).toBeInTheDocument();

    fireEvent.click(within(budgetSection).getByRole('button', { name: /set up budget/i }));
    expect(screen.getByText('Budgets Destination Route')).toBeInTheDocument();
  });

  it('renders loading skeleton and error state with Retry action in Dashboard Budget Overview', () => {
    const mockRetry = vi.fn();
    setupDashboardMocks({ isLoading: true });

    const { unmount } = render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );

    expect(screen.getByLabelText('Loading budget overview')).toBeInTheDocument();
    unmount();

    setupDashboardMocks({
      isError: true,
      error: new Error('Budget store offline read failed'),
      refetch: mockRetry
    });

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );

    expect(screen.getByText('Unable to load monthly budget overview')).toBeInTheDocument();
    expect(screen.getByText('Budget store offline read failed')).toBeInTheDocument();

    const budgetSection = screen.getByRole('region', { name: /budget overview/i });
    fireEvent.click(within(budgetSection).getByRole('button', { name: /retry/i }));
    expect(mockRetry).toHaveBeenCalledTimes(1);
  });

  it('reads offline local budgets and automatically refreshes Dashboard insights after transaction mutations via cache invalidation', async () => {
    vi.restoreAllMocks();

    const uId = createUserId(userId);
    const accId = createAccountId('99999999-9999-4999-8999-999999999901');
    const grocCatId = createCategoryId(catGroceries);
    const now = new Date();
    const period = getCurrentBudgetPeriod(now);

    const account = new Account({
      id: accId,
      userId: uId,
      name: 'Primary Bank',
      accountType: 'bank',
      openingBalance: Money.fromPaise(1000000),
      currency: 'INR',
      isArchived: false
    });

    const groceryCategory = new Category({
      id: grocCatId,
      userId: uId,
      name: 'Groceries & Household',
      type: 'expense',
      icon: 'ShoppingCart',
      color: '#D9827C'
    });

    const initialBudget = new Budget({
      id: createBudgetId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01'),
      userId: uId,
      categoryId: grocCatId,
      period,
      limitPaise: 100000 // ₹1,000.00
    });

    const txStore: Transaction[] = [
      new Transaction({
        id: createTransactionId('77777777-7777-4777-8777-777777777701'),
        userId: uId,
        type: 'expense',
        amountPaise: 40000, // ₹400.00 (40% Normal initially)
        currency: 'INR',
        accountId: accId,
        categoryId: grocCatId,
        title: 'Initial Market Run',
        transactionDate: new Date(now.getFullYear(), now.getMonth(), 5, 12, 0, 0),
        deletedAt: null,
        idempotencyKey: 'k-init'
      })
    ];

    const budgetRepo: BudgetRepository = {
      findById: async (id) => (id === initialBudget.id ? initialBudget : null),
      findByUserId: async () => [initialBudget],
      findByPeriod: async (p) => (p === period ? [initialBudget] : []),
      findByCategoryAndPeriod: async (c, p) =>
        c === grocCatId && p === period ? initialBudget : null,
      save: async () => {},
      delete: async () => {}
    };

    const txRepo: TransactionRepository = {
      findByIdempotencyKey: async (key) =>
        txStore.find((t) => t.idempotencyKey === key) ?? null,
      findMany: async () => txStore,
      save: async (tx) => {
        txStore.push(tx);
      }
    } as unknown as TransactionRepository;

    const catRepo: CategoryRepository = {
      findById: async (id) => (id === grocCatId ? groceryCategory : null),
      findByUserId: async () => [groceryCategory],
      findAll: async () => [groceryCategory],
      save: async () => {},
      saveBatch: async () => {},
      archive: async () => {},
      seedDefaults: async () => [groceryCategory]
    };

    const accRepo: AccountRepository = {
      findById: async (id) => (id === accId ? account : null)
    } as unknown as AccountRepository;

    const syncPort = {
      enqueue: vi.fn().mockResolvedValue(undefined),
      getPendingEntries: vi.fn().mockResolvedValue([])
    };

    const uow = {
      run: async <T,>(fn: () => Promise<T>) => fn()
    };

    const getBudgetsOverviewUseCase = new GetBudgetsOverviewUseCase(
      budgetRepo,
      txRepo,
      catRepo
    );
    const createTransactionUseCase = new CreateTransactionUseCase(
      txRepo,
      accRepo,
      catRepo,
      syncPort as any,
      uow
    );

    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
      user: { id: userId, email: 'offline@laxmilens.app' },
      isAuthenticated: true,
      isLoading: false
    } as any);

    vi.spyOn(defaultDatabaseManager, 'getActiveRepositories').mockResolvedValue({
      getBudgetsOverviewUseCase,
      createTransactionUseCase,
      getTransactionsUseCase: { execute: async () => [] },
      getAccountsUseCase: { execute: async () => [] },
      outboxManager: syncPort,
      categoryRepo: catRepo,
      syncCoordinator: { getPendingCount: async () => 0 }
    } as any);

    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });

    const OfflineDashboardHarness: React.FC = () => {
      const { createTransaction } = useTransactionsModule.useTransactions(qc);
      const { period: p, summary, budgets, isLoading } = useBudgetsModule.useBudgets(period, qc);
      const navigate = () => {};

      return (
        <div>
          <button
            type="button"
            onClick={() =>
              createTransaction({
                type: 'expense',
                amount: '450',
                title: 'Extra Groceries',
                accountId: accId,
                categoryId: grocCatId,
                transactionDate: new Date(now.getFullYear(), now.getMonth(), 10, 12, 0, 0).toISOString()
              })
            }
          >
            Add Expense Mutation
          </button>
          <DashboardPageHarnessView
            period={p}
            summary={summary}
            budgets={budgets}
            isLoading={isLoading}
            onNavigate={navigate}
          />
        </div>
      );
    };

    const DashboardPageHarnessView: React.FC<{
      period: string;
      summary: BudgetsOverviewSummaryDTO;
      budgets: BudgetOverviewItemDTO[];
      isLoading: boolean;
      onNavigate: () => void;
    }> = ({ period: p, summary, budgets, isLoading, onNavigate }) => (
      <DashboardPageMockedSectionWrapper
        period={p}
        summary={summary}
        budgets={budgets}
        isLoading={isLoading}
        onNavigate={onNavigate}
      />
    );

    const { DashboardBudgetSection } = await import(
      '@/features/dashboard/components/DashboardBudgetSection'
    );

    const DashboardPageMockedSectionWrapper: React.FC<{
      period: string;
      summary: BudgetsOverviewSummaryDTO;
      budgets: BudgetOverviewItemDTO[];
      isLoading: boolean;
      onNavigate: () => void;
    }> = ({ period: p, summary, budgets, isLoading, onNavigate }) => (
      <DashboardBudgetSection
        period={p}
        summary={summary}
        budgets={budgets}
        isLoading={isLoading}
        onNavigateToBudgets={onNavigate}
      />
    );

    render(
      <MemoryRouter>
        <QueryClientProvider client={qc}>
          <OfflineDashboardHarness />
        </QueryClientProvider>
      </MemoryRouter>
    );

    // Offline local state loaded: ₹400 of ₹1,000 -> 40% Normal, Remaining ₹600.00
    await waitFor(() => {
      expect(screen.getByText('Groceries & Household')).toBeInTheDocument();
      expect(screen.getAllByText('40%').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Remaining ₹600.00')).toBeInTheDocument();
    });

    // Trigger expense transaction mutation (+₹450 -> ₹850 total = 85% Warning)
    fireEvent.click(screen.getByRole('button', { name: 'Add Expense Mutation' }));

    await waitFor(() => {
      expect(screen.getAllByText('85%').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Remaining ₹150.00')).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent(
        /1 category budget at 80%\+ threshold/i
      );
    });
  });
});

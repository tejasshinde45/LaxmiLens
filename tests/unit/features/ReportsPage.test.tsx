import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReportsPage } from '@/features/reports/ReportsPage';
import { GenerateFinancialReportUseCase } from '@/application';
import { AccountWithBalanceDTO } from '@/application/dto/AccountDTO';
import { Account } from '@/domain/entities/Account';
import { Category } from '@/domain/entities/Category';
import { Transaction } from '@/domain/entities/Transaction';
import { AccountRepository } from '@/domain/repositories/AccountRepository';
import { CategoryRepository } from '@/domain/repositories/CategoryRepository';
import {
  TransactionFilter,
  TransactionRepository
} from '@/domain/repositories/TransactionRepository';
import {
  createAccountId,
  createCategoryId,
  createTransactionId,
  createUserId
} from '@/domain/value-objects/Identifiers';
import { defaultDatabaseManager } from '@/infrastructure/database/local/DatabaseManager';
import * as useAuthModule from '@/features/auth/hooks/useAuth';
import * as useAccountsModule from '@/features/accounts/hooks/useAccounts';
import * as useCategoriesModule from '@/features/categories/hooks/useCategories';
import * as csvExportModule from '@/features/reports/utils/csvExport';
import * as printReportModule from '@/features/reports/utils/printReport';

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn()
  }
}));

describe('ReportsPage (Phase 10 Stage 4)', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const now = new Date();
  const currMonthStart = new Date(now.getFullYear(), now.getMonth(), 3, 10, 0, 0);
  const currMonthMid = new Date(now.getFullYear(), now.getMonth(), 10, 12, 0, 0);
  const prevMonthMid = new Date(now.getFullYear(), now.getMonth() - 1, 12, 12, 0, 0);
  const postPeriodDay = new Date(now.getFullYear(), now.getMonth() + 1, 5, 10, 0, 0);

  const accBankId = createAccountId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
  const accArchivedId = createAccountId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2');
  const accCardId = createAccountId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3');
  const accBorrowingsId = createAccountId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4');

  const catSalaryId = createCategoryId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1');
  const catGroceriesId = createCategoryId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2');
  const catArchivedId = createCategoryId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3');

  const domainAccounts: Account[] = [
    new Account({
      id: accBankId,
      userId: createUserId(userId),
      name: 'HDFC Salary',
      accountType: 'bank',
      openingBalancePaise: 500000, // ₹5,000.00
      institutionName: 'HDFC Bank'
    }),
    new Account({
      id: accArchivedId,
      userId: createUserId(userId),
      name: 'Old Kotak',
      accountType: 'savings',
      openingBalancePaise: 100000,
      isArchived: true
    }),
    new Account({
      id: accCardId,
      userId: createUserId(userId),
      name: 'ICICI Card',
      accountType: 'credit_card',
      openingBalancePaise: -400000 // -₹4,000.00 card debt
    }),
    new Account({
      id: accBorrowingsId,
      userId: createUserId(userId),
      name: 'Personal Borrowings',
      accountType: 'other',
      openingBalancePaise: 0,
      systemTag: 'personal_borrowings'
    })
  ];

  const accountDTOs: AccountWithBalanceDTO[] = domainAccounts.map((acc) => ({
    id: acc.id,
    userId: acc.userId,
    name: acc.name,
    accountType: acc.accountType,
    openingBalancePaise: acc.openingBalancePaise,
    openingBalanceFormatted: acc.openingBalance.format(),
    currentBalancePaise: acc.openingBalancePaise,
    currentBalanceFormatted: acc.openingBalance.format(),
    currency: acc.currency,
    institutionName: acc.institutionName,
    systemTag: acc.systemTag,
    isArchived: acc.isArchived,
    isCreditCard: acc.isCreditCard(),
    version: acc.version,
    createdAt: acc.createdAt.toISOString(),
    updatedAt: acc.updatedAt.toISOString()
  }));

  const sampleCategories: Category[] = [
    new Category({
      id: catSalaryId,
      userId: createUserId(userId),
      name: 'Salary & Wages',
      type: 'income',
      icon: 'Briefcase',
      color: '#72B895'
    }),
    new Category({
      id: catGroceriesId,
      userId: createUserId(userId),
      name: 'Groceries',
      type: 'expense',
      icon: 'ShoppingCart',
      color: '#D9827C'
    }),
    new Category({
      id: catArchivedId,
      userId: createUserId(userId),
      name: 'Legacy Cable TV',
      type: 'expense',
      icon: 'Film',
      color: '#E4B66D',
      isArchived: true
    })
  ];

  const sampleTransactions: Transaction[] = [
    // Previous period (last month): Income ₹8,000, Expense ₹2,000 on HDFC Bank
    new Transaction({
      id: createTransactionId('tx-prev-inc'),
      userId: createUserId(userId),
      type: 'income',
      amountPaise: 800000,
      accountId: accBankId,
      categoryId: catSalaryId,
      title: 'Prior Month Salary',
      transactionDate: prevMonthMid,
      createdAt: prevMonthMid,
      idempotencyKey: 'k-prev-inc'
    }),
    new Transaction({
      id: createTransactionId('tx-prev-exp'),
      userId: createUserId(userId),
      type: 'expense',
      amountPaise: 200000,
      accountId: accBankId,
      categoryId: catGroceriesId,
      title: 'Prior Groceries',
      transactionDate: prevMonthMid,
      createdAt: prevMonthMid,
      idempotencyKey: 'k-prev-exp'
    }),
    // Current month:
    // 1) HDFC Salary +₹10,000
    new Transaction({
      id: createTransactionId('tx-cur-inc'),
      userId: createUserId(userId),
      type: 'income',
      amountPaise: 1000000,
      accountId: accBankId,
      categoryId: catSalaryId,
      title: 'Monthly Payroll',
      transactionDate: currMonthStart,
      createdAt: currMonthStart,
      idempotencyKey: 'k-cur-inc'
    }),
    // 2) HDFC Groceries -₹2,500
    new Transaction({
      id: createTransactionId('tx-cur-exp'),
      userId: createUserId(userId),
      type: 'expense',
      amountPaise: 250000,
      accountId: accBankId,
      categoryId: catGroceriesId,
      title: 'Supermarket Run',
      note: 'Weekly essentials',
      transactionDate: currMonthMid,
      createdAt: currMonthMid,
      idempotencyKey: 'k-cur-exp'
    }),
    // 3) Old Kotak Archived Expense -₹500 (Archived category & Archived account)
    new Transaction({
      id: createTransactionId('tx-cur-arch'),
      userId: createUserId(userId),
      type: 'expense',
      amountPaise: 50000,
      accountId: accArchivedId,
      categoryId: catArchivedId,
      title: 'Legacy Cable Fee',
      transactionDate: currMonthMid,
      createdAt: currMonthMid,
      idempotencyKey: 'k-cur-arch'
    }),
    // 4) Uncategorized Income +₹1,000 on HDFC
    new Transaction({
      id: createTransactionId('tx-cur-uncat'),
      userId: createUserId(userId),
      type: 'income',
      amountPaise: 100000,
      accountId: accBankId,
      categoryId: undefined,
      title: 'Cashback Credit',
      transactionDate: currMonthMid,
      createdAt: currMonthMid,
      idempotencyKey: 'k-cur-uncat'
    }),
    // 5) Transfer Personal Borrowings -> HDFC Bank ₹3,000 (excluded from income/expense)
    new Transaction({
      id: createTransactionId('tx-cur-trf-in'),
      userId: createUserId(userId),
      type: 'transfer',
      amountPaise: 300000,
      accountId: accBorrowingsId,
      destinationAccountId: accBankId,
      title: 'Borrowed Funds Transfer',
      transactionDate: currMonthMid,
      createdAt: currMonthMid,
      idempotencyKey: 'k-cur-trf-in'
    }),
    // 6) Transfer HDFC -> ICICI Card ₹1,500 (excluded from income/expense)
    new Transaction({
      id: createTransactionId('tx-cur-trf-out'),
      userId: createUserId(userId),
      type: 'transfer',
      amountPaise: 150000,
      accountId: accBankId,
      destinationAccountId: accCardId,
      title: 'Card Payment',
      transactionDate: currMonthMid,
      createdAt: currMonthMid,
      idempotencyKey: 'k-cur-trf-out'
    }),
    // 7) Post-period expense on HDFC next month -₹1,000 (to distinguish Period Closing vs Live Balance)
    new Transaction({
      id: createTransactionId('tx-post-period'),
      userId: createUserId(userId),
      type: 'expense',
      amountPaise: 100000,
      accountId: accBankId,
      categoryId: catGroceriesId,
      title: 'Future Post-Period Order',
      transactionDate: postPeriodDay,
      createdAt: postPeriodDay,
      idempotencyKey: 'k-post-period'
    })
  ];

  let testQueryClient: QueryClient;

  function buildUseCase(txs: Transaction[] = sampleTransactions, cats: Category[] = sampleCategories) {
    const accountRepo: AccountRepository = {
      findById: async (id) => domainAccounts.find((a) => a.id === id) ?? null,
      findByUserId: async () => domainAccounts,
      findAll: async () => domainAccounts,
      save: async () => {},
      saveBatch: async () => {},
      archive: async () => {},
      restore: async () => {}
    };
    const transactionRepo: TransactionRepository = {
      findById: async () => null,
      findByIdempotencyKey: async () => null,
      findByAccount: async () => [],
      findMany: async (f: TransactionFilter) =>
        txs.filter((t) => t.userId === f.userId && (f.includeDeleted || !t.isDeleted)),
      save: async () => {},
      saveBatch: async () => {},
      softDelete: async () => {}
    };
    const categoryRepo: CategoryRepository = {
      findById: async (id) => cats.find((c) => c.id === id) ?? null,
      findByUserId: async () => cats,
      findAll: async () => cats,
      save: async () => {},
      saveBatch: async () => {},
      archive: async () => {},
      seedDefaults: async () => []
    };
    return new GenerateFinancialReportUseCase(accountRepo, transactionRepo, categoryRepo);
  }

  function setupMocks(opts?: {
    transactions?: Transaction[];
    accountsLoading?: boolean;
    accountsError?: boolean;
    reportUseCase?: GenerateFinancialReportUseCase;
    refetchAccounts?: () => Promise<void>;
    accountsList?: AccountWithBalanceDTO[];
  }) {
    const useCase = opts?.reportUseCase ?? buildUseCase(opts?.transactions ?? sampleTransactions);

    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
      user: { id: userId, email: 'reports@laxmilens.app' },
      isAuthenticated: true,
      isLoading: false
    } as any);

    vi.spyOn(useAccountsModule, 'useAccounts').mockReturnValue({
      accounts: opts?.accountsList ?? accountDTOs,
      summary: {
        totalNetWorthPaise: 0,
        totalNetWorthFormatted: '₹0.00',
        totalAssetsPaise: 0,
        totalAssetsFormatted: '₹0.00',
        totalLiabilitiesPaise: 0,
        totalLiabilitiesFormatted: '₹0.00',
        activeAccountsCount: 3,
        archivedAccountsCount: 1
      },
      isLoading: opts?.accountsLoading ?? false,
      isError: opts?.accountsError ?? false,
      error: opts?.accountsError ? new Error('IndexedDB unavailable') : null,
      refetch: opts?.refetchAccounts ?? vi.fn().mockResolvedValue(undefined),
      createAccount: vi.fn(),
      isCreating: false,
      updateAccount: vi.fn(),
      isUpdating: false,
      archiveAccount: vi.fn(),
      isArchiving: false,
      restoreAccount: vi.fn(),
      isRestoring: false
    });

    vi.spyOn(useCategoriesModule, 'useCategories').mockReturnValue({
      categories: sampleCategories,
      incomeCategories: sampleCategories.filter((c) => c.type === 'income' && !c.isArchived),
      expenseCategories: sampleCategories.filter((c) => c.type === 'expense' && !c.isArchived),
      categoryMap: new Map(sampleCategories.map((c) => [c.id, c])),
      getCategoryById: (id?: string | null) => sampleCategories.find((c) => c.id === id),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined)
    });

    vi.spyOn(defaultDatabaseManager, 'getActiveRepositories').mockResolvedValue({
      generateFinancialReportUseCase: useCase
    } as any);

    return { useCase };
  }

  function renderPage() {
    return render(
      <QueryClientProvider client={testQueryClient}>
        <MemoryRouter initialEntries={['/reports']}>
          <ReportsPage />
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    testQueryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false }
      }
    });
  });

  it('renders Financial Summary using DTOs, preserves transfer neutrality, and reveals Transfer KPIs when filtered by account', async () => {
    setupMocks();
    renderPage();

    // Global Summary: Income ₹11,000.00 (10,000 + 1,000), Expense ₹3,000.00 (2,500 + 500), Net ₹8,000.00
    expect((await screen.findAllByText('₹11,000.00')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('₹3,000.00').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('₹8,000.00').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/excluded from Income, Expenses, and Net Cash Flow/i)).toBeInTheDocument();

    // Verify archived account and Personal Borrowings system account are clearly selectable
    const accountSelect = screen.getByLabelText('Account Scope') as HTMLSelectElement;
    expect(accountSelect.innerHTML).toContain('Old Kotak (savings • Archived)');
    expect(accountSelect.innerHTML).toContain('Personal Borrowings (other • Liability / System)');

    // Filter by HDFC Salary account -> reveals Account Transfers section (In ₹3,000, Out ₹1,500, Net ₹1,500, Vol ₹4,500)
    fireEvent.change(accountSelect, { target: { value: accBankId } });

    const transferHeading = await screen.findByText('Account Transfers (Excluded from Cash Flow)');
    expect(transferHeading).toBeInTheDocument();
    const transferCard = transferHeading.closest('[class*="rounded"]') as HTMLElement;
    expect(within(transferCard).getByText('Transfers In')).toBeInTheDocument();
    expect(within(transferCard).getByText('Transfers Out')).toBeInTheDocument();
    expect(within(transferCard).getByText('Net Transfers')).toBeInTheDocument();
    expect(within(transferCard).getByText('Total Transfer Volume')).toBeInTheDocument();
    expect(within(transferCard).getByText('₹4,500.00')).toBeInTheDocument();
  });

  it('switches to Account Statement, renders opening/closing/live balances, sub-filter notice, counterparty names, and credit-card liability', async () => {
    setupMocks();
    renderPage();

    await screen.findAllByText('₹11,000.00');

    // Radix Tabs respond cleanly to mouseDown/click across environments
    const statementTab = screen.getByRole('tab', { name: /Account Statement/i });
    fireEvent.mouseDown(statementTab);
    fireEvent.click(statementTab);

    // HDFC Salary:
    // Opening (Period Start) = 500,000 + 800,000 - 200,000 = ₹11,000.00
    // In-period: +10,000 + 1,000 + 3,000 (trf in) - 2,500 - 1,500 (trf out) = +₹10,000 -> Closing ₹21,000.00
    // Post-period: -1,000 -> Current Live Balance ₹20,000.00
    expect(await screen.findByText('Chronological Ledger')).toBeInTheDocument();
    expect(screen.getAllByText('₹21,000.00').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('₹20,000.00').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Transfer from Personal Borrowings/i)).toBeInTheDocument();
    expect(screen.getByText(/Transfer to ICICI Card/i)).toBeInTheDocument();
    expect(screen.getByText(/Current Live Balance today/i)).toBeInTheDocument();

    // Filter by Expense Only inside Account Statement -> sub-filtered notice appears while closing balance stays ₹21,000.00
    const typeSelect = screen.getByLabelText('Transaction Type');
    fireEvent.change(typeSelect, { target: { value: 'expense' } });

    expect(await screen.findByRole('note')).toHaveTextContent(
      /Displayed ledger rows are sub-filtered \(1 of 5 period entries shown\)/i
    );
    expect(screen.getAllByText('₹21,000.00').length).toBeGreaterThanOrEqual(1);

    // Switch statement account to ICICI Card -> verify negative credit-card liability badges & semantics note
    fireEvent.change(typeSelect, { target: { value: 'all' } });
    const stmtAccountSelect = screen.getByLabelText('Statement Account');
    fireEvent.change(stmtAccountSelect, { target: { value: accCardId } });

    expect(await screen.findByText('Amount Owed')).toBeInTheDocument();
    expect(screen.getByText(/Negative credit-card balance represents amount owed/i)).toBeInTheDocument();
  });

  it('switches to Category Report, displays separate Expense & Income breakdowns, archived category badges, and uncategorized items', async () => {
    setupMocks();
    renderPage();

    await screen.findAllByText('₹11,000.00');

    const categoryTab = screen.getByRole('tab', { name: /Category Report/i });
    fireEvent.mouseDown(categoryTab);
    fireEvent.click(categoryTab);

    expect(await screen.findByText('Expense Categories')).toBeInTheDocument();
    expect(screen.getByText('Income Categories')).toBeInTheDocument();
    expect(screen.getByText('Legacy Cable TV')).toBeInTheDocument();
    expect(screen.getAllByText('Archived').length).toBeGreaterThanOrEqual(1);
    const incomeTable = screen.getByText('Income Categories').closest('[class*="rounded"]') as HTMLElement;
    expect(within(incomeTable).getAllByText('Uncategorized').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Transfers Excluded/i)).toBeInTheDocument();

    // Reset filters test after applying search filter
    const searchInput = screen.getByLabelText('Search report transactions');
    fireEvent.change(searchInput, { target: { value: 'Supermarket' } });

    const resetBtn = await screen.findByRole('button', { name: /Reset Filters/i });
    fireEvent.click(resetBtn);

    await waitFor(() => {
      expect((screen.getByLabelText('Search report transactions') as HTMLInputElement).value).toBe(
        ''
      );
    });
  });

  it('triggers the matching CSV export adapter and printReport across all three tabs and renders PrintableReportHeader in .report-print-root', async () => {
    setupMocks();
    const downloadCsvSpy = vi.spyOn(csvExportModule, 'downloadCsv').mockImplementation(() => {});
    const buildSummarySpy = vi.spyOn(csvExportModule, 'buildFinancialSummaryCsv');
    const buildStmtSpy = vi.spyOn(csvExportModule, 'buildAccountStatementCsv');
    const buildCatSpy = vi.spyOn(csvExportModule, 'buildCategoryReportCsv');
    const printSpy = vi.spyOn(printReportModule, 'printReport').mockImplementation(() => {});

    const { container } = renderPage();
    await screen.findAllByText('₹11,000.00');

    expect(container.querySelector('.report-print-root')).not.toBeNull();
    expect(screen.getByText('Financial Summary Report')).toBeInTheDocument();

    // Summary CSV & Print
    fireEvent.click(screen.getByRole('button', { name: /Export CSV/i }));
    expect(buildSummarySpy).toHaveBeenCalledTimes(1);
    expect(downloadCsvSpy).toHaveBeenLastCalledWith(
      expect.stringContaining('\uFEFF'),
      expect.stringMatching(/^laxmilens-financial-summary-.*\.csv$/)
    );

    fireEvent.click(screen.getByRole('button', { name: /Print \/ Save as PDF/i }));
    expect(printSpy).toHaveBeenLastCalledWith(
      expect.stringContaining('LaxmiLens Financial Summary')
    );

    // Account Statement CSV & Print
    const stmtTab = screen.getByRole('tab', { name: /Account Statement/i });
    fireEvent.mouseDown(stmtTab);
    fireEvent.click(stmtTab);
    await screen.findByText('Chronological Ledger');

    fireEvent.click(screen.getByRole('button', { name: /Export CSV/i }));
    expect(buildStmtSpy).toHaveBeenCalledTimes(1);
    expect(downloadCsvSpy).toHaveBeenLastCalledWith(
      expect.stringContaining('\uFEFF'),
      expect.stringMatching(/^laxmilens-statement-HDFC Salary-.*\.csv$/)
    );

    fireEvent.click(screen.getByRole('button', { name: /Print \/ Save as PDF/i }));
    expect(printSpy).toHaveBeenLastCalledWith(
      expect.stringContaining('LaxmiLens Account Statement - HDFC Salary')
    );

    // Category Report CSV & Print
    const catTab = screen.getByRole('tab', { name: /Category Report/i });
    fireEvent.mouseDown(catTab);
    fireEvent.click(catTab);
    await screen.findByText('Expense Categories');

    fireEvent.click(screen.getByRole('button', { name: /Export CSV/i }));
    expect(buildCatSpy).toHaveBeenCalledTimes(1);
    expect(downloadCsvSpy).toHaveBeenLastCalledWith(
      expect.stringContaining('\uFEFF'),
      expect.stringMatching(/^laxmilens-category-report-.*\.csv$/)
    );
  });

  it('renders loading, empty, custom date-range validation, and error-with-retry states cleanly', async () => {
    // 1. Loading state
    setupMocks({ accountsLoading: true });
    const { unmount } = renderPage();
    expect(screen.getByLabelText('Loading report')).toBeInTheDocument();
    unmount();

    // 2. Error state + retry
    const refetchSpy = vi.fn().mockResolvedValue(undefined);
    testQueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    setupMocks({ accountsError: true, refetchAccounts: refetchSpy });
    const { unmount: unmountErr } = renderPage();
    expect(await screen.findByText('Unable to generate report')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Retry/i }));
    expect(refetchSpy).toHaveBeenCalledTimes(1);
    unmountErr();

    // 3. Empty state + invalid custom date range validation
    testQueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    setupMocks({ transactions: [] });
    renderPage();

    expect(await screen.findByText('No matching activity for this summary')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Custom Range/i }));
    const fromInput = screen.getByLabelText('From Date');
    const toInput = screen.getByLabelText('To Date');
    fireEvent.change(fromInput, { target: { value: '2026-12-20' } });
    fireEvent.change(toInput, { target: { value: '2026-12-01' } });

    expect(await screen.findByText('Invalid reporting date range')).toBeInTheDocument();
  });

  it('displays Archived and Liability / System badges inside Account Statement headers, handles Last Month preset, and handles empty account lists on Statement tab', async () => {
    setupMocks();
    const { unmount } = renderPage();
    await screen.findAllByText('₹11,000.00');

    // Preset change to Last Month loads prior month metrics (Income ₹8,000.00, Expense ₹2,000.00)
    fireEvent.click(screen.getByRole('button', { name: /Last Month/i }));
    expect((await screen.findAllByText('₹8,000.00')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('₹2,000.00').length).toBeGreaterThanOrEqual(1);

    // Switch to Account Statement and select Archived account then Personal Borrowings system account
    const stmtTab = screen.getByRole('tab', { name: /Account Statement/i });
    fireEvent.mouseDown(stmtTab);
    fireEvent.click(stmtTab);
    await screen.findByText('Chronological Ledger');

    const stmtAccountSelect = screen.getByLabelText('Statement Account');
    fireEvent.change(stmtAccountSelect, { target: { value: accArchivedId } });
    expect(await screen.findByRole('heading', { name: 'Old Kotak' })).toBeInTheDocument();
    expect(screen.getAllByText('Archived').length).toBeGreaterThanOrEqual(1);

    fireEvent.change(stmtAccountSelect, { target: { value: accBorrowingsId } });
    expect(await screen.findByRole('heading', { name: 'Personal Borrowings' })).toBeInTheDocument();
    expect(screen.getAllByText('Liability / System').length).toBeGreaterThanOrEqual(1);
    unmount();

    // Zero accounts on Statement tab renders helpful empty state instead of crashing
    testQueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    setupMocks({ accountsList: [], transactions: [] });
    renderPage();

    const emptyStmtTab = screen.getByRole('tab', { name: /Account Statement/i });
    fireEvent.mouseDown(emptyStmtTab);
    fireEvent.click(emptyStmtTab);
    expect(await screen.findByText('No accounts available for statements')).toBeInTheDocument();
  });
});

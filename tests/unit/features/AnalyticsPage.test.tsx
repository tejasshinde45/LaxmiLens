import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient as globalQueryClient } from '@/lib/queryClient';
import { AnalyticsPage } from '@/features/analytics/AnalyticsPage';
import * as useTransactionsModule from '@/features/transactions/hooks/useTransactions';
import * as useCategoriesModule from '@/features/categories/hooks/useCategories';
import * as useAuthModule from '@/features/auth/hooks/useAuth';
import { Category } from '@/domain/entities/Category';
import { TransactionResponseDTO } from '@/application/dto/TransactionDTO';
import { createCategoryId, createUserId } from '@/domain/value-objects/Identifiers';
import { defaultDatabaseManager } from '@/infrastructure/database/local/DatabaseManager';

// Polyfill ResizeObserver for Recharts ResponsiveContainer in JSDOM
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

describe('AnalyticsPage & Phase 7 UI Integration', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const catSalary = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
  const catGroceries = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
  const catDining = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3';

  const now = new Date();
  const currMonthMidIso = new Date(now.getFullYear(), now.getMonth(), 10, 12, 0, 0).toISOString();
  const prevMonthMidIso = new Date(now.getFullYear(), now.getMonth() - 1, 10, 12, 0, 0).toISOString();

  const sampleCategories: Category[] = [
    new Category({
      id: createCategoryId(catSalary),
      userId: createUserId(userId),
      name: 'Salary & Wages',
      type: 'income',
      icon: 'Briefcase',
      color: '#72B895'
    }),
    new Category({
      id: createCategoryId(catGroceries),
      userId: createUserId(userId),
      name: 'Groceries & Household',
      type: 'expense',
      icon: 'ShoppingCart',
      color: '#D9827C'
    }),
    new Category({
      id: createCategoryId(catDining),
      userId: createUserId(userId),
      name: 'Food & Dining Out',
      type: 'expense',
      icon: 'Utensils',
      color: '#E4B66D'
    })
  ];

  const sampleTransactions: TransactionResponseDTO[] = [
    {
      id: 'tx-1',
      userId,
      type: 'income',
      amountPaise: 1000000, // ₹10,000.00
      amountInPaise: 1000000,
      amountFormatted: '₹10,000.00',
      currency: 'INR',
      accountId: 'acc-1',
      categoryId: catSalary,
      title: 'Monthly Salary',
      description: 'Monthly Salary',
      transactionDate: currMonthMidIso,
      date: currMonthMidIso,
      deletedAt: null,
      isDeleted: false,
      version: 1,
      idempotencyKey: 'k-1',
      status: 'cleared',
      createdAt: currMonthMidIso,
      updatedAt: currMonthMidIso
    },
    {
      id: 'tx-2',
      userId,
      type: 'expense',
      amountPaise: 250000, // ₹2,500.00
      amountInPaise: 250000,
      amountFormatted: '₹2,500.00',
      currency: 'INR',
      accountId: 'acc-1',
      categoryId: catGroceries,
      title: 'Grocery Store',
      description: 'Grocery Store',
      transactionDate: currMonthMidIso,
      date: currMonthMidIso,
      deletedAt: null,
      isDeleted: false,
      version: 1,
      idempotencyKey: 'k-2',
      status: 'cleared',
      createdAt: currMonthMidIso,
      updatedAt: currMonthMidIso
    },
    {
      id: 'tx-3',
      userId,
      type: 'expense',
      amountPaise: 150000, // ₹1,500.00
      amountInPaise: 150000,
      amountFormatted: '₹1,500.00',
      currency: 'INR',
      accountId: 'acc-1',
      categoryId: catDining,
      title: 'Team Dinner',
      description: 'Team Dinner',
      transactionDate: currMonthMidIso,
      date: currMonthMidIso,
      deletedAt: null,
      isDeleted: false,
      version: 1,
      idempotencyKey: 'k-3',
      status: 'cleared',
      createdAt: currMonthMidIso,
      updatedAt: currMonthMidIso
    },
    // Previous month expense for comparison: ₹2,000.00 -> This month ₹4,000.00 = +100%
    {
      id: 'tx-prev',
      userId,
      type: 'expense',
      amountPaise: 200000,
      amountInPaise: 200000,
      amountFormatted: '₹2,000.00',
      currency: 'INR',
      accountId: 'acc-1',
      categoryId: catGroceries,
      title: 'Last Month Market',
      description: 'Last Month Market',
      transactionDate: prevMonthMidIso,
      date: prevMonthMidIso,
      deletedAt: null,
      isDeleted: false,
      version: 1,
      idempotencyKey: 'k-prev',
      status: 'cleared',
      createdAt: prevMonthMidIso,
      updatedAt: prevMonthMidIso
    },
    // Transfer & Deleted MUST NOT affect totals
    {
      id: 'tx-trf',
      userId,
      type: 'transfer',
      amountPaise: 2500000,
      amountInPaise: 2500000,
      amountFormatted: '₹25,000.00',
      currency: 'INR',
      accountId: 'acc-1',
      destinationAccountId: 'acc-2',
      targetAccountId: 'acc-2',
      title: 'Savings Sweep',
      description: 'Savings Sweep',
      transactionDate: currMonthMidIso,
      date: currMonthMidIso,
      deletedAt: null,
      isDeleted: false,
      version: 1,
      idempotencyKey: 'k-trf',
      status: 'cleared',
      createdAt: currMonthMidIso,
      updatedAt: currMonthMidIso
    },
    {
      id: 'tx-del',
      userId,
      type: 'expense',
      amountPaise: 900000,
      amountInPaise: 900000,
      amountFormatted: '₹9,000.00',
      currency: 'INR',
      accountId: 'acc-1',
      categoryId: catDining,
      title: 'Cancelled Order',
      description: 'Cancelled Order',
      transactionDate: currMonthMidIso,
      date: currMonthMidIso,
      deletedAt: currMonthMidIso,
      isDeleted: true,
      version: 2,
      idempotencyKey: 'k-del',
      status: 'cleared',
      createdAt: currMonthMidIso,
      updatedAt: currMonthMidIso
    }
  ];

  function setupMocks(opts?: {
    transactions?: TransactionResponseDTO[];
    isLoading?: boolean;
    isError?: boolean;
    error?: Error | null;
    refetch?: () => Promise<any>;
  }) {
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
      user: { id: userId, email: 'analytics@laxmilens.app' },
      isAuthenticated: true,
      isLoading: false
    } as any);

    vi.spyOn(useTransactionsModule, 'useTransactions').mockReturnValue({
      transactions: opts?.transactions ?? sampleTransactions,
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
      isLoading: opts?.isLoading ?? false,
      isError: opts?.isError ?? false,
      error: opts?.error ?? null,
      refetch: opts?.refetch ?? vi.fn().mockResolvedValue(undefined),
      isAuthenticated: true,
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
      expenseCategories: [sampleCategories[1], sampleCategories[2]],
      categoryMap: new Map(sampleCategories.map((c) => [c.id, c])),
      getCategoryById: (id) => sampleCategories.find((c) => c.id === id),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined)
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders summary metrics, charts, category breakdown, spending trend comparison, and insights accurately', () => {
    setupMocks();

    render(
      <MemoryRouter>
        <AnalyticsPage />
      </MemoryRouter>
    );

    // Summary metrics (Income ₹10,000, Expenses ₹4,000, Net ₹6,000, Savings 60%)
    expect(screen.getByText('₹10,000.00')).toBeInTheDocument();
    expect(screen.getAllByText('₹4,000.00').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('₹6,000.00')).toBeInTheDocument();
    expect(screen.getByText('60%')).toBeInTheDocument();

    // Charts & Breakdown
    expect(screen.getByText('Income vs Expense Trends')).toBeInTheDocument();
    expect(screen.getByText('Daily')).toBeInTheDocument();
    expect(screen.getByText('Expense Breakdown')).toBeInTheDocument();
    expect(screen.getAllByText('Groceries & Household').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Food & Dining Out')).toBeInTheDocument();
    expect(screen.getByText('62.5%')).toBeInTheDocument();
    expect(screen.getByText('37.5%')).toBeInTheDocument();

    // Spending trend vs last month (₹2,000 -> ₹4,000 = +100%)
    expect(screen.getByText('+100% vs previous period')).toBeInTheDocument();
    expect(screen.getByText('+₹2,000.00')).toBeInTheDocument();

    // Activity Insights
    expect(screen.getByText('Highest-Spending Category')).toBeInTheDocument();
    expect(screen.getByText('Largest Single Expense')).toBeInTheDocument();
    expect(screen.getByText('Notable Category Increase')).toBeInTheDocument();
  });

  it('switches presets (All Time, Last 3 Months, Custom Date Range) and handles custom validation & insufficient history cleanly', () => {
    setupMocks();

    render(
      <MemoryRouter>
        <AnalyticsPage />
      </MemoryRouter>
    );

    // Switch to Last 3 Months -> switches chart granularity to Monthly and compares against zero prior history
    fireEvent.click(screen.getByRole('tab', { name: 'Last 3 Months' }));
    expect(screen.getByText('Monthly')).toBeInTheDocument();
    expect(screen.getByText('Insufficient History')).toBeInTheDocument();

    // Switch to All Time -> sums current + previous month active expenses (₹6,000) & explicitly marks no prior period
    fireEvent.click(screen.getByRole('tab', { name: 'All Time' }));
    expect(screen.getAllByText('₹6,000.00').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('status')).toHaveTextContent(/No prior equivalent period exists/i);

    // Switch to Custom Date Range and trigger invalid inverted bounds
    fireEvent.click(screen.getByRole('tab', { name: 'Custom Date Range' }));
    const startInput = screen.getByLabelText(/from date/i);
    const endInput = screen.getByLabelText(/to date/i);
    fireEvent.change(startInput, { target: { value: '2026-11-25' } });
    fireEvent.change(endInput, { target: { value: '2026-11-05' } });

    expect(screen.getByRole('alert')).toHaveTextContent(
      /Start date must be on or before end date/i
    );
    expect(screen.getByText('Adjust Custom Date Range')).toBeInTheDocument();
  });

  it('handles empty datasets, zero income safely (no NaN/Infinity), loading skeletons, and error retry state', () => {
    setupMocks({ transactions: [] });
    const { unmount } = render(
      <MemoryRouter initialEntries={['/analytics']}>
        <Routes>
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/transactions" element={<div>Transactions Route</div>} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('No income recorded in period')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText(/No financial activity for/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/);
    unmount();

    // Loading state
    setupMocks({ isLoading: true });
    const loadingView = render(
      <MemoryRouter>
        <AnalyticsPage />
      </MemoryRouter>
    );
    expect(screen.getByLabelText('Loading analytics')).toBeInTheDocument();
    loadingView.unmount();

    // Error state with Retry
    const mockRetry = vi.fn().mockResolvedValue(undefined);
    setupMocks({ isError: true, error: new Error('Dexie offline read error'), refetch: mockRetry });
    render(
      <MemoryRouter>
        <AnalyticsPage />
      </MemoryRouter>
    );
    expect(screen.getByText('Failed to Load Analytics')).toBeInTheDocument();
    expect(screen.getByText('Dexie offline read error')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(mockRetry).toHaveBeenCalledTimes(1);
  });

  it('operates strictly read-only offline through existing query caches without mutating transactions or enqueuing outbox entries', async () => {
    vi.restoreAllMocks();
    globalQueryClient.clear();

    const enqueueSpy = vi.fn();
    const saveSpy = vi.fn();
    const deleteSpy = vi.fn();

    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
      user: { id: userId, email: 'offline@laxmilens.app' },
      isAuthenticated: true,
      isLoading: false
    } as any);

    vi.spyOn(defaultDatabaseManager, 'getActiveRepositories').mockResolvedValue({
      getTransactionsUseCase: {
        execute: vi.fn().mockResolvedValue(sampleTransactions)
      },
      transactionRepo: { save: saveSpy, softDelete: deleteSpy },
      categoryRepo: {
        findByUserId: vi.fn().mockResolvedValue(sampleCategories),
        seedDefaults: vi.fn()
      },
      outboxManager: {
        enqueue: enqueueSpy,
        getPendingEntries: vi.fn().mockResolvedValue([])
      }
    } as any);

    try {
      render(
        <QueryClientProvider client={globalQueryClient}>
          <MemoryRouter>
            <AnalyticsPage />
          </MemoryRouter>
        </QueryClientProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('₹10,000.00')).toBeInTheDocument();
        expect(screen.getByText('+100% vs previous period')).toBeInTheDocument();
      });

      // Switch filters using offline cached data with zero DB writes or outbox mutations
      fireEvent.click(screen.getByRole('tab', { name: 'Last Month' }));
      expect(screen.getAllByText('₹2,000.00').length).toBeGreaterThanOrEqual(1);

      fireEvent.click(screen.getByRole('tab', { name: 'This Month' }));
      expect(screen.getByText('₹10,000.00')).toBeInTheDocument();

      expect(enqueueSpy).not.toHaveBeenCalled();
      expect(saveSpy).not.toHaveBeenCalled();
      expect(deleteSpy).not.toHaveBeenCalled();
    } finally {
      globalQueryClient.clear();
    }
  });
});

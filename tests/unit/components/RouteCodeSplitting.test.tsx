import React from 'react';
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext, AuthContextType } from '@/features/auth/context/AuthContext';
import { RouteLoadingFallback } from '@/components/feedback/RouteLoadingFallback';
import { RouteErrorFallback } from '@/components/feedback/RouteErrorFallback';
import { appRoutes } from '@/app/router/routes';
import * as useAccountsModule from '@/features/accounts/hooks/useAccounts';
import * as useTransactionsModule from '@/features/transactions/hooks/useTransactions';
import * as useCategoriesModule from '@/features/categories/hooks/useCategories';
import * as useAccountSyncModule from '@/features/accounts/hooks/useAccountSync';
import * as useBudgetsModule from '@/features/budgets/hooks/useBudgets';
import * as useNotificationsModule from '@/features/notifications/hooks/useNotifications';

const OriginalRequest = globalThis.Request;

describe('Phase 12 Stage 2A: Route-Based Code Splitting & Lazy Loading', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    const CompatibleRequest = function (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Request {
      try {
        return new OriginalRequest(input, init);
      } catch (err) {
        if (err instanceof TypeError && init?.signal) {
          const { signal: _ignoredSignal, ...rest } = init;
          return new OriginalRequest(input, rest);
        }
        throw err;
      }
    } as unknown as typeof Request;
    CompatibleRequest.prototype = OriginalRequest.prototype;
    globalThis.Request = CompatibleRequest;
  });

  afterAll(() => {
    globalThis.Request = OriginalRequest;
  });

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('renders Obsidian Gold full-screen and embedded RouteLoadingFallback variants accessibly', () => {
    const { container: fullContainer } = render(
      <RouteLoadingFallback fullScreen label="Loading sign-in..." />
    );
    expect(screen.getByRole('status', { name: 'Loading sign-in...' })).toBeInTheDocument();
    expect(screen.getByText('LL')).toBeInTheDocument();
    expect(fullContainer.firstChild).toHaveClass('min-h-screen', 'bg-[#101010]');

    const { container: embeddedContainer } = render(
      <RouteLoadingFallback label="Loading analytics..." />
    );
    expect(screen.getByRole('status', { name: 'Loading analytics...' })).toBeInTheDocument();
    expect(embeddedContainer.firstChild).not.toHaveClass('min-h-screen');
  });

  it('preserves full route hierarchy and lazy elements for guest and protected routes', () => {
    expect(appRoutes[0]?.errorElement).toBeDefined();

    const rootChildren = appRoutes[0]?.children ?? [];
    const guestBranch = rootChildren.find((r) =>
      r.children?.some((child) => child.path === '/login')
    );
    const protectedBranch = rootChildren.find((r) => r.path === '/');
    const appLayoutBranch = protectedBranch?.children?.[0];
    const embeddedErrorBranch = appLayoutBranch?.children?.[0];

    expect(guestBranch?.children?.map((c) => c.path)).toEqual([
      '/login',
      '/register',
      '/forgot-password',
      '/reset-password'
    ]);

    const protectedPaths = embeddedErrorBranch?.children?.map((c) => c.path ?? 'index') ?? [];
    expect(protectedPaths).toEqual([
      'index',
      'dashboard',
      'transactions',
      'accounts',
      'borrowings',
      'budgets',
      'recurring',
      'analytics',
      'calendar',
      'reports',
      'notifications',
      'settings',
      '*'
    ]);
  });

  it('resolves lazy guest route (/login) cleanly without exposing protected routes', async () => {
    const authValue: AuthContextType = {
      user: null,
      isLoading: false,
      isAuthenticated: false,
      signIn: vi.fn(),
      signUp: vi.fn(),
      signInWithGoogle: vi.fn(),
      signOut: vi.fn(),
      resetPassword: vi.fn(),
      updatePassword: vi.fn()
    };

    const memoryRouter = createMemoryRouter(appRoutes, {
      initialEntries: ['/login']
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={qc}>
        <AuthContext.Provider value={authValue}>
          <RouterProvider router={memoryRouter} />
        </AuthContext.Provider>
      </QueryClientProvider>
    );

    await waitFor(
      () => {
        expect(screen.getByRole('heading', { name: /Welcome Back/i })).toBeInTheDocument();
      },
      { timeout: 10000 }
    );

    qc.clear();
  });

  it('resolves lazy authenticated feature route (/dashboard) through ProtectedRoute and AppLayout Suspense', async () => {
    const authValue: AuthContextType = {
      user: { id: '11111111-1111-4111-8111-111111111111', email: 'test@laxmilens.app' },
      isLoading: false,
      isAuthenticated: true,
      signIn: vi.fn(),
      signUp: vi.fn(),
      signInWithGoogle: vi.fn(),
      signOut: vi.fn(),
      resetPassword: vi.fn(),
      updatePassword: vi.fn()
    };

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
      summary: useTransactionsModule.computeTransactionSummary([]),
      pendingTxIdSet: new Set(),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isAuthenticated: true,
      createTransaction: vi.fn(),
      isCreating: false,
      updateTransaction: vi.fn(),
      isUpdating: false,
      deleteTransaction: vi.fn(),
      isDeleting: false
    });

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
      isAuthenticated: true
    });

    vi.spyOn(useBudgetsModule, 'useBudgets').mockReturnValue({
      period: '2026-11',
      budgets: [],
      pendingBudgetIdSet: new Set(),
      summary: {
        period: '2026-11',
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
    } as any);

    vi.spyOn(useNotificationsModule, 'useNotifications').mockReturnValue({
      notifications: [],
      unreadCount: 0,
      pendingNotificationIdSet: new Set(),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      markAsRead: vi.fn(),
      isMarkingRead: false,
      markAllAsRead: vi.fn(),
      isMarkingAllRead: false,
      dismissNotification: vi.fn(),
      isDismissing: false,
      evaluateAlerts: vi.fn()
    } as any);

    const memoryRouter = createMemoryRouter(appRoutes, {
      initialEntries: ['/dashboard']
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={qc}>
        <AuthContext.Provider value={authValue}>
          <RouterProvider router={memoryRouter} />
        </AuthContext.Provider>
      </QueryClientProvider>
    );

    await waitFor(
      () => {
        expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument();
      },
      { timeout: 10000 }
    );

    qc.clear();
  });

  it('catches failed lazy route chunk loads via RouteErrorFallback safely', async () => {
    const FailingLazyRoute = React.lazy(() =>
      Promise.reject(new Error('Failed to fetch dynamically imported module /assets/chunk-xyz.js'))
    );

    const testRouter = createMemoryRouter(
      [
        {
          path: '/',
          errorElement: <RouteErrorFallback homePath="/dashboard" homeLabel="Back to Dashboard" />,
          children: [
            { path: 'dashboard', element: <div>Safe Dashboard</div> },
            {
              path: 'analytics',
              element: (
                <React.Suspense fallback={<RouteLoadingFallback label="Loading analytics..." />}>
                  <FailingLazyRoute />
                </React.Suspense>
              ),
              errorElement: (
                <RouteErrorFallback embedded homePath="/dashboard" homeLabel="Back to Dashboard" />
              )
            }
          ]
        }
      ],
      { initialEntries: ['/analytics'] }
    );

    const { container } = render(<RouterProvider router={testRouter} />);

    await waitFor(() => {
      expect(screen.getByText('Unable to Display Page')).toBeInTheDocument();
    });

    expect(container.textContent).not.toContain('chunk-xyz.js');
    expect(screen.getByRole('button', { name: /Back to Dashboard/i })).toBeInTheDocument();
  });
});

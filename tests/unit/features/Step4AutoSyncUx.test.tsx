import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';

import { AuthContext, AuthContextType } from '@/features/auth/context/AuthContext';
import { Header } from '@/app/navigation/Header';
import { SyncStatusSettingsCard } from '@/features/settings/components/SyncStatusSettingsCard';
import { RestoreBackupPanel } from '@/features/settings/components/RestoreBackupPanel';
import { AccountsPage } from '@/features/accounts/AccountsPage';
import { TransactionsPage } from '@/features/transactions/TransactionsPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { BudgetsPage } from '@/features/budgets/BudgetsPage';
import { BorrowingsPage } from '@/features/borrowings/BorrowingsPage';
import { RecurringPage } from '@/features/recurring/RecurringPage';
import { NotificationsPage } from '@/features/notifications/NotificationsPage';
import * as useAccountsModule from '@/features/accounts/hooks/useAccounts';
import * as useTransactionsModule from '@/features/transactions/hooks/useTransactions';
import * as useCategoriesModule from '@/features/categories/hooks/useCategories';
import * as useBudgetsModule from '@/features/budgets/hooks/useBudgets';
import * as useBorrowingsModule from '@/features/borrowings/hooks/useBorrowings';
import * as useRecurringModule from '@/features/recurring/hooks/useRecurring';
import * as useNotificationsModule from '@/features/notifications/hooks/useNotifications';
import * as useNotificationPreferencesModule from '@/features/notifications/hooks/useNotificationPreferences';
import { defaultDatabaseManager } from '@/infrastructure/database/local/DatabaseManager';
import {
  AutoSyncScheduler,
  AutoSyncStateSnapshot,
  AutoSyncStatus,
  createIdleSyncState
} from '@/infrastructure/sync/AutoSyncScheduler';
import { LocalOutboxRecord } from '@/infrastructure/database/local/schema';
import { formatSanitizedSyncFailure } from '@/features/sync/utils/syncStatusPresentation';
import type { ManualSyncCoordinator, UnifiedSyncResult } from '@/infrastructure/sync/ManualSyncCoordinator';

const USER_ID = '11111111-1111-4111-8111-111111111111';

function makeAuthValue(): AuthContextType {
  return {
    user: {
      id: USER_ID,
      email: 'investor@laxmilens.app',
      displayName: 'Test User'
    },
    isLoading: false,
    isAuthenticated: true,
    signIn: vi.fn(),
    signUp: vi.fn(),
    signInWithGoogle: vi.fn(),
    signOut: vi.fn(),
    resetPassword: vi.fn(),
    updatePassword: vi.fn()
  };
}

function makeSyncResult(overrides: Partial<UnifiedSyncResult> = {}): UnifiedSyncResult {
  return {
    totalPending: 0,
    totalProcessed: 0,
    syncedCount: 0,
    failedCount: 0,
    skippedCount: 0,
    unsupportedCount: 0,
    stillPendingCount: 0,
    pulledCount: 0,
    accounts: { syncedCount: 0, failedCount: 0, skippedCount: 0 },
    categories: { syncedCount: 0, failedCount: 0, skippedCount: 0 },
    budgets: {
      syncedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      categoryBlockedCount: 0,
      conflictCount: 0,
      pulledCount: 0
    },
    transactions: {
      syncedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      dependencyBlockedCount: 0,
      categoryBlockedCount: 0,
      conflictCount: 0
    },
    lenders: { syncedCount: 0, failedCount: 0, skippedCount: 0 },
    borrowings: { syncedCount: 0, failedCount: 0, skippedCount: 0 },
    borrowingRepayments: { syncedCount: 0, failedCount: 0, skippedCount: 0 },
    recurringRules: { syncedCount: 0, failedCount: 0, skippedCount: 0 },
    recurringOccurrences: { syncedCount: 0, failedCount: 0, skippedCount: 0 },
    notifications: { syncedCount: 0, failedCount: 0, skippedCount: 0, pulledCount: 0 },
    notificationPreferences: { syncedCount: 0, failedCount: 0, skippedCount: 0, pulledCount: 0 },
    errors: [],
    ...overrides
  };
}

function createFakeSyncStateBus(initialStatus: AutoSyncStatus = 'saved_locally') {
  let state: AutoSyncStateSnapshot = {
    ...createIdleSyncState(USER_ID, initialStatus !== 'waiting_for_internet'),
    status: initialStatus,
    label:
      initialStatus === 'saved_locally'
        ? 'Saved locally'
        : initialStatus === 'synchronizing'
          ? 'Synchronizing'
          : initialStatus === 'successfully_synchronized'
            ? 'Successfully synchronized'
            : initialStatus === 'waiting_for_internet'
              ? 'Waiting for internet'
              : 'Synchronization failed'
  };

  const listeners = new Set<(snapshot: AutoSyncStateSnapshot) => void>();

  vi.spyOn(defaultDatabaseManager, 'getSyncState').mockImplementation(() => state);
  vi.spyOn(defaultDatabaseManager, 'subscribeSyncState').mockImplementation((listener) => {
    listeners.add(listener);
    listener(state);
    return () => {
      listeners.delete(listener);
    };
  });

  const emit = (patch: Partial<AutoSyncStateSnapshot> & { status: AutoSyncStatus; label: string }) => {
    state = {
      ...state,
      ...patch,
      updatedAt: new Date().toISOString()
    };
    for (const listener of Array.from(listeners)) {
      listener(state);
    }
  };

  return { emit, getState: () => state };
}

describe('Phase 12 Step 4: Automatic Synchronization UX', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false }
      }
    });
    vi.restoreAllMocks();
  });

  afterEach(() => {
    queryClient.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('1. Header indicator displays all five states, live updates, pending count, and lastSyncedAt time', () => {
    const bus = createFakeSyncStateBus('saved_locally');
    vi.spyOn(useNotificationsModule, 'useNotifications').mockReturnValue({
      notifications: [],
      allNotifications: [],
      unreadCount: 0,
      totalCount: 0,
      pendingNotificationIdSet: new Set(),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isAuthenticated: true,
      markAsRead: vi.fn(),
      isMarkingRead: false,
      markAllAsRead: vi.fn(),
      isMarkingAllRead: false,
      dismissNotification: vi.fn(),
      isDismissing: false
    });

    render(
      <MemoryRouter>
        <AuthContext.Provider value={makeAuthValue()}>
          <QueryClientProvider client={queryClient}>
            <Header onOpenCommandPalette={vi.fn()} />
          </QueryClientProvider>
        </AuthContext.Provider>
      </MemoryRouter>
    );

    const indicator = screen.getByTestId('header-sync-indicator');
    expect(indicator).toHaveTextContent('Saved locally');
    expect(screen.getByRole('status')).toHaveTextContent('Saved locally');

    act(() => {
      bus.emit({
        status: 'synchronizing',
        label: 'Synchronizing',
        isSyncing: true,
        isOnline: true,
        pendingCount: 2
      });
    });
    expect(indicator).toHaveTextContent('Synchronizing');
    expect(screen.getByTestId('header-sync-pending-count')).toHaveTextContent('2');

    const syncedAtIso = new Date().toISOString();
    act(() => {
      bus.emit({
        status: 'successfully_synchronized',
        label: 'Successfully synchronized',
        isSyncing: false,
        isOnline: true,
        pendingCount: 0,
        lastSyncedAt: syncedAtIso,
        lastError: null
      });
    });
    expect(indicator).toHaveTextContent('Successfully synchronized');
    expect(screen.getByTestId('header-sync-last-time')).toBeInTheDocument();

    act(() => {
      bus.emit({
        status: 'waiting_for_internet',
        label: 'Waiting for internet',
        isSyncing: false,
        isOnline: false,
        pendingCount: 1
      });
    });
    expect(indicator).toHaveTextContent('Waiting for internet');

    act(() => {
      bus.emit({
        status: 'synchronization_failed',
        label: 'Synchronization failed',
        isSyncing: false,
        isOnline: true,
        pendingCount: 1,
        lastError: 'Temporary failure'
      });
    });
    expect(indicator).toHaveTextContent('Synchronization failed');
    expect(screen.getByRole('status')).toHaveTextContent('Synchronization failed');
  });

  it('2. Removes manual Sync Now / Sync Cloud buttons from all seven normal financial pages', () => {
    createFakeSyncStateBus('saved_locally');

    vi.spyOn(useAccountsModule, 'useAccounts').mockReturnValue({
      accounts: [],
      summary: {
        totalNetWorthPaise: 0,
        totalNetWorthFormatted: '₹0.00',
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
    } as any);

    vi.spyOn(useTransactionsModule, 'useTransactions').mockReturnValue({
      transactions: [],
      summary: {
        totalIncomePaise: 0,
        totalExpensePaise: 0,
        totalTransferPaise: 0,
        netCashflowPaise: 0,
        count: 0
      },
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

    vi.spyOn(useBudgetsModule, 'useBudgets').mockReturnValue({
      period: '2026-11',
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

    vi.spyOn(useBorrowingsModule, 'useBorrowings').mockReturnValue({
      summary: {
        totalBorrowedPaise: 0,
        totalRepaidPaise: 0,
        totalOutstandingPaise: 0,
        activeLendersCount: 0,
        overdueCount: 0,
        totalBorrowedFormatted: '₹0.00',
        totalRepaidFormatted: '₹0.00',
        totalOutstandingFormatted: '₹0.00'
      },
      lenders: [],
      borrowings: [],
      repayments: [],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      addBorrowing: vi.fn(),
      isAddingBorrowing: false,
      recordRepayment: vi.fn(),
      isRecordingRepayment: false
    });

    vi.spyOn(useRecurringModule, 'useRecurring').mockReturnValue({
      overview: {} as any,
      summary: {
        activeSchedulesCount: 0,
        dueTodayCount: 0,
        overdueCount: 0,
        upcomingCount: 0,
        monthlyCommitmentPaise: 0,
        monthlyCommitmentFormatted: '₹0.00'
      },
      overdue: [],
      dueToday: [],
      upcoming: [],
      snoozed: [],
      recentlyGenerated: [],
      schedules: [],
      pendingRecurringIdSet: new Set(),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isAuthenticated: true,
      createRule: vi.fn(),
      isCreating: false,
      updateRule: vi.fn(),
      isUpdating: false,
      pauseRule: vi.fn(),
      isPausing: false,
      resumeRule: vi.fn(),
      isResuming: false,
      deleteRule: vi.fn(),
      isDeleting: false,
      confirmOccurrence: vi.fn(),
      isConfirming: false,
      skipOccurrence: vi.fn(),
      isSkipping: false,
      snoozeOccurrence: vi.fn(),
      isSnoozing: false,
      dismissOccurrence: vi.fn(),
      isDismissing: false
    } as any);

    vi.spyOn(useNotificationsModule, 'useNotifications').mockReturnValue({
      notifications: [],
      allNotifications: [],
      unreadCount: 0,
      totalCount: 0,
      pendingNotificationIdSet: new Set(),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isAuthenticated: true,
      markAsRead: vi.fn(),
      isMarkingRead: false,
      markAllAsRead: vi.fn(),
      isMarkingAllRead: false,
      dismissNotification: vi.fn(),
      isDismissing: false
    });

    const pages = [
      <AccountsPage key="acc" />,
      <TransactionsPage key="tx" />,
      <DashboardPage key="dash" />,
      <BudgetsPage key="bud" />,
      <BorrowingsPage key="bor" />,
      <RecurringPage key="rec" />,
      <NotificationsPage key="not" />
    ];

    for (const page of pages) {
      const view = render(
        <MemoryRouter>
          <AuthContext.Provider value={makeAuthValue()}>
            <QueryClientProvider client={queryClient}>{page}</QueryClientProvider>
          </AuthContext.Provider>
        </MemoryRouter>
      );
      expect(screen.queryByRole('button', { name: /Sync Now|Sync Cloud/i })).not.toBeInTheDocument();
      view.unmount();
    }
  });

  it('3. Write hooks confirm local persistence ("Saved locally") and never claim cloud sync completion', async () => {
    const toastSuccessSpy = vi.spyOn(toast, 'success');
    const mockRepos = {
      createAccountUseCase: {
        execute: vi.fn().mockResolvedValue({ id: 'a1', name: 'Wallet' })
      },
      createTransactionUseCase: {
        execute: vi.fn().mockResolvedValue({ id: 't1', type: 'expense' })
      },
      createBudgetUseCase: {
        execute: vi.fn().mockResolvedValue({
          id: 'b1',
          limitFormatted: '₹5,000.00',
          period: '2026-11'
        })
      },
      addBorrowingUseCase: {
        execute: vi.fn().mockResolvedValue({
          id: 'br1',
          amountFormatted: '₹1,200.00',
          lenderName: 'Asha'
        })
      },
      createRecurringRuleUseCase: {
        execute: vi.fn().mockResolvedValue({ id: 'r1', title: 'Rent' })
      },
      markAllNotificationsReadUseCase: {
        execute: vi.fn().mockResolvedValue({ updatedCount: 2 })
      },
      updateNotificationPreferencesUseCase: {
        execute: vi.fn().mockResolvedValue({ userId: USER_ID })
      },
      getAccountsUseCase: { execute: vi.fn().mockResolvedValue({ accounts: [], summary: {} }) },
      getTransactionsUseCase: { execute: vi.fn().mockResolvedValue({ transactions: [], summary: {} }) },
      getBudgetsOverviewUseCase: { execute: vi.fn().mockResolvedValue(null) },
      getBorrowingsUseCase: { execute: vi.fn().mockResolvedValue({ lenders: [], borrowings: [], repayments: [], summary: {} }) },
      getRecurringOverviewUseCase: { execute: vi.fn().mockResolvedValue(null) },
      getNotificationsUseCase: { execute: vi.fn().mockResolvedValue({ notifications: [], unreadCount: 0 }) },
      getNotificationPreferencesUseCase: { execute: vi.fn().mockResolvedValue({ userId: USER_ID }) },
      evaluateFinancialAlertsUseCase: { execute: vi.fn().mockResolvedValue(undefined) },
      outboxManager: { getPendingEntries: vi.fn().mockResolvedValue([]), getPendingCount: vi.fn().mockResolvedValue(0) }
    };
    vi.spyOn(defaultDatabaseManager, 'getActiveRepositories').mockResolvedValue(mockRepos as any);

    let hooks!: {
      acc: ReturnType<typeof useAccountsModule.useAccounts>;
      tx: ReturnType<typeof useTransactionsModule.useTransactions>;
      bud: ReturnType<typeof useBudgetsModule.useBudgets>;
      bor: ReturnType<typeof useBorrowingsModule.useBorrowings>;
      rec: ReturnType<typeof useRecurringModule.useRecurring>;
      not: ReturnType<typeof useNotificationsModule.useNotifications>;
      pref: ReturnType<typeof useNotificationPreferencesModule.useNotificationPreferences>;
    };

    const Harness: React.FC = () => {
      hooks = {
        acc: useAccountsModule.useAccounts(),
        tx: useTransactionsModule.useTransactions(),
        bud: useBudgetsModule.useBudgets('2026-11'),
        bor: useBorrowingsModule.useBorrowings(),
        rec: useRecurringModule.useRecurring(),
        not: useNotificationsModule.useNotifications(),
        pref: useNotificationPreferencesModule.useNotificationPreferences()
      };
      return null;
    };

    render(
      <AuthContext.Provider value={makeAuthValue()}>
        <QueryClientProvider client={queryClient}>
          <Harness />
        </QueryClientProvider>
      </AuthContext.Provider>
    );

    await act(async () => {
      await hooks.acc.createAccount({
        name: 'Wallet',
        accountType: 'cash',
        openingBalance: '100',
        color: '#D6AD60',
        icon: 'wallet'
      } as any);
      await hooks.tx.createTransaction({
        type: 'expense',
        amount: '50',
        accountId: 'a1',
        categoryId: 'c1',
        title: 'Tea',
        transactionDate: '2026-11-27'
      });
      await hooks.bud.createBudget({
        categoryId: 'c1',
        period: '2026-11',
        limit: '5000'
      });
      await hooks.bor.addBorrowing({
        lenderName: 'Asha',
        amount: '1200',
        borrowedDate: '2026-11-27',
        receivingAccountId: 'a1'
      });
      await hooks.rec.createRule({
        title: 'Rent',
        type: 'expense',
        amount: '15000',
        accountId: 'a1',
        frequency: 'monthly',
        interval: 1,
        startDate: '2026-11-27'
      });
      await hooks.not.markAllAsRead();
      await hooks.pref.updatePreferences({
        upcomingRemindersEnabled: true,
        overdueRemindersEnabled: true,
        budgetAlertsEnabled: true,
        budgetWarningThresholdPct: 80
      });
    });

    const messages = toastSuccessSpy.mock.calls.map((c) => String(c[0]));
    expect(messages).toHaveLength(7);
    for (const msg of messages) {
      expect(msg.toLowerCase()).toContain('locally');
      expect(msg.toLowerCase()).not.toContain('synchronized');
      expect(msg.toLowerCase()).not.toContain('synced to cloud');
    }
  });

  it('4. Background synchronization of multiple records avoids toast spam and updates Header cleanly', async () => {
    const toastSuccessSpy = vi.spyOn(toast, 'success');
    const toastInfoSpy = vi.spyOn(toast, 'info');
    const toastWarnSpy = vi.spyOn(toast, 'warning');
    const toastErrorSpy = vi.spyOn(toast, 'error');

    const lifecycleListeners = new Set<any>();
    let pendingCount = 3;
    const listeners = new Set<(event: any) => void>();

    const coordinator = {
      isOperationInProgress: vi.fn(() => false),
      isAuthPaused: vi.fn(() => false),
      notifyNetworkRecovered: vi.fn(),
      getPendingCount: vi.fn(async () => pendingCount),
      getRetryScheduleSummary: vi.fn(async () => ({
        pendingCount,
        hasPermanentOrExhaustedFailures: false,
        authPaused: false,
        earliestRetryAtMs: null
      })),
      subscribeLifecycle: (fn: (event: any) => void) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      run: vi.fn(async () => {
        for (const fn of listeners) {
          fn({ type: 'syncStarted', userId: USER_ID, mode: 'background' });
        }
        pendingCount = 0;
        const result = makeSyncResult({
          totalPending: 3,
          totalProcessed: 3,
          syncedCount: 3,
          stillPendingCount: 0
        });
        for (const fn of listeners) {
          fn({ type: 'syncCompleted', userId: USER_ID, mode: 'background', result });
        }
        return result;
      })
    } as unknown as ManualSyncCoordinator;

    const scheduler = new AutoSyncScheduler({
      userId: USER_ID,
      sessionGeneration: 1,
      coordinator,
      outboxManager: { getPendingCount: vi.fn(async () => pendingCount) } as any,
      lifecycleAdapter: {
        isOnline: () => true,
        subscribe: (cbs) => {
          lifecycleListeners.add(cbs);
          return () => lifecycleListeners.delete(cbs);
        }
      },
      debounceMs: 10
    });

    vi.spyOn(defaultDatabaseManager, 'getSyncState').mockImplementation(() => scheduler.getState());
    vi.spyOn(defaultDatabaseManager, 'subscribeSyncState').mockImplementation((fn) =>
      scheduler.subscribe(fn)
    );
    vi.spyOn(useNotificationsModule, 'useNotifications').mockReturnValue({
      unreadCount: 0
    } as any);

    render(
      <MemoryRouter>
        <AuthContext.Provider value={makeAuthValue()}>
          <QueryClientProvider client={queryClient}>
            <Header onOpenCommandPalette={vi.fn()} />
          </QueryClientProvider>
        </AuthContext.Provider>
      </MemoryRouter>
    );

    await act(async () => {
      scheduler.start();
    });

    await waitFor(() => {
      expect(screen.getByTestId('header-sync-indicator')).toHaveTextContent(
        'Successfully synchronized'
      );
    });

    expect(toastSuccessSpy).not.toHaveBeenCalled();
    expect(toastInfoSpy).not.toHaveBeenCalled();
    expect(toastWarnSpy).not.toHaveBeenCalled();
    expect(toastErrorSpy).not.toHaveBeenCalled();
    scheduler.dispose();
  });

  it('5. Failure popover sanitizes SQL/tokens/UUIDs/financial details, keeps outbox, distinguishes recovery, and retries cleanly', async () => {
    const bus = createFakeSyncStateBus('saved_locally');
    const retrySpy = vi.spyOn(defaultDatabaseManager, 'retryFailedSync').mockResolvedValue(
      makeSyncResult({ syncedCount: 1 })
    );
    vi.spyOn(useNotificationsModule, 'useNotifications').mockReturnValue({
      unreadCount: 0
    } as any);

    const dangerousRawError =
      `ERROR 42501 PGRST204 permission denied for relation sync_outbox ` +
      `INSERT INTO transactions user=${USER_ID} amount_paise=99900 "HDFC Secret Bonus"`;

    act(() => {
      bus.emit({
        status: 'synchronization_failed',
        label: 'Synchronization failed',
        isOnline: true,
        isSyncing: false,
        pendingCount: 2,
        lastError: dangerousRawError,
        lastResult: makeSyncResult({
          failedCount: 1,
          stillPendingCount: 2,
          errors: [{ entity: 'transactions', entityId: 'tx-1', error: dangerousRawError, category: 'database' }]
        })
      });
    });

    // Direct unit check on sanitizer output
    const formatted = formatSanitizedSyncFailure(bus.getState());
    expect(formatted?.canRetry).toBe(true);
    expect(formatted?.summary).not.toContain('42501');
    expect(formatted?.detail).not.toContain('PGRST204');

    render(
      <MemoryRouter>
        <AuthContext.Provider value={makeAuthValue()}>
          <QueryClientProvider client={queryClient}>
            <Header onOpenCommandPalette={vi.fn()} />
            <SyncStatusSettingsCard />
          </QueryClientProvider>
        </AuthContext.Provider>
      </MemoryRouter>
    );

    // Open Header popover
    fireEvent.click(screen.getByTestId('header-sync-indicator'));
    const popover = screen.getByTestId('header-sync-popover');
    expect(popover).toHaveTextContent('saved locally');
    expect(popover).not.toHaveTextContent('42501');
    expect(popover).not.toHaveTextContent('PGRST204');
    expect(popover).not.toHaveTextContent('sync_outbox');
    expect(popover).not.toHaveTextContent(USER_ID);
    expect(popover).not.toHaveTextContent('HDFC Secret Bonus');
    expect(popover).not.toHaveTextContent('99900');

    // Click Retry Sync in popover
    fireEvent.click(within(popover).getByRole('button', { name: /Retry Sync/i }));
    await waitFor(() => {
      expect(retrySpy).toHaveBeenCalledTimes(1);
    });

    // Also verify auth-paused recovery distinction hides Retry Sync, clarifies sign-in, and scrubs tokens
    act(() => {
      bus.emit({
        status: 'synchronization_failed',
        label: 'Synchronization failed',
        isOnline: true,
        authPaused: true,
        lastError: 'PGRST301 JWT expired Bearer eyJhbGciOiJIUzI1NiJ9',
        lastResult: makeSyncResult({ authPaused: true })
      });
    });
    const updatedPopover = screen.getByTestId('header-sync-popover');
    expect(updatedPopover).not.toHaveTextContent('PGRST301');
    expect(updatedPopover).not.toHaveTextContent('eyJhbGci');
    expect(within(updatedPopover).queryByRole('button', { name: /Retry Sync/i })).not.toBeInTheDocument();
    expect(within(updatedPopover).getByRole('button', { name: /Sign in again/i })).toBeInTheDocument();
  });

  it('6. Holds background sync for restored pending outbox items until restore confirmation banner is dismissed', async () => {
    vi.useFakeTimers();

    const listeners = new Set<(event: any) => void>();
    const pendingEntries: LocalOutboxRecord[] = [
      {
        id: 1,
        userId: USER_ID,
        entity: 'accounts',
        entityId: 'acc-1',
        operation: 'INSERT',
        payload: {},
        idempotencyKey: 'k1',
        attempts: 0,
        createdAt: '2026-11-27T10:00:00.000Z'
      }
    ];

    const runSpy = vi.fn(async () => makeSyncResult({ syncedCount: 1 }));
    let exclusiveActive = false;

    const coordinator = {
      isOperationInProgress: vi.fn(() => exclusiveActive),
      isAuthPaused: vi.fn(() => false),
      notifyNetworkRecovered: vi.fn(),
      getPendingCount: vi.fn(async () => pendingEntries.length),
      getRetryScheduleSummary: vi.fn(async () => ({
        pendingCount: pendingEntries.length,
        hasPermanentOrExhaustedFailures: false,
        authPaused: false,
        earliestRetryAtMs: null
      })),
      subscribeLifecycle: (fn: (event: any) => void) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      run: runSpy
    } as unknown as ManualSyncCoordinator;

    const scheduler = new AutoSyncScheduler({
      userId: USER_ID,
      sessionGeneration: 1,
      coordinator,
      outboxManager: { getPendingCount: vi.fn(async () => pendingEntries.length) } as any,
      lifecycleAdapter: {
        isOnline: () => true,
        subscribe: () => () => undefined
      },
      debounceMs: 50
    });

    scheduler.start();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    runSpy.mockClear();

    // Acquire confirmation hold while restore runs & finishes
    scheduler.holdPostRestoreSync();
    exclusiveActive = true;
    for (const fn of listeners) {
      fn({ type: 'exclusiveStarted', userId: USER_ID, reason: 'restore' });
    }
    exclusiveActive = false;
    for (const fn of listeners) {
      await fn({
        type: 'exclusiveEnded',
        userId: USER_ID,
        reason: 'restore',
        mayHaveMutatedOutbox: true,
        succeeded: true
      });
    }

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    // Still blocked until user dismisses restore confirmation!
    expect(runSpy).not.toHaveBeenCalled();
    expect(scheduler.getState().status).toBe('saved_locally');

    // Render confirmation panel and click Done -> releases hold -> background sync runs
    const handleDismiss = vi.fn(() => scheduler.releasePostRestoreSync());
    render(
      <RestoreBackupPanel
        userId={USER_ID}
        isBusy={false}
        operationPhase="idle"
        restoreError={null}
        lastRestoreResult={{
          mode: 'empty',
          restoredCounts: {
            accounts: 1,
            categories: 0,
            transactions: 0,
            lenders: 0,
            borrowings: 0,
            borrowingRepayments: 0,
            budgets: 0,
            recurringRules: 0,
            recurringOccurrences: 0,
            notifications: 0,
            notificationPreferences: 0
          },
          restoredOutboxCount: 1,
          safetyBackupUsed: false
        }}
        restoreSession={{
          fileName: null,
          archive: null,
          preview: null,
          restorePendingOutbox: true,
          safetyBackup: null
        }}
        onDecryptAndPreview={vi.fn()}
        onToggleOutbox={vi.fn()}
        onCreateSafetyBackup={vi.fn()}
        onConfirmRestore={vi.fn()}
        onCancelRestore={vi.fn()}
        onClearStatus={handleDismiss}
      />
    );

    expect(screen.getByText(/Local database restored successfully/i)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('dismiss-restore-status-btn'));
    expect(handleDismiss).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(runSpy).toHaveBeenCalledWith({ mode: 'background', retryFailed: false });
    scheduler.dispose();
  });

  it('7. Verifies legacy SyncEngine, useSyncStatus, and Navbar are removed and unused across src/', () => {
    const projectRoot = process.cwd();
    expect(fs.existsSync(path.join(projectRoot, 'src/infrastructure/sync/SyncEngine.ts'))).toBe(false);
    expect(fs.existsSync(path.join(projectRoot, 'src/hooks/useSyncStatus.ts'))).toBe(false);
    expect(fs.existsSync(path.join(projectRoot, 'src/app/navigation/Navbar.tsx'))).toBe(false);

    const srcIndex = fs.readFileSync(path.join(projectRoot, 'src/infrastructure/index.ts'), 'utf8');
    expect(srcIndex).not.toContain('SyncEngine');
  });
});

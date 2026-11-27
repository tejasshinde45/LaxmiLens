import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { queryClient as globalQueryClient } from '@/lib/queryClient';
import {
  BASE_QUERY_RETRY_DELAY_MS,
  MAX_QUERY_RETRY_ATTEMPTS,
  MAX_QUERY_RETRY_DELAY_MS,
  computeQueryRetryDelay,
  isNonRetryableError,
  isTransientRetryableError,
  shouldRetryQuery
} from '@/lib/queryRetryPolicy';
import { OFFLINE_QUERY_STALE_TIME_MS } from '@/features/sync/utils/pendingOutboxQuery';
import { AuthProvider, AuthContext, AuthContextType } from '@/features/auth/context/AuthContext';
import { AuthPort, AuthUser } from '@/application/ports/AuthPort';
import { useAccounts } from '@/features/accounts/hooks/useAccounts';
import { useAccountSync } from '@/features/accounts/hooks/useAccountSync';
import { useBorrowings } from '@/features/borrowings/hooks/useBorrowings';
import { useCategories } from '@/features/categories/hooks/useCategories';
import { useReports } from '@/features/reports/hooks/useReports';
import { defaultDatabaseManager } from '@/infrastructure/database/local/DatabaseManager';
import { defaultLegacyMigrator } from '@/infrastructure/database/local/LegacyDatabaseMigrator';
import { ReactQueryBackupCacheInvalidator } from '@/infrastructure/backup/ReactQueryBackupCacheInvalidator';
import { LaxmiLensDB } from '@/infrastructure/database/local/DexieDatabase';
import {
  DatabaseSessionError,
  InvalidDatabaseSessionError,
  MigrationConflictError,
  NoActiveDatabaseSessionError,
  StaleSessionError,
  UnauthorizedDatabaseAccessError
} from '@/infrastructure/database/local/errors/DatabaseErrors';
import {
  CategoryArchivedError,
  InvalidTransactionAmountError,
  InvalidUserIdError,
  UnauthorizedEntityAccessError
} from '@/domain/errors/DomainErrors';
import { InvalidBudgetPeriodError } from '@/domain/errors/BudgetErrors';
import {
  BackupAuthenticationError,
  BackupOwnershipMismatchError,
  BackupValidationError
} from '@/domain/errors/BackupErrors';
import {
  SyncAuthError,
  SyncConflictError,
  SyncDatabaseError,
  SyncInProgressError
} from '@/infrastructure/sync/errors/SyncErrors';
import { Category } from '@/domain/entities/Category';
import { createCategoryId, createUserId } from '@/domain/value-objects/Identifiers';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn()
  }
}));

describe('Phase 12 Stage 2C: React Query Cache & Retry Policy Hardening', () => {
  const userA = createUserId('11111111-1111-4111-8111-111111111111');
  const userB = createUserId('22222222-2222-4222-8222-222222222222');

  beforeEach(() => {
    vi.restoreAllMocks();
    globalQueryClient.clear();
  });

  afterEach(() => {
    globalQueryClient.clear();
    vi.restoreAllMocks();
  });

  describe('1. Global QueryClient defaults & offline stale-time policy', () => {
    it('configures 5m staleTime, typed retry/backoff, and disables all automatic refetch triggers', () => {
      const defaults = globalQueryClient.getDefaultOptions();
      expect(defaults.queries?.staleTime).toBe(OFFLINE_QUERY_STALE_TIME_MS);
      expect(defaults.queries?.staleTime).toBe(5 * 60 * 1000);
      expect(defaults.queries?.refetchInterval).toBe(false);
      expect(defaults.queries?.refetchOnWindowFocus).toBe(false);
      expect(defaults.queries?.refetchOnReconnect).toBe(false);
      expect(defaults.queries?.retry).toBe(shouldRetryQuery);
      expect(defaults.queries?.retryDelay).toBe(computeQueryRetryDelay);
      expect(defaults.mutations?.retry).toBe(false);
    });

    it('keeps useAccounts, useCategories, useBorrowings, useReports, and useAccountSync warm across remounts and reconnects without auto-syncing', async () => {
      const qc = new QueryClient({
        defaultOptions: globalQueryClient.getDefaultOptions()
      });

      const getAccountsExec = vi.fn(async () => []);
      const findCategoriesByUser = vi.fn(async () => [
        new Category({
          id: createCategoryId('cccc0000-0000-4000-8000-000000000001'),
          userId: userA,
          name: 'Groceries',
          type: 'expense'
        })
      ]);
      const getBorrowingsExec = vi.fn(async () => ({
        summary: {
          totalOutstandingPaise: 0,
          totalOutstandingFormatted: '₹0.00',
          totalBorrowedPaise: 0,
          totalBorrowedFormatted: '₹0.00',
          totalRepaidPaise: 0,
          totalRepaidFormatted: '₹0.00',
          activeLendersCount: 0,
          totalLendersCount: 0,
          activeBorrowingsCount: 0,
          totalBorrowingsCount: 0
        },
        lenders: [],
        borrowings: [],
        repayments: []
      }));
      const generateReportExec = vi.fn(async () => ({
        reportType: 'summary',
        periodLabel: 'Current Month',
        totals: {
          totalIncomePaise: 0,
          totalExpensePaise: 0,
          netCashFlowPaise: 0,
          transactionCount: 0
        },
        accountBalances: [],
        categoryBreakdown: []
      }));
      const getPendingCount = vi.fn(async () => 0);
      const syncRunSpy = vi.fn();

      vi.spyOn(defaultDatabaseManager, 'getActiveRepositories').mockResolvedValue({
        getAccountsUseCase: { execute: getAccountsExec },
        categoryRepo: { findByUserId: findCategoriesByUser, seedDefaults: vi.fn() },
        getBorrowingsUseCase: { execute: getBorrowingsExec },
        generateFinancialReportUseCase: { execute: generateReportExec }
      } as any);

      vi.spyOn(defaultDatabaseManager, 'getActiveSyncCoordinator').mockResolvedValue({
        getPendingCount,
        run: syncRunSpy
      } as any);

      const authValue: AuthContextType = {
        user: { id: userA, email: 'cache@laxmilens.app' },
        isLoading: false,
        isAuthenticated: true,
        signIn: vi.fn(),
        signUp: vi.fn(),
        signInWithGoogle: vi.fn(),
        signOut: vi.fn(),
        resetPassword: vi.fn(),
        updatePassword: vi.fn()
      };

      const Harness: React.FC = () => {
        const acc = useAccounts();
        const cats = useCategories();
        const borrowings = useBorrowings();
        const reports = useReports();
        const sync = useAccountSync();
        return (
          <div data-testid="ready">
            {String(acc.isLoading || cats.isLoading || borrowings.isLoading || reports.isLoading)}-
            {sync.pendingCount}
          </div>
        );
      };

      const renderHarness = () =>
        render(
          <AuthContext.Provider value={authValue}>
            <QueryClientProvider client={qc}>
              <Harness />
            </QueryClientProvider>
          </AuthContext.Provider>
        );

      const first = renderHarness();
      await waitFor(() => {
        expect(first.getByTestId('ready').textContent).toBe('false-0');
      });

      expect(getAccountsExec).toHaveBeenCalledTimes(1);
      expect(findCategoriesByUser).toHaveBeenCalledTimes(1);
      expect(getBorrowingsExec).toHaveBeenCalledTimes(1);
      expect(generateReportExec).toHaveBeenCalledTimes(1);
      expect(getPendingCount).toHaveBeenCalledTimes(1);
      expect(syncRunSpy).not.toHaveBeenCalled();

      // Unmount & remount within 5m staleTime + dispatch network online reconnect event
      first.unmount();
      act(() => {
        window.dispatchEvent(new Event('online'));
      });

      const second = renderHarness();
      await waitFor(() => {
        expect(second.getByTestId('ready').textContent).toBe('false-0');
      });

      // Remounting and reconnect must NOT trigger refetches or cloud sync
      expect(getAccountsExec).toHaveBeenCalledTimes(1);
      expect(findCategoriesByUser).toHaveBeenCalledTimes(1);
      expect(getBorrowingsExec).toHaveBeenCalledTimes(1);
      expect(generateReportExec).toHaveBeenCalledTimes(1);
      expect(getPendingCount).toHaveBeenCalledTimes(1);
      expect(syncRunSpy).not.toHaveBeenCalled();

      // Explicit check on query observer options stored in QueryCache (while second mount is active)
      const reportQuery = qc.getQueryCache().find({ queryKey: ['reports', userA], exact: false });
      expect(reportQuery).toBeDefined();
      const observerStaleTime = (
        reportQuery?.observers[0]?.options as { staleTime?: number } | undefined
      )?.staleTime;
      expect(observerStaleTime).toBe(OFFLINE_QUERY_STALE_TIME_MS);

      second.unmount();
      qc.clear();
    });
  });

  describe('2. Mutation invalidation, user-scoped isolation, user switch, and backup invalidation', () => {
    it('invalidates user-scoped accounts, syncPendingCount, and reports immediately after local mutation', async () => {
      const qc = new QueryClient({
        defaultOptions: globalQueryClient.getDefaultOptions()
      });

      let balance = 100000;
      const getAccountsExec = vi.fn(async () => [
        {
          id: 'acc-1',
          userId: userA,
          name: 'Checking',
          accountType: 'bank' as const,
          openingBalancePaise: balance,
          openingBalanceFormatted: '₹1,000.00',
          currentBalancePaise: balance,
          currentBalanceFormatted: '₹1,000.00',
          currency: 'INR',
          isArchived: false,
          isCreditCard: false,
          version: 1,
          createdAt: '2026-11-01T00:00:00.000Z',
          updatedAt: '2026-11-01T00:00:00.000Z'
        }
      ]);
      const createAccountExec = vi.fn(async () => {
        balance = 250000;
        return {
          id: 'acc-2',
          userId: userA,
          name: 'Savings',
          accountType: 'savings',
          openingBalancePaise: 150000,
          openingBalanceFormatted: '₹1,500.00',
          currentBalancePaise: 150000,
          currentBalanceFormatted: '₹1,500.00',
          currency: 'INR',
          isArchived: false,
          isCreditCard: false,
          version: 1,
          createdAt: '2026-11-01T00:00:00.000Z',
          updatedAt: '2026-11-01T00:00:00.000Z'
        };
      });

      vi.spyOn(defaultDatabaseManager, 'getActiveRepositories').mockResolvedValue({
        getAccountsUseCase: { execute: getAccountsExec },
        createAccountUseCase: { execute: createAccountExec }
      } as any);

      const authValue: AuthContextType = {
        user: { id: userA, email: 'mutate@laxmilens.app' },
        isLoading: false,
        isAuthenticated: true,
        signIn: vi.fn(),
        signUp: vi.fn(),
        signInWithGoogle: vi.fn(),
        signOut: vi.fn(),
        resetPassword: vi.fn(),
        updatePassword: vi.fn()
      };

      const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

      let triggerCreate!: () => Promise<unknown>;
      const Harness: React.FC = () => {
        const acc = useAccounts();
        triggerCreate = () =>
          acc.createAccount({
            name: 'Savings',
            accountType: 'savings',
            openingBalance: '1500'
          });
        return <span data-testid="bal">{acc.accounts[0]?.currentBalancePaise ?? 0}</span>;
      };

      const view = render(
        <AuthContext.Provider value={authValue}>
          <QueryClientProvider client={qc}>
            <Harness />
          </QueryClientProvider>
        </AuthContext.Provider>
      );

      await waitFor(() => {
        expect(view.getByTestId('bal').textContent).toBe('100000');
      });

      await act(async () => {
        await triggerCreate();
      });

      await waitFor(() => {
        expect(view.getByTestId('bal').textContent).toBe('250000');
      });

      const invalidatedKeys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
      expect(invalidatedKeys).toContain(JSON.stringify(['accounts', userA]));
      expect(invalidatedKeys).toContain(JSON.stringify(['syncPendingCount', userA]));
      expect(invalidatedKeys).toContain(JSON.stringify(['reports', userA]));

      view.unmount();
      qc.clear();
    });

    it('isolates cached entries per user, clears cache & cancels in-flight queries on user switching and sign-out, and handles backup invalidation safely', async () => {
      const qc = new QueryClient({
        defaultOptions: globalQueryClient.getDefaultOptions()
      });

      let authCallback: ((u: AuthUser | null) => void) | null = null;
      const mockAdapter: AuthPort = {
        getCurrentUser: vi.fn().mockResolvedValue({ id: userA, email: 'userA@example.com' }),
        signInWithEmail: vi.fn(),
        signUpWithEmail: vi.fn(),
        signInWithOAuth: vi.fn(),
        signOut: vi.fn().mockResolvedValue(undefined),
        resetPasswordForEmail: vi.fn(),
        updatePassword: vi.fn(),
        onAuthStateChange: vi.fn().mockImplementation((cb) => {
          authCallback = cb;
          return () => {};
        })
      };

      const openSpy = vi.spyOn(defaultDatabaseManager, 'openForUser').mockImplementation(
        async (uid: string) => ({ name: `LaxmiLens_LocalDB_${uid}`, isOpen: () => true }) as LaxmiLensDB
      );
      vi.spyOn(defaultDatabaseManager, 'closeCurrentDatabase').mockResolvedValue(undefined);
      vi.spyOn(defaultLegacyMigrator, 'migrate').mockImplementation(async (uid: string) => ({
        userId: uid,
        accountsMigrated: 0,
        transactionsMigrated: 0,
        categoriesMigrated: 0,
        profilesMigrated: 0,
        outboxEntriesMigrated: 0,
        skippedForeignRecords: 0,
        skippedAmbiguousRecords: 0,
        alreadyMigratedRecords: 0,
        isComplete: true,
        errors: []
      }));

      const cancelSpy = vi.spyOn(qc, 'cancelQueries');
      const clearSpy = vi.spyOn(qc, 'clear');

      const Consumer: React.FC = () => {
        const { user, isLoading } = React.useContext(AuthContext)!;
        return <div data-testid="active-user">{isLoading ? 'loading' : user?.id ?? 'none'}</div>;
      };

      const view = render(
        <QueryClientProvider client={qc}>
          <AuthProvider authAdapter={mockAdapter}>
            <Consumer />
          </AuthProvider>
        </QueryClientProvider>
      );

      await waitFor(() => {
        expect(view.getByTestId('active-user').textContent).toBe(userA);
      });

      // Populate User A scoped cache entries
      qc.setQueryData(['accounts', userA], [{ id: 'a-secret', name: 'User A Private Vault' }]);
      qc.setQueryData(['transactions', userA], [{ id: 'tx-a-1' }]);
      qc.setQueryData(['reports', userA, 'summary'], { totalIncomePaise: 900000 });
      expect(qc.getQueryData(['accounts', userB])).toBeUndefined();

      // Switch directly to User B
      act(() => {
        authCallback?.({ id: userB, email: 'userB@example.com' });
      });

      await waitFor(() => {
        expect(view.getByTestId('active-user').textContent).toBe(userB);
      });

      expect(openSpy).toHaveBeenCalledWith(userB);
      expect(cancelSpy).toHaveBeenCalled();
      expect(clearSpy).toHaveBeenCalled();
      expect(qc.getQueryData(['accounts', userA])).toBeUndefined();
      expect(qc.getQueryData(['transactions', userA])).toBeUndefined();
      expect(qc.getQueryData(['reports', userA, 'summary'])).toBeUndefined();

      // Populate User B cache, verify backup invalidator only targets User B (and clears on sign-out)
      qc.setQueryData(['accounts', userB], [{ id: 'b-checking' }]);
      qc.setQueryData(['accounts', userA], [{ id: 'stale-a' }]);

      const syncSpy = vi.spyOn(qc, 'invalidateQueries');
      const backupInvalidator = new ReactQueryBackupCacheInvalidator(qc);
      await backupInvalidator.invalidateUserCaches(userB);

      const backupInvalidated = syncSpy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
      expect(backupInvalidated).toContain(JSON.stringify(['accounts', userB]));
      expect(backupInvalidated).toContain(JSON.stringify(['pendingOutboxEntries', userB]));
      expect(backupInvalidated).not.toContain(JSON.stringify(['accounts', userA]));

      // Sign out removes all cached user state
      act(() => {
        authCallback?.(null);
      });

      await waitFor(() => {
        expect(view.getByTestId('active-user').textContent).toBe('none');
      });
      expect(qc.getQueryData(['accounts', userB])).toBeUndefined();

      view.unmount();
      qc.clear();
    });
  });

  describe('3. Typed Retry Policy & Bounded Backoff', () => {
    it('retries genuinely transient errors with bounded exponential backoff up to MAX_QUERY_RETRY_ATTEMPTS', () => {
      expect(computeQueryRetryDelay(0)).toBe(BASE_QUERY_RETRY_DELAY_MS);
      expect(computeQueryRetryDelay(1)).toBe(BASE_QUERY_RETRY_DELAY_MS * 2);
      expect(computeQueryRetryDelay(4)).toBe(MAX_QUERY_RETRY_DELAY_MS);

      const transientErrors: unknown[] = [
        new TypeError('Failed to fetch'),
        new TypeError('NetworkError when attempting to fetch resource.'),
        new DOMException('Transaction timed out after 4000ms', 'TimeoutError'),
        new DOMException('Transaction aborted', 'AbortError'),
        new DOMException('Inactive transaction', 'TransactionInactiveError'),
        new DOMException('Temporary unknown IDB error', 'UnknownError'),
        Object.assign(new Error('Too Many Requests'), { status: 429 }),
        Object.assign(new Error('Request Timeout'), { statusCode: 408 }),
        Object.assign(new Error('Internal Server Error'), { status: 500 }),
        Object.assign(new Error('Service Unavailable'), { response: { status: 503 } }),
        Object.assign(new Error('Gateway Timeout'), { cause: { status: 504 } }),
        Object.assign(new Error('Socket timeout'), { code: 'ETIMEDOUT' }),
        Object.assign(new Error('Storage lock'), { isTransient: true }),
        new SyncDatabaseError('Gateway error', 'PGRST500'),
        new SyncDatabaseError('Statement timeout', '57014'),
        new SyncDatabaseError('Connection drop', '08006'),
        new Error('IndexedDB request timed out while reading')
      ];

      for (const err of transientErrors) {
        expect(isTransientRetryableError(err)).toBe(true);
        expect(isNonRetryableError(err)).toBe(false);
        expect(shouldRetryQuery(0, err)).toBe(true);
        expect(shouldRetryQuery(1, err)).toBe(true);
        expect(shouldRetryQuery(MAX_QUERY_RETRY_ATTEMPTS, err)).toBe(false);
      }
    });

    it('never retries permanent domain, validation, authorization, session, or client HTTP errors', () => {
      const zodIssue = z.string().uuid().safeParse('not-uuid');
      const zodError = zodIssue.success ? new Error('unexpected') : zodIssue.error;

      const nonRetryableErrors: unknown[] = [
        new NoActiveDatabaseSessionError(),
        new StaleSessionError(),
        new InvalidDatabaseSessionError(),
        new UnauthorizedDatabaseAccessError(userA, userB),
        new (class CustomSessionErr extends DatabaseSessionError {})('Session lost'),
        new MigrationConflictError('transactions', 'tx-1', 'Conflict'),
        new InvalidUserIdError(),
        new UnauthorizedEntityAccessError('Account', 'acc-1'),
        new InvalidTransactionAmountError(),
        new CategoryArchivedError('cat-1'),
        new InvalidBudgetPeriodError(),
        new BackupAuthenticationError(),
        new BackupOwnershipMismatchError(),
        new BackupValidationError('Bad backup', []),
        new SyncAuthError('Token invalid'),
        new SyncConflictError('Version mismatch'),
        new SyncInProgressError(),
        new SyncDatabaseError('RLS violation', '42501'),
        new SyncDatabaseError('Duplicate key', '23505'),
        new DOMException('Unique constraint failed', 'ConstraintError'),
        new DOMException('Invalid key type', 'DataError'),
        new DOMException('Storage full', 'QuotaExceededError'),
        new DOMException('Closed manually', 'DatabaseClosedError'),
        Object.assign(new Error('Bad Request'), { status: 400 }),
        Object.assign(new Error('Unauthorized'), { status: 401 }),
        Object.assign(new Error('Forbidden'), { statusCode: 403 }),
        Object.assign(new Error('Not Found'), { status: 404 }),
        Object.assign(new Error('Unprocessable Entity'), { response: { status: 422 } }),
        new TypeError("Cannot read properties of undefined (reading 'amountPaise')"),
        zodError
      ];

      for (const err of nonRetryableErrors) {
        expect(isNonRetryableError(err)).toBe(true);
        expect(isTransientRetryableError(err)).toBe(false);
        expect(shouldRetryQuery(0, err)).toBe(false);
      }
    });

    it('does not misclassify errors solely because their messages contain numeric digits', () => {
      // Genuine transient errors whose messages contain '4' or '404' MUST still retry
      const transientWithDigits = [
        new Error('IndexedDB request timed out after 4000ms'),
        Object.assign(new Error('Upstream replica 404 temporarily unavailable (HTTP 503)'), {
          status: 503
        }),
        Object.assign(new Error('Rate limit hit: retry after 4 seconds (HTTP 429)'), {
          status: 429
        }),
        new DOMException('Transaction aborted on step 4', 'AbortError')
      ];

      for (const err of transientWithDigits) {
        expect(shouldRetryQuery(0, err)).toBe(true);
      }

      // Arbitrary untyped errors containing '404' or '400' in prose must NOT be classified as HTTP statuses
      // or retried blindly as transient failures
      const untypedProseError = new Error('Record lookup 404 invariant mismatch on account #4');
      expect(isNonRetryableError(untypedProseError)).toBe(false);
      expect(isTransientRetryableError(untypedProseError)).toBe(false);
      expect(shouldRetryQuery(0, untypedProseError)).toBe(false);

      // Even a non-retryable DomainError containing digits stays non-retryable
      const domainWithDigits = new InvalidUserIdError('User ID 503400 is malformed');
      expect(isNonRetryableError(domainWithDigits)).toBe(true);
      expect(shouldRetryQuery(0, domainWithDigits)).toBe(false);
    });

    it('executes bounded retries in TanStack Query for transient failures and aborts immediately on session/validation failures', async () => {
      const qc = new QueryClient({
        defaultOptions: {
          queries: {
            ...globalQueryClient.getDefaultOptions().queries,
            retryDelay: () => 1
          },
          mutations: globalQueryClient.getDefaultOptions().mutations
        }
      });

      let transientAttempts = 0;
      let permanentAttempts = 0;

      const RetryProbe: React.FC = () => {
        const transientQ = useQuery({
          queryKey: ['probe-transient', userA],
          queryFn: async () => {
            transientAttempts += 1;
            if (transientAttempts < 3) {
              throw new DOMException('Temporary timeout after 400ms', 'TimeoutError');
            }
            return 'recovered-on-third-attempt';
          }
        });

        const permanentQ = useQuery({
          queryKey: ['probe-permanent', userA],
          queryFn: async () => {
            permanentAttempts += 1;
            throw new NoActiveDatabaseSessionError();
          }
        });

        return (
          <div>
            <span data-testid="transient-status">
              {transientQ.data ?? transientQ.status}
            </span>
            <span data-testid="permanent-status">{permanentQ.status}</span>
          </div>
        );
      };

      const view = render(
        <QueryClientProvider client={qc}>
          <RetryProbe />
        </QueryClientProvider>
      );

      await waitFor(() => {
        expect(view.getByTestId('transient-status').textContent).toBe('recovered-on-third-attempt');
        expect(view.getByTestId('permanent-status').textContent).toBe('error');
      });

      expect(transientAttempts).toBe(3); // 1 initial + 2 retries
      expect(permanentAttempts).toBe(1); // 0 retries on missing DB session

      view.unmount();
      qc.clear();
    });

    it('preserves manual Sync Now retry semantics (no auto-retry on mutation failure, explicit Sync Now retries cleanly)', async () => {
      const qc = new QueryClient({
        defaultOptions: globalQueryClient.getDefaultOptions()
      });

      let syncInvocation = 0;
      const runSpy = vi.fn(async () => {
        syncInvocation += 1;
        if (syncInvocation === 1) {
          throw new Error('Network error during manual push');
        }
        return {
          totalPending: 0,
          totalProcessed: 1,
          syncedCount: 1,
          failedCount: 0,
          skippedCount: 0,
          unsupportedCount: 0,
          stillPendingCount: 0,
          pulledCount: 0,
          accounts: { syncedCount: 1, failedCount: 0, skippedCount: 0 },
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
          notificationPreferences: {
            syncedCount: 0,
            failedCount: 0,
            skippedCount: 0,
            pulledCount: 0
          },
          errors: []
        };
      });

      vi.spyOn(defaultDatabaseManager, 'getActiveSyncCoordinator').mockResolvedValue({
        getPendingCount: vi.fn().mockResolvedValue(1),
        run: runSpy
      } as any);

      const authValue: AuthContextType = {
        user: { id: userA, email: 'sync@laxmilens.app' },
        isLoading: false,
        isAuthenticated: true,
        signIn: vi.fn(),
        signUp: vi.fn(),
        signInWithGoogle: vi.fn(),
        signOut: vi.fn(),
        resetPassword: vi.fn(),
        updatePassword: vi.fn()
      };

      let syncFn!: () => Promise<unknown>;
      const SyncHarness: React.FC = () => {
        const { syncNow } = useAccountSync();
        syncFn = syncNow;
        return <div data-testid="sync-ready">ok</div>;
      };

      const view = render(
        <AuthContext.Provider value={authValue}>
          <QueryClientProvider client={qc}>
            <SyncHarness />
          </QueryClientProvider>
        </AuthContext.Provider>
      );

      // First manual Sync Now failure must NOT auto-retry in the background
      await expect(syncFn()).rejects.toThrow('Network error during manual push');
      expect(runSpy).toHaveBeenCalledTimes(1);

      // Second explicit Sync Now click executes and succeeds
      await expect(syncFn()).resolves.toMatchObject({ syncedCount: 1, failedCount: 0 });
      expect(runSpy).toHaveBeenCalledTimes(2);

      view.unmount();
      qc.clear();
    });
  });
});

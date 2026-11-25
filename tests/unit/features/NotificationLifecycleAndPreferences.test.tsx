import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  evaluateAlertsNow,
  resetNotificationEvaluationState,
  runInitialSessionEvaluation
} from '@/features/notifications/services/financialAlertEvaluator';
import { useInitialFinancialAlertEvaluation } from '@/features/notifications/hooks/useInitialFinancialAlertEvaluation';
import { NotificationPreferencesSection } from '@/features/notifications/components/NotificationPreferencesSection';
import { useAccountSync } from '@/features/accounts/hooks/useAccountSync';
import { notificationQueryKeys } from '@/features/notifications/hooks/notificationQueryKeys';
import { defaultDatabaseManager } from '@/infrastructure/database/local/DatabaseManager';
import * as useAuthModule from '@/features/auth/hooks/useAuth';
import {
  Account,
  Budget,
  Category,
  Money,
  Notification,
  NotificationPreference,
  RecurringRule,
  Transaction,
  createAccountId,
  createBudgetId,
  createCategoryId,
  createRecurringRuleId,
  createTransactionId,
  createUserId
} from '@/domain';
import {
  EvaluateFinancialAlertsUseCase,
  GetBudgetsOverviewUseCase,
  GetNotificationPreferencesUseCase,
  GetRecurringOverviewUseCase,
  UpdateNotificationPreferencesUseCase
} from '@/application';
import { NotificationRepository } from '@/domain/repositories/NotificationRepository';
import { NotificationPreferenceRepository } from '@/domain/repositories/NotificationPreferenceRepository';
import { BudgetRepository } from '@/domain/repositories/BudgetRepository';
import { TransactionRepository } from '@/domain/repositories/TransactionRepository';
import { CategoryRepository } from '@/domain/repositories/CategoryRepository';
import { RecurringRuleRepository } from '@/domain/repositories/RecurringRuleRepository';
import { RecurringOccurrenceRepository } from '@/domain/repositories/RecurringOccurrenceRepository';
import { AccountRepository } from '@/domain/repositories/AccountRepository';
import { SyncPort } from '@/application/ports/SyncPort';
import { UnitOfWork } from '@/application/ports/UnitOfWork';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn()
  }
}));

const USER_A = createUserId('11111111-1111-4111-8111-111111111111');
const USER_B = createUserId('22222222-2222-4222-8222-222222222222');
const ACC_ID = createAccountId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
const CAT_FOOD_ID = createCategoryId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
const CAT_RENT_ID = createCategoryId('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
const BUDGET_ID = createBudgetId('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
const RULE_ID = createRecurringRuleId('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');

describe('Phase 9 Stage 5: Lifecycle Evaluation, Preferences & Sync Integration', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    resetNotificationEvaluationState();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false }
      }
    });
  });

  const buildAlertHarness = () => {
    const notifications = new Map<string, Notification>();
    const preferences = new Map<string, NotificationPreference>();
    const outbox: Array<Record<string, unknown>> = [];
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const todayStr = `${yyyy}-${mm}-${dd}`;
    const currentPeriod = `${yyyy}-${mm}`;

    const accounts = [
      new Account({
        id: ACC_ID,
        userId: USER_A,
        name: 'Primary Bank',
        accountType: 'bank',
        openingBalancePaise: 5_000_000
      })
    ];
    const categories = [
      new Category({
        id: CAT_FOOD_ID,
        userId: USER_A,
        name: 'Food',
        type: 'expense'
      }),
      new Category({
        id: CAT_RENT_ID,
        userId: USER_A,
        name: 'Utilities',
        type: 'expense'
      })
    ];
    const budgets = [
      new Budget({
        id: BUDGET_ID,
        userId: USER_A,
        categoryId: CAT_FOOD_ID,
        period: currentPeriod,
        limitPaise: 1_000_000
      })
    ];
    const transactions: Transaction[] = [
      new Transaction({
        id: createTransactionId('77777777-7777-4777-8777-777777777771'),
        userId: USER_A,
        accountId: ACC_ID,
        categoryId: CAT_FOOD_ID,
        type: 'expense',
        amountPaise: 850_000, // 85%
        title: 'Groceries',
        transactionDate: today,
        idempotencyKey: 'tx-1'
      })
    ];
    const rules: RecurringRule[] = [
      new RecurringRule({
        id: RULE_ID,
        userId: USER_A,
        title: 'Broadband',
        type: 'expense',
        amount: Money.fromPaise(99_900),
        accountId: ACC_ID,
        categoryId: CAT_RENT_ID,
        frequency: 'monthly',
        interval: 1,
        startDate: todayStr,
        nextDueDate: todayStr,
        status: 'active'
      })
    ];

    const notificationRepo: NotificationRepository = {
      findById: async (id, userId) => {
        const item = notifications.get(id);
        return item && item.userId === userId ? item : null;
      },
      findByDedupeKey: async (userId, key) =>
        Array.from(notifications.values()).find(
          (n) => n.userId === userId && n.dedupeKey === key
        ) ?? null,
      findAll: async (userId) =>
        Array.from(notifications.values()).filter((n) => n.userId === userId),
      countUnread: async (userId) =>
        Array.from(notifications.values()).filter(
          (n) => n.userId === userId && n.status === 'unread'
        ).length,
      save: async (n) => {
        notifications.set(n.id, n);
      },
      saveMany: async (list) => {
        for (const n of list) notifications.set(n.id, n);
      }
    };
    const prefRepo: NotificationPreferenceRepository = {
      findByUserId: async (userId) => preferences.get(userId) ?? null,
      save: async (p) => {
        preferences.set(p.userId, p);
      }
    };
    const budgetRepo: BudgetRepository = {
      findById: async (id) => budgets.find((b) => b.id === id) ?? null,
      findByPeriod: async (period, userId) =>
        budgets.filter((b) => b.userId === userId && b.period === period),
      findByCategoryAndPeriod: async () => null,
      save: async () => {},
      delete: async () => {}
    };
    const txRepo: TransactionRepository = {
      findById: async () => null,
      findByIdempotencyKey: async () => null,
      findByAccount: async () => [],
      findMany: async (f) => transactions.filter((t) => t.userId === f.userId),
      save: async () => {},
      saveBatch: async () => {},
      softDelete: async () => {}
    };
    const catRepo: CategoryRepository = {
      findById: async (id) => categories.find((c) => c.id === id) ?? null,
      findByUserId: async (userId) => categories.filter((c) => c.userId === userId),
      findAll: async (userId) => categories.filter((c) => c.userId === userId),
      save: async () => {},
      saveBatch: async () => {},
      archive: async () => {},
      seedDefaults: async () => []
    };
    const ruleRepo: RecurringRuleRepository = {
      findById: async () => null,
      findAll: async (userId) => rules.filter((r) => r.userId === userId),
      findByStatus: async () => [],
      save: async () => {},
      delete: async () => {}
    };
    const occRepo: RecurringOccurrenceRepository = {
      findById: async () => null,
      findByRuleAndDate: async () => null,
      findByTransactionId: async () => null,
      findAll: async () => [],
      save: async () => {}
    };
    const accRepo: AccountRepository = {
      findById: async () => null,
      findByUserId: async (userId) => accounts.filter((a) => a.userId === userId),
      findAll: async (userId) => accounts.filter((a) => a.userId === userId),
      save: async () => {},
      saveBatch: async () => {},
      archive: async () => {},
      restore: async () => {}
    };
    const syncPort: SyncPort = {
      enqueue: async (e) => {
        outbox.push(e as unknown as Record<string, unknown>);
      },
      processOutbox: async () => ({
        pushedCount: 0,
        pulledCount: 0,
        conflictsCount: 0,
        errors: []
      }),
      getPendingCount: async () => outbox.length,
      clearOutbox: async () => {}
    };
    const unitOfWork: UnitOfWork = {
      run: async (work) => work()
    };

    const evaluateFinancialAlertsUseCase = new EvaluateFinancialAlertsUseCase(
      notificationRepo,
      prefRepo,
      new GetBudgetsOverviewUseCase(budgetRepo, txRepo, catRepo),
      new GetRecurringOverviewUseCase(ruleRepo, occRepo, accRepo, catRepo),
      syncPort,
      unitOfWork
    );
    const getNotificationPreferencesUseCase = new GetNotificationPreferencesUseCase(prefRepo);
    const updateNotificationPreferencesUseCase = new UpdateNotificationPreferencesUseCase(
      prefRepo,
      syncPort,
      unitOfWork
    );

    return {
      notifications,
      preferences,
      outbox,
      transactions,
      today,
      evaluateFinancialAlertsUseCase,
      getNotificationPreferencesUseCase,
      updateNotificationPreferencesUseCase
    };
  };

  it('evaluates recurring and budget alerts once on authenticated session ready without repeating on React rerenders', async () => {
    const harness = buildAlertHarness();
    const executeSpy = vi.spyOn(harness.evaluateFinancialAlertsUseCase, 'execute');

    vi.spyOn(defaultDatabaseManager, 'getActiveUserId').mockReturnValue(USER_A);
    vi.spyOn(defaultDatabaseManager, 'getActiveRepositories').mockResolvedValue({
      evaluateFinancialAlertsUseCase: harness.evaluateFinancialAlertsUseCase
    } as any);

    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
      user: { id: USER_A, email: 'test@laxmilens.local' },
      isAuthenticated: true,
      isLoading: false
    } as any);

    const LifecycleProbe: React.FC<{ count: number }> = ({ count }) => {
      useInitialFinancialAlertEvaluation(queryClient);
      return <div>Render {count}</div>;
    };

    const { rerender } = render(<LifecycleProbe count={1} />);

    await waitFor(() => {
      expect(executeSpy).toHaveBeenCalledTimes(1);
      expect(harness.notifications.size).toBe(2); // 1 budget warning (85%) + 1 recurring dueToday
    });

    // React rerenders MUST NOT trigger duplicate evaluations
    rerender(<LifecycleProbe count={2} />);
    rerender(<LifecycleProbe count={3} />);
    await waitFor(() => {
      expect(executeSpy).toHaveBeenCalledTimes(1);
    });

    // Repeated evaluation is idempotent and upgrades 85% -> 105% on budget_warning -> budget_exceeded
    const noChangeResult = await evaluateAlertsNow(USER_A, queryClient);
    expect(noChangeResult?.createdCount).toBe(0);
    expect(noChangeResult?.updatedCount).toBe(0);

    harness.transactions.push(
      new Transaction({
        id: createTransactionId('77777777-7777-4777-8777-777777777772'),
        userId: USER_A,
        accountId: ACC_ID,
        categoryId: CAT_FOOD_ID,
        type: 'expense',
        amountPaise: 200_000, // pushes spend to 105%
        title: 'Dinner',
        transactionDate: harness.today,
        idempotencyKey: 'tx-2'
      })
    );

    const promotedResult = await evaluateAlertsNow(USER_A, queryClient);
    expect(promotedResult?.updatedCount).toBe(1);
    expect(harness.notifications.size).toBe(2); // Single budget notification promoted in-place
    const budgetNotif = Array.from(harness.notifications.values()).find(
      (n) => n.entityType === 'budget'
    );
    expect(budgetNotif?.category).toBe('budget_exceeded');
    expect(budgetNotif?.severity).toBe('critical');
  });

  it('prevents cross-user evaluation when active database session belongs to another user', async () => {
    const harness = buildAlertHarness();
    const executeSpy = vi.spyOn(harness.evaluateFinancialAlertsUseCase, 'execute');

    vi.spyOn(defaultDatabaseManager, 'getActiveUserId').mockReturnValue(USER_A);
    vi.spyOn(defaultDatabaseManager, 'getActiveRepositories').mockResolvedValue({
      evaluateFinancialAlertsUseCase: harness.evaluateFinancialAlertsUseCase
    } as any);

    const res = await runInitialSessionEvaluation(USER_B, queryClient);
    expect(res).toBeNull();
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it('loads default preferences without implicit DB writes, validates lead days 0..30, and saves updates cleanly', async () => {
    const harness = buildAlertHarness();
    const prefSaveSpy = vi.spyOn(harness.updateNotificationPreferencesUseCase, 'execute');

    vi.spyOn(defaultDatabaseManager, 'getActiveUserId').mockReturnValue(USER_A);
    vi.spyOn(defaultDatabaseManager, 'getActiveRepositories').mockResolvedValue({
      getNotificationPreferencesUseCase: harness.getNotificationPreferencesUseCase,
      updateNotificationPreferencesUseCase: harness.updateNotificationPreferencesUseCase,
      evaluateFinancialAlertsUseCase: harness.evaluateFinancialAlertsUseCase
    } as any);

    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
      user: { id: USER_A, email: 'test@laxmilens.local' },
      isAuthenticated: true,
      isLoading: false
    } as any);

    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <NotificationPreferencesSection />
        </QueryClientProvider>
      </MemoryRouter>
    );

    const recurringSwitch = await screen.findByRole('switch', {
      name: 'Recurring Payment Reminders'
    });
    const leadDaysInput = (await screen.findByLabelText(
      'Upcoming Reminder Lead Days'
    )) as HTMLInputElement;
    expect(screen.getByText('Default Settings')).toBeInTheDocument();
    expect(recurringSwitch).toHaveAttribute('aria-checked', 'true');
    expect(leadDaysInput.value).toBe('3');

    // No implicit record persisted during initial read
    expect(harness.preferences.size).toBe(0);
    expect(harness.outbox.length).toBe(0);

    // Out-of-range lead days shows validation error and blocks save
    fireEvent.change(leadDaysInput, { target: { value: '31' } });
    expect(
      screen.getByText(/Upcoming lead days must be a whole number between 0 and 30/i)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Preferences' })).toBeDisabled();

    // Valid update saves to repository and updates query cache + outbox
    fireEvent.change(leadDaysInput, { target: { value: '7' } });
    fireEvent.click(recurringSwitch);
    const saveBtn = screen.getByRole('button', { name: 'Save Preferences' });
    expect(saveBtn).not.toBeDisabled();
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(prefSaveSpy).toHaveBeenCalledWith({
        userId: USER_A,
        recurringPaymentEnabled: false,
        budgetWarningEnabled: true,
        budgetExceededEnabled: true,
        upcomingLeadDays: 7
      });
    });

    expect(harness.preferences.get(USER_A)?.upcomingLeadDays).toBe(7);
    expect(harness.preferences.get(USER_A)?.recurringPaymentEnabled).toBe(false);
    expect(
      harness.outbox.some((e) => e.entity === 'notification_preferences')
    ).toBe(true);
  });

  it('invalidates notification & preference queries after successful sync and skips notification invalidation on failed sync', async () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const mockCoordinatorRun = vi.fn();

    vi.spyOn(defaultDatabaseManager, 'getActiveUserId').mockReturnValue(USER_A);
    vi.spyOn(defaultDatabaseManager, 'getActiveSyncCoordinator').mockResolvedValue({
      getPendingCount: vi.fn().mockResolvedValue(0),
      run: mockCoordinatorRun
    } as any);
    vi.spyOn(defaultDatabaseManager, 'getActiveRepositories').mockResolvedValue({
      evaluateFinancialAlertsUseCase: {
        execute: vi.fn().mockResolvedValue({
          createdCount: 0,
          updatedCount: 0,
          unchangedCount: 0,
          unreadCount: 0,
          evaluatedAt: '2026-05-15T00:00:00.000Z'
        })
      }
    } as any);

    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
      user: { id: USER_A, email: 'test@laxmilens.local' },
      isAuthenticated: true,
      isLoading: false
    } as any);

    let capturedSync!: () => Promise<unknown>;
    const SyncHarness: React.FC = () => {
      const { syncNow } = useAccountSync(queryClient);
      capturedSync = syncNow;
      return <div>Sync Harness</div>;
    };

    render(<SyncHarness />);

    // 1. Failed sync must NOT invalidate notification or preference caches
    mockCoordinatorRun.mockResolvedValueOnce({
      totalPending: 1,
      totalProcessed: 1,
      syncedCount: 0,
      failedCount: 1,
      skippedCount: 0,
      unsupportedCount: 0,
      stillPendingCount: 1,
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
      borrowings: { syncedCount: 0, failedCount: 0, skippedCount: 0, dependencyBlockedCount: 0 },
      borrowing_repayments: {
        syncedCount: 0,
        failedCount: 0,
        skippedCount: 0,
        dependencyBlockedCount: 0
      },
      errors: [{ entity: 'notifications', entityId: 'n1', error: 'Conflict', category: 'conflict' }]
    });

    await capturedSync();
    expect(invalidateSpy).not.toHaveBeenCalledWith({
      queryKey: notificationQueryKeys.all(USER_A)
    });
    expect(invalidateSpy).not.toHaveBeenCalledWith({
      queryKey: notificationQueryKeys.preferences(USER_A)
    });

    // 2. Successful sync invalidates notification & preference query caches cleanly
    invalidateSpy.mockClear();
    mockCoordinatorRun.mockResolvedValueOnce({
      totalPending: 1,
      totalProcessed: 1,
      syncedCount: 1,
      failedCount: 0,
      skippedCount: 0,
      unsupportedCount: 0,
      stillPendingCount: 0,
      pulledCount: 1,
      accounts: { syncedCount: 0, failedCount: 0, skippedCount: 0 },
      categories: { syncedCount: 0, failedCount: 0, skippedCount: 0 },
      budgets: {
        syncedCount: 0,
        failedCount: 0,
        skippedCount: 0,
        categoryBlockedCount: 0,
        conflictCount: 0,
        pulledCount: 1
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
      borrowings: { syncedCount: 0, failedCount: 0, skippedCount: 0, dependencyBlockedCount: 0 },
      borrowing_repayments: {
        syncedCount: 0,
        failedCount: 0,
        skippedCount: 0,
        dependencyBlockedCount: 0
      },
      errors: []
    });

    await capturedSync();
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: notificationQueryKeys.all(USER_A)
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: notificationQueryKeys.preferences(USER_A)
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['accounts', USER_A]
    });
  });
});

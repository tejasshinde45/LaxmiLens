import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RecurringPage } from '@/features/recurring/RecurringPage';
import * as useRecurringModule from '@/features/recurring/hooks/useRecurring';
import * as useAccountsModule from '@/features/accounts/hooks/useAccounts';
import * as useCategoriesModule from '@/features/categories/hooks/useCategories';
import * as useAccountSyncModule from '@/features/accounts/hooks/useAccountSync';
import { AccountWithBalanceDTO } from '@/application';
import { Category } from '@/domain/entities/Category';
import {
  createCategoryId,
  createUserId
} from '@/domain/value-objects/Identifiers';
import { RecurringOverviewResponseDTO } from '@/application/dto/RecurringDTO';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn()
  }
}));

describe('Phase 8 UI: RecurringPage & Reminder Lifecycles', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const accId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  const catRentId = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
  const ruleRentId = '44444444-4444-4444-8444-444444444441';
  const occRentId = '55555555-5555-4555-8555-555555555551';

  const mockCreateRule = vi.fn();
  const mockUpdateRule = vi.fn();
  const mockPauseRule = vi.fn();
  const mockResumeRule = vi.fn();
  const mockDeleteRule = vi.fn();
  const mockConfirmOccurrence = vi.fn();
  const mockSkipOccurrence = vi.fn();
  const mockSnoozeOccurrence = vi.fn();
  const mockDismissOccurrence = vi.fn();
  const mockSyncNow = vi.fn();

  const accounts: AccountWithBalanceDTO[] = [
    {
      id: accId,
      userId,
      name: 'HDFC Savings',
      accountType: 'bank',
      currency: 'INR',
      openingBalancePaise: 5000000,
      openingBalanceFormatted: '₹50,000.00',
      currentBalancePaise: 5000000,
      currentBalanceFormatted: '₹50,000.00',
      isArchived: false,
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
  ];

  const categories: Category[] = [
    new Category({
      id: createCategoryId(catRentId),
      userId: createUserId(userId),
      name: 'Housing',
      type: 'expense',
      icon: 'Home',
      color: '#D6AD60',
      isArchived: false
    })
  ];

  const sampleOverview: RecurringOverviewResponseDTO = {
    summary: {
      asOfDate: '2026-11-25',
      activeSchedulesCount: 1,
      pausedSchedulesCount: 0,
      completedSchedulesCount: 0,
      overdueCount: 1,
      dueTodayCount: 0,
      upcomingCount: 0,
      snoozedCount: 0,
      totalOverdueAmountPaise: 2500000,
      totalOverdueAmountFormatted: '₹25,000.00',
      totalDueTodayAmountPaise: 0,
      totalDueTodayAmountFormatted: '₹0.00',
      totalUpcoming30DaysExpensePaise: 2500000,
      totalUpcoming30DaysExpenseFormatted: '₹25,000.00',
      totalUpcoming30DaysIncomePaise: 0,
      totalUpcoming30DaysIncomeFormatted: '₹0.00'
    },
    overdue: [
      {
        occurrenceId: occRentId,
        recurringRuleId: ruleRentId,
        userId,
        title: 'Apartment Rent',
        description: 'Monthly rent transfer',
        type: 'expense',
        amountPaise: 2500000,
        amountFormatted: '₹25,000.00',
        accountId: accId,
        accountName: 'HDFC Savings',
        categoryId: catRentId,
        categoryName: 'Housing',
        frequency: 'monthly',
        interval: 1,
        occurrenceDate: '2026-11-20',
        effectiveDueDate: '2026-11-20',
        snoozedUntilDate: null,
        status: 'pending',
        bucket: 'overdue',
        daysUntilDue: -5,
        idempotencyKey: `recurring:${ruleRentId}:2026-11-20`
      }
    ],
    dueToday: [],
    upcoming: [],
    snoozed: [],
    recentlyGenerated: [],
    schedules: [
      {
        id: ruleRentId,
        userId,
        title: 'Apartment Rent',
        description: 'Monthly rent transfer',
        type: 'expense',
        amountPaise: 2500000,
        amountFormatted: '₹25,000.00',
        accountId: accId,
        accountName: 'HDFC Savings',
        categoryId: catRentId,
        categoryName: 'Housing',
        frequency: 'monthly',
        interval: 1,
        anchorDayOfMonth: 20,
        startDate: '2026-10-20',
        endDate: null,
        nextDueDate: '2026-11-20',
        lastGeneratedDate: '2026-10-20',
        status: 'active',
        requiresUserConfirmation: true,
        previewDates: ['2026-11-20', '2026-12-20'],
        version: 1,
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-20T00:00:00.000Z'
      }
    ]
  };

  beforeEach(() => {
    vi.clearAllMocks();

    vi.spyOn(useAccountsModule, 'useAccounts').mockReturnValue({
      accounts,
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
      restoreAccount: vi.fn()
    } as any);

    vi.spyOn(useCategoriesModule, 'useCategories').mockReturnValue({
      categories,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn()
    } as any);

    vi.spyOn(useAccountSyncModule, 'useAccountSync').mockReturnValue({
      syncNow: mockSyncNow,
      isSyncing: false,
      pendingCount: 1,
      isAuthenticated: true
    } as any);

    vi.spyOn(useRecurringModule, 'useRecurring').mockReturnValue({
      overview: sampleOverview,
      summary: sampleOverview.summary,
      overdue: sampleOverview.overdue,
      dueToday: sampleOverview.dueToday,
      upcoming: sampleOverview.upcoming,
      snoozed: sampleOverview.snoozed,
      recentlyGenerated: sampleOverview.recentlyGenerated,
      schedules: sampleOverview.schedules,
      pendingRecurringIdSet: new Set([ruleRentId]),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isAuthenticated: true,
      createRule: mockCreateRule.mockResolvedValue({}),
      isCreating: false,
      updateRule: mockUpdateRule.mockResolvedValue({}),
      isUpdating: false,
      pauseRule: mockPauseRule.mockResolvedValue(undefined),
      resumeRule: mockResumeRule.mockResolvedValue(undefined),
      deleteRule: mockDeleteRule.mockResolvedValue(undefined),
      confirmOccurrence: mockConfirmOccurrence.mockResolvedValue({}),
      isConfirming: false,
      skipOccurrence: mockSkipOccurrence.mockResolvedValue(undefined),
      snoozeOccurrence: mockSnoozeOccurrence.mockResolvedValue(undefined),
      dismissOccurrence: mockDismissOccurrence.mockResolvedValue(undefined)
    });
  });

  const renderPage = () =>
    render(
      <MemoryRouter>
        <RecurringPage />
      </MemoryRouter>
    );

  it('renders recurring summary, overdue reminders, pending sync indicator, and schedules tab', async () => {
    renderPage();

    expect(screen.getByText('Recurring & Reminders')).toBeInTheDocument();
    expect(screen.getByText('1 Actionable')).toBeInTheDocument();
    expect(screen.getByText('Apartment Rent')).toBeInTheDocument();
    expect(screen.getByText('5 days overdue')).toBeInTheDocument();
    expect(screen.getByText('Pending sync')).toBeInTheDocument();

    // Switch to All Schedules tab
    fireEvent.click(screen.getByRole('button', { name: /All Schedules \(1\)/i }));
    expect(screen.getByText('active')).toBeInTheDocument();

    // Pause schedule action
    fireEvent.click(screen.getByRole('button', { name: /Pause/i }));
    await waitFor(() => {
      expect(mockPauseRule).toHaveBeenCalledWith(ruleRentId);
    });
  });

  it('opens confirm modal and triggers confirmOccurrence only on explicit confirmation', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /^Confirm$/i }));
    expect(screen.getByText('Confirm & Record Transaction')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Confirm & Record/i }));
    await waitFor(() => {
      expect(mockConfirmOccurrence).toHaveBeenCalledWith(
        expect.objectContaining({
          recurringRuleId: ruleRentId,
          occurrenceDate: '2026-11-20',
          occurrenceId: occRentId
        })
      );
    });
  });

  it('supports skip, snooze modal submission, and manual cloud sync trigger', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /^Skip$/i }));
    await waitFor(() => {
      expect(mockSkipOccurrence).toHaveBeenCalledWith(
        expect.objectContaining({
          recurringRuleId: ruleRentId,
          occurrenceDate: '2026-11-20'
        })
      );
    });

    fireEvent.click(screen.getByRole('button', { name: /^Snooze$/i }));
    expect(screen.getByRole('heading', { name: 'Snooze Reminder' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Snooze Reminder/i }));
    await waitFor(() => {
      expect(mockSnoozeOccurrence).toHaveBeenCalledWith(
        expect.objectContaining({
          recurringRuleId: ruleRentId,
          occurrenceDate: '2026-11-20'
        })
      );
    });

    expect(screen.queryByRole('button', { name: /Sync Cloud|Sync Now/i })).not.toBeInTheDocument();
  });

  it('opens New Schedule modal and submits validated schedule form', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /New Schedule/i }));
    expect(screen.getByText('Create Recurring Schedule')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Title/i), {
      target: { value: 'Gym Membership' }
    });
    fireEvent.change(screen.getByLabelText(/Amount \(INR\)/i), {
      target: { value: '1800' }
    });

    fireEvent.click(screen.getByRole('button', { name: /Create Schedule/i }));

    await waitFor(() => {
      expect(mockCreateRule).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Gym Membership',
          amount: '1800',
          type: 'expense',
          accountId: accId
        })
      );
    });
  });
});

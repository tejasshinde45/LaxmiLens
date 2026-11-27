import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CalendarPage } from '@/features/calendar/CalendarPage';
import {
  buildCalendarMonthGrid,
  buildDailyLedgerMap,
  buildGridRecurringMap,
  computeMonthlyCalendarSummary,
  resolveTransactionLocalDate,
  shiftCalendarMonth
} from '@/features/calendar/calendarService';
import * as useTransactionsModule from '@/features/transactions/hooks/useTransactions';
import * as useAccountsModule from '@/features/accounts/hooks/useAccounts';
import * as useCategoriesModule from '@/features/categories/hooks/useCategories';
import * as useRecurringModule from '@/features/recurring/hooks/useRecurring';
import { TransactionResponseDTO } from '@/application/dto/TransactionDTO';
import { AccountWithBalanceDTO } from '@/application/dto/AccountDTO';
import { RecurringReminderDTO, RecurringRuleResponseDTO } from '@/application/dto/RecurringDTO';
import { Category } from '@/domain/entities/Category';
import { createCategoryId, createUserId } from '@/domain/value-objects/Identifiers';
import { getLocalTodayDateString } from '@/domain/services/RecurrenceScheduleService';

describe('Phase 12 Stage 1D: Functional Financial Calendar', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const bankAccId = '22222222-2222-4222-8222-222222222221';
  const cashAccId = '22222222-2222-4222-8222-222222222222';
  const salaryCatId = '33333333-3333-4333-8333-333333333331';
  const foodCatId = '33333333-3333-4333-8333-333333333332';
  const rentRuleId = '44444444-4444-4444-8444-444444444441';
  const pausedRuleId = '44444444-4444-4444-8444-444444444442';

  const makeLocalIso = (year: number, month: number, day: number, hour = 12, min = 0): string =>
    new Date(year, month - 1, day, hour, min, 0, 0).toISOString();

  const makeTx = (overrides: Partial<TransactionResponseDTO> = {}): TransactionResponseDTO => ({
    id: `tx-${Math.random().toString(36).slice(2)}`,
    userId,
    type: 'expense',
    amountPaise: 10000,
    amountFormatted: '₹100.00',
    currency: 'INR',
    accountId: bankAccId,
    categoryId: foodCatId,
    title: 'Sample Expense',
    transactionDate: makeLocalIso(2026, 11, 15),
    deletedAt: null,
    isDeleted: false,
    version: 1,
    idempotencyKey: `key-${Math.random()}`,
    createdAt: makeLocalIso(2026, 11, 15),
    updatedAt: makeLocalIso(2026, 11, 15),
    ...overrides
  });

  const sampleAccounts: AccountWithBalanceDTO[] = [
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
    }
  ];

  const sampleCategories: Category[] = [
    new Category({
      id: createCategoryId(salaryCatId),
      userId: createUserId(userId),
      name: 'Salary & Wages',
      type: 'income',
      isDefault: true
    }),
    new Category({
      id: createCategoryId(foodCatId),
      userId: createUserId(userId),
      name: 'Food & Dining Out',
      type: 'expense',
      isDefault: true
    })
  ];

  describe('1. Pure Calendar Grid, Leap Year, Timezone & Ledger Rules', () => {
    it('aligns weekdays Sun..Sat accurately with leading and trailing padding cells', () => {
      // April 2026 starts on Wednesday (index 3) and has 30 days
      const april2026 = buildCalendarMonthGrid(2026, 4, '2026-04-10');
      expect(april2026.label).toBe('April 2026');
      expect(april2026.daysInMonth).toBe(30);
      expect(april2026.cells.length % 7).toBe(0);
      expect(april2026.cells.slice(0, 3).map((c) => c.dateKey)).toEqual([
        '2026-03-29',
        '2026-03-30',
        '2026-03-31'
      ]);
      expect(april2026.cells.slice(0, 3).every((c) => !c.isCurrentMonth)).toBe(true);
      expect(april2026.cells[3]).toMatchObject({
        dateKey: '2026-04-01',
        isCurrentMonth: true,
        isToday: false
      });
      expect(april2026.cells.find((c) => c.dateKey === '2026-04-10')?.isToday).toBe(true);
    });

    it('handles leap-year February (2024) and non-leap February (2026) accurately', () => {
      const leapFeb = buildCalendarMonthGrid(2024, 2, '2024-02-29');
      expect(leapFeb.daysInMonth).toBe(29);
      const leapDays = leapFeb.cells.filter((c) => c.isCurrentMonth);
      expect(leapDays).toHaveLength(29);
      expect(leapDays[28]?.dateKey).toBe('2024-02-29');
      expect(leapDays[28]?.isToday).toBe(true);

      const nonLeapFeb = buildCalendarMonthGrid(2026, 2, '2026-02-15');
      expect(nonLeapFeb.daysInMonth).toBe(28);
      const regularDays = nonLeapFeb.cells.filter((c) => c.isCurrentMonth);
      expect(regularDays).toHaveLength(28);
      expect(nonLeapFeb.cells.some((c) => c.dateKey === '2026-02-29')).toBe(false);
    });

    it('shifts months cleanly across year boundaries', () => {
      expect(shiftCalendarMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
      expect(shiftCalendarMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    });

    it('computes daily income, expense, net cashflow in integer paise, excludes transfers and deleted items', () => {
      const txIncome = makeTx({
        id: 'tx-inc',
        type: 'income',
        amountPaise: 5000050, // ₹50,000.50
        title: 'Consulting Retainer',
        categoryId: salaryCatId,
        transactionDate: makeLocalIso(2026, 11, 20, 10, 0)
      });
      const txExp1 = makeTx({
        id: 'tx-exp1',
        type: 'expense',
        amountPaise: 120025, // ₹1,200.25
        title: 'Dinner',
        transactionDate: makeLocalIso(2026, 11, 20, 20, 0)
      });
      const txExp2 = makeTx({
        id: 'tx-exp2',
        type: 'expense',
        amountPaise: 30075, // ₹300.75
        title: 'Cab',
        transactionDate: makeLocalIso(2026, 11, 20, 21, 0)
      });
      const txTransfer = makeTx({
        id: 'tx-trf',
        type: 'transfer',
        amountPaise: 1000000, // ₹10,000.00
        accountId: bankAccId,
        destinationAccountId: cashAccId,
        categoryId: undefined,
        title: 'ATM Cash Pull',
        transactionDate: makeLocalIso(2026, 11, 20, 15, 0)
      });
      const txDeletedExpense = makeTx({
        id: 'tx-del',
        type: 'expense',
        amountPaise: 999900,
        title: 'Deleted Duplicate',
        isDeleted: true,
        deletedAt: makeLocalIso(2026, 11, 20, 22, 0),
        transactionDate: makeLocalIso(2026, 11, 20, 12, 0)
      });

      const dailyMap = buildDailyLedgerMap([
        txIncome,
        txExp1,
        txExp2,
        txTransfer,
        txDeletedExpense
      ]);

      const day20 = dailyMap.get('2026-11-20');
      expect(day20).toBeDefined();
      expect(day20!.totalIncomePaise).toBe(5000050);
      expect(day20!.totalExpensePaise).toBe(150100);
      expect(day20!.netCashFlowPaise).toBe(5000050 - 150100);
      expect(day20!.transactionCount).toBe(4);
      expect(day20!.transferCount).toBe(1);
      expect(day20!.transactions.some((t) => t.id === 'tx-del')).toBe(false);
      expect(day20!.transactions.some((t) => t.id === 'tx-trf')).toBe(true);

      const monthSummary = computeMonthlyCalendarSummary('2026-11', dailyMap, new Map());
      expect(monthSummary.totalIncomePaise).toBe(5000050);
      expect(monthSummary.totalExpensePaise).toBe(150100);
      expect(monthSummary.netCashFlowPaise).toBe(4849950);
      expect(monthSummary.transferCount).toBe(1);
      expect(monthSummary.activeDaysCount).toBe(1);
    });

    it('resolves local calendar dates consistently without UTC boundary shifts', () => {
      // Valid leap-year date-only YYYY-MM-DD stays exact local calendar date
      expect(resolveTransactionLocalDate('2024-02-29')).toBe('2024-02-29');

      // Local-clock edge timestamps (23:55 vs 00:05) resolve to their respective local calendar dates
      const lateNightIso = new Date(2026, 10, 14, 23, 55, 0, 0).toISOString();
      const earlyMorningIso = new Date(2026, 10, 15, 0, 5, 0, 0).toISOString();
      expect(resolveTransactionLocalDate(lateNightIso)).toBe('2026-11-14');
      expect(resolveTransactionLocalDate(earlyMorningIso)).toBe('2026-11-15');
    });

    it('projects read-only recurring dates across months without duplicating actionable/snoozed reminders or including paused rules', () => {
      const rentSchedule: RecurringRuleResponseDTO = {
        id: rentRuleId,
        userId,
        title: 'Apartment Rent',
        type: 'expense',
        amountPaise: 2500000,
        amountFormatted: '₹25,000.00',
        accountId: bankAccId,
        accountName: 'Axis Priority Bank',
        categoryId: foodCatId,
        frequency: 'monthly',
        interval: 1,
        anchorDayOfMonth: 15,
        startDate: '2026-10-15',
        endDate: null,
        nextDueDate: '2026-11-15',
        lastGeneratedDate: '2026-10-15',
        status: 'active',
        requiresUserConfirmation: true,
        previewDates: ['2026-11-15', '2026-12-15'],
        version: 1,
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-15T00:00:00.000Z'
      };

      const pausedSchedule: RecurringRuleResponseDTO = {
        ...rentSchedule,
        id: pausedRuleId,
        title: 'Paused Membership',
        status: 'paused',
        nextDueDate: '2026-11-18'
      };

      const snoozedNovRent: RecurringReminderDTO = {
        occurrenceId: 'occ-1',
        recurringRuleId: rentRuleId,
        userId,
        title: 'Apartment Rent',
        type: 'expense',
        amountPaise: 2500000,
        amountFormatted: '₹25,000.00',
        accountId: bankAccId,
        accountName: 'Axis Priority Bank',
        frequency: 'monthly',
        interval: 1,
        occurrenceDate: '2026-11-15',
        effectiveDueDate: '2026-11-22',
        snoozedUntilDate: '2026-11-22',
        status: 'snoozed',
        bucket: 'snoozed',
        daysUntilDue: 2,
        idempotencyKey: `recurring:${rentRuleId}:2026-11-15`
      };

      // November grid shows snoozed item ONLY on Nov 22 (not duplicated back on Nov 15)
      const novRecurring = buildGridRecurringMap({
        gridStartDateKey: '2026-11-01',
        gridEndDateKey: '2026-12-05',
        todayDateKey: '2026-11-20',
        snoozed: [snoozedNovRent],
        schedules: [rentSchedule, pausedSchedule]
      });

      expect(novRecurring.get('2026-11-15')).toBeUndefined();
      expect(novRecurring.get('2026-11-18')).toBeUndefined(); // paused skipped
      expect(novRecurring.get('2026-11-22')).toHaveLength(1);
      expect(novRecurring.get('2026-11-22')?.[0]?.status).toBe('snoozed');

      // Navigating ahead to February 2027 projects the recurring date purely in memory
      const febRecurring = buildGridRecurringMap({
        gridStartDateKey: '2027-01-31',
        gridEndDateKey: '2027-03-06',
        todayDateKey: '2026-11-20',
        snoozed: [snoozedNovRent],
        schedules: [rentSchedule, pausedSchedule]
      });
      expect(febRecurring.get('2027-02-15')).toHaveLength(1);
      expect(febRecurring.get('2027-02-15')?.[0]?.isProjected).toBe(true);
    });
  });

  describe('2. CalendarPage UI Integration & Read-Only Safety', () => {
    let mockRefetch: ReturnType<typeof vi.fn>;
    let mockCreateTx: ReturnType<typeof vi.fn>;
    let mockUpdateTx: ReturnType<typeof vi.fn>;
    let mockDeleteTx: ReturnType<typeof vi.fn>;
    let mockConfirmOcc: ReturnType<typeof vi.fn>;
    let mockCreateRule: ReturnType<typeof vi.fn>;
    let mockSkipOcc: ReturnType<typeof vi.fn>;
    let mockSnoozeOcc: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 10, 26, 14, 0, 0, 0)); // Nov 26, 2026 local

      mockRefetch = vi.fn().mockResolvedValue({});
      mockCreateTx = vi.fn();
      mockUpdateTx = vi.fn();
      mockDeleteTx = vi.fn();
      mockConfirmOcc = vi.fn();
      mockCreateRule = vi.fn();
      mockSkipOcc = vi.fn();
      mockSnoozeOcc = vi.fn();

      const txs: TransactionResponseDTO[] = [
        makeTx({
          id: 'tx-today-exp',
          type: 'expense',
          amountPaise: 125000, // ₹1,250.00
          title: 'Specialty Coffee',
          categoryId: foodCatId,
          transactionDate: makeLocalIso(2026, 11, 26, 11, 30)
        }),
        makeTx({
          id: 'tx-today-trf',
          type: 'transfer',
          amountPaise: 500000, // ₹5,000.00
          accountId: bankAccId,
          destinationAccountId: cashAccId,
          categoryId: undefined,
          title: 'Cash Top-Up',
          transactionDate: makeLocalIso(2026, 11, 26, 13, 0)
        }),
        makeTx({
          id: 'tx-nov10-inc',
          type: 'income',
          amountPaise: 9000000, // ₹90,000.00
          categoryId: salaryCatId,
          title: 'November Salary',
          transactionDate: makeLocalIso(2026, 11, 10, 9, 0)
        }),
        makeTx({
          id: 'tx-dec05-exp',
          type: 'expense',
          amountPaise: 45000,
          categoryId: foodCatId,
          title: 'December Grocery',
          transactionDate: makeLocalIso(2026, 12, 5, 16, 0)
        }),
        makeTx({
          id: 'tx-deleted-nov26',
          type: 'expense',
          amountPaise: 77700,
          title: 'Voided Order',
          isDeleted: true,
          deletedAt: makeLocalIso(2026, 11, 26, 12, 0),
          transactionDate: makeLocalIso(2026, 11, 26, 10, 0)
        })
      ];

      vi.spyOn(useTransactionsModule, 'useTransactions').mockReturnValue({
        transactions: txs,
        summary: useTransactionsModule.computeTransactionSummary(txs),
        pendingTxIdSet: new Set(['tx-today-exp']),
        isLoading: false,
        isError: false,
        error: null,
        refetch: mockRefetch,
        isAuthenticated: true,
        createTransaction: mockCreateTx,
        isCreating: false,
        updateTransaction: mockUpdateTx,
        isUpdating: false,
        deleteTransaction: mockDeleteTx,
        isDeleting: false
      });

      vi.spyOn(useAccountsModule, 'useAccounts').mockReturnValue({
        accounts: sampleAccounts,
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

      vi.spyOn(useCategoriesModule, 'useCategories').mockReturnValue({
        categories: sampleCategories,
        incomeCategories: sampleCategories.filter((c) => c.type === 'income'),
        expenseCategories: sampleCategories.filter((c) => c.type === 'expense'),
        categoryMap: new Map(sampleCategories.map((c) => [c.id, c])),
        getCategoryById: (id) => sampleCategories.find((c) => c.id === id),
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn()
      });

      const activeSchedule: RecurringRuleResponseDTO = {
        id: rentRuleId,
        userId,
        title: 'Monthly House Rent',
        type: 'expense',
        amountPaise: 2000000, // ₹20,000.00
        amountFormatted: '₹20,000.00',
        accountId: bankAccId,
        accountName: 'Axis Priority Bank',
        categoryId: foodCatId,
        categoryName: 'Food & Dining Out',
        frequency: 'monthly',
        interval: 1,
        anchorDayOfMonth: 28,
        startDate: '2026-10-28',
        endDate: null,
        nextDueDate: '2026-11-28',
        lastGeneratedDate: '2026-10-28',
        status: 'active',
        requiresUserConfirmation: true,
        previewDates: ['2026-11-28', '2026-12-28'],
        version: 1,
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-28T00:00:00.000Z'
      };

      const dueSoonItem: RecurringReminderDTO = {
        occurrenceId: 'occ-nov28',
        recurringRuleId: rentRuleId,
        userId,
        title: 'Monthly House Rent',
        type: 'expense',
        amountPaise: 2000000,
        amountFormatted: '₹20,000.00',
        accountId: bankAccId,
        accountName: 'Axis Priority Bank',
        categoryId: foodCatId,
        categoryName: 'Food & Dining Out',
        frequency: 'monthly',
        interval: 1,
        occurrenceDate: '2026-11-28',
        effectiveDueDate: '2026-11-28',
        snoozedUntilDate: null,
        status: 'pending',
        bucket: 'upcoming',
        daysUntilDue: 2,
        idempotencyKey: `recurring:${rentRuleId}:2026-11-28`
      };

      vi.spyOn(useRecurringModule, 'useRecurring').mockReturnValue({
        overview: {
          summary: {} as any,
          overdue: [],
          dueToday: [],
          upcoming: [dueSoonItem],
          snoozed: [],
          recentlyGenerated: [],
          schedules: [activeSchedule]
        },
        summary: {} as any,
        overdue: [],
        dueToday: [],
        upcoming: [dueSoonItem],
        snoozed: [],
        recentlyGenerated: [],
        schedules: [activeSchedule],
        pendingRecurringIdSet: new Set(),
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
        isAuthenticated: true,
        createRule: mockCreateRule,
        isCreating: false,
        updateRule: vi.fn(),
        isUpdating: false,
        pauseRule: vi.fn(),
        resumeRule: vi.fn(),
        deleteRule: vi.fn(),
        confirmOccurrence: mockConfirmOcc,
        isConfirming: false,
        skipOccurrence: mockSkipOcc,
        snoozeOccurrence: mockSnoozeOcc,
        dismissOccurrence: vi.fn()
      } as any);
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it('renders November 2026 with today selected, real activity totals, transfer label, and zero deleted entries', () => {
      render(
        <MemoryRouter>
          <CalendarPage />
        </MemoryRouter>
      );

      expect(screen.getByRole('heading', { name: 'November 2026' })).toBeInTheDocument();
      expect(screen.getByText('2026-11-26')).toBeInTheDocument();

      // Monthly totals in KPI strip: Nov income 90,000.00, Nov expense 1,250.00 (5,000 transfer & 777 deleted excluded!)
      expect(screen.getByText('+₹90,000.00')).toBeInTheDocument();
      expect(screen.getAllByText('-₹1,250.00').length).toBeGreaterThanOrEqual(1);

      // Selected day (Nov 26) shows both Expense and Transfer items, excludes Voided Order
      expect(screen.getByText('Specialty Coffee')).toBeInTheDocument();
      expect(screen.getByText('Cash Top-Up')).toBeInTheDocument();
      expect(screen.getByText('Transfers excluded from totals')).toBeInTheDocument();
      expect(screen.queryByText('Voided Order')).not.toBeInTheDocument();
    });

    it('navigates between months cleanly and jumps back via Today without mutating recurring or ledger data', () => {
      render(
        <MemoryRouter>
          <CalendarPage />
        </MemoryRouter>
      );

      // Move forward to December 2026
      fireEvent.click(screen.getByRole('button', { name: /Next month/i }));
      expect(screen.getByRole('heading', { name: 'December 2026' })).toBeInTheDocument();
      expect(screen.getAllByText('-₹450.00').length).toBeGreaterThanOrEqual(2);

      // Select Dec 5 in December to inspect its expense
      const dec5Cell = screen.getByRole('gridcell', { name: /2026-12-05/i });
      fireEvent.click(dec5Cell);
      expect(screen.getByText('December Grocery')).toBeInTheDocument();

      // Move to an empty day (Dec 12) and verify helpful empty state
      fireEvent.click(screen.getByRole('gridcell', { name: /2026-12-12/i }));
      expect(screen.getByText('No transactions on this date')).toBeInTheDocument();

      // Jump back to Today cleanly
      fireEvent.click(screen.getByRole('button', { name: /^Today$/i }));
      expect(screen.getByRole('heading', { name: 'November 2026' })).toBeInTheDocument();
      expect(screen.getByText('Specialty Coffee')).toBeInTheDocument();

      // Select Nov 28 to view read-only recurring commitment without triggering persistence
      fireEvent.click(screen.getByRole('gridcell', { name: /2026-11-28/i }));
      expect(screen.getByText('Monthly House Rent')).toBeInTheDocument();
      expect(
        screen.getByText(/Awaiting manual confirmation on Recurring & Reminders/i)
      ).toBeInTheDocument();

      expect(mockCreateTx).not.toHaveBeenCalled();
      expect(mockUpdateTx).not.toHaveBeenCalled();
      expect(mockDeleteTx).not.toHaveBeenCalled();
      expect(mockConfirmOcc).not.toHaveBeenCalled();
      expect(mockCreateRule).not.toHaveBeenCalled();
      expect(mockSkipOcc).not.toHaveBeenCalled();
      expect(mockSnoozeOcc).not.toHaveBeenCalled();
      expect(mockRefetch).not.toHaveBeenCalled();
    });

    it('renders loading and retryable error states cleanly', () => {
      vi.spyOn(useTransactionsModule, 'useTransactions').mockReturnValue({
        transactions: [],
        summary: useTransactionsModule.computeTransactionSummary([]),
        pendingTxIdSet: new Set(),
        isLoading: false,
        isError: true,
        error: new Error('Offline store read error'),
        refetch: mockRefetch,
        isAuthenticated: true,
        createTransaction: mockCreateTx,
        isCreating: false,
        updateTransaction: mockUpdateTx,
        isUpdating: false,
        deleteTransaction: mockDeleteTx,
        isDeleting: false
      });

      render(
        <MemoryRouter>
          <CalendarPage />
        </MemoryRouter>
      );

      expect(screen.getByText('Unable to load ledger activity')).toBeInTheDocument();
      expect(screen.getByText('Offline store read error')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /Retry/i }));
      expect(mockRefetch).toHaveBeenCalledTimes(1);
    });

    it('renders week rows inside the calendar grid and supports arrow-key cell navigation', () => {
      render(
        <MemoryRouter>
          <CalendarPage />
        </MemoryRouter>
      );

      const grid = screen.getByRole('grid', { name: /November 2026 Financial Calendar/i });
      const rows = grid.querySelectorAll('[role="row"]');
      expect(rows.length).toBeGreaterThanOrEqual(5);

      const nov26 = screen.getByRole('gridcell', { name: /2026-11-26/i });
      expect(nov26).toHaveAttribute('aria-selected', 'true');
      nov26.focus();
      fireEvent.keyDown(nov26, { key: 'ArrowRight' });

      expect(screen.getByRole('gridcell', { name: /2026-11-27/i })).toHaveAttribute(
        'aria-selected',
        'true'
      );
    });
  });
});

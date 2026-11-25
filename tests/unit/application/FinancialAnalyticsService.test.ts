import { describe, it, expect } from 'vitest';
import {
  FinancialAnalyticsService,
  resolveAnalyticsDateRange,
  formatLocalDateInput,
  parseLocalDateInput,
  AnalyticsTransactionRecord
} from '@/application/services/FinancialAnalyticsService';
import { Category } from '@/domain/entities/Category';
import {
  createCategoryId,
  createUserId
} from '@/domain/value-objects/Identifiers';
import {
  InvalidDateRangeError,
  UnauthorizedEntityAccessError
} from '@/domain/errors/DomainErrors';

describe('FinancialAnalyticsService (Phase 7)', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const otherUserId = '22222222-2222-4222-8222-222222222222';
  const catSalary = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
  const catGroceries = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
  const catDining = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3';
  const catFuel = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4';

  const now = new Date(2026, 10, 25, 11, 30, 0); // 25 Nov 2026 local

  const categories: Category[] = [
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
    }),
    new Category({
      id: createCategoryId(catFuel),
      userId: createUserId(userId),
      name: 'Transport & Fuel',
      type: 'expense',
      icon: 'Car',
      color: '#82A9CF'
    })
  ];

  function makeTx(
    overrides: Partial<AnalyticsTransactionRecord> & { id: string }
  ): AnalyticsTransactionRecord {
    return {
      userId,
      type: 'expense',
      amountPaise: 10000,
      categoryId: catGroceries,
      title: 'Test Tx',
      transactionDate: new Date(2026, 10, 10, 12, 0, 0),
      deletedAt: null,
      isDeleted: false,
      ...overrides
    };
  }

  it('computes exact integer-paise income, expenses, net cash flow, savings rate, and excludes transfers & deleted items', () => {
    const txs: AnalyticsTransactionRecord[] = [
      // Income: ₹1,250.75 + ₹8,749.25 = ₹10,000.00 (1,000,000 paise)
      makeTx({
        id: 'tx-inc-1',
        type: 'income',
        amountPaise: 125075,
        categoryId: catSalary,
        title: 'Consulting Part 1',
        transactionDate: new Date(2026, 10, 2, 10, 0, 0)
      }),
      makeTx({
        id: 'tx-inc-2',
        type: 'income',
        amountPaise: 874925,
        categoryId: catSalary,
        title: 'Consulting Part 2',
        transactionDate: new Date(2026, 10, 5, 10, 0, 0)
      }),
      // Expenses: ₹1,500.50 + ₹999.50 = ₹2,500.00 (250,000 paise)
      makeTx({
        id: 'tx-exp-1',
        type: 'expense',
        amountPaise: 150050,
        categoryId: catGroceries,
        title: 'Supermarket',
        transactionDate: new Date(2026, 10, 6, 15, 0, 0)
      }),
      makeTx({
        id: 'tx-exp-2',
        type: 'expense',
        amountPaise: 99950,
        categoryId: catDining,
        title: 'Dinner',
        transactionDate: new Date(2026, 10, 12, 20, 0, 0)
      }),
      // Transfers: ₹50,000 MUST be excluded from income, expense, net, and breakdown
      makeTx({
        id: 'tx-trf-1',
        type: 'transfer',
        amountPaise: 5000000,
        categoryId: undefined,
        title: 'Bank to Savings',
        transactionDate: new Date(2026, 10, 14, 9, 0, 0)
      }),
      // Soft-deleted expense & deletedAt timestamp expense MUST be excluded
      makeTx({
        id: 'tx-del-1',
        type: 'expense',
        amountPaise: 300000,
        categoryId: catFuel,
        title: 'Deleted Flagged',
        isDeleted: true,
        transactionDate: new Date(2026, 10, 15, 9, 0, 0)
      }),
      makeTx({
        id: 'tx-del-2',
        type: 'expense',
        amountPaise: 400000,
        categoryId: catFuel,
        title: 'Deleted Timestamped',
        deletedAt: '2026-11-16T09:00:00.000Z',
        transactionDate: new Date(2026, 10, 15, 10, 0, 0)
      })
    ];

    const res = FinancialAnalyticsService.analyze({
      userId,
      transactions: txs,
      categories,
      preset: 'this_month',
      now
    });

    expect(res.summary.totalIncomePaise).toBe(1000000);
    expect(res.summary.totalIncomeFormatted).toBe('₹10,000.00');
    expect(res.summary.totalExpensePaise).toBe(250000);
    expect(res.summary.totalExpenseFormatted).toBe('₹2,500.00');
    expect(res.summary.netCashFlowPaise).toBe(750000);
    expect(res.summary.netCashFlowFormatted).toBe('₹7,500.00');
    expect(res.summary.savingsRatePercent).toBe(75);
    expect(res.summary.savingsRateFormatted).toBe('75%');
    expect(res.summary.transferCount).toBe(1);
    expect(res.summary.expenseCount).toBe(2);
    expect(res.summary.incomeCount).toBe(2);

    // Expense breakdown excludes income categories, transfers, and deleted entries
    expect(res.expenseBreakdown).toHaveLength(2);
    expect(res.expenseBreakdown[0]).toMatchObject({
      categoryName: 'Groceries & Household',
      totalPaise: 150050,
      percentageOfExpenses: 60
    });
    expect(res.expenseBreakdown[1]).toMatchObject({
      categoryName: 'Food & Dining Out',
      totalPaise: 99950,
      percentageOfExpenses: 40
    });
  });

  it('handles zero income and empty datasets safely without NaN or Infinity', () => {
    const emptyRes = FinancialAnalyticsService.analyze({
      userId,
      transactions: [],
      categories,
      preset: 'this_month',
      now
    });

    expect(emptyRes.summary.totalIncomePaise).toBe(0);
    expect(emptyRes.summary.totalExpensePaise).toBe(0);
    expect(emptyRes.summary.netCashFlowPaise).toBe(0);
    expect(emptyRes.summary.savingsRatePercent).toBeNull();
    expect(emptyRes.summary.savingsRateFormatted).toBe('—');
    expect(emptyRes.hasTimeSeriesData).toBe(false);
    expect(emptyRes.expenseBreakdown).toEqual([]);
    expect(emptyRes.spendingTrend.comparisonAvailable).toBe(false);

    const expenseOnlyRes = FinancialAnalyticsService.analyze({
      userId,
      transactions: [makeTx({ id: 'tx-only-exp', type: 'expense', amountPaise: 150000 })],
      categories,
      preset: 'this_month',
      now
    });

    expect(expenseOnlyRes.summary.totalIncomePaise).toBe(0);
    expect(expenseOnlyRes.summary.totalExpensePaise).toBe(150000);
    expect(expenseOnlyRes.summary.netCashFlowPaise).toBe(-150000);
    expect(expenseOnlyRes.summary.netCashFlowFormatted).toBe('-₹1,500.00');
    expect(expenseOnlyRes.summary.savingsRatePercent).toBeNull();
    expect(expenseOnlyRes.summary.savingsRateFormatted).toBe('—');
  });

  it('respects strict local calendar boundaries and buckets transactions without UTC drift', () => {
    const txs: AnalyticsTransactionRecord[] = [
      // Exact start & end of Nov 2026 in local time
      makeTx({
        id: 'nov-start',
        amountPaise: 10000,
        title: 'Nov Start Midnight',
        transactionDate: new Date(2026, 10, 1, 0, 0, 0, 0)
      }),
      makeTx({
        id: 'nov-early-am',
        amountPaise: 20000,
        title: 'Nov 15 Early AM',
        transactionDate: new Date(2026, 10, 15, 0, 15, 0, 0)
      }),
      makeTx({
        id: 'nov-end',
        amountPaise: 30000,
        title: 'Nov End Night',
        transactionDate: new Date(2026, 10, 30, 23, 59, 59, 999)
      }),
      // Oct 31 23:59:59.999 local MUST fall strictly into last_month
      makeTx({
        id: 'oct-end',
        amountPaise: 50000,
        title: 'Oct End Night',
        transactionDate: new Date(2026, 9, 31, 23, 59, 59, 999)
      }),
      // Dec 1 00:00:00.000 local MUST be excluded from Nov
      makeTx({
        id: 'dec-start',
        amountPaise: 70000,
        title: 'Dec Start Midnight',
        transactionDate: new Date(2026, 11, 1, 0, 0, 0, 0)
      })
    ];

    const novRes = FinancialAnalyticsService.analyze({
      userId,
      transactions: txs,
      categories,
      preset: 'this_month',
      now
    });

    expect(novRes.period.granularity).toBe('daily');
    expect(novRes.summary.totalExpensePaise).toBe(60000);
    expect(novRes.timeSeries).toHaveLength(30); // Nov has 30 local days
    expect(novRes.timeSeries.find((d) => d.bucketKey === '2026-11-01')?.expensePaise).toBe(10000);
    expect(novRes.timeSeries.find((d) => d.bucketKey === '2026-11-15')?.expensePaise).toBe(20000);
    expect(novRes.timeSeries.find((d) => d.bucketKey === '2026-11-30')?.expensePaise).toBe(30000);

    // Check previous equivalent period (October)
    expect(novRes.spendingTrend.comparisonAvailable).toBe(true);
    expect(novRes.spendingTrend.previousExpensePaise).toBe(50000);
    expect(novRes.spendingTrend.deltaPaise).toBe(10000);
    expect(novRes.spendingTrend.percentageChange).toBe(20);
    expect(novRes.spendingTrend.direction).toBe('increase');

    // Last month check
    const octRes = FinancialAnalyticsService.analyze({
      userId,
      transactions: txs,
      categories,
      preset: 'last_month',
      now
    });
    expect(octRes.summary.totalExpensePaise).toBe(50000);
    expect(octRes.timeSeries).toHaveLength(31);
  });

  it('supports Last 3/6 Months, This Year, All Time, Custom ranges, monthly granularity, and previous-period insufficient data checks', () => {
    const txs: AnalyticsTransactionRecord[] = [
      makeTx({
        id: 't-jun',
        amountPaise: 200000, // ₹2,000 in Jun 2026
        categoryId: catGroceries,
        transactionDate: new Date(2026, 5, 15)
      }),
      makeTx({
        id: 't-sep',
        amountPaise: 300000, // ₹3,000 in Sep 2026
        categoryId: catGroceries,
        transactionDate: new Date(2026, 8, 10)
      }),
      makeTx({
        id: 't-oct',
        amountPaise: 500000, // ₹5,000 in Oct 2026
        categoryId: catDining,
        transactionDate: new Date(2026, 9, 12)
      }),
      makeTx({
        id: 't-nov',
        amountPaise: 400000, // ₹4,000 in Nov 2026
        categoryId: catGroceries,
        transactionDate: new Date(2026, 10, 12)
      })
    ];

    // Last 3 Months (Sep, Oct, Nov 2026) vs Preceding 3 Months (Jun, Jul, Aug 2026)
    const threeMonthRes = FinancialAnalyticsService.analyze({
      userId,
      transactions: txs,
      categories,
      preset: 'last_3_months',
      now
    });
    expect(threeMonthRes.period.granularity).toBe('monthly');
    expect(threeMonthRes.timeSeries).toHaveLength(3);
    expect(threeMonthRes.summary.totalExpensePaise).toBe(1200000); // ₹12,000
    expect(threeMonthRes.spendingTrend.comparisonAvailable).toBe(true);
    expect(threeMonthRes.spendingTrend.previousExpensePaise).toBe(200000); // ₹2,000 in Jun
    expect(threeMonthRes.spendingTrend.percentageChange).toBe(500);
    expect(threeMonthRes.categoryIncreases[0]).toMatchObject({
      categoryId: catGroceries,
      previousPaise: 200000,
      currentPaise: 700000,
      deltaPaise: 500000
    });
    expect(
      threeMonthRes.insights.some(
        (i) => i.type === 'highest_month' && i.description.includes('October 2026')
      )
    ).toBe(true);

    // Custom 10-day window (Nov 10–19) vs preceding 10 days (Oct 31–Nov 9 -> no spend = insufficient data)
    const customShort = FinancialAnalyticsService.analyze({
      userId,
      transactions: txs,
      categories,
      preset: 'custom',
      customRange: { startDate: '2026-11-10', endDate: '2026-11-19' },
      now
    });
    expect(customShort.period.granularity).toBe('daily');
    expect(customShort.summary.totalExpensePaise).toBe(400000);
    expect(customShort.spendingTrend.comparisonAvailable).toBe(false);
    expect(customShort.spendingTrend.insufficientDataReason).toMatch(/Insufficient historical/i);

    // All Time must NEVER claim a previous period comparison exists
    const allTime = FinancialAnalyticsService.analyze({
      userId,
      transactions: txs,
      categories,
      preset: 'all_time',
      now
    });
    expect(allTime.summary.totalExpensePaise).toBe(1400000);
    expect(allTime.spendingTrend.comparisonAvailable).toBe(false);
    expect(allTime.spendingTrend.insufficientDataReason).toMatch(/All Time/i);

    // Date validation guards
    expect(() => parseLocalDateInput('2026-02-30')).toThrow();
    expect(() =>
      resolveAnalyticsDateRange('custom', now, {
        startDate: '2026-11-20',
        endDate: '2026-11-01'
      })
    ).toThrow(InvalidDateRangeError);
    expect(formatLocalDateInput(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('rejects cross-tenant transactions strictly for ownership isolation', () => {
    expect(() =>
      FinancialAnalyticsService.analyze({
        userId,
        transactions: [
          makeTx({
            id: 'foreign-tx',
            userId: otherUserId,
            amountPaise: 10000,
            title: 'Other user tx'
          })
        ],
        categories,
        preset: 'this_month',
        now
      })
    ).toThrow(UnauthorizedEntityAccessError);
  });
});

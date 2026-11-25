import { describe, it, expect } from 'vitest';
import {
  FinancialReportService,
  ReportAccountRecord,
  ReportCategoryRecord,
  ReportTransactionRecord
} from '@/application';
import { Account } from '@/domain/entities/Account';
import { Category } from '@/domain/entities/Category';
import { Transaction } from '@/domain/entities/Transaction';
import {
  AccountNotFoundError,
  DomainError,
  InvalidTransactionAmountError,
  InvalidUserIdError,
  UnauthorizedEntityAccessError
} from '@/domain/errors/DomainErrors';
import {
  createAccountId,
  createCategoryId,
  createTransactionId,
  createUserId
} from '@/domain/value-objects/Identifiers';

describe('FinancialReportService (Phase 10 Stage 1)', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const otherUserId = '22222222-2222-4222-8222-222222222222';

  const accBankId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  const accCashId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
  const accCreditCardId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
  const accBorrowingsId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';

  const catSalaryId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
  const catFreelanceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
  const catGroceriesId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3';
  const catDiningId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4';
  const catArchivedExpenseId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5';
  const catArchivedIncomeId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb6';

  const now = new Date(2026, 10, 25, 11, 30, 0); // 25 Nov 2026 local

  const accounts: ReportAccountRecord[] = [
    new Account({
      id: createAccountId(accBankId),
      userId: createUserId(userId),
      name: 'HDFC Salary',
      accountType: 'bank',
      openingBalancePaise: 1000000, // ₹10,000.00
      institutionName: 'HDFC Bank'
    }),
    new Account({
      id: createAccountId(accCashId),
      userId: createUserId(userId),
      name: 'Cash Wallet',
      accountType: 'cash',
      openingBalancePaise: 200000 // ₹2,000.00
    }),
    new Account({
      id: createAccountId(accCreditCardId),
      userId: createUserId(userId),
      name: 'ICICI Amazon Card',
      accountType: 'credit_card',
      openingBalancePaise: -1500000, // -₹15,000.00 starting card debt
      institutionName: 'ICICI Bank'
    }),
    new Account({
      id: createAccountId(accBorrowingsId),
      userId: createUserId(userId),
      name: 'Personal Borrowings',
      accountType: 'other',
      openingBalancePaise: 0,
      systemTag: 'personal_borrowings'
    })
  ];

  const categories: Category[] = [
    new Category({
      id: createCategoryId(catSalaryId),
      userId: createUserId(userId),
      name: 'Salary & Wages',
      type: 'income',
      icon: 'Briefcase',
      color: '#72B895'
    }),
    new Category({
      id: createCategoryId(catFreelanceId),
      userId: createUserId(userId),
      name: 'Freelance & Consulting',
      type: 'income',
      icon: 'Laptop',
      color: '#82A9CF'
    }),
    new Category({
      id: createCategoryId(catGroceriesId),
      userId: createUserId(userId),
      name: 'Groceries & Household',
      type: 'expense',
      icon: 'ShoppingCart',
      color: '#D9827C'
    }),
    new Category({
      id: createCategoryId(catDiningId),
      userId: createUserId(userId),
      name: 'Food & Dining Out',
      type: 'expense',
      icon: 'Utensils',
      color: '#E4B66D'
    }),
    new Category({
      id: createCategoryId(catArchivedExpenseId),
      userId: createUserId(userId),
      name: 'Legacy Subscriptions',
      type: 'expense',
      icon: 'Package',
      color: '#B9B4AA',
      isArchived: true
    }),
    new Category({
      id: createCategoryId(catArchivedIncomeId),
      userId: createUserId(userId),
      name: 'Legacy Bonus',
      type: 'income',
      icon: 'Award',
      color: '#D6AD60',
      isArchived: true
    })
  ];

  function makeTx(
    overrides: Partial<ReportTransactionRecord> & { id: string }
  ): ReportTransactionRecord {
    return {
      userId,
      type: 'expense',
      amountPaise: 10000,
      accountId: accBankId,
      categoryId: catGroceriesId,
      title: 'Sample Transaction',
      transactionDate: new Date(2026, 10, 10, 12, 0, 0),
      createdAt: new Date(2026, 10, 10, 12, 0, 0),
      deletedAt: null,
      isDeleted: false,
      ...overrides
    };
  }

  describe('A. Financial Summary Reports', () => {
    it('calculates exact integer-paise income, expenses, net cash flow, savings rate, separated transfers, and previous-period comparisons', () => {
      const txs: ReportTransactionRecord[] = [
        // Previous month (Oct 2026): Income ₹8,000, Expense ₹4,000 -> Net ₹4,000, Savings Rate 50%
        makeTx({
          id: 'oct-inc',
          type: 'income',
          amountPaise: 800000,
          categoryId: catSalaryId,
          title: 'Oct Salary',
          transactionDate: new Date(2026, 9, 5, 9, 0, 0)
        }),
        makeTx({
          id: 'oct-exp',
          type: 'expense',
          amountPaise: 400000,
          categoryId: catGroceriesId,
          title: 'Oct Rent & Food',
          transactionDate: new Date(2026, 9, 12, 18, 0, 0)
        }),
        makeTx({
          id: 'oct-trf',
          type: 'transfer',
          amountPaise: 150000,
          categoryId: undefined,
          accountId: accBankId,
          destinationAccountId: accCashId,
          title: 'Oct ATM',
          transactionDate: new Date(2026, 9, 20, 11, 0, 0)
        }),

        // Current month (Nov 2026): Income ₹10,000.00 (1,000,000), Expense ₹2,500.00 (250,000) -> Net ₹7,500.00, Savings Rate 75%
        makeTx({
          id: 'nov-inc-1',
          type: 'income',
          amountPaise: 625075,
          categoryId: catSalaryId,
          title: 'Nov Salary',
          transactionDate: new Date(2026, 10, 2, 10, 0, 0)
        }),
        makeTx({
          id: 'nov-inc-2',
          type: 'income',
          amountPaise: 374925,
          categoryId: catFreelanceId,
          title: 'Nov Consulting',
          transactionDate: new Date(2026, 10, 4, 15, 0, 0)
        }),
        makeTx({
          id: 'nov-exp-1',
          type: 'expense',
          amountPaise: 150050,
          categoryId: catGroceriesId,
          title: 'Groceries',
          transactionDate: new Date(2026, 10, 8, 17, 0, 0)
        }),
        makeTx({
          id: 'nov-exp-2',
          type: 'expense',
          amountPaise: 99950,
          categoryId: catDiningId,
          title: 'Dinner Out',
          transactionDate: new Date(2026, 10, 12, 20, 0, 0)
        }),
        // Transfers (including borrowing inflow & repayment) MUST NOT distort income/expense
        makeTx({
          id: 'nov-trf-bank-cash',
          type: 'transfer',
          amountPaise: 300000,
          categoryId: undefined,
          accountId: accBankId,
          destinationAccountId: accCashId,
          title: 'Cash Withdrawal',
          transactionDate: new Date(2026, 10, 14, 12, 0, 0)
        }),
        makeTx({
          id: 'nov-trf-borrow',
          type: 'transfer',
          amountPaise: 500000,
          categoryId: undefined,
          accountId: accBorrowingsId,
          destinationAccountId: accBankId,
          title: 'Loan Receipt',
          transactionDate: new Date(2026, 10, 16, 12, 0, 0)
        }),
        // Soft-deleted records excluded
        makeTx({
          id: 'nov-del-1',
          type: 'expense',
          amountPaise: 999900,
          isDeleted: true,
          transactionDate: new Date(2026, 10, 18, 12, 0, 0)
        }),
        makeTx({
          id: 'nov-del-2',
          type: 'income',
          amountPaise: 999900,
          categoryId: catSalaryId,
          deletedAt: new Date(2026, 10, 19, 12, 0, 0),
          transactionDate: new Date(2026, 10, 18, 13, 0, 0)
        })
      ];

      const summary = FinancialReportService.generateFinancialSummary({
        userId,
        accounts,
        transactions: txs,
        categories,
        filters: { preset: 'this_month' },
        now
      });

      expect(summary.reportType).toBe('summary');
      expect(summary.isEmpty).toBe(false);
      expect(summary.metrics).toMatchObject({
        totalIncomePaise: 1000000,
        totalIncomeFormatted: '₹10,000.00',
        totalExpensePaise: 250000,
        totalExpenseFormatted: '₹2,500.00',
        netCashFlowPaise: 750000,
        netCashFlowFormatted: '₹7,500.00',
        savingsRatePercent: 75,
        savingsRateFormatted: '75%',
        transfersInPaise: 800000,
        transfersOutPaise: 800000,
        netTransfersPaise: 0,
        totalTransferVolumePaise: 800000,
        incomeCount: 2,
        expenseCount: 2,
        transferCount: 2,
        activeTransactionCount: 6
      });

      expect(summary.comparison.comparisonAvailable).toBe(true);
      expect(summary.comparison.hasPreviousPeriodData).toBe(true);
      expect(summary.comparison.income).toMatchObject({
        currentPaise: 1000000,
        previousPaise: 800000,
        deltaPaise: 200000,
        deltaFormatted: '+₹2,000.00',
        percentageChange: 25,
        direction: 'increase'
      });
      expect(summary.comparison.expense).toMatchObject({
        currentPaise: 250000,
        previousPaise: 400000,
        deltaPaise: -150000,
        deltaFormatted: '-₹1,500.00',
        percentageChange: -37.5,
        direction: 'decrease'
      });
      expect(summary.comparison.netCashFlow).toMatchObject({
        currentPaise: 750000,
        previousPaise: 400000,
        deltaPaise: 350000,
        percentageChange: 87.5,
        direction: 'increase'
      });
      expect(summary.comparison.savingsRate).toMatchObject({
        currentPercent: 75,
        previousPercent: 50,
        deltaPercentagePoints: 25,
        deltaFormatted: '+25 pp',
        direction: 'increase'
      });

      // Nov 2026 has 30 daily buckets
      expect(summary.period.granularity).toBe('daily');
      expect(summary.periodBreakdown).toHaveLength(30);
    });

    it('keeps transfers neutral when filtering by a single account while accurately separating transfers in and out', () => {
      const txs: ReportTransactionRecord[] = [
        makeTx({
          id: 'tx-bank-inc',
          type: 'income',
          amountPaise: 500000,
          accountId: accBankId,
          categoryId: catSalaryId,
          transactionDate: new Date(2026, 10, 5, 10, 0, 0)
        }),
        makeTx({
          id: 'tx-bank-exp',
          type: 'expense',
          amountPaise: 100000,
          accountId: accBankId,
          categoryId: catGroceriesId,
          transactionDate: new Date(2026, 10, 6, 10, 0, 0)
        }),
        makeTx({
          id: 'tx-trf-out',
          type: 'transfer',
          amountPaise: 250000,
          categoryId: undefined,
          accountId: accBankId,
          destinationAccountId: accCashId,
          transactionDate: new Date(2026, 10, 7, 10, 0, 0)
        }),
        makeTx({
          id: 'tx-trf-in',
          type: 'transfer',
          amountPaise: 75000,
          categoryId: undefined,
          accountId: accBorrowingsId,
          destinationAccountId: accBankId,
          transactionDate: new Date(2026, 10, 8, 10, 0, 0)
        }),
        // Unrelated cash expense should be excluded when filtering to Bank
        makeTx({
          id: 'tx-cash-exp',
          type: 'expense',
          amountPaise: 50000,
          accountId: accCashId,
          categoryId: catDiningId,
          transactionDate: new Date(2026, 10, 9, 10, 0, 0)
        })
      ];

      const summary = FinancialReportService.generateFinancialSummary({
        userId,
        accounts,
        transactions: txs,
        categories,
        filters: {
          preset: 'this_month',
          accountIds: [accBankId]
        },
        now
      });

      expect(summary.metrics.totalIncomePaise).toBe(500000);
      expect(summary.metrics.totalExpensePaise).toBe(100000);
      expect(summary.metrics.netCashFlowPaise).toBe(400000);
      expect(summary.metrics.transfersInPaise).toBe(75000);
      expect(summary.metrics.transfersOutPaise).toBe(250000);
      expect(summary.metrics.netTransfersPaise).toBe(-175000);
      expect(summary.metrics.netTransfersFormatted).toBe('-₹1,750.00');
      expect(summary.metrics.transferCount).toBe(2);
    });

    it('handles empty datasets, empty periods, zero income savings rate, and all_time comparison unavailability safely', () => {
      const empty = FinancialReportService.generateFinancialSummary({
        userId,
        accounts,
        transactions: [],
        categories,
        filters: { preset: 'this_month' },
        now
      });

      expect(empty.isEmpty).toBe(true);
      expect(empty.metrics.totalIncomePaise).toBe(0);
      expect(empty.metrics.totalExpensePaise).toBe(0);
      expect(empty.metrics.netCashFlowPaise).toBe(0);
      expect(empty.metrics.savingsRatePercent).toBeNull();
      expect(empty.metrics.savingsRateFormatted).toBe('—');
      expect(empty.comparison.hasPreviousPeriodData).toBe(false);
      expect(empty.comparison.income.percentageChange).toBeNull();
      expect(empty.comparison.savingsRate.direction).toBe('unavailable');

      const expenseOnly = FinancialReportService.generateFinancialSummary({
        userId,
        accounts,
        transactions: [
          makeTx({
            id: 'tx-exp-only',
            type: 'expense',
            amountPaise: 120000,
            transactionDate: new Date(2026, 10, 10, 12, 0, 0)
          })
        ],
        categories,
        filters: { preset: 'all_time' },
        now
      });

      expect(expenseOnly.metrics.totalIncomePaise).toBe(0);
      expect(expenseOnly.metrics.netCashFlowPaise).toBe(-120000);
      expect(expenseOnly.metrics.savingsRatePercent).toBeNull();
      expect(expenseOnly.metrics.savingsRateFormatted).toBe('—');
      expect(expenseOnly.comparison.comparisonAvailable).toBe(false);
      expect(expenseOnly.comparison.income.direction).toBe('unavailable');
    });

    it('supports monthly granularity for multi-month ranges and equal-span previous custom ranges', () => {
      const txs: ReportTransactionRecord[] = [
        // Prior 10-day span: Nov 1 - Nov 10
        makeTx({
          id: 'tx-prev-span',
          type: 'expense',
          amountPaise: 200000,
          transactionDate: new Date(2026, 10, 5, 10, 0, 0)
        }),
        // Current 10-day span: Nov 11 - Nov 20
        makeTx({
          id: 'tx-curr-span',
          type: 'expense',
          amountPaise: 300000,
          transactionDate: new Date(2026, 10, 15, 10, 0, 0)
        })
      ];

      const customRes = FinancialReportService.generateFinancialSummary({
        userId,
        accounts,
        transactions: txs,
        categories,
        filters: {
          preset: 'custom',
          customRange: { startDate: '2026-11-11', endDate: '2026-11-20' }
        },
        now
      });

      expect(customRes.metrics.totalExpensePaise).toBe(300000);
      expect(customRes.comparison.expense.previousPaise).toBe(200000);
      expect(customRes.comparison.expense.deltaPaise).toBe(100000);
      expect(customRes.comparison.expense.percentageChange).toBe(50);

      const sixMonths = FinancialReportService.generateFinancialSummary({
        userId,
        accounts,
        transactions: txs,
        categories,
        filters: { preset: 'last_6_months' },
        now
      });

      expect(sixMonths.period.granularity).toBe('monthly');
      expect(sixMonths.periodBreakdown).toHaveLength(6);
    });
  });

  describe('B. Account Statement Reports', () => {
    it('computes period opening balance from pre-period ledger, period closing balance, post-period live balance divergence, and counterparty names', () => {
      // HDFC Bank inception opening = ₹10,000.00 (1,000,000 paise)
      const txs: ReportTransactionRecord[] = [
        // Pre-period (Oct 2026): +₹5,000 salary, -₹1,000 groceries, -₹500 transfer out -> net +₹3,500
        // Nov 1 Opening Balance MUST be ₹13,500.00 (1,350,000 paise)
        makeTx({
          id: 'pre-inc',
          type: 'income',
          amountPaise: 500000,
          accountId: accBankId,
          categoryId: catSalaryId,
          title: 'Oct Salary',
          transactionDate: new Date(2026, 9, 5, 10, 0, 0)
        }),
        makeTx({
          id: 'pre-exp',
          type: 'expense',
          amountPaise: 100000,
          accountId: accBankId,
          categoryId: catGroceriesId,
          title: 'Oct Groceries',
          transactionDate: new Date(2026, 9, 15, 10, 0, 0)
        }),
        makeTx({
          id: 'pre-trf-out',
          type: 'transfer',
          amountPaise: 50000,
          categoryId: undefined,
          accountId: accBankId,
          destinationAccountId: accCashId,
          title: 'Oct ATM',
          transactionDate: new Date(2026, 9, 25, 10, 0, 0)
        }),

        // In-period (Nov 2026):
        // 1) Nov 02 Income +₹2,000 -> running ₹15,500 (1,550,000)
        // 2) Nov 10 Transfer OUT to Cash -₹1,200 -> running ₹14,300 (1,430,000)
        // 3) Nov 12 Transfer IN from Personal Borrowings +₹3,000 -> running ₹17,300 (1,730,000)
        // 4) Nov 20 Expense -₹800 -> running ₹16,500 (1,650,000)
        makeTx({
          id: 'nov-1-inc',
          type: 'income',
          amountPaise: 200000,
          accountId: accBankId,
          categoryId: catFreelanceId,
          title: 'Client Advance',
          transactionDate: new Date(2026, 10, 2, 9, 0, 0)
        }),
        makeTx({
          id: 'nov-2-trf-out',
          type: 'transfer',
          amountPaise: 120000,
          categoryId: undefined,
          accountId: accBankId,
          destinationAccountId: accCashId,
          title: 'Cash Topup',
          transactionDate: new Date(2026, 10, 10, 14, 0, 0)
        }),
        makeTx({
          id: 'nov-3-trf-in',
          type: 'transfer',
          amountPaise: 300000,
          categoryId: undefined,
          accountId: accBorrowingsId,
          destinationAccountId: accBankId,
          title: 'Friend Loan Deposit',
          transactionDate: new Date(2026, 10, 12, 16, 0, 0)
        }),
        makeTx({
          id: 'nov-4-exp',
          type: 'expense',
          amountPaise: 80000,
          accountId: accBankId,
          categoryId: catDiningId,
          title: 'Team Lunch',
          transactionDate: new Date(2026, 10, 20, 13, 0, 0)
        }),

        // Post-period (Dec 2026): -₹4,500 -> live balance = ₹12,000.00 (1,200,000)
        makeTx({
          id: 'dec-exp',
          type: 'expense',
          amountPaise: 450000,
          accountId: accBankId,
          categoryId: catGroceriesId,
          title: 'Dec Rent',
          transactionDate: new Date(2026, 11, 1, 8, 0, 0)
        }),

        // Soft-deleted tx MUST NOT affect opening, running, closing, or live balance
        makeTx({
          id: 'del-nov',
          type: 'expense',
          amountPaise: 500000,
          accountId: accBankId,
          isDeleted: true,
          transactionDate: new Date(2026, 10, 15, 10, 0, 0)
        })
      ];

      const stmt = FinancialReportService.generateAccountStatement({
        userId,
        accounts,
        transactions: txs,
        categories,
        filters: {
          preset: 'this_month',
          statementAccountId: accBankId
        },
        now
      });

      expect(stmt.reportType).toBe('statement');
      expect(stmt.account.name).toBe('HDFC Salary');
      expect(stmt.balances).toMatchObject({
        inceptionOpeningBalancePaise: 1000000,
        prePeriodDeltaPaise: 350000,
        prePeriodTransactionCount: 3,
        periodOpeningBalancePaise: 1350000,
        periodOpeningBalanceFormatted: '₹13,500.00',
        totalCreditsPaise: 500000,
        totalDebitsPaise: 200000,
        totalIncomeCreditsPaise: 200000,
        totalTransferCreditsPaise: 300000,
        totalExpenseDebitsPaise: 80000,
        totalTransferDebitsPaise: 120000,
        netPeriodChangePaise: 300000,
        periodClosingBalancePaise: 1650000,
        periodClosingBalanceFormatted: '₹16,500.00',
        currentLiveBalancePaise: 1200000,
        currentLiveBalanceFormatted: '₹12,000.00',
        postPeriodTransactionCount: 1,
        postPeriodNetDeltaPaise: -450000,
        hasPostPeriodActivity: true,
        closingDiffersFromLiveBalance: true
      });
      expect(stmt.balances.balanceSemanticsNote).toContain('post-period transaction');

      expect(stmt.entries).toHaveLength(4);
      expect(stmt.entries[0]).toMatchObject({
        transactionId: 'nov-1-inc',
        direction: 'credit',
        transferDirection: null,
        creditPaise: 200000,
        debitPaise: 0,
        runningBalancePaise: 1550000
      });
      expect(stmt.entries[1]).toMatchObject({
        transactionId: 'nov-2-trf-out',
        direction: 'debit',
        transferDirection: 'outgoing',
        counterpartyAccountId: accCashId,
        counterpartyAccountName: 'Cash Wallet',
        debitPaise: 120000,
        runningBalancePaise: 1430000
      });
      expect(stmt.entries[2]).toMatchObject({
        transactionId: 'nov-3-trf-in',
        direction: 'credit',
        transferDirection: 'incoming',
        counterpartyAccountId: accBorrowingsId,
        counterpartyAccountName: 'Personal Borrowings',
        creditPaise: 300000,
        runningBalancePaise: 1730000
      });
      expect(stmt.entries[3]).toMatchObject({
        transactionId: 'nov-4-exp',
        direction: 'debit',
        runningBalancePaise: 1650000
      });
    });

    it('sorts identical transactionDate entries deterministically by createdAt ASC then id ASC', () => {
      const sameDate = new Date(2026, 10, 10, 0, 0, 0, 0);
      // Supply intentionally out-of-order rows
      const txs: ReportTransactionRecord[] = [
        makeTx({
          id: 'tx-b',
          type: 'expense',
          amountPaise: 10000,
          accountId: accBankId,
          title: 'Same CreatedAt B',
          transactionDate: sameDate,
          createdAt: new Date(2026, 10, 10, 9, 0, 0)
        }),
        makeTx({
          id: 'tx-a',
          type: 'income',
          amountPaise: 50000,
          accountId: accBankId,
          categoryId: catSalaryId,
          title: 'Same CreatedAt A',
          transactionDate: sameDate,
          createdAt: new Date(2026, 10, 10, 9, 0, 0)
        }),
        makeTx({
          id: 'tx-earliest-created',
          type: 'expense',
          amountPaise: 20000,
          accountId: accBankId,
          title: 'Earliest Created',
          transactionDate: sameDate,
          createdAt: new Date(2026, 10, 10, 8, 0, 0)
        })
      ];

      const stmt = FinancialReportService.generateAccountStatement({
        userId,
        accounts,
        transactions: txs,
        categories,
        filters: {
          preset: 'this_month',
          statementAccountId: accBankId
        },
        now
      });

      expect(stmt.entries.map((e) => e.transactionId)).toEqual([
        'tx-earliest-created',
        'tx-a',
        'tx-b'
      ]);
      // Opening ₹10,000.00 (1,000,000):
      // -20,000 -> 980,000; +50,000 -> 1,030,000; -10,000 -> 1,020,000
      expect(stmt.entries.map((e) => e.runningBalancePaise)).toEqual([
        980000,
        1030000,
        1020000
      ]);
    });

    it('preserves signed credit-card convention where negative balance indicates debt owed and incoming transfers reduce liability', () => {
      // ICICI Card opening = -₹15,000.00 (-1,500,000)
      const txs: ReportTransactionRecord[] = [
        makeTx({
          id: 'cc-exp',
          type: 'expense',
          amountPaise: 250000, // -₹2,500 -> -₹17,500
          accountId: accCreditCardId,
          categoryId: catDiningId,
          title: 'Flight Ticket',
          transactionDate: new Date(2026, 10, 4, 10, 0, 0)
        }),
        makeTx({
          id: 'cc-pay',
          type: 'transfer',
          amountPaise: 1000000, // +₹10,000 -> -₹7,500
          categoryId: undefined,
          accountId: accBankId,
          destinationAccountId: accCreditCardId,
          title: 'Card Bill Payment',
          transactionDate: new Date(2026, 10, 15, 10, 0, 0)
        })
      ];

      const stmt = FinancialReportService.generateAccountStatement({
        userId,
        accounts,
        transactions: txs,
        categories,
        filters: {
          preset: 'this_month',
          statementAccountId: accCreditCardId
        },
        now
      });

      expect(stmt.account.isCreditCard).toBe(true);
      expect(stmt.balances.periodOpeningBalancePaise).toBe(-1500000);
      expect(stmt.balances.periodClosingBalancePaise).toBe(-750000);
      expect(stmt.balances.periodClosingBalanceFormatted).toBe('-₹7,500.00');
      expect(stmt.balances.currentLiveBalancePaise).toBe(-750000);
      expect(stmt.balances.isCreditCardLiability).toBe(true);
      expect(stmt.balances.balanceSemanticsNote).toContain('amount owed');
      expect(stmt.entries.map((e) => e.runningBalancePaise)).toEqual([-1750000, -750000]);
    });

    it('preserves exact running and closing account balances even when row-level display sub-filters are active', () => {
      const txs: ReportTransactionRecord[] = [
        makeTx({
          id: 'sub-1',
          type: 'income',
          amountPaise: 500000,
          accountId: accBankId,
          categoryId: catSalaryId,
          title: 'Salary',
          transactionDate: new Date(2026, 10, 1, 10, 0, 0)
        }),
        makeTx({
          id: 'sub-2',
          type: 'expense',
          amountPaise: 100000,
          accountId: accBankId,
          categoryId: catGroceriesId,
          title: 'BigBasket',
          transactionDate: new Date(2026, 10, 2, 10, 0, 0)
        })
      ];

      const stmt = FinancialReportService.generateAccountStatement({
        userId,
        accounts,
        transactions: txs,
        categories,
        filters: {
          preset: 'this_month',
          statementAccountId: accBankId,
          types: ['expense']
        },
        now
      });

      expect(stmt.isSubFiltered).toBe(true);
      expect(stmt.totalPeriodEntryCount).toBe(2);
      expect(stmt.displayedEntryCount).toBe(1);
      expect(stmt.entries[0].transactionId).toBe('sub-2');
      // True ledger balance after sub-1 (+₹5,000) and sub-2 (-₹1,000) from ₹10,000 opening = ₹14,000
      expect(stmt.entries[0].runningBalancePaise).toBe(1400000);
      expect(stmt.balances.periodClosingBalancePaise).toBe(1400000);
    });
  });

  describe('C. Category Reports & D. Filtering Consistency', () => {
    it('builds separate income and expense breakdowns, preserves archived categories, includes uncategorized items, and excludes transfers', () => {
      const txs: ReportTransactionRecord[] = [
        // Prior month comparison for Groceries & Salary
        makeTx({
          id: 'prev-sal',
          type: 'income',
          amountPaise: 500000,
          categoryId: catSalaryId,
          title: 'Oct Salary',
          transactionDate: new Date(2026, 9, 5, 10, 0, 0)
        }),
        makeTx({
          id: 'prev-groc',
          type: 'expense',
          amountPaise: 100000,
          categoryId: catGroceriesId,
          title: 'Oct Groceries',
          transactionDate: new Date(2026, 9, 6, 10, 0, 0)
        }),

        // Current month Income: Salary ₹6,000, Archived Income ₹2,000, Uncategorized Income ₹2,000 -> Total ₹10,000
        makeTx({
          id: 'cur-sal',
          type: 'income',
          amountPaise: 600000,
          categoryId: catSalaryId,
          title: 'Nov Salary',
          transactionDate: new Date(2026, 10, 2, 10, 0, 0)
        }),
        makeTx({
          id: 'cur-arch-inc',
          type: 'income',
          amountPaise: 200000,
          categoryId: catArchivedIncomeId,
          title: 'Legacy Bonus Payout',
          transactionDate: new Date(2026, 10, 3, 10, 0, 0)
        }),
        makeTx({
          id: 'cur-uncat-inc',
          type: 'income',
          amountPaise: 200000,
          categoryId: undefined,
          title: 'Misc Refund',
          transactionDate: new Date(2026, 10, 4, 10, 0, 0)
        }),

        // Current month Expense: Groceries ₹2,500, Archived Expense ₹1,500, Mismatched-category Expense -> Uncategorized ₹1,000 -> Total ₹5,000
        makeTx({
          id: 'cur-groc',
          type: 'expense',
          amountPaise: 250000,
          categoryId: catGroceriesId,
          title: 'Groceries',
          transactionDate: new Date(2026, 10, 5, 10, 0, 0)
        }),
        makeTx({
          id: 'cur-arch-exp',
          type: 'expense',
          amountPaise: 150000,
          categoryId: catArchivedExpenseId,
          title: 'Old Streaming Plan',
          transactionDate: new Date(2026, 10, 6, 10, 0, 0)
        }),
        makeTx({
          id: 'cur-mismatch-exp',
          type: 'expense',
          amountPaise: 100000,
          categoryId: catSalaryId, // Income category mistakenly referenced on expense -> resolves to uncategorized
          title: 'Mismatched Fee',
          transactionDate: new Date(2026, 10, 7, 10, 0, 0)
        }),

        // Transfer MUST be excluded from category breakdowns
        makeTx({
          id: 'cur-trf',
          type: 'transfer',
          amountPaise: 900000,
          categoryId: undefined,
          accountId: accBankId,
          destinationAccountId: accCashId,
          title: 'Transfer Excluded',
          transactionDate: new Date(2026, 10, 8, 10, 0, 0)
        })
      ];

      const catReport = FinancialReportService.generateCategoryReport({
        userId,
        accounts,
        transactions: txs,
        categories,
        filters: { preset: 'this_month' },
        now
      });

      expect(catReport.reportType).toBe('category');
      expect(catReport.excludedTransferCount).toBe(1);
      expect(catReport.isEmpty).toBe(false);

      expect(catReport.expenseSummary).toMatchObject({
        totalPaise: 500000,
        transactionCount: 3,
        categoryCount: 3,
        archivedCategoryCount: 1,
        previousTotalPaise: 100000,
        deltaPaise: 400000,
        percentageChange: 400,
        direction: 'increase'
      });

      expect(catReport.incomeSummary).toMatchObject({
        totalPaise: 1000000,
        transactionCount: 3,
        categoryCount: 3,
        archivedCategoryCount: 1,
        previousTotalPaise: 500000,
        deltaPaise: 500000,
        percentageChange: 100,
        direction: 'increase'
      });

      expect(catReport.expenseBreakdown[0]).toMatchObject({
        categoryId: catGroceriesId,
        categoryName: 'Groceries & Household',
        isArchived: false,
        totalPaise: 250000,
        percentageShare: 50,
        previousPaise: 100000,
        deltaPaise: 150000,
        percentageChange: 150,
        direction: 'increase'
      });

      const archivedExpRow = catReport.expenseBreakdown.find(
        (r) => r.categoryId === catArchivedExpenseId
      );
      expect(archivedExpRow).toMatchObject({
        categoryName: 'Legacy Subscriptions',
        isArchived: true,
        totalPaise: 150000,
        percentageShare: 30,
        previousPaise: 0,
        percentageChange: null,
        direction: 'new'
      });

      const uncatExpRow = catReport.expenseBreakdown.find((r) => r.categoryId === 'uncategorized');
      expect(uncatExpRow).toMatchObject({
        categoryName: 'Uncategorized',
        totalPaise: 100000,
        percentageShare: 20
      });

      const archivedIncRow = catReport.incomeBreakdown.find(
        (r) => r.categoryId === catArchivedIncomeId
      );
      expect(archivedIncRow).toMatchObject({
        categoryName: 'Legacy Bonus',
        isArchived: true,
        totalPaise: 200000,
        percentageShare: 20
      });
    });

    it('enforces strict category/type filter consistency and excludes archived categories when includeArchivedCategories is false', () => {
      const txs: ReportTransactionRecord[] = [
        makeTx({
          id: 'tx-sal',
          type: 'income',
          amountPaise: 500000,
          categoryId: catSalaryId,
          title: 'Monthly Salary',
          transactionDate: new Date(2026, 10, 5, 10, 0, 0)
        }),
        makeTx({
          id: 'tx-groc',
          type: 'expense',
          amountPaise: 100000,
          categoryId: catGroceriesId,
          note: 'Organic market order',
          title: 'Weekly Groceries',
          transactionDate: new Date(2026, 10, 6, 10, 0, 0)
        }),
        makeTx({
          id: 'tx-arch',
          type: 'expense',
          amountPaise: 50000,
          categoryId: catArchivedExpenseId,
          title: 'Old Plan',
          transactionDate: new Date(2026, 10, 7, 10, 0, 0)
        }),
        makeTx({
          id: 'tx-trf',
          type: 'transfer',
          amountPaise: 200000,
          categoryId: undefined,
          accountId: accBankId,
          destinationAccountId: accCashId,
          title: 'Transfer',
          transactionDate: new Date(2026, 10, 8, 10, 0, 0)
        })
      ];

      // 1. Selecting an expense category in Summary MUST exclude income and transfers
      const expenseCatOnly = FinancialReportService.generateFinancialSummary({
        userId,
        accounts,
        transactions: txs,
        categories,
        filters: {
          preset: 'this_month',
          categoryIds: [catGroceriesId]
        },
        now
      });
      expect(expenseCatOnly.metrics.totalIncomePaise).toBe(0);
      expect(expenseCatOnly.metrics.totalExpensePaise).toBe(100000);
      expect(expenseCatOnly.metrics.transferCount).toBe(0);

      // 2. Selecting an income category while restricting types to ['expense'] produces empty results (no leak)
      const conflictingFilter = FinancialReportService.generateCategoryReport({
        userId,
        accounts,
        transactions: txs,
        categories,
        filters: {
          preset: 'this_month',
          categoryIds: [catSalaryId],
          types: ['expense']
        },
        now
      });
      expect(conflictingFilter.isEmpty).toBe(true);
      expect(conflictingFilter.incomeSummary.totalPaise).toBe(0);
      expect(conflictingFilter.expenseSummary.totalPaise).toBe(0);

      // 3. Excluding archived categories filters them out cleanly
      const activeCatsOnly = FinancialReportService.generateCategoryReport({
        userId,
        accounts,
        transactions: txs,
        categories,
        filters: {
          preset: 'this_month',
          includeArchivedCategories: false
        },
        now
      });
      expect(activeCatsOnly.expenseSummary.totalPaise).toBe(100000);
      expect(activeCatsOnly.expenseSummary.archivedCategoryCount).toBe(0);

      // 4. Search query matches case-insensitively on title or note
      const searched = FinancialReportService.generateFinancialSummary({
        userId,
        accounts,
        transactions: txs,
        categories,
        filters: {
          preset: 'this_month',
          searchQuery: 'ORGANIC'
        },
        now
      });
      expect(searched.metrics.totalExpensePaise).toBe(100000);
      expect(searched.metrics.totalIncomePaise).toBe(0);
    });

    it('handles system account exclusion without corrupting bank statement transfers', () => {
      const txs: ReportTransactionRecord[] = [
        // Direct edge-case expense recorded on system account
        makeTx({
          id: 'sys-direct-exp',
          type: 'expense',
          amountPaise: 30000,
          accountId: accBorrowingsId,
          categoryId: catGroceriesId,
          title: 'System Direct Fee',
          transactionDate: new Date(2026, 10, 4, 10, 0, 0)
        }),
        // Normal borrowing transfer from Personal Borrowings -> Bank
        makeTx({
          id: 'sys-trf-to-bank',
          type: 'transfer',
          amountPaise: 400000,
          categoryId: undefined,
          accountId: accBorrowingsId,
          destinationAccountId: accBankId,
          title: 'Borrowing Receipt',
          transactionDate: new Date(2026, 10, 5, 10, 0, 0)
        })
      ];

      const summaryNoSystem = FinancialReportService.generateFinancialSummary({
        userId,
        accounts,
        transactions: txs,
        categories,
        filters: {
          preset: 'this_month',
          includeSystemAccounts: false
        },
        now
      });

      expect(summaryNoSystem.metrics.totalExpensePaise).toBe(0);
      // Bank received ₹4,000 in, while Personal Borrowings side is out of reportable scope
      expect(summaryNoSystem.metrics.transfersInPaise).toBe(400000);
      expect(summaryNoSystem.metrics.transfersOutPaise).toBe(0);

      // Bank statement still resolves counterparty 'Personal Borrowings' accurately
      const bankStmt = FinancialReportService.generateAccountStatement({
        userId,
        accounts,
        transactions: txs,
        categories,
        filters: {
          preset: 'this_month',
          statementAccountId: accBankId,
          includeSystemAccounts: false
        },
        now
      });

      expect(bankStmt.entries).toHaveLength(1);
      expect(bankStmt.entries[0].counterpartyAccountName).toBe('Personal Borrowings');
      expect(bankStmt.balances.periodClosingBalancePaise).toBe(1400000);
    });

    it('produces zero NaN values when previous period totals or shares are zero', () => {
      const txs: ReportTransactionRecord[] = [
        makeTx({
          id: 'cur-only',
          type: 'expense',
          amountPaise: 50000,
          categoryId: catGroceriesId,
          transactionDate: new Date(2026, 10, 5, 10, 0, 0)
        })
      ];

      const catReport = FinancialReportService.generateCategoryReport({
        userId,
        accounts,
        transactions: txs,
        categories,
        filters: { preset: 'this_month' },
        now
      });

      expect(catReport.expenseSummary.previousTotalPaise).toBe(0);
      expect(catReport.expenseSummary.percentageChange).toBeNull();
      expect(catReport.expenseBreakdown[0].percentageChange).toBeNull();
      expect(catReport.incomeSummary.totalPaise).toBe(0);
      expect(catReport.incomeBreakdown).toEqual([]);
    });
  });

  describe('Security, Domain Validation, Overflow & Immutability Guards', () => {
    it('rejects invalid user IDs, missing statement accounts, and cross-user entities', () => {
      expect(() =>
        FinancialReportService.generateFinancialSummary({
          userId: 'bad-user-id',
          accounts,
          transactions: [],
          categories,
          filters: { preset: 'this_month' },
          now
        })
      ).toThrow(InvalidUserIdError);

      expect(() =>
        FinancialReportService.generateAccountStatement({
          userId,
          accounts,
          transactions: [],
          categories,
          filters: {
            preset: 'this_month',
            statementAccountId: '99999999-9999-4999-8999-999999999999'
          },
          now
        })
      ).toThrow(AccountNotFoundError);

      expect(() =>
        FinancialReportService.generateFinancialSummary({
          userId,
          accounts: [
            ...accounts,
            {
              id: 'foreign-acc',
              userId: otherUserId,
              name: 'Foreign Bank',
              accountType: 'bank',
              openingBalancePaise: 1000,
              isArchived: false
            }
          ],
          transactions: [],
          categories,
          filters: { preset: 'this_month' },
          now
        })
      ).toThrow(UnauthorizedEntityAccessError);

      expect(() =>
        FinancialReportService.generateFinancialSummary({
          userId,
          accounts,
          transactions: [makeTx({ id: 'foreign-tx', userId: otherUserId })],
          categories,
          filters: { preset: 'this_month' },
          now
        })
      ).toThrow(UnauthorizedEntityAccessError);

      const foreignCategory: ReportCategoryRecord = {
        id: 'foreign-cat',
        userId: otherUserId,
        name: 'Foreign Cat',
        type: 'expense',
        isArchived: false
      };
      expect(() =>
        FinancialReportService.generateCategoryReport({
          userId,
          accounts,
          transactions: [],
          categories: [...categories, foreignCategory],
          filters: { preset: 'this_month' },
          now
        })
      ).toThrow(UnauthorizedEntityAccessError);
    });

    it('rejects floating-point amounts and integer-paise overflow safely', () => {
      expect(() =>
        FinancialReportService.generateFinancialSummary({
          userId,
          accounts,
          transactions: [makeTx({ id: 'float-tx', amountPaise: 100.5 })],
          categories,
          filters: { preset: 'this_month' },
          now
        })
      ).toThrow(DomainError);

      expect(() =>
        FinancialReportService.generateFinancialSummary({
          userId,
          accounts,
          transactions: [
            makeTx({ id: 'ovf-1', amountPaise: Number.MAX_SAFE_INTEGER }),
            makeTx({ id: 'ovf-2', amountPaise: 1000 })
          ],
          categories,
          filters: { preset: 'this_month' },
          now
        })
      ).toThrow(InvalidTransactionAmountError);

      expect(() =>
        FinancialReportService.generateAccountStatement({
          userId,
          accounts: [
            {
              id: accBankId,
              userId,
              name: 'Huge Bank',
              accountType: 'bank',
              openingBalancePaise: Number.MAX_SAFE_INTEGER,
              isArchived: false
            }
          ],
          transactions: [
            makeTx({
              id: 'ovf-stmt',
              type: 'income',
              amountPaise: 5000,
              accountId: accBankId,
              categoryId: catSalaryId,
              transactionDate: new Date(2026, 10, 5, 10, 0, 0)
            })
          ],
          categories,
          filters: { preset: 'this_month', statementAccountId: accBankId },
          now
        })
      ).toThrow(DomainError);
    });

    it('never mutates input accounts, transactions, categories, or filter arrays', () => {
      const frozenAccounts = Object.freeze(
        accounts.map((a) => Object.freeze({ ...a }))
      );
      const frozenCategories = Object.freeze(categories);
      const domainTxs = Object.freeze([
        new Transaction({
          id: createTransactionId('imm-1'),
          userId: createUserId(userId),
          type: 'income',
          amountPaise: 250000,
          accountId: createAccountId(accBankId),
          categoryId: createCategoryId(catSalaryId),
          title: 'Salary',
          transactionDate: new Date(2026, 10, 5, 10, 0, 0),
          idempotencyKey: 'k-imm-1'
        }),
        new Transaction({
          id: createTransactionId('imm-2'),
          userId: createUserId(userId),
          type: 'expense',
          amountPaise: 50000,
          accountId: createAccountId(accBankId),
          categoryId: createCategoryId(catGroceriesId),
          title: 'Milk & Bread',
          transactionDate: new Date(2026, 10, 4, 10, 0, 0),
          idempotencyKey: 'k-imm-2'
        })
      ]);
      const filterAccountIds = Object.freeze([accBankId]);
      const filterTypes = Object.freeze(['income', 'expense'] as const);

      const summary = FinancialReportService.generateFinancialSummary({
        userId,
        accounts: frozenAccounts,
        transactions: domainTxs,
        categories: frozenCategories,
        filters: {
          preset: 'this_month',
          accountIds: filterAccountIds,
          types: filterTypes
        },
        now
      });
      const stmt = FinancialReportService.generateAccountStatement({
        userId,
        accounts: frozenAccounts,
        transactions: domainTxs,
        categories: frozenCategories,
        filters: {
          preset: 'this_month',
          statementAccountId: accBankId
        },
        now
      });
      const cat = FinancialReportService.generateCategoryReport({
        userId,
        accounts: frozenAccounts,
        transactions: domainTxs,
        categories: frozenCategories,
        filters: { preset: 'this_month' },
        now
      });

      expect(summary.metrics.totalIncomePaise).toBe(250000);
      expect(stmt.entries.map((e) => e.transactionId)).toEqual(['imm-2', 'imm-1']);
      expect(domainTxs.map((t) => t.id)).toEqual(['imm-1', 'imm-2']);
      expect(cat.expenseSummary.totalPaise).toBe(50000);
    });
  });
});

import { describe, it, expect } from 'vitest';
import { LedgerRules } from '@/domain/rules/LedgerRules';
import { Money } from '@/domain/value-objects/Money';
import { createAccountId, createTransactionId, createUserId } from '@/domain/value-objects/Identifiers';
import { Transaction } from '@/domain/entities/Transaction';
import { Account } from '@/domain/entities/Account';

describe('LedgerRules', () => {
  const userId = createUserId('user-1');
  const bankAccountId = createAccountId('bank-1');
  const cashAccountId = createAccountId('cash-1');
  const creditCardId = createAccountId('cc-1');

  it('correctly calculates derived account balance through transactions', () => {
    const openingBalance = Money.fromRupees(1000); // 100,000 paise

    const transactions: Transaction[] = [
      new Transaction({
        id: createTransactionId('tx-1'),
        userId,
        type: 'income',
        amountPaise: 50000, // ₹500
        accountId: bankAccountId,
        title: 'Salary Bonus',
        transactionDate: new Date(),
        idempotencyKey: 'k-1'
      }),
      new Transaction({
        id: createTransactionId('tx-2'),
        userId,
        type: 'expense',
        amountPaise: 20000, // ₹200
        accountId: bankAccountId,
        title: 'Groceries',
        transactionDate: new Date(),
        idempotencyKey: 'k-2'
      }),
      new Transaction({
        id: createTransactionId('tx-3'),
        userId,
        type: 'transfer',
        amountPaise: 30000, // ₹300
        accountId: bankAccountId,
        destinationAccountId: cashAccountId,
        title: 'ATM Cash Withdrawal',
        transactionDate: new Date(),
        idempotencyKey: 'k-3'
      })
    ];

    // Bank balance: 1000 + 500 - 200 - 300 = 1000
    const bankBalance = LedgerRules.calculateAccountBalance(openingBalance, bankAccountId, transactions);
    expect(bankBalance.rupees).toBe(1000);

    // Cash balance: opening 0 + 300 transfer in = 300
    const cashBalance = LedgerRules.calculateAccountBalance(Money.zero(), cashAccountId, transactions);
    expect(cashBalance.rupees).toBe(300);
  });

  it('excludes soft-deleted transactions from derived balances', () => {
    const openingBalance = Money.fromRupees(1000);

    const transactions: Transaction[] = [
      new Transaction({
        id: createTransactionId('tx-1'),
        userId,
        type: 'expense',
        amountPaise: 40000, // ₹400
        accountId: bankAccountId,
        title: 'Cancelled Expense',
        transactionDate: new Date(),
        deletedAt: new Date(), // Soft-deleted
        idempotencyKey: 'k-del'
      })
    ];

    const balance = LedgerRules.calculateAccountBalance(openingBalance, bankAccountId, transactions);
    // Deleted transaction must NOT reduce balance
    expect(balance.rupees).toBe(1000);
  });

  it('correctly handles negative balances for credit accounts or deficits', () => {
    const openingBalance = Money.zero();

    const transactions: Transaction[] = [
      new Transaction({
        id: createTransactionId('tx-cc-1'),
        userId,
        type: 'expense',
        amountPaise: 450000, // ₹4,500
        accountId: creditCardId,
        title: 'Flight Ticket',
        transactionDate: new Date(),
        idempotencyKey: 'k-cc-1'
      })
    ];

    const balance = LedgerRules.calculateAccountBalance(openingBalance, creditCardId, transactions);
    expect(balance.rupees).toBe(-4500);
    expect(balance.paise).toBe(-450000);
    expect(balance.format()).toBe('-₹4,500.00');
  });

  it('correctly computes totals excluding transfers', () => {
    const transactions: Transaction[] = [
      new Transaction({
        id: createTransactionId('tx-1'),
        userId,
        type: 'income',
        amountPaise: 100000, // ₹1,000
        accountId: bankAccountId,
        title: 'Salary',
        transactionDate: new Date(),
        idempotencyKey: 'k-inc'
      }),
      new Transaction({
        id: createTransactionId('tx-2'),
        userId,
        type: 'expense',
        amountPaise: 40000, // ₹400
        accountId: bankAccountId,
        title: 'Utilities',
        transactionDate: new Date(),
        idempotencyKey: 'k-exp'
      }),
      new Transaction({
        id: createTransactionId('tx-3'),
        userId,
        type: 'transfer',
        amountPaise: 25000, // ₹250 (transfer, neutral to cashflow)
        accountId: bankAccountId,
        destinationAccountId: cashAccountId,
        title: 'Transfer',
        transactionDate: new Date(),
        idempotencyKey: 'k-tr'
      })
    ];

    const totals = LedgerRules.calculateTotals(transactions);
    expect(totals.totalIncome.rupees).toBe(1000);
    expect(totals.totalExpense.rupees).toBe(400);
    expect(totals.netSavings.rupees).toBe(600);
    expect(totals.transactionCount).toBe(3);
  });

  it('correctly computes net worth subtracting credit card liabilities', () => {
    const bankAccount = new Account({
      id: bankAccountId,
      userId,
      name: 'Bank',
      accountType: 'bank',
      openingBalancePaise: 500000 // ₹5,000
    });

    const creditCardAccount = new Account({
      id: creditCardId,
      userId,
      name: 'Credit Card',
      accountType: 'credit_card',
      openingBalancePaise: 0
    });

    const balances = [
      { account: bankAccount, balance: Money.fromRupees(5000) },
      { account: creditCardAccount, balance: Money.fromRupees(2000) } // ₹2,000 debt
    ];

    const netWorth = LedgerRules.calculateNetWorth(balances);
    // Net worth = 5,000 - 2,000 = 3,000
    expect(netWorth.rupees).toBe(3000);
  });
});

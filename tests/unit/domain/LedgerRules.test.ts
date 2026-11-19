import { describe, it, expect } from 'vitest';
import { LedgerRules } from '@/domain/rules/LedgerRules';
import { Money } from '@/domain/value-objects/Money';
import { createAccountId, createTransactionId } from '@/domain/value-objects/Identifiers';
import { Transaction } from '@/domain/entities/Transaction';

describe('LedgerRules', () => {
  const bankAccountId = createAccountId('bank-1');
  const cashAccountId = createAccountId('cash-1');

  it('correctly calculates derived account balance through transactions', () => {
    const openingBalance = Money.fromRupees(1000); // 100,000 paise

    const transactions: Transaction[] = [
      new Transaction({
        id: createTransactionId('tx-1'),
        type: 'income',
        amount: Money.fromRupees(500),
        accountId: bankAccountId,
        date: new Date(),
        description: 'Salary Bonus',
        status: 'cleared',
        idempotencyKey: 'k-1',
        version: 1,
        isDeleted: false,
        createdAt: new Date(),
        updatedAt: new Date()
      }),
      new Transaction({
        id: createTransactionId('tx-2'),
        type: 'expense',
        amount: Money.fromRupees(200),
        accountId: bankAccountId,
        date: new Date(),
        description: 'Groceries',
        status: 'cleared',
        idempotencyKey: 'k-2',
        version: 1,
        isDeleted: false,
        createdAt: new Date(),
        updatedAt: new Date()
      }),
      new Transaction({
        id: createTransactionId('tx-3'),
        type: 'transfer',
        amount: Money.fromRupees(300),
        accountId: bankAccountId,
        targetAccountId: cashAccountId,
        date: new Date(),
        description: 'ATM Cash Withdrawal',
        status: 'cleared',
        idempotencyKey: 'k-3',
        version: 1,
        isDeleted: false,
        createdAt: new Date(),
        updatedAt: new Date()
      })
    ];

    // Bank balance: 1000 + 500 - 200 - 300 = 1000
    const bankBalance = LedgerRules.calculateAccountBalance(openingBalance, bankAccountId, transactions);
    expect(bankBalance.rupees).toBe(1000);

    // Cash balance: opening 0 + 300 transfer in = 300
    const cashBalance = LedgerRules.calculateAccountBalance(Money.zero(), cashAccountId, transactions);
    expect(cashBalance.rupees).toBe(300);
  });
});

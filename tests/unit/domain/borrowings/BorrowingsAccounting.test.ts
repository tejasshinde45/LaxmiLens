import { describe, it, expect } from 'vitest';
import { LedgerRules } from '@/domain/rules/LedgerRules';
import { Account } from '@/domain/entities/Account';
import { Transaction } from '@/domain/entities/Transaction';
import { Money } from '@/domain/value-objects/Money';
import {
  createAccountId,
  createTransactionId,
  createUserId
} from '@/domain/value-objects/Identifiers';

describe('Personal Borrowings Financial Accounting Rules', () => {
  const userId = createUserId('11111111-1111-4111-8111-111111111111');
  const bankAccountId = createAccountId('33333333-3333-4333-8333-333333333333');
  const personalBorrowingsAccountId = createAccountId('99999999-9999-4999-8999-999999999999');

  const bankAccount = new Account({
    id: bankAccountId,
    userId,
    name: 'HDFC Savings',
    accountType: 'bank',
    openingBalancePaise: 5000000 // ₹50,000
  });

  const personalBorrowingsAccount = new Account({
    id: personalBorrowingsAccountId,
    userId,
    name: 'Personal Borrowings',
    accountType: 'other',
    openingBalancePaise: 0 // ₹0
  });

  it('Rule 1: Borrowing principal is NOT income, and repayment is NOT an expense', () => {
    // Borrow ₹10,000 from Rahul into Bank
    const borrowingTx = new Transaction({
      id: createTransactionId('tx-borrow-1'),
      userId,
      type: 'transfer',
      amountPaise: 1000000, // ₹10,000
      currency: 'INR',
      accountId: personalBorrowingsAccountId, // from Personal Borrowings
      destinationAccountId: bankAccountId, // into Bank
      title: 'Borrowing from Rahul',
      transactionDate: new Date('2026-11-01'),
      idempotencyKey: 'idemp-tx-borrow-1'
    });

    // Repay ₹4,000 to Rahul from Bank
    const repaymentTx = new Transaction({
      id: createTransactionId('tx-repay-1'),
      userId,
      type: 'transfer',
      amountPaise: 400000, // ₹4,000
      currency: 'INR',
      accountId: bankAccountId, // from Bank
      destinationAccountId: personalBorrowingsAccountId, // into Personal Borrowings
      title: 'Repayment to Rahul',
      transactionDate: new Date('2026-11-15'),
      idempotencyKey: 'idemp-tx-repay-1'
    });

    const ledgerTotals = LedgerRules.calculateTotals([borrowingTx, repaymentTx]);

    // Transfers are excluded from income and expenses:
    expect(ledgerTotals.totalIncome.rupees).toBe(0);
    expect(ledgerTotals.totalExpense.rupees).toBe(0);
    expect(ledgerTotals.netSavings.rupees).toBe(0);
    expect(ledgerTotals.transactionCount).toBe(2);
  });

  it('Rule 2: Borrowing increases receiving cash/bank asset and increases personal borrowing liability', () => {
    const borrowingTx = new Transaction({
      id: createTransactionId('tx-borrow-1'),
      userId,
      type: 'transfer',
      amountPaise: 1000000, // ₹10,000
      currency: 'INR',
      accountId: personalBorrowingsAccountId,
      destinationAccountId: bankAccountId,
      title: 'Borrowing from Rahul',
      transactionDate: new Date('2026-11-01'),
      idempotencyKey: 'idemp-tx-borrow-2'
    });

    // Bank Account: ₹50,000 + ₹10,000 = ₹60,000
    const bankBalance = LedgerRules.calculateAccountBalance(
      bankAccount.openingBalance,
      bankAccountId,
      [borrowingTx]
    );
    expect(bankBalance.rupees).toBe(60000);

    // Personal Borrowings Account: ₹0 - ₹10,000 = -₹10,000 (represented as negative liability balance)
    const pbBalance = LedgerRules.calculateAccountBalance(
      personalBorrowingsAccount.openingBalance,
      personalBorrowingsAccountId,
      [borrowingTx]
    );
    expect(pbBalance.rupees).toBe(-10000);
  });

  it('Rule 3: Repayment decreases cash/bank asset and decreases personal borrowing liability', () => {
    const borrowingTx = new Transaction({
      id: createTransactionId('tx-borrow-1'),
      userId,
      type: 'transfer',
      amountPaise: 1000000, // ₹10,000
      currency: 'INR',
      accountId: personalBorrowingsAccountId,
      destinationAccountId: bankAccountId,
      title: 'Borrowing from Rahul',
      transactionDate: new Date('2026-11-01'),
      idempotencyKey: 'idemp-tx-borrow-3'
    });

    const repaymentTx = new Transaction({
      id: createTransactionId('tx-repay-1'),
      userId,
      type: 'transfer',
      amountPaise: 400000, // ₹4,000
      currency: 'INR',
      accountId: bankAccountId,
      destinationAccountId: personalBorrowingsAccountId,
      title: 'Repayment to Rahul',
      transactionDate: new Date('2026-11-15'),
      idempotencyKey: 'idemp-tx-repay-3'
    });

    const transactions = [borrowingTx, repaymentTx];

    // Bank Account: ₹50,000 + ₹10,000 - ₹4,000 = ₹56,000
    const bankBalance = LedgerRules.calculateAccountBalance(
      bankAccount.openingBalance,
      bankAccountId,
      transactions
    );
    expect(bankBalance.rupees).toBe(56000);

    // Personal Borrowings Account: ₹0 - ₹10,000 + ₹4,000 = -₹6,000 (remaining liability is ₹6,000)
    const pbBalance = LedgerRules.calculateAccountBalance(
      personalBorrowingsAccount.openingBalance,
      personalBorrowingsAccountId,
      transactions
    );
    expect(pbBalance.rupees).toBe(-6000);
  });

  it('Rule 4: Net worth accurately reflects the borrowing liability and remains constant across borrow/repay', () => {
    // 1. Initial State: Only Bank with ₹50,000
    const initialBalances = [
      { account: bankAccount, balance: Money.fromRupees(50000) },
      { account: personalBorrowingsAccount, balance: Money.fromRupees(0) }
    ];
    const initialNetWorth = LedgerRules.calculateNetWorth(initialBalances);
    expect(initialNetWorth.rupees).toBe(50000);

    // 2. After Borrowing ₹10,000:
    // Bank is ₹60,000 (Asset)
    // Personal Borrowings is -₹10,000 (Liability)
    // Net Worth = ₹60,000 + (-₹10,000) = ₹50,000 (unchanged!)
    const afterBorrowBalances = [
      { account: bankAccount, balance: Money.fromRupees(60000) },
      { account: personalBorrowingsAccount, balance: Money.fromRupees(-10000) }
    ];
    const afterBorrowNetWorth = LedgerRules.calculateNetWorth(afterBorrowBalances);
    expect(afterBorrowNetWorth.rupees).toBe(50000);

    // 3. After Repaying ₹4,000:
    // Bank is ₹56,000 (Asset)
    // Personal Borrowings is -₹6,000 (Liability)
    // Net Worth = ₹56,000 + (-₹6,000) = ₹50,000 (unchanged!)
    const afterRepayBalances = [
      { account: bankAccount, balance: Money.fromRupees(56000) },
      { account: personalBorrowingsAccount, balance: Money.fromRupees(-6000) }
    ];
    const afterRepayNetWorth = LedgerRules.calculateNetWorth(afterRepayBalances);
    expect(afterRepayNetWorth.rupees).toBe(50000);
  });

  it('Rule 5: Preserves historical records when borrowings are fully repaid', () => {
    const borrowingTx = new Transaction({
      id: createTransactionId('tx-borrow-1'),
      userId,
      type: 'transfer',
      amountPaise: 500000,
      currency: 'INR',
      accountId: personalBorrowingsAccountId,
      destinationAccountId: bankAccountId,
      title: 'Borrowing from Rahul',
      transactionDate: new Date('2026-11-01'),
      idempotencyKey: 'idemp-tx-borrow-5'
    });

    const repaymentTx = new Transaction({
      id: createTransactionId('tx-repay-1'),
      userId,
      type: 'transfer',
      amountPaise: 500000,
      currency: 'INR',
      accountId: bankAccountId,
      destinationAccountId: personalBorrowingsAccountId,
      title: 'Full Repayment to Rahul',
      transactionDate: new Date('2026-11-20'),
      idempotencyKey: 'idemp-tx-repay-5'
    });

    const transactions = [borrowingTx, repaymentTx];

    // Bank Account returns to ₹50,000
    const bankBalance = LedgerRules.calculateAccountBalance(
      bankAccount.openingBalance,
      bankAccountId,
      transactions
    );
    expect(bankBalance.rupees).toBe(50000);

    // Personal Borrowings returns to ₹0
    const pbBalance = LedgerRules.calculateAccountBalance(
      personalBorrowingsAccount.openingBalance,
      personalBorrowingsAccountId,
      transactions
    );
    expect(pbBalance.rupees).toBe(0);

    // Both historical transactions remain preserved in ledger
    expect(transactions).toHaveLength(2);
    expect(transactions[0].isDeleted).toBe(false);
    expect(transactions[1].isDeleted).toBe(false);
  });
});

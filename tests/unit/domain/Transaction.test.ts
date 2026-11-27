import { describe, it, expect } from 'vitest';
import { Transaction } from '@/domain/entities/Transaction';
import { Category } from '@/domain/entities/Category';
import {
  createTransactionId,
  createAccountId,
  createCategoryId,
  createUserId
} from '@/domain/value-objects/Identifiers';
import {
  InvalidTransactionAmountError,
  MissingAccountError,
  TransferAccountMismatchError
} from '@/domain/errors/DomainErrors';

describe('Transaction Entity', () => {
  const userId = createUserId('user-1');
  const sourceAccountId = createAccountId('acc-source');
  const destinationAccountId = createAccountId('acc-dest');
  const expenseCategoryId = createCategoryId('cat-expense');
  const incomeCategoryId = createCategoryId('cat-income');

  it('creates valid income, expense, and transfer transactions', () => {
    // Valid Expense
    const expenseTx = new Transaction({
      id: createTransactionId('tx-1'),
      userId,
      type: 'expense',
      amountPaise: 49900, // ₹499.00
      accountId: sourceAccountId,
      categoryId: expenseCategoryId,
      title: 'Groceries at Nature Basket',
      transactionDate: new Date(),
      idempotencyKey: 'idemp-1'
    });
    expect(expenseTx.isExpense()).toBe(true);
    expect(expenseTx.amount.rupees).toBe(499);
    expect(expenseTx.isDeleted).toBe(false);

    // Valid Income
    const incomeTx = new Transaction({
      id: createTransactionId('tx-2'),
      userId,
      type: 'income',
      amountPaise: 15000000, // ₹1,50,000.00
      accountId: sourceAccountId,
      categoryId: incomeCategoryId,
      title: 'Monthly Salary',
      transactionDate: new Date(),
      idempotencyKey: 'idemp-2'
    });
    expect(incomeTx.isIncome()).toBe(true);
    expect(incomeTx.amount.rupees).toBe(150000);

    // Valid Transfer (category not required, distinct destination account)
    const transferTx = new Transaction({
      id: createTransactionId('tx-3'),
      userId,
      type: 'transfer',
      amountPaise: 2500000, // ₹25,000.00
      accountId: sourceAccountId,
      destinationAccountId,
      title: 'Transfer to Savings',
      transactionDate: new Date(),
      idempotencyKey: 'idemp-3'
    });
    expect(transferTx.isTransfer()).toBe(true);
    expect(transferTx.destinationAccountId).toBe(destinationAccountId);
    expect(transferTx.categoryId).toBeUndefined();
  });

  it('rejects zero or negative amounts', () => {
    expect(
      () =>
        new Transaction({
          id: createTransactionId('tx-invalid-1'),
          userId,
          type: 'expense',
          amountPaise: 0,
          accountId: sourceAccountId,
          title: 'Zero Amount',
          transactionDate: new Date(),
          idempotencyKey: 'idemp-inv-1'
        })
    ).toThrow(InvalidTransactionAmountError);

    expect(
      () =>
        new Transaction({
          id: createTransactionId('tx-invalid-2'),
          userId,
          type: 'expense',
          amountPaise: -5000,
          accountId: sourceAccountId,
          title: 'Negative Amount',
          transactionDate: new Date(),
          idempotencyKey: 'idemp-inv-2'
        })
    ).toThrow(InvalidTransactionAmountError);
  });

  it('rejects missing or empty account', () => {
    expect(
      () =>
        new Transaction({
          id: createTransactionId('tx-invalid-3'),
          userId,
          type: 'income',
          amountPaise: 50000,
          accountId: '' as any,
          title: 'Missing Account',
          transactionDate: new Date(),
          idempotencyKey: 'idemp-inv-3'
        })
    ).toThrow(MissingAccountError);
  });

  it('rejects transfer where source and destination accounts are the same', () => {
    expect(
      () =>
        new Transaction({
          id: createTransactionId('tx-invalid-4'),
          userId,
          type: 'transfer',
          amountPaise: 10000,
          accountId: sourceAccountId,
          destinationAccountId: sourceAccountId, // SAME ACCOUNT
          title: 'Self Transfer',
          transactionDate: new Date(),
          idempotencyKey: 'idemp-inv-4'
        })
    ).toThrow(TransferAccountMismatchError);
  });

  it('rejects transfer without destination account', () => {
    expect(
      () =>
        new Transaction({
          id: createTransactionId('tx-invalid-5'),
          userId,
          type: 'transfer',
          amountPaise: 10000,
          accountId: sourceAccountId,
          title: 'Missing Destination',
          transactionDate: new Date(),
          idempotencyKey: 'idemp-inv-5'
        })
    ).toThrow(TransferAccountMismatchError);
  });

  it('rejects destination account specified for non-transfer transaction', () => {
    expect(
      () =>
        new Transaction({
          id: createTransactionId('tx-invalid-6'),
          userId,
          type: 'expense',
          amountPaise: 10000,
          accountId: sourceAccountId,
          destinationAccountId,
          title: 'Invalid Non-Transfer Destination',
          transactionDate: new Date(),
          idempotencyKey: 'idemp-inv-6'
        })
    ).toThrow(/Only transfer transactions may specify a destination account/);
  });

  it('correctly handles soft deletion via markDeleted', () => {
    const original = new Transaction({
      id: createTransactionId('tx-7'),
      userId,
      type: 'expense',
      amountPaise: 20000,
      accountId: sourceAccountId,
      title: 'Original Active Transaction',
      transactionDate: new Date(),
      idempotencyKey: 'idemp-7'
    });

    expect(original.isDeleted).toBe(false);
    expect(original.deletedAt).toBeNull();

    const deleteTimestamp = new Date('2026-11-19T10:00:00Z');
    const deleted = original.markDeleted(deleteTimestamp);

    expect(deleted.isDeleted).toBe(true);
    expect(deleted.deletedAt).toEqual(deleteTimestamp);
    expect(deleted.id).toBe(original.id);
  });

  it('normalizes empty and whitespace-only notes to undefined while trimming non-empty notes', () => {
    const emptyNoteTx = new Transaction({
      id: createTransactionId('tx-empty-note'),
      userId,
      type: 'expense',
      amountPaise: 5000,
      accountId: sourceAccountId,
      title: 'Coffee',
      note: '',
      transactionDate: new Date(),
      idempotencyKey: 'idemp-empty-note'
    });
    expect(emptyNoteTx.note).toBeUndefined();
    expect(emptyNoteTx.notes).toBeUndefined();

    const whitespaceNoteTx = new Transaction({
      id: createTransactionId('tx-ws-note'),
      userId,
      type: 'expense',
      amountPaise: 5000,
      accountId: sourceAccountId,
      title: 'Tea',
      note: '   \t  ',
      transactionDate: new Date(),
      idempotencyKey: 'idemp-ws-note'
    });
    expect(whitespaceNoteTx.note).toBeUndefined();

    const nonEmptyNoteTx = new Transaction({
      id: createTransactionId('tx-trimmed-note'),
      userId,
      type: 'expense',
      amountPaise: 5000,
      accountId: sourceAccountId,
      title: 'Lunch',
      note: '  Team meal  ',
      transactionDate: new Date(),
      idempotencyKey: 'idemp-trimmed-note'
    });
    expect(nonEmptyNoteTx.note).toBe('Team meal');
  });
});

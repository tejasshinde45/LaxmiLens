import { Transaction, TransactionProps } from '@/domain/entities/Transaction';
import { Money } from '@/domain/value-objects/Money';
import {
  createTransactionId,
  createAccountId,
  createCategoryId
} from '@/domain/value-objects/Identifiers';

export function createTestTransaction(overrides: Partial<TransactionProps> = {}): Transaction {
  const now = new Date();
  return new Transaction({
    id: createTransactionId(crypto.randomUUID()),
    type: 'expense',
    amount: Money.fromPaise(50000), // ₹500.00
    accountId: createAccountId('acc-1'),
    categoryId: createCategoryId('cat-1'),
    date: now,
    description: 'Test Groceries',
    status: 'cleared',
    idempotencyKey: crypto.randomUUID(),
    version: 1,
    isDeleted: false,
    createdAt: now,
    updatedAt: now,
    ...overrides
  });
}

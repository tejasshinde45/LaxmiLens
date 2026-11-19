import { Transaction, TransactionProps } from '@/domain/entities/Transaction';
import {
  createTransactionId,
  createAccountId,
  createCategoryId,
  createUserId
} from '@/domain/value-objects/Identifiers';

export function createTestTransaction(overrides: Partial<TransactionProps> = {}): Transaction {
  const now = new Date();
  return new Transaction({
    id: createTransactionId(crypto.randomUUID()),
    userId: createUserId('test-user-1'),
    type: 'expense',
    amountPaise: 50000, // ₹500.00
    currency: 'INR',
    accountId: createAccountId('acc-1'),
    categoryId: createCategoryId('cat-1'),
    title: 'Test Groceries',
    transactionDate: now,
    deletedAt: null,
    status: 'cleared',
    idempotencyKey: crypto.randomUUID(),
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides
  });
}

import { Account, AccountProps } from '@/domain/entities/Account';
import { createAccountId, createUserId } from '@/domain/value-objects/Identifiers';

export function createTestAccount(overrides: Partial<AccountProps> = {}): Account {
  const now = new Date();
  return new Account({
    id: createAccountId(crypto.randomUUID()),
    userId: createUserId('123e4567-e89b-12d3-a456-426614174000'),
    name: 'HDFC Salary Bank',
    accountType: 'bank',
    currency: 'INR',
    openingBalancePaise: 1000000, // ₹10,000.00
    isArchived: false,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides
  });
}

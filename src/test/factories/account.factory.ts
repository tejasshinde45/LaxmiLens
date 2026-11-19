import { Account, AccountProps } from '@/domain/entities/Account';
import { Money } from '@/domain/value-objects/Money';
import { createAccountId } from '@/domain/value-objects/Identifiers';

export function createTestAccount(overrides: Partial<AccountProps> = {}): Account {
  const now = new Date();
  return new Account({
    id: createAccountId(crypto.randomUUID()),
    name: 'HDFC Salary Bank',
    type: 'bank',
    currency: 'INR',
    openingBalance: Money.fromPaise(1000000), // ₹10,000.00
    status: 'active',
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides
  });
}

import { Brand } from '@/types/common';
import { InvalidUserIdError } from '../errors/DomainErrors';

export type TransactionId = Brand<string, 'TransactionId'>;
export type AccountId = Brand<string, 'AccountId'>;
export type CategoryId = Brand<string, 'CategoryId'>;
export type BudgetId = Brand<string, 'BudgetId'>;
export type RecurringRuleId = Brand<string, 'RecurringRuleId'>;
export type RecurringOccurrenceId = Brand<string, 'RecurringOccurrenceId'>;
export type NotificationId = Brand<string, 'NotificationId'>;
export type LenderId = Brand<string, 'LenderId'>;
export type BorrowingId = Brand<string, 'BorrowingId'>;
export type RepaymentId = Brand<string, 'RepaymentId'>;
export type UserId = Brand<string, 'UserId'>;

export const createTransactionId = (id: string): TransactionId => id as TransactionId;
export const createAccountId = (id: string): AccountId => id as AccountId;
export const createCategoryId = (id: string): CategoryId => id as CategoryId;
export const createBudgetId = (id: string): BudgetId => id as BudgetId;
export const createRecurringRuleId = (id: string): RecurringRuleId => id as RecurringRuleId;
export const createRecurringOccurrenceId = (id: string): RecurringOccurrenceId =>
  id as RecurringOccurrenceId;
export const createNotificationId = (id: string): NotificationId => id as NotificationId;
export const createLenderId = (id: string): LenderId => id as LenderId;
export const createBorrowingId = (id: string): BorrowingId => id as BorrowingId;
export const createRepaymentId = (id: string): RepaymentId => id as RepaymentId;
export const createUserId = (id: string): UserId => id as UserId;

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(id: unknown): id is string {
  if (typeof id !== 'string') return false;
  return UUID_REGEX.test(id.trim());
}

export function validateUserId(id: unknown): UserId {
  if (!id || typeof id !== 'string' || !isValidUuid(id)) {
    throw new InvalidUserIdError(
      typeof id === 'string' && id.trim().length > 0
        ? `Invalid user ID '${id}'. A valid UUID is required.`
        : 'User ID is required and must be a valid UUID.'
    );
  }
  return id.trim() as UserId;
}

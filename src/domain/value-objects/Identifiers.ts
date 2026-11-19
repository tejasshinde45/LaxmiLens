import { Brand } from '@/types/common';

export type TransactionId = Brand<string, 'TransactionId'>;
export type AccountId = Brand<string, 'AccountId'>;
export type CategoryId = Brand<string, 'CategoryId'>;
export type BudgetId = Brand<string, 'BudgetId'>;
export type RecurringRuleId = Brand<string, 'RecurringRuleId'>;
export type UserId = Brand<string, 'UserId'>;

export const createTransactionId = (id: string): TransactionId => id as TransactionId;
export const createAccountId = (id: string): AccountId => id as AccountId;
export const createCategoryId = (id: string): CategoryId => id as CategoryId;
export const createBudgetId = (id: string): BudgetId => id as BudgetId;
export const createRecurringRuleId = (id: string): RecurringRuleId => id as RecurringRuleId;
export const createUserId = (id: string): UserId => id as UserId;

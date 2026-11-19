export interface LocalAccountRecord {
  id: string;
  name: string;
  type: 'cash' | 'bank' | 'upi' | 'wallet' | 'credit_card';
  currency: string;
  openingBalanceInPaise: number;
  status: 'active' | 'archived';
  color?: string;
  icon?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface LocalTransactionRecord {
  id: string;
  type: 'income' | 'expense' | 'transfer';
  amountInPaise: number;
  accountId: string;
  targetAccountId?: string;
  categoryId?: string;
  date: string;
  description: string;
  notes?: string;
  status: 'cleared' | 'pending' | 'reconciled';
  idempotencyKey: string;
  version: number;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LocalCategoryRecord {
  id: string;
  name: string;
  type: 'income' | 'expense';
  parentId?: string;
  icon?: string;
  color?: string;
  isSystem: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface LocalBudgetRecord {
  id: string;
  categoryId: string;
  period: string; // YYYY-MM
  limitInPaise: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface LocalRecurringRuleRecord {
  id: string;
  name: string;
  type: 'income' | 'expense' | 'transfer';
  amountInPaise: number;
  accountId: string;
  targetAccountId?: string;
  categoryId?: string;
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  startDate: string;
  endDate?: string;
  nextDueDate: string;
  lastGeneratedDate?: string;
  requiresUserConfirmation: boolean;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface LocalOutboxRecord {
  id?: number;
  entity: 'accounts' | 'transactions' | 'categories' | 'budgets' | 'recurring_rules';
  entityId: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  payload: Record<string, unknown>;
  idempotencyKey: string;
  attempts: number;
  lastAttemptAt?: string;
  lastError?: string;
  createdAt: string;
}

export interface LocalSyncMetadataRecord {
  key: string;
  value: string;
  updatedAt: string;
}

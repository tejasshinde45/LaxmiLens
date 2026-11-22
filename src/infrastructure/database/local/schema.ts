export interface LocalProfileRecord {
  id: string; // matches auth.users.id
  email: string;
  displayName?: string;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

export interface LocalAccountRecord {
  id: string; // UUID
  userId: string;
  name: string;
  accountType: 'cash' | 'bank' | 'savings' | 'credit_card' | 'wallet' | 'other';
  openingBalancePaise: number;
  currency: string;
  institutionName?: string;
  color?: string;
  icon?: string;
  notes?: string;
  isArchived: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;

  // Compatibility fields
  type?: string;
  openingBalanceInPaise?: number;
  status?: 'active' | 'archived';
}

export interface LocalCategoryRecord {
  id: string; // UUID
  userId: string;
  name: string;
  type: 'income' | 'expense';
  icon?: string;
  color?: string;
  isDefault: boolean;
  isArchived: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;

  // Compatibility fields
  parentId?: string;
  isSystem?: boolean;
}

export interface LocalTransactionRecord {
  id: string; // UUID
  userId: string;
  type: 'income' | 'expense' | 'transfer';
  amountPaise: number;
  currency: string;
  accountId: string;
  destinationAccountId?: string;
  categoryId?: string;
  title: string;
  note?: string;
  transactionDate: string; // ISO 8601 string
  deletedAt: string | null; // ISO 8601 or null
  version: number;
  deviceId?: string;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;

  // Compatibility fields
  targetAccountId?: string;
  description?: string;
  notes?: string;
  date?: string;
  amountInPaise?: number;
  isDeleted?: boolean;
  status?: 'cleared' | 'pending' | 'reconciled';
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
  userId: string;
  entity: 'profiles' | 'accounts' | 'transactions' | 'categories' | 'budgets' | 'recurring_rules';
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

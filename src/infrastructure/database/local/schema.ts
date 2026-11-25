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
  systemTag?: string | null;
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
  id: string; // UUID
  userId: string;
  categoryId: string;
  period: string; // YYYY-MM
  limitPaise: number;
  version: number;
  createdAt: string;
  updatedAt: string;

  // Compatibility fields
  limitInPaise?: number;
}

export interface LocalRecurringRuleRecord {
  id: string;
  userId: string;
  title: string;
  description?: string;
  type: 'income' | 'expense' | 'transfer';
  amountPaise: number;
  accountId: string;
  categoryId?: string;
  frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  interval: number;
  anchorDayOfMonth: number;
  startDate: string; // YYYY-MM-DD local calendar date
  endDate?: string | null; // YYYY-MM-DD
  nextDueDate: string; // YYYY-MM-DD
  lastGeneratedDate?: string | null; // YYYY-MM-DD
  status: 'active' | 'paused' | 'completed';
  requiresUserConfirmation: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;

  // Legacy v1/v2 compatibility fields preserved during migration
  name?: string;
  amountInPaise?: number;
  targetAccountId?: string;
  isActive?: boolean;
}

export interface LocalRecurringOccurrenceRecord {
  id: string;
  userId: string;
  recurringRuleId: string;
  occurrenceDate: string; // YYYY-MM-DD local calendar date
  status: 'pending' | 'confirmed' | 'skipped' | 'snoozed' | 'dismissed';
  snoozedUntilDate?: string | null;
  transactionId?: string | null;
  idempotencyKey: string;
  confirmedAt?: string | null;
  skippedAt?: string | null;
  dismissedAt?: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface LocalLenderRecord {
  id: string; // UUID
  userId: string;
  name: string;
  phone?: string;
  email?: string;
  notes?: string;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LocalBorrowingRecord {
  id: string; // UUID
  userId: string;
  lenderId: string;
  amountPaise: number;
  borrowingDate: string; // ISO string
  dueDate?: string | null;
  receivingAccountId: string;
  transactionId: string;
  status: 'active' | 'repaid';
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LocalBorrowingRepaymentRecord {
  id: string; // UUID
  userId: string;
  borrowingId: string;
  lenderId: string;
  amountPaise: number;
  repaymentDate: string; // ISO string
  paymentAccountId: string;
  transactionId: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LocalOutboxRecord {
  id?: number;
  userId: string;
  entity:
    | 'profiles'
    | 'accounts'
    | 'transactions'
    | 'categories'
    | 'budgets'
    | 'recurring_rules'
    | 'recurring_occurrences'
    | 'lenders'
    | 'borrowings'
    | 'borrowing_repayments';
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

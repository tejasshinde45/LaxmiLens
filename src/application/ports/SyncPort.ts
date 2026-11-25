export type SyncOperation = 'INSERT' | 'UPDATE' | 'DELETE';
export type SyncEntity =
  | 'accounts'
  | 'transactions'
  | 'categories'
  | 'budgets'
  | 'recurring_rules'
  | 'recurring_occurrences'
  | 'lenders'
  | 'borrowings'
  | 'borrowing_repayments';

export interface OutboxEntry {
  id: string;
  userId: string;
  entity: SyncEntity;
  entityId: string;
  operation: SyncOperation;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  attempts: number;
  lastAttemptAt?: Date;
  lastError?: string;
  createdAt: Date;
}

export interface SyncResult {
  pushedCount: number;
  pulledCount: number;
  conflictsCount: number;
  errors: string[];
}

export interface SyncPort {
  enqueue(entry: Omit<OutboxEntry, 'id' | 'attempts' | 'createdAt'>): Promise<void>;
  processOutbox(): Promise<SyncResult>;
  getPendingCount(userId: string): Promise<number>;
  clearOutbox(): Promise<void>;
}

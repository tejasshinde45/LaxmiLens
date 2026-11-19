export interface CreateTransactionDTO {
  type: 'income' | 'expense' | 'transfer';
  amountInPaise: number;
  accountId: string;
  targetAccountId?: string;
  categoryId?: string;
  date: string; // ISO 8601 string
  description: string;
  notes?: string;
  status?: 'cleared' | 'pending' | 'reconciled';
  idempotencyKey?: string;
}

export interface UpdateTransactionDTO {
  id: string;
  amountInPaise?: number;
  accountId?: string;
  targetAccountId?: string;
  categoryId?: string;
  date?: string;
  description?: string;
  notes?: string;
  status?: 'cleared' | 'pending' | 'reconciled';
}

export interface TransactionResponseDTO {
  id: string;
  type: 'income' | 'expense' | 'transfer';
  amountInPaise: number;
  amountFormatted: string;
  accountId: string;
  targetAccountId?: string;
  categoryId?: string;
  date: string;
  description: string;
  notes?: string;
  status: string;
  idempotencyKey: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

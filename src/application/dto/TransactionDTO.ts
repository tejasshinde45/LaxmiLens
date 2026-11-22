export interface CreateTransactionDTO {
  userId?: string;
  type: 'income' | 'expense' | 'transfer';
  amountPaise?: number;
  currency?: string;
  accountId: string;
  destinationAccountId?: string;
  categoryId?: string;
  title?: string;
  note?: string;
  transactionDate?: string; // ISO 8601 string
  deviceId?: string;
  idempotencyKey?: string;

  // Compatibility fields
  amountInPaise?: number;
  targetAccountId?: string;
  description?: string;
  notes?: string;
  date?: string;
  status?: 'cleared' | 'pending' | 'reconciled';
}

export interface UpdateTransactionDTO {
  id: string;
  userId: string;
  amountPaise?: number;
  accountId?: string;
  destinationAccountId?: string;
  categoryId?: string;
  title?: string;
  note?: string;
  transactionDate?: string;

  // Compatibility fields
  amountInPaise?: number;
  targetAccountId?: string;
  description?: string;
  notes?: string;
  date?: string;
  status?: 'cleared' | 'pending' | 'reconciled';
}

export interface TransactionResponseDTO {
  id: string;
  userId: string;
  type: 'income' | 'expense' | 'transfer';
  amountPaise: number;
  amountFormatted: string;
  currency: string;
  accountId: string;
  destinationAccountId?: string;
  categoryId?: string;
  title: string;
  note?: string;
  transactionDate: string;
  deletedAt: string | null;
  isDeleted: boolean;
  version: number;
  deviceId?: string;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;

  // Compatibility fields
  amountInPaise: number;
  targetAccountId?: string;
  description: string;
  notes?: string;
  date: string;
  status: string;
}

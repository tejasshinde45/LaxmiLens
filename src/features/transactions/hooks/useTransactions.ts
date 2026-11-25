import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { queryClient as globalQueryClient } from '@/lib/queryClient';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { defaultDatabaseManager } from '@/infrastructure/database/local/DatabaseManager';
import { DexieTransactionRepository } from '@/infrastructure/database/local/repositories/DexieTransactionRepository';
import { DexieAccountRepository } from '@/infrastructure/database/local/repositories/DexieAccountRepository';
import { DexieCategoryRepository } from '@/infrastructure/database/local/repositories/DexieCategoryRepository';
import { OutboxManager } from '@/infrastructure/sync/OutboxManager';
import { DexieUnitOfWork } from '@/infrastructure/database/local/DexieUnitOfWork';
import {
  GetTransactionsUseCase,
  CreateTransactionUseCase,
  UpdateTransactionUseCase,
  DeleteTransactionUseCase,
  TransactionResponseDTO,
  CreateTransactionDTO,
  UpdateTransactionDTO
} from '@/application';
import {
  CreateTransactionFormValues,
  EditTransactionFormValues
} from '../schemas/transactionSchemas';
import { formatPaiseToINR } from '@/utils/formatters';
import { createUserId } from '@/domain/value-objects/Identifiers';

// Fallback singleton adapters for static / isolated test contexts
const fallbackTransactionRepo = new DexieTransactionRepository();
const fallbackAccountRepo = new DexieAccountRepository();
const fallbackCategoryRepo = new DexieCategoryRepository();
const fallbackSyncPort = new OutboxManager();
const fallbackUow = new DexieUnitOfWork();

const fallbackGetTransactionsUseCase = new GetTransactionsUseCase(fallbackTransactionRepo);
const fallbackCreateTransactionUseCase = new CreateTransactionUseCase(
  fallbackTransactionRepo,
  fallbackAccountRepo,
  fallbackCategoryRepo,
  fallbackSyncPort,
  fallbackUow
);
const fallbackUpdateTransactionUseCase = new UpdateTransactionUseCase(
  fallbackTransactionRepo,
  fallbackAccountRepo,
  fallbackCategoryRepo,
  fallbackSyncPort,
  fallbackUow
);
const fallbackDeleteTransactionUseCase = new DeleteTransactionUseCase(
  fallbackTransactionRepo,
  fallbackSyncPort,
  fallbackUow
);

export interface TransactionSummary {
  totalCount: number;
  totalIncomePaise: number;
  totalIncomeFormatted: string;
  totalExpensePaise: number;
  totalExpenseFormatted: string;
  netCashFlowPaise: number;
  netCashFlowFormatted: string;
}

/**
 * Calculates cashflow totals adhering to LedgerRules.
 * Transfers are strictly neutral to external cashflow (excluded from income/expenses).
 */
export function computeTransactionSummary(
  transactions: readonly TransactionResponseDTO[]
): TransactionSummary {
  let totalIncomePaise = 0;
  let totalExpensePaise = 0;
  let activeCount = 0;

  for (const tx of transactions) {
    if (tx.isDeleted) continue;
    activeCount++;

    if (tx.type === 'income') {
      totalIncomePaise += tx.amountPaise;
    } else if (tx.type === 'expense') {
      totalExpensePaise += tx.amountPaise;
    }
  }

  const netCashFlowPaise = totalIncomePaise - totalExpensePaise;

  return {
    totalCount: activeCount,
    totalIncomePaise,
    totalIncomeFormatted: formatPaiseToINR(totalIncomePaise),
    totalExpensePaise,
    totalExpenseFormatted: formatPaiseToINR(totalExpensePaise),
    netCashFlowPaise,
    netCashFlowFormatted: formatPaiseToINR(netCashFlowPaise)
  };
}

export function useTransactions(client = globalQueryClient) {
  let user: { id: string } | null = null;
  let isAuthenticated = false;
  try {
    const auth = useAuth();
    user = auth.user;
    isAuthenticated = auth.isAuthenticated;
  } catch {
    user = null;
    isAuthenticated = false;
  }

  const queryKey = ['transactions', user?.id];
  const pendingOutboxKey = ['pendingOutboxTxIds', user?.id];

  // Fetch all transactions for active user
  const {
    data: transactions = [],
    isLoading,
    isError,
    error,
    refetch
  } = useQuery<TransactionResponseDTO[]>({
    queryKey,
    queryFn: async () => {
      if (!user?.id) return [];
      const validatedUserId = createUserId(user.id);
      try {
        const repos = await defaultDatabaseManager.getActiveRepositories();
        return await repos.getTransactionsUseCase.execute({ userId: validatedUserId });
      } catch {
        return await fallbackGetTransactionsUseCase.execute({ userId: validatedUserId });
      }
    },
    enabled: !!user?.id,
    staleTime: 0,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false
  });

  // Query pending outbox entries to identify transactions waiting for sync
  const { data: pendingOutboxTxIds = [] } = useQuery<string[]>({
    queryKey: pendingOutboxKey,
    queryFn: async () => {
      if (!user?.id) return [];
      try {
        const repos = await defaultDatabaseManager.getActiveRepositories();
        const entries = await repos.outboxManager.getPendingEntries(user.id, 100);
        return entries
          .filter((e) => e.entity === 'transactions')
          .map((e) => e.entityId);
      } catch {
        const entries = await fallbackSyncPort.getPendingEntries(user.id, 100);
        return entries
          .filter((e) => e.entity === 'transactions')
          .map((e) => e.entityId);
      }
    },
    enabled: !!user?.id,
    staleTime: 0,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false
  });

  const pendingTxIdSet = new Set<string>(pendingOutboxTxIds);

  const summary = computeTransactionSummary(transactions);

  // Invalidate queries across transactions, accounts, budgets, and outbox
  const invalidateFinancialState = () => {
    client.invalidateQueries({ queryKey: ['transactions', user?.id] });
    client.invalidateQueries({ queryKey: ['accounts', user?.id] });
    client.invalidateQueries({ queryKey: ['budgets', user?.id] });
    client.invalidateQueries({ queryKey: ['syncPendingCount', user?.id] });
    client.invalidateQueries({ queryKey: pendingOutboxKey });
  };

  // Mutation: Create Transaction / Transfer
  const createMutation = useMutation<TransactionResponseDTO, Error, CreateTransactionFormValues>({
    mutationFn: async (values: CreateTransactionFormValues) => {
      if (!user?.id) {
        throw new Error('Please sign in to record transactions.');
      }

      // Convert rupees string to exact integer paise
      const parsedRupees = parseFloat(values.amount);
      if (isNaN(parsedRupees) || parsedRupees <= 0) {
        throw new Error('Amount must be a positive number.');
      }
      const amountPaise = Math.round(parsedRupees * 100);

      const title =
        values.title && values.title.trim().length > 0
          ? values.title.trim()
          : values.type === 'transfer'
          ? 'Account Transfer'
          : 'Untitled Transaction';

      const dto: CreateTransactionDTO = {
        userId: user.id,
        type: values.type,
        amountPaise,
        accountId: values.accountId,
        destinationAccountId: values.type === 'transfer' ? values.destinationAccountId : undefined,
        categoryId: values.type !== 'transfer' && values.categoryId ? values.categoryId : undefined,
        title,
        note: values.note?.trim() || undefined,
        transactionDate: new Date(values.transactionDate).toISOString(),
        idempotencyKey: crypto.randomUUID()
      };

      try {
        const repos = await defaultDatabaseManager.getActiveRepositories();
        return await repos.createTransactionUseCase.execute(dto);
      } catch {
        return await fallbackCreateTransactionUseCase.execute(dto);
      }
    },
    onSuccess: (tx) => {
      invalidateFinancialState();
      toast.success(
        tx.type === 'transfer'
          ? 'Transfer recorded successfully'
          : `${tx.type === 'income' ? 'Income' : 'Expense'} recorded successfully`
      );
    },
    onError: (err) => {
      console.error('Failed to record transaction:', err);
      toast.error(err.message || 'Failed to record transaction. Please verify your inputs.');
    }
  });

  // Mutation: Update Transaction
  const updateMutation = useMutation<TransactionResponseDTO, Error, EditTransactionFormValues>({
    mutationFn: async (values: EditTransactionFormValues) => {
      if (!user?.id) {
        throw new Error('Please sign in to update transactions.');
      }

      const parsedRupees = parseFloat(values.amount);
      if (isNaN(parsedRupees) || parsedRupees <= 0) {
        throw new Error('Amount must be a positive number.');
      }
      const amountPaise = Math.round(parsedRupees * 100);

      const title =
        values.title && values.title.trim().length > 0
          ? values.title.trim()
          : values.type === 'transfer'
          ? 'Account Transfer'
          : 'Untitled Transaction';

      const dto: UpdateTransactionDTO = {
        id: values.id,
        userId: user.id,
        amountPaise,
        accountId: values.accountId,
        destinationAccountId: values.type === 'transfer' ? values.destinationAccountId : undefined,
        categoryId: values.type !== 'transfer' && values.categoryId ? values.categoryId : undefined,
        title,
        note: values.note !== undefined ? values.note.trim() : undefined,
        transactionDate: new Date(values.transactionDate).toISOString()
      };

      try {
        const repos = await defaultDatabaseManager.getActiveRepositories();
        return await repos.updateTransactionUseCase.execute(dto);
      } catch {
        return await fallbackUpdateTransactionUseCase.execute(dto);
      }
    },
    onSuccess: () => {
      invalidateFinancialState();
      toast.success('Transaction updated successfully');
    },
    onError: (err) => {
      console.error('Failed to update transaction:', err);
      toast.error(err.message || 'Failed to update transaction.');
    }
  });

  // Mutation: Soft Delete Transaction
  const deleteMutation = useMutation<void, Error, string>({
    mutationFn: async (id: string) => {
      if (!user?.id) {
        throw new Error('Please sign in to delete transactions.');
      }

      try {
        const repos = await defaultDatabaseManager.getActiveRepositories();
        await repos.deleteTransactionUseCase.execute(id, user.id);
      } catch {
        await fallbackDeleteTransactionUseCase.execute(id, user.id);
      }
    },
    onSuccess: () => {
      invalidateFinancialState();
      toast.success('Transaction deleted');
    },
    onError: (err) => {
      console.error('Failed to delete transaction:', err);
      toast.error(err.message || 'Failed to delete transaction.');
    }
  });

  return {
    transactions,
    summary,
    pendingTxIdSet,
    isLoading,
    isError,
    error,
    refetch,
    isAuthenticated,
    createTransaction: createMutation.mutateAsync,
    isCreating: createMutation.isPending,
    updateTransaction: updateMutation.mutateAsync,
    isUpdating: updateMutation.isPending,
    deleteTransaction: deleteMutation.mutateAsync,
    isDeleting: deleteMutation.isPending
  };
}

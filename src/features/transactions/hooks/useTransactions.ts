import { useContext } from 'react';
import { useQuery, useMutation, QueryClient, QueryClientContext } from '@tanstack/react-query';
import { toast } from 'sonner';
import { queryClient as globalQueryClient } from '@/lib/queryClient';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { defaultDatabaseManager } from '@/infrastructure/database/local/DatabaseManager';
import { NoActiveDatabaseSessionError } from '@/infrastructure/database/local/errors/DatabaseErrors';
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
import { normalizeOptionalText } from '@/utils/textNormalization';
import { createUserId } from '@/domain/value-objects/Identifiers';
import { triggerAlertEvaluationSafely } from '@/features/notifications/services/financialAlertEvaluator';
import {
  fetchSharedPendingOutboxEntries,
  OFFLINE_QUERY_STALE_TIME_MS,
  pendingOutboxEntriesQueryKey
} from '@/features/sync/utils/pendingOutboxQuery';

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

export interface UseTransactionsOptions {
  enableTransactions?: boolean;
  enablePendingOutbox?: boolean;
}

export function useTransactions(client?: QueryClient, options?: UseTransactionsOptions) {
  const enableTransactions = options?.enableTransactions ?? true;
  const enablePendingOutbox = options?.enablePendingOutbox ?? true;
  const contextQueryClient = useContext(QueryClientContext);
  const activeClient = client ?? contextQueryClient ?? globalQueryClient;

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
  } = useQuery<TransactionResponseDTO[]>(
    {
      queryKey,
      queryFn: async () => {
        if (!user?.id) return [];
        const validatedUserId = createUserId(user.id);
        let useCase: GetTransactionsUseCase;
        try {
          const repos = await defaultDatabaseManager.getActiveRepositories();
          useCase = repos.getTransactionsUseCase;
        } catch (err) {
          if (err instanceof NoActiveDatabaseSessionError) {
            useCase = fallbackGetTransactionsUseCase;
          } else {
            throw err;
          }
        }
        return await useCase.execute({ userId: validatedUserId });
      },
      enabled: !!user?.id && enableTransactions,
      staleTime: OFFLINE_QUERY_STALE_TIME_MS,
      refetchInterval: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false
    },
    activeClient
  );

  // Query pending outbox entries to identify transactions waiting for sync
  const { data: pendingOutboxTxIds = [] } = useQuery<string[]>(
    {
      queryKey: pendingOutboxKey,
      queryFn: async () => {
        if (!user?.id) return [];
        const entries = await fetchSharedPendingOutboxEntries(
          user.id,
          activeClient,
          fallbackSyncPort,
          150
        );
        return entries
          .filter((e) => e.entity === 'transactions')
          .map((e) => e.entityId);
      },
      enabled: !!user?.id && enablePendingOutbox,
      staleTime: OFFLINE_QUERY_STALE_TIME_MS,
      refetchInterval: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false
    },
    activeClient
  );

  const pendingTxIdSet = new Set<string>(pendingOutboxTxIds);

  const summary = computeTransactionSummary(transactions);

  // Invalidate queries across transactions, accounts, budgets, reports, and outbox
  const invalidateFinancialState = () => {
    activeClient.invalidateQueries({ queryKey: ['transactions', user?.id] });
    activeClient.invalidateQueries({ queryKey: ['accounts', user?.id] });
    activeClient.invalidateQueries({ queryKey: ['budgets', user?.id] });
    activeClient.invalidateQueries({ queryKey: ['reports', user?.id] });
    activeClient.invalidateQueries({ queryKey: ['syncPendingCount', user?.id] });
    activeClient.invalidateQueries({ queryKey: pendingOutboxKey });
    activeClient.invalidateQueries({ queryKey: pendingOutboxEntriesQueryKey(user?.id) });
  };

  // Mutation: Create Transaction / Transfer
  const createMutation = useMutation<TransactionResponseDTO, Error, CreateTransactionFormValues>(
    {
      mutationFn: async (values: CreateTransactionFormValues) => {
        if (!user?.id) {
          throw new Error('Please sign in to record transactions.');
        }

        // Convert rupees string to exact integer paise
        const parsedRupees = parseFloat(values.amount.trim());
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
          note: normalizeOptionalText(values.note),
          transactionDate: new Date(values.transactionDate).toISOString(),
          idempotencyKey: crypto.randomUUID()
        };

        let useCase: CreateTransactionUseCase;
        try {
          const repos = await defaultDatabaseManager.getActiveRepositories();
          useCase = repos.createTransactionUseCase;
        } catch (err) {
          if (err instanceof NoActiveDatabaseSessionError) {
            useCase = fallbackCreateTransactionUseCase;
          } else {
            throw err;
          }
        }
        return await useCase.execute(dto);
      },
      onSuccess: (tx) => {
        invalidateFinancialState();
        if (user?.id && tx.type !== 'transfer') {
          triggerAlertEvaluationSafely(user.id, activeClient);
        }
        toast.success(
          tx.type === 'transfer'
            ? 'Transfer saved locally'
            : `${tx.type === 'income' ? 'Income' : 'Expense'} saved locally`
        );
      },
      onError: (err) => {
        console.error('Failed to record transaction:', err);
        toast.error(err.message || 'Failed to record transaction. Please verify your inputs.');
      }
    },
    activeClient
  );

  // Mutation: Update Transaction
  const updateMutation = useMutation<TransactionResponseDTO, Error, EditTransactionFormValues>(
    {
      mutationFn: async (values: EditTransactionFormValues) => {
        if (!user?.id) {
          throw new Error('Please sign in to update transactions.');
        }

        const parsedRupees = parseFloat(values.amount.trim());
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
          // Pass empty string when explicitly cleared so UpdateTransactionUseCase does not
          // fall back to existing.note; Transaction entity collapses '' to undefined before persistence.
          note: values.note !== undefined ? (normalizeOptionalText(values.note) ?? '') : undefined,
          transactionDate: new Date(values.transactionDate).toISOString()
        };

        let useCase: UpdateTransactionUseCase;
        try {
          const repos = await defaultDatabaseManager.getActiveRepositories();
          useCase = repos.updateTransactionUseCase;
        } catch (err) {
          if (err instanceof NoActiveDatabaseSessionError) {
            useCase = fallbackUpdateTransactionUseCase;
          } else {
            throw err;
          }
        }
        return await useCase.execute(dto);
      },
      onSuccess: () => {
        invalidateFinancialState();
        if (user?.id) {
          triggerAlertEvaluationSafely(user.id, activeClient);
        }
        toast.success('Transaction changes saved locally');
      },
      onError: (err) => {
        console.error('Failed to update transaction:', err);
        toast.error(err.message || 'Failed to update transaction.');
      }
    },
    activeClient
  );

  // Mutation: Soft Delete Transaction
  const deleteMutation = useMutation<void, Error, string>(
    {
      mutationFn: async (id: string) => {
        if (!user?.id) {
          throw new Error('Please sign in to delete transactions.');
        }

        let useCase: DeleteTransactionUseCase;
        try {
          const repos = await defaultDatabaseManager.getActiveRepositories();
          useCase = repos.deleteTransactionUseCase;
        } catch (err) {
          if (err instanceof NoActiveDatabaseSessionError) {
            useCase = fallbackDeleteTransactionUseCase;
          } else {
            throw err;
          }
        }
        await useCase.execute(id, user.id);
      },
      onSuccess: () => {
        invalidateFinancialState();
        if (user?.id) {
          triggerAlertEvaluationSafely(user.id, activeClient);
        }
        toast.success('Transaction removal saved locally');
      },
      onError: (err) => {
        console.error('Failed to delete transaction:', err);
        toast.error(err.message || 'Failed to delete transaction.');
      }
    },
    activeClient
  );

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

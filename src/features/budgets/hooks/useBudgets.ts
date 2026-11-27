import { useContext } from 'react';
import { useQuery, useMutation, QueryClientContext, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { queryClient as globalQueryClient } from '@/lib/queryClient';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { defaultDatabaseManager } from '@/infrastructure/database/local/DatabaseManager';
import { NoActiveDatabaseSessionError } from '@/infrastructure/database/local/errors/DatabaseErrors';
import { DexieBudgetRepository } from '@/infrastructure/database/local/repositories/DexieBudgetRepository';
import { DexieTransactionRepository } from '@/infrastructure/database/local/repositories/DexieTransactionRepository';
import { DexieCategoryRepository } from '@/infrastructure/database/local/repositories/DexieCategoryRepository';
import { OutboxManager } from '@/infrastructure/sync/OutboxManager';
import { DexieUnitOfWork } from '@/infrastructure/database/local/DexieUnitOfWork';
import {
  CreateBudgetUseCase,
  UpdateBudgetUseCase,
  DeleteBudgetUseCase,
  GetBudgetsOverviewUseCase,
  BudgetsOverviewResponseDTO,
  BudgetsOverviewSummaryDTO,
  BudgetResponseDTO
} from '@/application';
import { parseBudgetPeriod } from '@/application/services/BudgetSpendingService';
import { createUserId } from '@/domain/value-objects/Identifiers';
import { triggerAlertEvaluationSafely } from '@/features/notifications/services/financialAlertEvaluator';
import {
  fetchSharedPendingOutboxEntries,
  OFFLINE_QUERY_STALE_TIME_MS,
  pendingOutboxEntriesQueryKey
} from '@/features/sync/utils/pendingOutboxQuery';
import {
  CreateBudgetFormValues,
  EditBudgetFormValues,
  getCurrentBudgetPeriod,
  parseInrToPaise
} from '../schemas/budgetSchemas';

// Fallback singleton adapters for isolated component / test contexts
const fallbackBudgetRepo = new DexieBudgetRepository();
const fallbackTransactionRepo = new DexieTransactionRepository();
const fallbackCategoryRepo = new DexieCategoryRepository();
const fallbackSyncPort = new OutboxManager();
const fallbackUow = new DexieUnitOfWork();

const fallbackGetBudgetsOverviewUseCase = new GetBudgetsOverviewUseCase(
  fallbackBudgetRepo,
  fallbackTransactionRepo,
  fallbackCategoryRepo
);
const fallbackCreateBudgetUseCase = new CreateBudgetUseCase(
  fallbackBudgetRepo,
  fallbackCategoryRepo,
  fallbackSyncPort,
  fallbackUow
);
const fallbackUpdateBudgetUseCase = new UpdateBudgetUseCase(
  fallbackBudgetRepo,
  fallbackSyncPort,
  fallbackUow
);
const fallbackDeleteBudgetUseCase = new DeleteBudgetUseCase(
  fallbackBudgetRepo,
  fallbackSyncPort,
  fallbackUow
);

export type BudgetUtilizationStatus = 'normal' | 'warning' | 'exceeded';

export function getBudgetUtilizationStatus(
  utilizationPercentage: number,
  isExceeded: boolean
): BudgetUtilizationStatus {
  if (isExceeded || utilizationPercentage >= 100) {
    return 'exceeded';
  }
  if (utilizationPercentage >= 80) {
    return 'warning';
  }
  return 'normal';
}

function createEmptyOverview(period: string): BudgetsOverviewResponseDTO {
  const emptySummary: BudgetsOverviewSummaryDTO = {
    period,
    totalBudgetLimitPaise: 0,
    totalBudgetLimitFormatted: '₹0.00',
    totalSpentPaise: 0,
    totalSpentFormatted: '₹0.00',
    totalRemainingPaise: 0,
    totalRemainingFormatted: '₹0.00',
    overallUtilizationPercentage: 0,
    budgetCount: 0,
    exceededCount: 0
  };
  return {
    period,
    summary: emptySummary,
    budgets: []
  };
}

export function useBudgets(
  period: string = getCurrentBudgetPeriod(),
  explicitClient?: QueryClient
) {
  const contextClient = useContext(QueryClientContext);
  const client = explicitClient ?? contextClient ?? globalQueryClient;
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

  const { normalizedPeriod } = parseBudgetPeriod(period);
  const queryKey = ['budgets', user?.id, normalizedPeriod];
  const pendingOutboxKey = ['pendingOutboxBudgetIds', user?.id];

  const {
    data,
    isLoading,
    isError,
    error,
    refetch
  } = useQuery<BudgetsOverviewResponseDTO, Error>(
    {
      queryKey,
      queryFn: async () => {
        if (!user?.id) {
          return createEmptyOverview(normalizedPeriod);
        }
        const validatedUserId = createUserId(user.id);
        try {
          const repos = await defaultDatabaseManager.getActiveRepositories();
          return await repos.getBudgetsOverviewUseCase.execute(validatedUserId, normalizedPeriod);
        } catch (activeErr) {
          if (!(activeErr instanceof NoActiveDatabaseSessionError)) {
            throw activeErr;
          }
          return await fallbackGetBudgetsOverviewUseCase.execute(
            validatedUserId,
            normalizedPeriod
          );
        }
      },
      enabled: !!user?.id,
      staleTime: OFFLINE_QUERY_STALE_TIME_MS,
      refetchInterval: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false
    },
    client
  );

  const { data: pendingOutboxBudgetIds = [] } = useQuery<string[]>(
    {
      queryKey: pendingOutboxKey,
      queryFn: async () => {
        if (!user?.id) return [];
        const entries = await fetchSharedPendingOutboxEntries(
          user.id,
          client,
          fallbackSyncPort,
          150
        );
        return entries.filter((e) => e.entity === 'budgets').map((e) => e.entityId);
      },
      enabled: !!user?.id,
      staleTime: OFFLINE_QUERY_STALE_TIME_MS,
      refetchInterval: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false
    },
    client
  );

  const pendingBudgetIdSet = new Set<string>(pendingOutboxBudgetIds);

  const invalidateBudgetState = () => {
    client.invalidateQueries({ queryKey: ['budgets', user?.id] });
    client.invalidateQueries({ queryKey: ['syncPendingCount', user?.id] });
    client.invalidateQueries({ queryKey: pendingOutboxKey });
    client.invalidateQueries({ queryKey: pendingOutboxEntriesQueryKey(user?.id) });
    if (user?.id) {
      triggerAlertEvaluationSafely(user.id, client);
    }
  };

  const createBudgetMutation = useMutation<BudgetResponseDTO, Error, CreateBudgetFormValues>(
    {
      mutationFn: async (values: CreateBudgetFormValues) => {
        if (!user?.id) {
          throw new Error('Please sign in to create a monthly budget.');
        }

        const limitPaise = parseInrToPaise(values.limit);
        const dto = {
          userId: user.id,
          categoryId: values.categoryId,
          period: values.period,
          limitPaise
        };

        try {
          const repos = await defaultDatabaseManager.getActiveRepositories();
          return await repos.createBudgetUseCase.execute(dto);
        } catch (activeErr) {
          if (!(activeErr instanceof NoActiveDatabaseSessionError)) {
            throw activeErr;
          }
          return await fallbackCreateBudgetUseCase.execute(dto);
        }
      },
      onSuccess: (created) => {
        invalidateBudgetState();
        toast.success(`Budget of ${created.limitFormatted} for ${created.period} saved locally`);
      },
      onError: (err) => {
        toast.error(err.message || 'Could not create budget.');
      }
    },
    client
  );

  const updateBudgetMutation = useMutation<BudgetResponseDTO, Error, EditBudgetFormValues>(
    {
      mutationFn: async (values: EditBudgetFormValues) => {
        if (!user?.id) {
          throw new Error('Please sign in to update a budget.');
        }

        const limitPaise = parseInrToPaise(values.limit);
        const dto = {
          id: values.id,
          userId: user.id,
          limitPaise
        };

        try {
          const repos = await defaultDatabaseManager.getActiveRepositories();
          return await repos.updateBudgetUseCase.execute(dto);
        } catch (activeErr) {
          if (!(activeErr instanceof NoActiveDatabaseSessionError)) {
            throw activeErr;
          }
          return await fallbackUpdateBudgetUseCase.execute(dto);
        }
      },
      onSuccess: (updated) => {
        invalidateBudgetState();
        toast.success(`Budget limit update to ${updated.limitFormatted} saved locally`);
      },
      onError: (err) => {
        toast.error(err.message || 'Could not update budget.');
      }
    },
    client
  );

  const deleteBudgetMutation = useMutation<void, Error, string>(
    {
      mutationFn: async (id: string) => {
        if (!user?.id) {
          throw new Error('Please sign in to delete a budget.');
        }

        try {
          const repos = await defaultDatabaseManager.getActiveRepositories();
          await repos.deleteBudgetUseCase.execute(id, user.id);
        } catch (activeErr) {
          if (!(activeErr instanceof NoActiveDatabaseSessionError)) {
            throw activeErr;
          }
          await fallbackDeleteBudgetUseCase.execute(id, user.id);
        }
      },
      onSuccess: () => {
        invalidateBudgetState();
        toast.success('Budget deletion saved locally. Historical transactions remain preserved.');
      },
      onError: (err) => {
        toast.error(err.message || 'Could not delete budget.');
      }
    },
    client
  );

  const overview = data ?? createEmptyOverview(normalizedPeriod);

  return {
    period: normalizedPeriod,
    summary: overview.summary,
    budgets: overview.budgets,
    pendingBudgetIdSet,
    isLoading,
    isError,
    error,
    refetch,
    isAuthenticated,
    createBudget: createBudgetMutation.mutateAsync,
    isCreating: createBudgetMutation.isPending,
    updateBudget: updateBudgetMutation.mutateAsync,
    isUpdating: updateBudgetMutation.isPending,
    deleteBudget: deleteBudgetMutation.mutateAsync,
    isDeleting: deleteBudgetMutation.isPending
  };
}

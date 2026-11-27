import { useContext } from 'react';
import { useQuery, useMutation, QueryClientContext, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { queryClient as globalQueryClient } from '@/lib/queryClient';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { defaultDatabaseManager } from '@/infrastructure/database/local/DatabaseManager';
import { NoActiveDatabaseSessionError } from '@/infrastructure/database/local/errors/DatabaseErrors';
import { DexieRecurringRuleRepository } from '@/infrastructure/database/local/repositories/DexieRecurringRuleRepository';
import { DexieRecurringOccurrenceRepository } from '@/infrastructure/database/local/repositories/DexieRecurringOccurrenceRepository';
import { DexieAccountRepository } from '@/infrastructure/database/local/repositories/DexieAccountRepository';
import { DexieCategoryRepository } from '@/infrastructure/database/local/repositories/DexieCategoryRepository';
import { DexieTransactionRepository } from '@/infrastructure/database/local/repositories/DexieTransactionRepository';
import { OutboxManager } from '@/infrastructure/sync/OutboxManager';
import { DexieUnitOfWork } from '@/infrastructure/database/local/DexieUnitOfWork';
import {
  CreateTransactionUseCase,
  CreateRecurringRuleUseCase,
  UpdateRecurringRuleUseCase,
  PauseRecurringRuleUseCase,
  ResumeRecurringRuleUseCase,
  DeleteRecurringRuleUseCase,
  ConfirmRecurringOccurrenceUseCase,
  SkipRecurringOccurrenceUseCase,
  SnoozeRecurringOccurrenceUseCase,
  DismissRecurringOccurrenceUseCase,
  GetRecurringOverviewUseCase,
  RecurringOverviewResponseDTO,
  RecurringRuleResponseDTO,
  ConfirmRecurringOccurrenceResultDTO,
  UpdateRecurringRuleDTO,
  ConfirmRecurringOccurrenceDTO,
  SkipRecurringOccurrenceDTO,
  SnoozeRecurringOccurrenceDTO,
  DismissRecurringOccurrenceDTO
} from '@/application';
import { createUserId } from '@/domain/value-objects/Identifiers';
import { getLocalTodayDateString } from '@/domain/services/RecurrenceScheduleService';
import { triggerAlertEvaluationSafely } from '@/features/notifications/services/financialAlertEvaluator';
import {
  fetchSharedPendingOutboxEntries,
  OFFLINE_QUERY_STALE_TIME_MS,
  pendingOutboxEntriesQueryKey
} from '@/features/sync/utils/pendingOutboxQuery';
import {
  RecurringRuleFormValues,
  parseRecurringAmountToPaise
} from '../schemas/recurringSchemas';

// Fallback adapters for isolated tests or non-session contexts
const fallbackRuleRepo = new DexieRecurringRuleRepository();
const fallbackOccRepo = new DexieRecurringOccurrenceRepository();
const fallbackAccountRepo = new DexieAccountRepository();
const fallbackCategoryRepo = new DexieCategoryRepository();
const fallbackTxRepo = new DexieTransactionRepository();
const fallbackSyncPort = new OutboxManager();
const fallbackUow = new DexieUnitOfWork();

const fallbackCreateTxUseCase = new CreateTransactionUseCase(
  fallbackTxRepo,
  fallbackAccountRepo,
  fallbackCategoryRepo,
  fallbackSyncPort,
  fallbackUow
);
const fallbackGetOverviewUseCase = new GetRecurringOverviewUseCase(
  fallbackRuleRepo,
  fallbackOccRepo,
  fallbackAccountRepo,
  fallbackCategoryRepo
);
const fallbackCreateRuleUseCase = new CreateRecurringRuleUseCase(
  fallbackRuleRepo,
  fallbackOccRepo,
  fallbackAccountRepo,
  fallbackCategoryRepo,
  fallbackSyncPort,
  fallbackUow
);
const fallbackUpdateRuleUseCase = new UpdateRecurringRuleUseCase(
  fallbackRuleRepo,
  fallbackOccRepo,
  fallbackAccountRepo,
  fallbackCategoryRepo,
  fallbackSyncPort,
  fallbackUow
);
const fallbackPauseRuleUseCase = new PauseRecurringRuleUseCase(
  fallbackRuleRepo,
  fallbackSyncPort,
  fallbackUow
);
const fallbackResumeRuleUseCase = new ResumeRecurringRuleUseCase(
  fallbackRuleRepo,
  fallbackOccRepo,
  fallbackSyncPort,
  fallbackUow
);
const fallbackDeleteRuleUseCase = new DeleteRecurringRuleUseCase(
  fallbackRuleRepo,
  fallbackSyncPort,
  fallbackUow
);
const fallbackConfirmOccUseCase = new ConfirmRecurringOccurrenceUseCase(
  fallbackRuleRepo,
  fallbackOccRepo,
  fallbackTxRepo,
  fallbackCreateTxUseCase,
  fallbackSyncPort,
  fallbackUow
);
const fallbackSkipOccUseCase = new SkipRecurringOccurrenceUseCase(
  fallbackRuleRepo,
  fallbackOccRepo,
  fallbackSyncPort,
  fallbackUow
);
const fallbackSnoozeOccUseCase = new SnoozeRecurringOccurrenceUseCase(
  fallbackRuleRepo,
  fallbackOccRepo,
  fallbackSyncPort,
  fallbackUow
);
const fallbackDismissOccUseCase = new DismissRecurringOccurrenceUseCase(
  fallbackRuleRepo,
  fallbackOccRepo,
  fallbackSyncPort,
  fallbackUow
);

function createEmptyRecurringOverview(asOfDate: string): RecurringOverviewResponseDTO {
  return {
    summary: {
      asOfDate,
      activeSchedulesCount: 0,
      pausedSchedulesCount: 0,
      completedSchedulesCount: 0,
      overdueCount: 0,
      dueTodayCount: 0,
      upcomingCount: 0,
      snoozedCount: 0,
      totalOverdueAmountPaise: 0,
      totalOverdueAmountFormatted: '₹0.00',
      totalDueTodayAmountPaise: 0,
      totalDueTodayAmountFormatted: '₹0.00',
      totalUpcoming30DaysExpensePaise: 0,
      totalUpcoming30DaysExpenseFormatted: '₹0.00',
      totalUpcoming30DaysIncomePaise: 0,
      totalUpcoming30DaysIncomeFormatted: '₹0.00'
    },
    overdue: [],
    dueToday: [],
    upcoming: [],
    snoozed: [],
    recentlyGenerated: [],
    schedules: []
  };
}

export function useRecurring(
  asOfDate: string = getLocalTodayDateString(),
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

  const queryKey = ['recurring', user?.id, asOfDate];
  const pendingOutboxKey = ['pendingOutboxRecurringIds', user?.id];

  const {
    data,
    isLoading,
    isError,
    error,
    refetch
  } = useQuery<RecurringOverviewResponseDTO, Error>(
    {
      queryKey,
      queryFn: async () => {
        if (!user?.id) return createEmptyRecurringOverview(asOfDate);
        const validatedUserId = createUserId(user.id);
        try {
          const repos = await defaultDatabaseManager.getActiveRepositories();
          return await repos.getRecurringOverviewUseCase.execute(validatedUserId, { asOfDate });
        } catch (activeErr) {
          if (!(activeErr instanceof NoActiveDatabaseSessionError)) throw activeErr;
          return await fallbackGetOverviewUseCase.execute(validatedUserId, { asOfDate });
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

  const { data: pendingOutboxRecurringIds = [] } = useQuery<string[]>(
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
        return entries
          .filter((e) => e.entity === 'recurring_rules' || e.entity === 'recurring_occurrences')
          .map((e) => e.entityId);
      },
      enabled: !!user?.id,
      staleTime: OFFLINE_QUERY_STALE_TIME_MS,
      refetchInterval: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false
    },
    client
  );

  const pendingRecurringIdSet = new Set<string>(pendingOutboxRecurringIds);

  const invalidateRecurringState = (includeLedger = false) => {
    client.invalidateQueries({ queryKey: ['recurring', user?.id] });
    client.invalidateQueries({ queryKey: pendingOutboxKey });
    client.invalidateQueries({ queryKey: ['syncPendingCount', user?.id] });
    client.invalidateQueries({ queryKey: pendingOutboxEntriesQueryKey(user?.id) });
    if (includeLedger) {
      client.invalidateQueries({ queryKey: ['transactions', user?.id] });
      client.invalidateQueries({ queryKey: ['accounts', user?.id] });
      client.invalidateQueries({ queryKey: ['budgets', user?.id] });
      client.invalidateQueries({ queryKey: ['reports', user?.id] });
      client.invalidateQueries({ queryKey: ['pendingOutboxTxIds', user?.id] });
    }
    if (user?.id) {
      triggerAlertEvaluationSafely(user.id, client);
    }
  };

  const createRuleMutation = useMutation<RecurringRuleResponseDTO, Error, RecurringRuleFormValues>(
    {
      mutationFn: async (values) => {
        if (!user?.id) throw new Error('Please sign in to create a recurring schedule.');
        const dto = {
          userId: user.id,
          title: values.title,
          description: values.description || undefined,
          type: values.type,
          amountPaise: parseRecurringAmountToPaise(values.amount),
          accountId: values.accountId,
          categoryId: values.categoryId || undefined,
          frequency: values.frequency,
          interval: Number(values.interval),
          startDate: values.startDate,
          endDate: values.endDate ? values.endDate.trim() || null : null
        };
        try {
          const repos = await defaultDatabaseManager.getActiveRepositories();
          return await repos.createRecurringRuleUseCase.execute(dto);
        } catch (activeErr) {
          if (!(activeErr instanceof NoActiveDatabaseSessionError)) throw activeErr;
          return await fallbackCreateRuleUseCase.execute(dto);
        }
      },
      onSuccess: (created) => {
        invalidateRecurringState(false);
        toast.success(`Schedule "${created.title}" saved locally.`);
      },
      onError: (err) => {
        toast.error(err.message || 'Could not create recurring schedule.');
      }
    },
    client
  );

  const updateRuleMutation = useMutation<
    RecurringRuleResponseDTO,
    Error,
    { id: string; values: RecurringRuleFormValues }
  >(
    {
      mutationFn: async ({ id, values }) => {
        if (!user?.id) throw new Error('Please sign in to update this schedule.');
        const dto: UpdateRecurringRuleDTO = {
          id,
          userId: user.id,
          title: values.title,
          description: values.description || null,
          amountPaise: parseRecurringAmountToPaise(values.amount),
          accountId: values.accountId,
          categoryId: values.categoryId || null,
          frequency: values.frequency,
          interval: Number(values.interval),
          endDate: values.endDate ? values.endDate.trim() || null : null
        };
        try {
          const repos = await defaultDatabaseManager.getActiveRepositories();
          return await repos.updateRecurringRuleUseCase.execute(dto);
        } catch (activeErr) {
          if (!(activeErr instanceof NoActiveDatabaseSessionError)) throw activeErr;
          return await fallbackUpdateRuleUseCase.execute(dto);
        }
      },
      onSuccess: (updated) => {
        invalidateRecurringState(false);
        toast.success(`Schedule "${updated.title}" changes saved locally.`);
      },
      onError: (err) => {
        toast.error(err.message || 'Could not update schedule.');
      }
    },
    client
  );

  const pauseRuleMutation = useMutation<void, Error, string>(
    {
      mutationFn: async (id) => {
        if (!user?.id) throw new Error('Please sign in first.');
        try {
          const repos = await defaultDatabaseManager.getActiveRepositories();
          await repos.pauseRecurringRuleUseCase.execute({ id, userId: user.id });
        } catch (activeErr) {
          if (!(activeErr instanceof NoActiveDatabaseSessionError)) throw activeErr;
          await fallbackPauseRuleUseCase.execute({ id, userId: user.id });
        }
      },
      onSuccess: () => {
        invalidateRecurringState(false);
        toast.success('Recurring schedule pause saved locally.');
      },
      onError: (err) => toast.error(err.message || 'Could not pause schedule.')
    },
    client
  );

  const resumeRuleMutation = useMutation<void, Error, string>(
    {
      mutationFn: async (id) => {
        if (!user?.id) throw new Error('Please sign in first.');
        try {
          const repos = await defaultDatabaseManager.getActiveRepositories();
          await repos.resumeRecurringRuleUseCase.execute({ id, userId: user.id });
        } catch (activeErr) {
          if (!(activeErr instanceof NoActiveDatabaseSessionError)) throw activeErr;
          await fallbackResumeRuleUseCase.execute({ id, userId: user.id });
        }
      },
      onSuccess: () => {
        invalidateRecurringState(false);
        toast.success('Recurring schedule resume saved locally.');
      },
      onError: (err) => toast.error(err.message || 'Could not resume schedule.')
    },
    client
  );

  const deleteRuleMutation = useMutation<void, Error, string>(
    {
      mutationFn: async (id) => {
        if (!user?.id) throw new Error('Please sign in first.');
        try {
          const repos = await defaultDatabaseManager.getActiveRepositories();
          await repos.deleteRecurringRuleUseCase.execute({ id, userId: user.id });
        } catch (activeErr) {
          if (!(activeErr instanceof NoActiveDatabaseSessionError)) throw activeErr;
          await fallbackDeleteRuleUseCase.execute({ id, userId: user.id });
        }
      },
      onSuccess: () => {
        invalidateRecurringState(false);
        toast.success('Recurring schedule removal saved locally. Recorded transactions remain preserved.');
      },
      onError: (err) => toast.error(err.message || 'Could not remove schedule.')
    },
    client
  );

  const confirmOccurrenceMutation = useMutation<
    ConfirmRecurringOccurrenceResultDTO,
    Error,
    Omit<ConfirmRecurringOccurrenceDTO, 'userId'>
  >(
    {
      mutationFn: async (payload) => {
        if (!user?.id) throw new Error('Please sign in to confirm this payment.');
        const dto: ConfirmRecurringOccurrenceDTO = { ...payload, userId: user.id };
        try {
          const repos = await defaultDatabaseManager.getActiveRepositories();
          return await repos.confirmRecurringOccurrenceUseCase.execute(dto);
        } catch (activeErr) {
          if (!(activeErr instanceof NoActiveDatabaseSessionError)) throw activeErr;
          return await fallbackConfirmOccUseCase.execute(dto);
        }
      },
      onSuccess: (res) => {
        invalidateRecurringState(true);
        toast.success(
          res.alreadyConfirmed
            ? 'Payment was already saved locally.'
            : 'Payment confirmed and transaction saved locally.'
        );
      },
      onError: (err) => toast.error(err.message || 'Failed to confirm recurring transaction.')
    },
    client
  );

  const skipOccurrenceMutation = useMutation<
    void,
    Error,
    Omit<SkipRecurringOccurrenceDTO, 'userId'>
  >(
    {
      mutationFn: async (payload) => {
        if (!user?.id) throw new Error('Please sign in first.');
        const dto: SkipRecurringOccurrenceDTO = { ...payload, userId: user.id };
        try {
          const repos = await defaultDatabaseManager.getActiveRepositories();
          await repos.skipRecurringOccurrenceUseCase.execute(dto);
        } catch (activeErr) {
          if (!(activeErr instanceof NoActiveDatabaseSessionError)) throw activeErr;
          await fallbackSkipOccUseCase.execute(dto);
        }
      },
      onSuccess: () => {
        invalidateRecurringState(false);
        toast.success('Occurrence skip saved locally. No ledger transaction was created.');
      },
      onError: (err) => toast.error(err.message || 'Could not skip occurrence.')
    },
    client
  );

  const snoozeOccurrenceMutation = useMutation<
    void,
    Error,
    Omit<SnoozeRecurringOccurrenceDTO, 'userId'>
  >(
    {
      mutationFn: async (payload) => {
        if (!user?.id) throw new Error('Please sign in first.');
        const dto: SnoozeRecurringOccurrenceDTO = { ...payload, userId: user.id };
        try {
          const repos = await defaultDatabaseManager.getActiveRepositories();
          await repos.snoozeRecurringOccurrenceUseCase.execute(dto);
        } catch (activeErr) {
          if (!(activeErr instanceof NoActiveDatabaseSessionError)) throw activeErr;
          await fallbackSnoozeOccUseCase.execute(dto);
        }
      },
      onSuccess: (_res, vars) => {
        invalidateRecurringState(false);
        toast.success(`Reminder snooze until ${vars.snoozeUntilDate} saved locally.`);
      },
      onError: (err) => toast.error(err.message || 'Could not snooze reminder.')
    },
    client
  );

  const dismissOccurrenceMutation = useMutation<
    void,
    Error,
    Omit<DismissRecurringOccurrenceDTO, 'userId'>
  >(
    {
      mutationFn: async (payload) => {
        if (!user?.id) throw new Error('Please sign in first.');
        const dto: DismissRecurringOccurrenceDTO = { ...payload, userId: user.id };
        try {
          const repos = await defaultDatabaseManager.getActiveRepositories();
          await repos.dismissRecurringOccurrenceUseCase.execute(dto);
        } catch (activeErr) {
          if (!(activeErr instanceof NoActiveDatabaseSessionError)) throw activeErr;
          await fallbackDismissOccUseCase.execute(dto);
        }
      },
      onSuccess: () => {
        invalidateRecurringState(false);
        toast.success('Reminder dismissal saved locally.');
      },
      onError: (err) => toast.error(err.message || 'Could not dismiss reminder.')
    },
    client
  );

  const overview = data ?? createEmptyRecurringOverview(asOfDate);

  return {
    overview,
    summary: overview.summary,
    overdue: overview.overdue,
    dueToday: overview.dueToday,
    upcoming: overview.upcoming,
    snoozed: overview.snoozed,
    recentlyGenerated: overview.recentlyGenerated,
    schedules: overview.schedules,
    pendingRecurringIdSet,
    isLoading,
    isError,
    error,
    refetch,
    isAuthenticated,
    createRule: createRuleMutation.mutateAsync,
    isCreating: createRuleMutation.isPending,
    updateRule: updateRuleMutation.mutateAsync,
    isUpdating: updateRuleMutation.isPending,
    pauseRule: pauseRuleMutation.mutateAsync,
    resumeRule: resumeRuleMutation.mutateAsync,
    deleteRule: deleteRuleMutation.mutateAsync,
    confirmOccurrence: confirmOccurrenceMutation.mutateAsync,
    isConfirming: confirmOccurrenceMutation.isPending,
    skipOccurrence: skipOccurrenceMutation.mutateAsync,
    snoozeOccurrence: snoozeOccurrenceMutation.mutateAsync,
    dismissOccurrence: dismissOccurrenceMutation.mutateAsync
  };
}

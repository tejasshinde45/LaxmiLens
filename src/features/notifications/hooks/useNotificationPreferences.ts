import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { queryClient as globalQueryClient } from '@/lib/queryClient';
import { useAuth } from '@/features/auth/hooks/useAuth';
import {
  GetNotificationPreferencesUseCase,
  NotificationPreferenceDTO,
  UpdateNotificationPreferenceDTO,
  UpdateNotificationPreferencesUseCase
} from '@/application';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '@/domain/entities/NotificationPreference';
import { createUserId } from '@/domain/value-objects/Identifiers';
import { defaultDatabaseManager } from '@/infrastructure/database/local/DatabaseManager';
import { NoActiveDatabaseSessionError } from '@/infrastructure/database/local/errors/DatabaseErrors';
import { db } from '@/infrastructure/database/local/DexieDatabase';
import { DexieNotificationPreferenceRepository } from '@/infrastructure/database/local/repositories/DexieNotificationPreferenceRepository';
import { OutboxManager } from '@/infrastructure/sync/OutboxManager';
import { DexieUnitOfWork } from '@/infrastructure/database/local/DexieUnitOfWork';
import { notificationQueryKeys } from './notificationQueryKeys';
import { triggerAlertEvaluationSafely } from '../services/financialAlertEvaluator';
import {
  OFFLINE_QUERY_STALE_TIME_MS,
  pendingOutboxEntriesQueryKey
} from '@/features/sync/utils/pendingOutboxQuery';

const fallbackPrefRepo = new DexieNotificationPreferenceRepository(db);
const fallbackSyncPort = new OutboxManager(db);
const fallbackUow = new DexieUnitOfWork(db);

const fallbackGetPrefUseCase = new GetNotificationPreferencesUseCase(fallbackPrefRepo);
const fallbackUpdatePrefUseCase = new UpdateNotificationPreferencesUseCase(
  fallbackPrefRepo,
  fallbackSyncPort,
  fallbackUow
);

function buildDefaultPreferenceDto(userId = ''): NotificationPreferenceDTO {
  const now = new Date(0).toISOString();
  return {
    userId,
    recurringPaymentEnabled: DEFAULT_NOTIFICATION_PREFERENCES.recurringPaymentEnabled,
    budgetWarningEnabled: DEFAULT_NOTIFICATION_PREFERENCES.budgetWarningEnabled,
    budgetExceededEnabled: DEFAULT_NOTIFICATION_PREFERENCES.budgetExceededEnabled,
    upcomingLeadDays: DEFAULT_NOTIFICATION_PREFERENCES.upcomingLeadDays,
    version: 1,
    createdAt: now,
    updatedAt: now,
    isDefault: true
  };
}

export function useNotificationPreferences(explicitClient?: QueryClient) {
  let contextClient: QueryClient | undefined;
  try {
    contextClient = useQueryClient();
  } catch {
    contextClient = undefined;
  }
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

  const {
    data,
    isLoading,
    isError,
    error,
    refetch
  } = useQuery<NotificationPreferenceDTO, Error>(
    {
      queryKey: notificationQueryKeys.preferences(user?.id),
      queryFn: async () => {
        if (!user?.id) {
          return buildDefaultPreferenceDto('');
        }
        const validatedUserId = createUserId(user.id);
        try {
          const repos = await defaultDatabaseManager.getActiveRepositories();
          return await repos.getNotificationPreferencesUseCase.execute(validatedUserId);
        } catch (activeErr) {
          if (!(activeErr instanceof NoActiveDatabaseSessionError)) {
            throw activeErr;
          }
          return await fallbackGetPrefUseCase.execute(validatedUserId);
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

  const updatePreferencesMutation = useMutation<
    NotificationPreferenceDTO,
    Error,
    Omit<UpdateNotificationPreferenceDTO, 'userId'>
  >(
    {
      mutationFn: async (patch) => {
        if (!user?.id) {
          throw new Error('Please sign in to save notification preferences.');
        }
        const validatedUserId = createUserId(user.id);
        const dto: UpdateNotificationPreferenceDTO = {
          userId: validatedUserId,
          ...patch
        };

        try {
          const repos = await defaultDatabaseManager.getActiveRepositories();
          return await repos.updateNotificationPreferencesUseCase.execute(dto);
        } catch (activeErr) {
          if (!(activeErr instanceof NoActiveDatabaseSessionError)) {
            throw activeErr;
          }
          return await fallbackUpdatePrefUseCase.execute(dto);
        }
      },
      onSuccess: (saved) => {
        client.setQueryData(notificationQueryKeys.preferences(saved.userId), saved);
        client.invalidateQueries({ queryKey: notificationQueryKeys.preferences(saved.userId) });
        client.invalidateQueries({ queryKey: ['syncPendingCount', saved.userId] });
        client.invalidateQueries({ queryKey: pendingOutboxEntriesQueryKey(saved.userId) });
        triggerAlertEvaluationSafely(saved.userId, client);
        toast.success('Notification preferences saved locally.');
      },
      onError: (err) => {
        toast.error(err.message || 'Could not save notification preferences.');
      }
    },
    client
  );

  return {
    preferences: data ?? buildDefaultPreferenceDto(user?.id ?? ''),
    isLoading,
    isError,
    error,
    refetch,
    isAuthenticated,
    updatePreferences: updatePreferencesMutation.mutateAsync,
    isSaving: updatePreferencesMutation.isPending,
    isSaved: updatePreferencesMutation.isSuccess,
    saveError: updatePreferencesMutation.error
  };
}

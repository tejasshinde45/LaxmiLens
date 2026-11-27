import { useContext } from 'react';
import { useQuery, useMutation, QueryClientContext, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { queryClient as globalQueryClient } from '@/lib/queryClient';
import { useAuth } from '@/features/auth/hooks/useAuth';
import {
  defaultManualSyncCoordinator,
  ManualSyncCoordinator,
  UnifiedSyncResult
} from '@/infrastructure/sync/ManualSyncCoordinator';
import { defaultDatabaseManager } from '@/infrastructure/database/local/DatabaseManager';
import { NoActiveDatabaseSessionError } from '@/infrastructure/database/local/errors/DatabaseErrors';
import { triggerAlertEvaluationSafely } from '@/features/notifications/services/financialAlertEvaluator';
import { OFFLINE_QUERY_STALE_TIME_MS } from '@/features/sync/utils/pendingOutboxQuery';
import { isResultFullySynchronized } from '@/infrastructure/sync/AutoSyncScheduler';
import { ReactQueryBackupCacheInvalidator } from '@/infrastructure/backup/ReactQueryBackupCacheInvalidator';
import { useAutoSyncState } from '@/hooks/useAutoSyncState';

async function resolveSyncCoordinator(): Promise<ManualSyncCoordinator> {
  try {
    return await defaultDatabaseManager.getActiveSyncCoordinator();
  } catch (err) {
    if (!(err instanceof NoActiveDatabaseSessionError)) {
      throw err;
    }
    return defaultManualSyncCoordinator;
  }
}

export function useAccountSync(explicitClient?: QueryClient) {
  const contextClient = useContext(QueryClientContext);
  const client = explicitClient ?? contextClient ?? globalQueryClient;
  // Safely extract authentication context
  let user: { id: string } | null = null;
  let isAuthenticated = false;
  try {
    const auth = useAuth();
    user = auth.user;
    isAuthenticated = auth.isAuthenticated;
  } catch {
    // Allows usage in isolated component test environments without AuthProvider
    user = null;
    isAuthenticated = false;
  }

  const pendingQueryKey = ['syncPendingCount', user?.id];
  const syncState = useAutoSyncState();

  // Query pending outbox count for coordinated entities without background polling or auto-refetch triggers
  const { data: pendingCount = 0 } = useQuery<number>(
    {
      queryKey: pendingQueryKey,
      queryFn: async () => {
        if (!user?.id) return 0;
        const coordinator = await resolveSyncCoordinator();
        return await coordinator.getPendingCount(user.id);
      },
      enabled: !!user?.id,
      staleTime: OFFLINE_QUERY_STALE_TIME_MS,
      // Strictly disable automatic refetch triggers (no periodic timers, no reconnect triggers)
      refetchInterval: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false
    },
    client
  );

  // Manual synchronization mutation
  const syncMutation = useMutation<UnifiedSyncResult, Error, void>(
    {
      mutationFn: async () => {
        if (!user?.id) {
          throw new Error('Please sign in to synchronize with the cloud.');
        }
        const coordinator = await resolveSyncCoordinator();
        return await coordinator.run();
      },
      onSuccess: (result) => {
        const hasFailures =
          result.failedCount > 0 || (result.errors?.length ?? 0) > 0 || !!result.authPaused;
        const totalMoved = result.syncedCount + result.pulledCount;
        const fullySynced = isResultFullySynchronized(result);

        // Centralized query cache invalidation respecting failure boundaries
        if (user?.id && (!hasFailures || totalMoved > 0)) {
          const invalidator = new ReactQueryBackupCacheInvalidator(client);
          void invalidator.invalidateUserCaches(user.id, {
            includeNotifications: !hasFailures
          });

          if (!hasFailures && totalMoved > 0) {
            triggerAlertEvaluationSafely(user.id, client);
          }
        }

        if (fullySynced && result.syncedCount > 0) {
          toast.success(
            `Successfully synchronized ${result.syncedCount} update${result.syncedCount > 1 ? 's' : ''} to cloud.`
          );
        } else if (fullySynced && result.pulledCount > 0) {
          toast.success(
            `Pulled ${result.pulledCount} update${result.pulledCount > 1 ? 's' : ''} from cloud.`
          );
        } else if (result.syncedCount > 0 && (hasFailures || result.stillPendingCount > 0)) {
          toast.warning(
            `Synchronized ${result.syncedCount} item(s), while ${Math.max(result.failedCount, result.stillPendingCount)} remain saved locally.`
          );
        } else if (hasFailures) {
          toast.error(
            'Cloud synchronization could not be completed. Your changes remain safely saved locally.'
          );
        } else if (result.stillPendingCount > 0) {
          toast.info('Changes remain saved locally and will synchronize automatically when ready.');
        } else {
          toast.info('All changes are up to date with the cloud.');
        }
      },
      onError: (err) => {
        const message = err instanceof Error ? err.message : '';
        if (message.includes('not authenticated')) {
          toast.error('Please sign in to synchronize.');
        } else if (message.includes('already in progress')) {
          toast.info('Synchronization is already in progress.');
        } else {
          // Safe user-facing message suppressing technical stack traces or credentials
          toast.error('Synchronization failed. All changes remain saved locally.');
        }
      }
    },
    client
  );

  return {
    syncNow: syncMutation.mutateAsync,
    isSyncing: syncMutation.isPending || syncState.isSyncing,
    pendingCount,
    lastResult: syncMutation.data,
    isAuthenticated,
    syncState
  };
}

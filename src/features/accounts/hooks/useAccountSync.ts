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
import { notificationQueryKeys } from '@/features/notifications/hooks/notificationQueryKeys';
import { triggerAlertEvaluationSafely } from '@/features/notifications/services/financialAlertEvaluator';
import { OFFLINE_QUERY_STALE_TIME_MS } from '@/features/sync/utils/pendingOutboxQuery';

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
        const hasFailures = result.failedCount > 0;
        const totalMoved = result.syncedCount + result.pulledCount;

        // Preserve financial invalidations when sync succeeded or processed updates
        if (!hasFailures || totalMoved > 0) {
          client.invalidateQueries({ queryKey: ['accounts', user?.id] });
          client.invalidateQueries({ queryKey: ['categories', user?.id] });
          client.invalidateQueries({ queryKey: ['transactions', user?.id] });
          client.invalidateQueries({ queryKey: ['budgets', user?.id] });
          client.invalidateQueries({ queryKey: ['borrowings', user?.id] });
          client.invalidateQueries({ queryKey: ['recurring', user?.id] });
          client.invalidateQueries({ queryKey: ['pendingOutboxBudgetIds', user?.id] });
          client.invalidateQueries({ queryKey: ['pendingOutboxTxIds', user?.id] });
          client.invalidateQueries({ queryKey: ['pendingOutboxRecurringIds', user?.id] });
          client.invalidateQueries({ queryKey: ['pendingOutboxEntries', user?.id] });
          client.invalidateQueries({ queryKey: pendingQueryKey });
        }

        // Refresh notification & preference caches only after successful synchronization
        if (!hasFailures && user?.id) {
          client.invalidateQueries({ queryKey: notificationQueryKeys.all(user.id) });
          client.invalidateQueries({ queryKey: notificationQueryKeys.preferences(user.id) });
          client.invalidateQueries({ queryKey: notificationQueryKeys.pendingOutbox(user.id) });

          if (totalMoved > 0) {
            triggerAlertEvaluationSafely(user.id, client);
          }
        }

        if (result.syncedCount > 0 && result.failedCount === 0) {
          toast.success(
            `Successfully synchronized ${result.syncedCount} update${result.syncedCount > 1 ? 's' : ''} to cloud.`
          );
        } else if (result.pulledCount > 0 && result.failedCount === 0) {
          toast.success(
            `Pulled ${result.pulledCount} update${result.pulledCount > 1 ? 's' : ''} from cloud.`
          );
        } else if (result.syncedCount > 0 && result.failedCount > 0) {
          toast.warning(
            `Synchronized ${result.syncedCount} item(s), but ${result.failedCount} had issues and remain saved locally.`
          );
        } else if (result.failedCount > 0) {
          toast.error(
            'Cloud synchronization could not be completed. Your changes remain safely saved locally.'
          );
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
    isSyncing: syncMutation.isPending,
    pendingCount,
    lastResult: syncMutation.data,
    isAuthenticated
  };
}

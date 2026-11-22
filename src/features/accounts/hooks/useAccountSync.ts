import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { queryClient as globalQueryClient } from '@/lib/queryClient';
import { useAuth } from '@/features/auth/hooks/useAuth';
import {
  defaultManualSyncCoordinator,
  UnifiedSyncResult
} from '@/infrastructure/sync/ManualSyncCoordinator';

export function useAccountSync(client = globalQueryClient) {
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
        return defaultManualSyncCoordinator.getPendingCount(user.id);
      },
      enabled: !!user?.id,
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
        return defaultManualSyncCoordinator.run();
      },
      onSuccess: (result) => {
        // Invalidate relevant queries so UI reflects updated balances, transactions, and outbox state
        client.invalidateQueries({ queryKey: ['accounts', user?.id] });
        client.invalidateQueries({ queryKey: ['transactions', user?.id] });
        client.invalidateQueries({ queryKey: pendingQueryKey });

        if (result.syncedCount > 0 && result.failedCount === 0) {
          toast.success(
            `Successfully synchronized ${result.syncedCount} update${result.syncedCount > 1 ? 's' : ''} to cloud.`
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

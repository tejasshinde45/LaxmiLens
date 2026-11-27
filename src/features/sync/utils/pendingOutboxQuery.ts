import { type QueryClient } from '@tanstack/react-query';
import { defaultDatabaseManager } from '@/infrastructure/database/local/DatabaseManager';
import { NoActiveDatabaseSessionError } from '@/infrastructure/database/local/errors/DatabaseErrors';
import { LocalOutboxRecord } from '@/infrastructure/database/local/schema';
import { OutboxManager } from '@/infrastructure/sync/OutboxManager';
import { OFFLINE_QUERY_STALE_TIME_MS } from '@/lib/queryRetryPolicy';

export { OFFLINE_QUERY_STALE_TIME_MS };

export const pendingOutboxEntriesQueryKey = (userId?: string) =>
  ['pendingOutboxEntries', userId] as const;

/**
 * Coalesces concurrent pending-outbox reads across mounted UI observers (Header, Sidebar,
 * Dashboard, Transactions, Budgets, Notifications, Recurring) into a single IndexedDB query,
 * while always returning fresh outbox state whenever an entity outbox query refetches.
 */
export async function fetchSharedPendingOutboxEntries(
  userId: string,
  client: QueryClient,
  fallbackSyncPort: Pick<OutboxManager, 'getPendingEntries'>,
  limit = 150
): Promise<LocalOutboxRecord[]> {
  return client.fetchQuery<LocalOutboxRecord[]>({
    queryKey: pendingOutboxEntriesQueryKey(userId),
    queryFn: async () => {
      try {
        const repos = await defaultDatabaseManager.getActiveRepositories();
        return await repos.outboxManager.getPendingEntries(userId, limit);
      } catch (err) {
        if (!(err instanceof NoActiveDatabaseSessionError)) {
          throw err;
        }
        return await fallbackSyncPort.getPendingEntries(userId, limit);
      }
    },
    staleTime: 0
  });
}

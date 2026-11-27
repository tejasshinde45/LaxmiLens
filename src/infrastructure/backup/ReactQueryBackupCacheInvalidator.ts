import { QueryClient } from '@tanstack/react-query';
import { queryClient as defaultQueryClient } from '@/lib/queryClient';
import {
  BackupCacheInvalidator,
  InvalidateCacheOptions
} from '@/application/ports/BackupStoragePort';
import { notificationQueryKeys } from '@/features/notifications/hooks/notificationQueryKeys';

/**
 * Refreshes active local React Query views after atomic backup restore or sync completion
 * without triggering automatic network synchronization.
 */
export class ReactQueryBackupCacheInvalidator implements BackupCacheInvalidator {
  constructor(private readonly client: QueryClient = defaultQueryClient) {}

  public async invalidateUserCaches(
    userId: string,
    options: InvalidateCacheOptions = {}
  ): Promise<void> {
    const includeNotifications = options.includeNotifications ?? true;
    const queryKeysToInvalidate: Array<readonly unknown[]> = [
      ['accounts', userId],
      ['accountSyncPendingCount', userId],
      ['categories', userId],
      ['transactions', userId],
      ['pendingOutboxTxIds', userId],
      ['budgets', userId],
      ['pendingOutboxBudgetIds', userId],
      ['borrowings', userId],
      ['outbox', userId],
      ['recurring', userId],
      ['pendingOutboxRecurringIds', userId],
      ['pendingOutboxEntries', userId],
      ['reports', userId],
      ['syncPendingCount', userId]
    ];

    if (includeNotifications) {
      queryKeysToInvalidate.push(
        notificationQueryKeys.all(userId),
        notificationQueryKeys.preferences(userId),
        notificationQueryKeys.pendingOutbox(userId)
      );
    }

    await Promise.all(
      queryKeysToInvalidate.map((queryKey) => this.client.invalidateQueries({ queryKey }))
    );
  }
}

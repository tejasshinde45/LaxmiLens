import { useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { queryClient as globalQueryClient } from '@/lib/queryClient';
import { useAuth } from '@/features/auth/hooks/useAuth';
import {
  DismissNotificationUseCase,
  GetNotificationsUseCase,
  MarkAllNotificationsReadUseCase,
  MarkNotificationReadUseCase,
  NotificationDTO,
  NotificationsResponseDTO
} from '@/application';
import { NotificationStatus } from '@/domain/entities/Notification';
import { NotificationCategory } from '@/domain/services/NotificationIdentityService';
import { createUserId } from '@/domain/value-objects/Identifiers';
import { defaultDatabaseManager } from '@/infrastructure/database/local/DatabaseManager';
import { NoActiveDatabaseSessionError } from '@/infrastructure/database/local/errors/DatabaseErrors';
import { db } from '@/infrastructure/database/local/DexieDatabase';
import { DexieNotificationRepository } from '@/infrastructure/database/local/repositories/DexieNotificationRepository';
import { OutboxManager } from '@/infrastructure/sync/OutboxManager';
import { DexieUnitOfWork } from '@/infrastructure/database/local/DexieUnitOfWork';
import { notificationQueryKeys } from './notificationQueryKeys';
import {
  fetchSharedPendingOutboxEntries,
  OFFLINE_QUERY_STALE_TIME_MS,
  pendingOutboxEntriesQueryKey
} from '@/features/sync/utils/pendingOutboxQuery';

const fallbackNotifRepo = new DexieNotificationRepository(db);
const fallbackSyncPort = new OutboxManager(db);
const fallbackUow = new DexieUnitOfWork(db);

const fallbackGetNotificationsUseCase = new GetNotificationsUseCase(fallbackNotifRepo);
const fallbackMarkReadUseCase = new MarkNotificationReadUseCase(
  fallbackNotifRepo,
  fallbackSyncPort,
  fallbackUow
);
const fallbackMarkAllReadUseCase = new MarkAllNotificationsReadUseCase(
  fallbackNotifRepo,
  fallbackSyncPort,
  fallbackUow
);
const fallbackDismissUseCase = new DismissNotificationUseCase(
  fallbackNotifRepo,
  fallbackSyncPort,
  fallbackUow
);

const EMPTY_NOTIFICATIONS_RESPONSE: NotificationsResponseDTO = {
  notifications: [],
  unreadCount: 0,
  totalCount: 0
};

export interface UseNotificationsFilter {
  status?: NotificationStatus;
  category?: NotificationCategory;
}

export function useNotifications(
  filter?: UseNotificationsFilter,
  explicitClient?: QueryClient
) {
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

  const inflightIdsRef = useRef<Set<string>>(new Set());

  const {
    data = EMPTY_NOTIFICATIONS_RESPONSE,
    isLoading,
    isError,
    error,
    refetch
  } = useQuery<NotificationsResponseDTO, Error>(
    {
      queryKey: notificationQueryKeys.all(user?.id),
      queryFn: async () => {
        if (!user?.id) {
          return EMPTY_NOTIFICATIONS_RESPONSE;
        }
        const validatedUserId = createUserId(user.id);
        try {
          const repos = await defaultDatabaseManager.getActiveRepositories();
          return await repos.getNotificationsUseCase.execute(validatedUserId);
        } catch (activeErr) {
          if (!(activeErr instanceof NoActiveDatabaseSessionError)) {
            throw activeErr;
          }
          return await fallbackGetNotificationsUseCase.execute(validatedUserId);
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

  const { data: pendingOutboxNotificationIds = [] } = useQuery<string[]>(
    {
      queryKey: notificationQueryKeys.pendingOutbox(user?.id),
      queryFn: async () => {
        if (!user?.id) return [];
        const entries = await fetchSharedPendingOutboxEntries(
          user.id,
          client,
          fallbackSyncPort,
          150
        );
        return entries.filter((e) => e.entity === 'notifications').map((e) => e.entityId);
      },
      enabled: !!user?.id,
      staleTime: OFFLINE_QUERY_STALE_TIME_MS,
      refetchInterval: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false
    },
    client
  );

  const pendingNotificationIdSet = useMemo(
    () => new Set<string>(pendingOutboxNotificationIds),
    [pendingOutboxNotificationIds]
  );

  const invalidateNotificationState = () => {
    client.invalidateQueries({ queryKey: notificationQueryKeys.all(user?.id) });
    client.invalidateQueries({ queryKey: notificationQueryKeys.pendingOutbox(user?.id) });
    client.invalidateQueries({ queryKey: ['syncPendingCount', user?.id] });
    client.invalidateQueries({ queryKey: pendingOutboxEntriesQueryKey(user?.id) });
  };

  const markAsReadMutation = useMutation<NotificationDTO | null, Error, string>(
    {
      mutationFn: async (notificationId) => {
        if (!user?.id) {
          throw new Error('Please sign in to update notifications.');
        }
        if (inflightIdsRef.current.has(`read:${notificationId}`)) {
          return null;
        }
        inflightIdsRef.current.add(`read:${notificationId}`);
        try {
          const validatedUserId = createUserId(user.id);
          try {
            const repos = await defaultDatabaseManager.getActiveRepositories();
            return await repos.markNotificationReadUseCase.execute(validatedUserId, notificationId);
          } catch (activeErr) {
            if (!(activeErr instanceof NoActiveDatabaseSessionError)) {
              throw activeErr;
            }
            return await fallbackMarkReadUseCase.execute(validatedUserId, notificationId);
          }
        } finally {
          inflightIdsRef.current.delete(`read:${notificationId}`);
        }
      },
      onSuccess: (updated) => {
        if (updated) {
          invalidateNotificationState();
        }
      },
      onError: (err) => {
        toast.error(err.message || 'Could not mark notification as read.');
      }
    },
    client
  );

  const markAllAsReadMutation = useMutation<{ updatedCount: number }, Error, void>(
    {
      mutationFn: async () => {
        if (!user?.id) {
          throw new Error('Please sign in to update notifications.');
        }
        const validatedUserId = createUserId(user.id);
        try {
          const repos = await defaultDatabaseManager.getActiveRepositories();
          return await repos.markAllNotificationsReadUseCase.execute(validatedUserId);
        } catch (activeErr) {
          if (!(activeErr instanceof NoActiveDatabaseSessionError)) {
            throw activeErr;
          }
          return await fallbackMarkAllReadUseCase.execute(validatedUserId);
        }
      },
      onSuccess: (res) => {
        invalidateNotificationState();
        if (res.updatedCount > 0) {
          toast.success(
            `Marked ${res.updatedCount} notification${res.updatedCount > 1 ? 's' : ''} as read locally.`
          );
        }
      },
      onError: (err) => {
        toast.error(err.message || 'Could not mark notifications as read.');
      }
    },
    client
  );

  const dismissMutation = useMutation<NotificationDTO | null, Error, string>(
    {
      mutationFn: async (notificationId) => {
        if (!user?.id) {
          throw new Error('Please sign in to dismiss notifications.');
        }
        if (inflightIdsRef.current.has(`dismiss:${notificationId}`)) {
          return null;
        }
        inflightIdsRef.current.add(`dismiss:${notificationId}`);
        try {
          const validatedUserId = createUserId(user.id);
          try {
            const repos = await defaultDatabaseManager.getActiveRepositories();
            return await repos.dismissNotificationUseCase.execute(validatedUserId, notificationId);
          } catch (activeErr) {
            if (!(activeErr instanceof NoActiveDatabaseSessionError)) {
              throw activeErr;
            }
            return await fallbackDismissUseCase.execute(validatedUserId, notificationId);
          }
        } finally {
          inflightIdsRef.current.delete(`dismiss:${notificationId}`);
        }
      },
      onSuccess: (dismissed) => {
        if (dismissed) {
          invalidateNotificationState();
          toast.success('Notification dismissal saved locally.');
        }
      },
      onError: (err) => {
        toast.error(err.message || 'Could not dismiss notification.');
      }
    },
    client
  );

  const filteredNotifications = useMemo(() => {
    return data.notifications.filter((item) => {
      if (filter?.status && item.status !== filter.status) {
        return false;
      }
      if (filter?.category && item.category !== filter.category) {
        return false;
      }
      return true;
    });
  }, [data.notifications, filter?.status, filter?.category]);

  return {
    notifications: filteredNotifications,
    allNotifications: data.notifications,
    unreadCount: data.unreadCount,
    totalCount: data.totalCount,
    pendingNotificationIdSet,
    isLoading,
    isError,
    error,
    refetch,
    isAuthenticated,
    markAsRead: markAsReadMutation.mutateAsync,
    isMarkingRead: markAsReadMutation.isPending,
    markAllAsRead: markAllAsReadMutation.mutateAsync,
    isMarkingAllRead: markAllAsReadMutation.isPending,
    dismissNotification: dismissMutation.mutateAsync,
    isDismissing: dismissMutation.isPending
  };
}

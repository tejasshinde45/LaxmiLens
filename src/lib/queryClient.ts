import { QueryClient } from '@tanstack/react-query';
import {
  OFFLINE_QUERY_STALE_TIME_MS,
  computeQueryRetryDelay,
  shouldRetryQuery
} from './queryRetryPolicy';

/**
 * TanStack Query Client configuration.
 *
 * NOTE: React Query is used for in-memory view synchronization and caching,
 * NOT as a replacement for durable offline storage. All offline-first persistence
 * is handled by Dexie (IndexedDB) and the transactional outbox.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: OFFLINE_QUERY_STALE_TIME_MS, // 5 minutes
      gcTime: 1000 * 60 * 30, // 30 minutes
      retry: shouldRetryQuery,
      retryDelay: computeQueryRetryDelay,
      refetchInterval: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false
    },
    mutations: {
      retry: false
    }
  }
});

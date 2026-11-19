import { QueryClient } from '@tanstack/react-query';

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
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 30, // 30 minutes
      retry: (failureCount, error) => {
        // Do not retry on client 4xx errors
        if (error instanceof Error && error.message.includes('4')) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: false
    }
  }
});

import { useEffect, useState } from 'react';
import { defaultDatabaseManager } from '@/infrastructure/database/local/DatabaseManager';
import {
  AutoSyncStateSnapshot,
  createIdleSyncState
} from '@/infrastructure/sync/AutoSyncScheduler';

export type { AutoSyncStateSnapshot, AutoSyncStatus } from '@/infrastructure/sync/AutoSyncScheduler';

/**
 * React subscription exposing the active user's honest background synchronization state
 * ('Saved locally', 'Synchronizing', 'Successfully synchronized', 'Waiting for internet',
 * 'Synchronization failed') across sign-in, user switches, and cross-tab updates.
 */
export function useAutoSyncState(): AutoSyncStateSnapshot {
  const [syncState, setSyncState] = useState<AutoSyncStateSnapshot>(() => {
    if (typeof defaultDatabaseManager.getSyncState === 'function') {
      return defaultDatabaseManager.getSyncState();
    }
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    return createIdleSyncState(null, isOnline);
  });

  useEffect(() => {
    if (typeof defaultDatabaseManager.subscribeSyncState !== 'function') {
      return;
    }
    return defaultDatabaseManager.subscribeSyncState((nextState) => {
      setSyncState(nextState);
    });
  }, []);

  return syncState;
}

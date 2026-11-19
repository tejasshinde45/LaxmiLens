import { useState, useEffect } from 'react';
import { syncEngine } from '@/infrastructure/sync/SyncEngine';
import { SyncStatusDTO } from '@/application/dto/SyncDTO';

export function useSyncStatus(): SyncStatusDTO {
  const [status, setStatus] = useState<SyncStatusDTO>({
    pendingOutboxCount: 0,
    lastSyncedAt: null,
    isSyncing: false,
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    lastError: null
  });

  useEffect(() => {
    const unsubscribe = syncEngine.subscribe((updatedStatus) => {
      setStatus(updatedStatus);
    });

    return unsubscribe;
  }, []);

  return status;
}

export interface SyncStatusDTO {
  pendingOutboxCount: number;
  lastSyncedAt: string | null;
  isSyncing: boolean;
  isOnline: boolean;
  lastError: string | null;
}

export interface SyncConflictDTO {
  entity: string;
  entityId: string;
  localVersion: number;
  remoteVersion: number;
  localPayload: Record<string, unknown>;
  remotePayload: Record<string, unknown>;
  detectedAt: string;
}

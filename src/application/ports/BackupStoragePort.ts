import {
  BackupArchiveDocument,
  BackupExcludedRecordCounts,
  BackupRecordCounts,
  BackupRestoreMode,
  BackupTargetSummary,
  EncryptedBackupEnvelope,
  RawBackupStoreInput
} from '@/application/dto/BackupDTO';
import { BackupValidationService } from '@/application/services/BackupValidationService';

export interface CapturedLocalSnapshot {
  dexieSchemaVersion: number;
  rawStoreData: RawBackupStoreInput;
  preExcludedQuarantinedCounts: Partial<Omit<BackupExcludedRecordCounts, 'total'>>;
}

export interface AtomicRestoreExecutionInput {
  userId: string;
  mode: BackupRestoreMode;
  restorePendingOutbox: boolean;
  archive: BackupArchiveDocument;
  unusedSeededDefaultCategoryIdsToDelete: readonly string[];
  validator: BackupValidationService;
}

export interface AtomicRestoreExecutionResult {
  restoredCounts: BackupRecordCounts;
  restoredOutboxCount: number;
  replacedSeededDefaultCategoryIds: string[];
}

export interface BackupStoragePort {
  getDexieSchemaVersion(): number;
  getDatabaseIdentity(): string;
  captureUserSnapshot(userId: string): Promise<CapturedLocalSnapshot>;
  getTargetRestoreSummary(userId: string): Promise<BackupTargetSummary>;
  executeAtomicRestore(input: AtomicRestoreExecutionInput): Promise<AtomicRestoreExecutionResult>;
}

export type BackupExclusiveOperation = 'backup' | 'restore';

export interface ExclusiveOperationOptions {
  readonly broadcastRestoreCompleted?: boolean;
}

export interface BackupSyncActivityGuard {
  isSyncRunning(): boolean;
  isOperationInProgress?(): boolean;
  runExclusive?<T>(
    operation: BackupExclusiveOperation,
    work: () => Promise<T>,
    options?: ExclusiveOperationOptions
  ): Promise<T>;
}

export interface InvalidateCacheOptions {
  readonly includeNotifications?: boolean;
}

export interface BackupCacheInvalidator {
  invalidateUserCaches(userId: string, options?: InvalidateCacheOptions): Promise<void>;
}

export interface BackupFileExportOutcome {
  filename: string;
  byteLength: number;
  downloaded: boolean;
}

export interface BackupFileExporter {
  downloadEnvelope(
    envelope: EncryptedBackupEnvelope,
    filename?: string
  ): BackupFileExportOutcome;
}

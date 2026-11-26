import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  BackupArchiveDocument,
  BackupRestoreMode,
  ExecuteBackupRestoreResultDTO,
  ExportEncryptedBackupResultDTO,
  RestorePreviewSummaryDTO,
  SafetyBackupReceipt
} from '@/application/dto/BackupDTO';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { useAccountSync } from '@/features/accounts/hooks/useAccountSync';
import { defaultDatabaseManager } from '@/infrastructure/database/local/DatabaseManager';
import { formatBackupErrorMessage } from '../utils/passphraseStrength';

export type BackupOperationPhase =
  | 'idle'
  | 'exporting'
  | 'decrypting'
  | 'previewing'
  | 'exporting_safety'
  | 'restoring';

export interface SafetyBackupStatusSummary {
  readonly receipt: SafetyBackupReceipt;
  readonly filename: string;
  readonly byteLength: number;
  readonly downloaded: boolean;
}

export interface RestoreSessionState {
  readonly fileName: string | null;
  readonly archive: BackupArchiveDocument | null;
  readonly preview: RestorePreviewSummaryDTO | null;
  readonly restorePendingOutbox: boolean;
  readonly safetyBackup: SafetyBackupStatusSummary | null;
}

const INITIAL_RESTORE_SESSION: RestoreSessionState = {
  fileName: null,
  archive: null,
  preview: null,
  restorePendingOutbox: true,
  safetyBackup: null
};

export function useBackupRestore() {
  let user: { id: string; email?: string } | null = null;
  let isAuthenticated = false;
  try {
    const auth = useAuth();
    user = auth.user;
    isAuthenticated = auth.isAuthenticated;
  } catch {
    user = null;
    isAuthenticated = false;
  }

  let isSyncing = false;
  try {
    const syncState = useAccountSync();
    isSyncing = syncState.isSyncing;
  } catch {
    isSyncing = false;
  }

  const [operationPhase, setOperationPhase] = useState<BackupOperationPhase>('idle');
  const [exportError, setExportError] = useState<string | null>(null);
  const [lastExportResult, setLastExportResult] = useState<ExportEncryptedBackupResultDTO | null>(
    null
  );
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [lastRestoreResult, setLastRestoreResult] =
    useState<ExecuteBackupRestoreResultDTO | null>(null);
  const [restoreSession, setRestoreSession] = useState<RestoreSessionState>(INITIAL_RESTORE_SESSION);

  const activeUserIdRef = useRef<string | null>(user?.id ?? null);
  const operationInFlightRef = useRef<boolean>(false);

  const resetRestoreSession = useCallback(() => {
    setRestoreSession(INITIAL_RESTORE_SESSION);
    setRestoreError(null);
  }, []);

  // Purge all sensitive in-memory backup/restore state whenever user identity changes or unmounts.
  useEffect(() => {
    const nextUserId = user?.id ?? null;
    if (activeUserIdRef.current !== nextUserId) {
      activeUserIdRef.current = nextUserId;
      setExportError(null);
      setLastExportResult(null);
      setLastRestoreResult(null);
      setRestoreSession(INITIAL_RESTORE_SESSION);
      setRestoreError(null);
    }
  }, [user?.id]);

  useEffect(() => {
    return () => {
      setRestoreSession(INITIAL_RESTORE_SESSION);
    };
  }, []);

  const assertExclusiveReady = useCallback(async () => {
    if (operationInFlightRef.current) {
      throw new Error('Another backup or restore operation is already in progress.');
    }
    if (isSyncing) {
      throw new Error('Synchronization is currently running. Wait for it to finish first.');
    }
    const repos = await defaultDatabaseManager.getActiveRepositories();
    if (
      repos.syncCoordinator.isSyncRunning() ||
      repos.syncCoordinator.isOperationInProgress()
    ) {
      throw new Error('Synchronization or another backup/restore task is already in progress.');
    }
    return repos;
  }, [isSyncing]);

  const createBackup = useCallback(
    async (passphrase: string): Promise<ExportEncryptedBackupResultDTO> => {
      setExportError(null);
      setLastExportResult(null);
      const startedUserId = user?.id ?? null;

      try {
        const repos = await assertExclusiveReady();
        operationInFlightRef.current = true;
        setOperationPhase('exporting');

        const result = await repos.exportEncryptedBackupUseCase.execute({
          passphrase,
          downloadFile: true
        });

        if (activeUserIdRef.current !== startedUserId) {
          throw new Error('Your session changed while exporting. Please try again.');
        }

        setLastExportResult(result);
        toast.success(
          result.downloaded
            ? `Encrypted backup downloaded (${result.filename}).`
            : `Encrypted backup created (${result.filename}).`
        );
        return result;
      } catch (err) {
        const message = formatBackupErrorMessage(err, 'Failed to create encrypted backup.');
        setExportError(message);
        toast.error(message);
        throw err;
      } finally {
        operationInFlightRef.current = false;
        setOperationPhase('idle');
      }
    },
    [assertExclusiveReady, user?.id]
  );

  const decryptAndPreview = useCallback(
    async (file: File, passphrase: string): Promise<RestorePreviewSummaryDTO> => {
      setRestoreError(null);
      setLastRestoreResult(null);
      const startedUserId = user?.id ?? null;

      try {
        const repos = await assertExclusiveReady();
        operationInFlightRef.current = true;
        setOperationPhase('decrypting');

        const decrypted = await repos.decryptBackupFileUseCase.execute({
          file,
          passphrase
        });

        setOperationPhase('previewing');
        const preview = await repos.generateRestorePreviewUseCase.execute({
          archive: decrypted.archive,
          restorePendingOutbox: true
        });

        if (activeUserIdRef.current !== startedUserId) {
          throw new Error('Your session changed while reading this backup.');
        }

        setRestoreSession({
          fileName: file.name,
          archive: decrypted.archive,
          preview,
          restorePendingOutbox: true,
          safetyBackup: null
        });
        return preview;
      } catch (err) {
        const message = formatBackupErrorMessage(
          err,
          'Unable to decrypt and validate this backup file.'
        );
        setRestoreError(message);
        throw err;
      } finally {
        operationInFlightRef.current = false;
        setOperationPhase('idle');
      }
    },
    [assertExclusiveReady, user?.id]
  );

  const toggleRestorePendingOutbox = useCallback(
    async (nextEnabled: boolean): Promise<RestorePreviewSummaryDTO | null> => {
      const currentArchive = restoreSession.archive;
      if (!currentArchive) {
        return null;
      }
      setRestoreError(null);

      try {
        const repos = await assertExclusiveReady();
        operationInFlightRef.current = true;
        setOperationPhase('previewing');

        const updatedPreview = await repos.generateRestorePreviewUseCase.execute({
          archive: currentArchive,
          restorePendingOutbox: nextEnabled
        });

        setRestoreSession((prev) => ({
          ...prev,
          preview: updatedPreview,
          restorePendingOutbox: nextEnabled
        }));
        return updatedPreview;
      } catch (err) {
        const message = formatBackupErrorMessage(
          err,
          'Could not refresh restore preview options.'
        );
        setRestoreError(message);
        throw err;
      } finally {
        operationInFlightRef.current = false;
        setOperationPhase('idle');
      }
    },
    [assertExclusiveReady, restoreSession.archive]
  );

  const createSafetyBackup = useCallback(
    async (passphrase: string): Promise<SafetyBackupStatusSummary> => {
      setRestoreError(null);
      const startedUserId = user?.id ?? null;

      try {
        const repos = await assertExclusiveReady();
        operationInFlightRef.current = true;
        setOperationPhase('exporting_safety');

        const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        const exported = await repos.exportEncryptedBackupUseCase.execute({
          passphrase,
          downloadFile: true,
          filename: `laxmilens-safety-backup-${timestamp}`
        });

        if (activeUserIdRef.current !== startedUserId) {
          throw new Error('Your session changed while generating the safety backup.');
        }

        const safetySummary: SafetyBackupStatusSummary = {
          receipt: exported.safetyBackupReceipt,
          filename: exported.filename,
          byteLength: exported.byteLength,
          downloaded: exported.downloaded
        };

        setRestoreSession((prev) => ({
          ...prev,
          safetyBackup: safetySummary
        }));

        toast.success(`Safety backup downloaded (${exported.filename}).`);
        return safetySummary;
      } catch (err) {
        const message = formatBackupErrorMessage(
          err,
          'Could not create the mandatory safety backup.'
        );
        setRestoreError(message);
        toast.error(message);
        throw err;
      } finally {
        operationInFlightRef.current = false;
        setOperationPhase('idle');
      }
    },
    [assertExclusiveReady, user?.id]
  );

  const executeRestore = useCallback(
    async (params: {
      mode: BackupRestoreMode;
      confirmationText?: string;
    }): Promise<ExecuteBackupRestoreResultDTO> => {
      const currentArchive = restoreSession.archive;
      if (!currentArchive) {
        throw new Error('Decrypt and preview a valid backup file before restoring.');
      }

      setRestoreError(null);
      const startedUserId = user?.id ?? null;

      try {
        const repos = await assertExclusiveReady();
        operationInFlightRef.current = true;
        setOperationPhase('restoring');

        if (params.mode === 'replace' && !restoreSession.safetyBackup?.receipt) {
          throw new Error('Download a safety backup before replacing existing local data.');
        }

        const result = await repos.executeBackupRestoreUseCase.execute({
          archive: currentArchive,
          mode: params.mode,
          restorePendingOutbox: restoreSession.restorePendingOutbox,
          confirmationText: params.confirmationText,
          safetyBackupReceipt: restoreSession.safetyBackup?.receipt
        });

        if (activeUserIdRef.current !== startedUserId) {
          throw new Error('Session changed during restore.');
        }

        setRestoreSession(INITIAL_RESTORE_SESSION);
        setLastRestoreResult(result);
        toast.success(
          'Local database restored successfully. Cloud sync was not triggered automatically.'
        );
        return result;
      } catch (err) {
        const message = formatBackupErrorMessage(err, 'Backup restore failed.');
        setRestoreError(message);
        // Clear any stale/invalidated receipt and refresh live preview on safety/state failures.
        setRestoreSession((prev) => ({ ...prev, safetyBackup: null }));
        try {
          const repos = await defaultDatabaseManager.getActiveRepositories();
          if (currentArchive && activeUserIdRef.current === startedUserId) {
            const refreshedPreview = await repos.generateRestorePreviewUseCase.execute({
              archive: currentArchive,
              restorePendingOutbox: restoreSession.restorePendingOutbox
            });
            setRestoreSession((prev) => ({
              ...prev,
              preview: refreshedPreview,
              safetyBackup: null
            }));
          }
        } catch {
          // Preserve primary error surfaced above.
        }
        toast.error(message);
        throw err;
      } finally {
        operationInFlightRef.current = false;
        setOperationPhase('idle');
      }
    },
    [
      assertExclusiveReady,
      restoreSession.archive,
      restoreSession.restorePendingOutbox,
      restoreSession.safetyBackup?.receipt,
      user?.id
    ]
  );

  const isBusy = operationPhase !== 'idle' || isSyncing;

  return {
    isAuthenticated,
    userId: user?.id ?? null,
    isSyncing,
    operationPhase,
    isBusy,
    exportError,
    lastExportResult,
    restoreError,
    lastRestoreResult,
    restoreSession,
    createBackup,
    decryptAndPreview,
    toggleRestorePendingOutbox,
    createSafetyBackup,
    executeRestore,
    resetRestoreSession,
    clearExportStatus: () => {
      setExportError(null);
      setLastExportResult(null);
    },
    clearRestoreStatus: () => {
      setRestoreError(null);
      setLastRestoreResult(null);
    }
  };
}

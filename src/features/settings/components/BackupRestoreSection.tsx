import { AlertCircle, HardDriveDownload, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { useBackupRestore } from '../hooks/useBackupRestore';
import { CreateEncryptedBackupPanel } from './CreateEncryptedBackupPanel';
import { RestoreBackupPanel } from './RestoreBackupPanel';

export const BackupRestoreSection: React.FC = () => {
  const {
    userId,
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
    clearExportStatus,
    clearRestoreStatus
  } = useBackupRestore();

  return (
    <Card variant="surface" className="space-y-4 p-5" aria-labelledby="backup-restore-heading">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5 text-sm font-semibold text-[#F5F1E8]">
            <HardDriveDownload className="h-4 w-4 text-[#D6AD60]" />
            <h2 id="backup-restore-heading">Data Backup &amp; Restore</h2>
          </div>
          <p className="text-xs text-[#858078] leading-relaxed">
            Create passphrase-encrypted local snapshots of all 14 financial stores or restore a
            verified archive to this device.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isSyncing ? (
            <Badge variant="gold" size="sm" className="gap-1.5">
              <RefreshCw className="h-3 w-3 animate-spin" />
              <span>Sync In Progress</span>
            </Badge>
          ) : (
            <Badge variant="neutral" size="sm">
              AES-256-GCM Local Vault
            </Badge>
          )}
        </div>
      </div>

      {!userId && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-[10px] border border-[#303030] bg-[#141414] px-3.5 py-2.5 text-xs text-[#B9B4AA]"
        >
          <AlertCircle className="h-4 w-4 text-[#D6AD60] shrink-0" />
          <span>Sign in to your account to create or restore encrypted local backups.</span>
        </div>
      )}

      {isSyncing && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-[10px] border border-[#D6AD60]/30 bg-[#D6AD60]/10 px-3.5 py-2.5 text-xs text-[#D6AD60]"
        >
          <RefreshCw className="h-4 w-4 shrink-0 animate-spin" />
          <span>
            Cloud synchronization is running. Backup and restore actions will re-enable when sync
            completes.
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-1">
        <CreateEncryptedBackupPanel
          userId={userId}
          isBusy={isBusy}
          operationPhase={operationPhase}
          exportError={exportError}
          lastExportResult={lastExportResult}
          onCreateBackup={createBackup}
          onClearStatus={clearExportStatus}
        />

        <RestoreBackupPanel
          userId={userId}
          isBusy={isBusy}
          operationPhase={operationPhase}
          restoreError={restoreError}
          lastRestoreResult={lastRestoreResult}
          restoreSession={restoreSession}
          onDecryptAndPreview={decryptAndPreview}
          onToggleOutbox={toggleRestorePendingOutbox}
          onCreateSafetyBackup={createSafetyBackup}
          onConfirmRestore={executeRestore}
          onCancelRestore={resetRestoreSession}
          onClearStatus={clearRestoreStatus}
        />
      </div>
    </Card>
  );
};

import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  FileUp,
  Lock,
  ShieldCheck,
  Upload,
  X
} from 'lucide-react';
import {
  BACKUP_FILE_EXTENSION,
  BackupRestoreMode,
  ExecuteBackupRestoreResultDTO,
  RestorePreviewSummaryDTO
} from '@/application/dto/BackupDTO';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  BackupOperationPhase,
  RestoreSessionState,
  SafetyBackupStatusSummary
} from '../hooks/useBackupRestore';
import { formatBackupByteSize } from '../utils/passphraseStrength';
import { RestorePreviewDialog } from './RestorePreviewDialog';

interface RestoreBackupPanelProps {
  userId: string | null;
  isBusy: boolean;
  operationPhase: BackupOperationPhase;
  restoreError: string | null;
  lastRestoreResult: ExecuteBackupRestoreResultDTO | null;
  restoreSession: RestoreSessionState;
  onDecryptAndPreview: (file: File, passphrase: string) => Promise<RestorePreviewSummaryDTO>;
  onToggleOutbox: (nextEnabled: boolean) => Promise<RestorePreviewSummaryDTO | null>;
  onCreateSafetyBackup: (passphrase: string) => Promise<SafetyBackupStatusSummary>;
  onConfirmRestore: (params: {
    mode: BackupRestoreMode;
    confirmationText?: string;
  }) => Promise<ExecuteBackupRestoreResultDTO>;
  onCancelRestore: () => void;
  onClearStatus: () => void;
}

export const RestoreBackupPanel: React.FC<RestoreBackupPanelProps> = ({
  userId,
  isBusy,
  operationPhase,
  restoreError,
  lastRestoreResult,
  restoreSession,
  onDecryptAndPreview,
  onToggleOutbox,
  onCreateSafetyBackup,
  onConfirmRestore,
  onCancelRestore,
  onClearStatus
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [showPassphrase, setShowPassphrase] = useState(false);

  // Clear selected file and passphrase whenever authenticated user changes.
  useEffect(() => {
    setSelectedFile(null);
    setPassphrase('');
    setShowPassphrase(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [userId]);

  const isDecrypting = operationPhase === 'decrypting' || operationPhase === 'previewing';
  const canDecrypt =
    Boolean(userId) && !isBusy && selectedFile !== null && passphrase.trim().length > 0;
  const previewOpen = restoreSession.preview !== null;

  const clearSelectedFileAndPassphrase = () => {
    setSelectedFile(null);
    setPassphrase('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onClearStatus();
    const file = e.target.files?.[0] ?? null;
    setSelectedFile(file);
  };

  const handleDecryptSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canDecrypt || !selectedFile) return;

    try {
      await onDecryptAndPreview(selectedFile, passphrase);
      // Clear passphrase from React state immediately after archive decryption succeeds.
      setPassphrase('');
    } catch {
      // Inline error rendered cleanly below.
    }
  };

  const handleDialogCancel = () => {
    clearSelectedFileAndPassphrase();
    onCancelRestore();
  };

  const handleConfirmRestore = async (params: {
    mode: BackupRestoreMode;
    confirmationText?: string;
  }) => {
    const result = await onConfirmRestore(params);
    clearSelectedFileAndPassphrase();
    return result;
  };

  return (
    <div className="rounded-[12px] border border-[#303030] bg-[#141414] p-4 space-y-4 flex flex-col justify-between">
      <form onSubmit={handleDecryptSubmit} className="space-y-4">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-[#F5F1E8] flex items-center gap-2">
            <Upload className="h-4 w-4 text-[#82A9CF]" />
            <span>Restore From Backup</span>
          </h3>
          <p className="text-xs text-[#858078] leading-relaxed">
            Decrypt and inspect an encrypted <code className="text-[#B9B4AA]">{BACKUP_FILE_EXTENSION}</code>{' '}
            backup before making any changes. Backups can only be restored into the same
            signed-in LaxmiLens account.
          </p>
        </div>

        {/* File Picker */}
        <div className="space-y-1.5">
          <label
            htmlFor="backup-restore-file-input"
            className="block text-xs font-medium text-[#B9B4AA]"
          >
            Encrypted Backup File ({BACKUP_FILE_EXTENSION})
          </label>
          <div className="flex items-center gap-2">
            <label
              htmlFor="backup-restore-file-input"
              className="flex flex-1 items-center justify-between gap-2 rounded-[10px] border border-dashed border-[#383838] bg-[#1B1B1B] px-3 py-2.5 text-xs text-[#B9B4AA] hover:border-[#D6AD60] transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2 truncate">
                <FileUp className="h-4 w-4 text-[#D6AD60] shrink-0" />
                {selectedFile ? (
                  <span className="text-[#F5F1E8] font-medium truncate">{selectedFile.name}</span>
                ) : (
                  <span>Choose a {BACKUP_FILE_EXTENSION} backup file...</span>
                )}
              </span>
              {selectedFile && (
                <Badge variant="neutral" size="sm">
                  {formatBackupByteSize(selectedFile.size)}
                </Badge>
              )}
            </label>
            <input
              ref={fileInputRef}
              id="backup-restore-file-input"
              type="file"
              accept={`${BACKUP_FILE_EXTENSION},.json,application/json`}
              disabled={!userId || isBusy}
              onChange={handleFileChange}
              className="sr-only"
            />
            {selectedFile && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Clear selected backup file"
                disabled={isBusy}
                onClick={clearSelectedFileAndPassphrase}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        <Input
          id="backup-restore-passphrase"
          type={showPassphrase ? 'text' : 'password'}
          autoComplete="current-password"
          label="Backup Passphrase"
          placeholder="Enter passphrase used to create this backup"
          value={passphrase}
          disabled={!userId || isBusy}
          prefixIcon={<Lock className="h-3.5 w-3.5" />}
          onChange={(e) => {
            onClearStatus();
            setPassphrase(e.target.value);
          }}
          suffixIcon={
            <button
              type="button"
              disabled={!userId || isBusy}
              onClick={() => setShowPassphrase((prev) => !prev)}
              aria-label={showPassphrase ? 'Hide restore passphrase' : 'Show restore passphrase'}
              className="rounded p-0.5 text-[#858078] hover:text-[#F5F1E8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D6AD60] cursor-pointer disabled:opacity-50"
            >
              {showPassphrase ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          }
        />

        {restoreError && !previewOpen && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-[10px] border border-[#D9827C]/30 bg-[#D9827C]/10 px-3 py-2.5 text-xs text-[#D9827C]"
          >
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{restoreError}</span>
          </div>
        )}

        {lastRestoreResult && !restoreError && (
          <div
            role="status"
            className="rounded-[10px] border border-[#72B895]/30 bg-[#72B895]/10 px-3 py-2.5 text-xs text-[#72B895] space-y-1"
          >
            <div className="flex items-center gap-2 font-medium">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>Local database restored successfully</span>
            </div>
            <p className="text-[11px] text-[#B9B4AA]">
              Mode: {lastRestoreResult.mode === 'empty' ? 'Empty Restore' : 'Replace'} • Restored{' '}
              {lastRestoreResult.restoredCounts.accounts} account(s),{' '}
              {lastRestoreResult.restoredCounts.transactions} transaction(s),{' '}
              {lastRestoreResult.restoredOutboxCount} pending sync item(s). Cloud synchronization was
              not started automatically.
            </p>
          </div>
        )}

        <div className="pt-1 flex justify-end">
          <Button
            type="submit"
            variant="secondary"
            size="md"
            isLoading={isDecrypting}
            disabled={!canDecrypt}
            leftIcon={<ShieldCheck className="h-4 w-4" />}
            className="w-full sm:w-auto"
          >
            {isDecrypting ? 'Decrypting & Validating...' : 'Decrypt & Preview'}
          </Button>
        </div>
      </form>

      <RestorePreviewDialog
        open={previewOpen}
        fileName={restoreSession.fileName}
        preview={restoreSession.preview}
        restorePendingOutbox={restoreSession.restorePendingOutbox}
        safetyBackup={restoreSession.safetyBackup}
        isBusy={isBusy}
        operationPhase={operationPhase}
        restoreError={restoreError}
        onToggleOutbox={onToggleOutbox}
        onCreateSafetyBackup={onCreateSafetyBackup}
        onConfirmRestore={handleConfirmRestore}
        onCancel={handleDialogCancel}
      />
    </div>
  );
};

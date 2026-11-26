import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, KeyRound } from 'lucide-react';
import { ExportEncryptedBackupResultDTO } from '@/application/dto/BackupDTO';
import { Button } from '@/components/ui/Button';
import {
  evaluatePassphraseStrength,
  formatBackupByteSize
} from '../utils/passphraseStrength';
import { BackupOperationPhase } from '../hooks/useBackupRestore';
import { PassphraseStrengthFieldPair } from './PassphraseStrengthFieldPair';

interface CreateEncryptedBackupPanelProps {
  userId: string | null;
  isBusy: boolean;
  operationPhase: BackupOperationPhase;
  exportError: string | null;
  lastExportResult: ExportEncryptedBackupResultDTO | null;
  onCreateBackup: (passphrase: string) => Promise<ExportEncryptedBackupResultDTO>;
  onClearStatus: () => void;
}

export const CreateEncryptedBackupPanel: React.FC<CreateEncryptedBackupPanelProps> = ({
  userId,
  isBusy,
  operationPhase,
  exportError,
  lastExportResult,
  onCreateBackup,
  onClearStatus
}) => {
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');

  // Clear sensitive passphrase inputs whenever authenticated user changes.
  useEffect(() => {
    setPassphrase('');
    setConfirmPassphrase('');
  }, [userId]);

  const strength = evaluatePassphraseStrength(passphrase);
  const canSubmit =
    Boolean(userId) &&
    !isBusy &&
    strength.meetsMinimum &&
    passphrase === confirmPassphrase &&
    confirmPassphrase.length > 0;

  const isExporting = operationPhase === 'exporting';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) {
      return;
    }

    try {
      await onCreateBackup(passphrase);
      setPassphrase('');
      setConfirmPassphrase('');
    } catch {
      // Error surfaced cleanly via hook exportError state.
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-[12px] border border-[#303030] bg-[#141414] p-4 space-y-4 flex flex-col justify-between"
    >
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-[#F5F1E8] flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-[#D6AD60]" />
              <span>Create Encrypted Backup</span>
            </h3>
            <p className="text-xs text-[#858078] leading-relaxed">
              Export all accounts, categories, transactions, budgets, recurring schedules,
              borrowings, preferences, and pending sync items into a portable encrypted file.
            </p>
          </div>
        </div>

        <PassphraseStrengthFieldPair
          idPrefix="backup-export"
          passphrase={passphrase}
          confirmPassphrase={confirmPassphrase}
          disabled={!userId || isBusy}
          onPassphraseChange={(val) => {
            onClearStatus();
            setPassphrase(val);
          }}
          onConfirmPassphraseChange={(val) => {
            onClearStatus();
            setConfirmPassphrase(val);
          }}
        />

        {exportError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-[10px] border border-[#D9827C]/30 bg-[#D9827C]/10 px-3 py-2.5 text-xs text-[#D9827C]"
          >
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{exportError}</span>
          </div>
        )}

        {lastExportResult && !exportError && (
          <div
            role="status"
            className="rounded-[10px] border border-[#72B895]/30 bg-[#72B895]/10 px-3 py-2.5 text-xs text-[#72B895] space-y-1"
          >
            <div className="flex items-center gap-2 font-medium">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>
                {lastExportResult.downloaded
                  ? 'Encrypted backup downloaded to your device'
                  : 'Encrypted backup archive created'}
              </span>
            </div>
            <p className="text-[11px] text-[#B9B4AA]">
              File: <code className="text-[#F5F1E8]">{lastExportResult.filename}</code> (
              {formatBackupByteSize(lastExportResult.byteLength)}) •{' '}
              {lastExportResult.manifest.counts.accounts} account(s),{' '}
              {lastExportResult.manifest.counts.transactions} transaction(s),{' '}
              {lastExportResult.manifest.counts.pendingOutbox} pending sync item(s)
            </p>
          </div>
        )}
      </div>

      <div className="pt-1 flex justify-end">
        <Button
          type="submit"
          variant="primary"
          size="md"
          isLoading={isExporting}
          disabled={!canSubmit}
          leftIcon={<Download className="h-4 w-4" />}
          className="w-full sm:w-auto"
        >
          {isExporting ? 'Encrypting Backup...' : 'Create Backup'}
        </Button>
      </div>
    </form>
  );
};

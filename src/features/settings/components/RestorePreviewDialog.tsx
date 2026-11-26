import { useEffect, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  RefreshCw,
  ShieldCheck
} from 'lucide-react';
import {
  BACKUP_REPLACE_CONFIRMATION_TEXT,
  BackupRestoreMode,
  RestorePreviewSummaryDTO
} from '@/application/dto/BackupDTO';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { cn } from '@/utils/cn';
import {
  BackupOperationPhase,
  SafetyBackupStatusSummary
} from '../hooks/useBackupRestore';
import {
  evaluatePassphraseStrength,
  formatBackupByteSize
} from '../utils/passphraseStrength';
import { PassphraseStrengthFieldPair } from './PassphraseStrengthFieldPair';

interface RestorePreviewDialogProps {
  open: boolean;
  fileName: string | null;
  preview: RestorePreviewSummaryDTO | null;
  restorePendingOutbox: boolean;
  safetyBackup: SafetyBackupStatusSummary | null;
  isBusy: boolean;
  operationPhase: BackupOperationPhase;
  restoreError: string | null;
  onToggleOutbox: (nextEnabled: boolean) => Promise<RestorePreviewSummaryDTO | null>;
  onCreateSafetyBackup: (passphrase: string) => Promise<SafetyBackupStatusSummary>;
  onConfirmRestore: (params: {
    mode: BackupRestoreMode;
    confirmationText?: string;
  }) => Promise<unknown>;
  onCancel: () => void;
}

const STORE_LABELS: ReadonlyArray<{
  key: keyof RestorePreviewSummaryDTO['backupCounts'];
  label: string;
}> = [
  { key: 'accounts', label: 'Accounts' },
  { key: 'categories', label: 'Categories' },
  { key: 'transactions', label: 'Transactions' },
  { key: 'budgets', label: 'Budgets' },
  { key: 'recurringRules', label: 'Recurring Rules' },
  { key: 'recurringOccurrences', label: 'Scheduled Occurrences' },
  { key: 'lenders', label: 'Lenders' },
  { key: 'borrowings', label: 'Borrowings' },
  { key: 'borrowingRepayments', label: 'Repayments' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'notificationPreferences', label: 'Alert Preferences' },
  { key: 'profile', label: 'Profile' },
  { key: 'categoryMappings', label: 'Category Sync Maps' },
  { key: 'pendingOutbox', label: 'Pending Sync Queue' }
];

function formatExportTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
}

export const RestorePreviewDialog: React.FC<RestorePreviewDialogProps> = ({
  open,
  fileName,
  preview,
  restorePendingOutbox,
  safetyBackup,
  isBusy,
  operationPhase,
  restoreError,
  onToggleOutbox,
  onCreateSafetyBackup,
  onConfirmRestore,
  onCancel
}) => {
  const [emptyConfirmed, setEmptyConfirmed] = useState(false);
  const [safetyPassphrase, setSafetyPassphrase] = useState('');
  const [safetyConfirmPassphrase, setSafetyConfirmPassphrase] = useState('');
  const [replaceText, setReplaceText] = useState('');

  // Reset all ephemeral dialog form fields whenever preview changes or dialog closes.
  useEffect(() => {
    if (!open) {
      setEmptyConfirmed(false);
      setSafetyPassphrase('');
      setSafetyConfirmPassphrase('');
      setReplaceText('');
    }
  }, [open]);

  if (!preview) {
    return null;
  }

  const canEmptyRestore = preview.modeCompatibility.canRestoreIntoEmpty;
  const requiresReplace = preview.modeCompatibility.requiresReplaceConfirmation;
  const activeMode: BackupRestoreMode = canEmptyRestore ? 'empty' : 'replace';

  const safetyStrength = evaluatePassphraseStrength(safetyPassphrase);
  const canGenerateSafetyBackup =
    !isBusy &&
    safetyStrength.meetsMinimum &&
    safetyPassphrase === safetyConfirmPassphrase &&
    safetyConfirmPassphrase.length > 0;

  const canExecuteEmpty = canEmptyRestore && emptyConfirmed && !isBusy;
  const hasVerifiedSafetyReceipt = Boolean(safetyBackup?.receipt);
  const canExecuteReplace =
    requiresReplace &&
    hasVerifiedSafetyReceipt &&
    replaceText.trim() === BACKUP_REPLACE_CONFIRMATION_TEXT &&
    !isBusy;

  const isCreatingSafety = operationPhase === 'exporting_safety';
  const isRestoring = operationPhase === 'restoring';

  const existingCounts = preview.existingLocalCounts;
  const existingTotalRecords = existingCounts
    ? existingCounts.accounts +
      existingCounts.categories +
      existingCounts.transactions +
      existingCounts.budgets +
      existingCounts.recurringRules +
      existingCounts.recurringOccurrences +
      existingCounts.lenders +
      existingCounts.borrowings +
      existingCounts.borrowingRepayments +
      existingCounts.notifications +
      existingCounts.notificationPreferences +
      existingCounts.profile
    : 0;

  const handleDownloadSafety = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canGenerateSafetyBackup) return;
    try {
      await onCreateSafetyBackup(safetyPassphrase);
      setSafetyPassphrase('');
      setSafetyConfirmPassphrase('');
    } catch {
      // Displayed cleanly via restoreError alert banner.
    }
  };

  const handleRestoreClick = async () => {
    if (activeMode === 'empty' && !canExecuteEmpty) return;
    if (activeMode === 'replace' && !canExecuteReplace) return;

    try {
      await onConfirmRestore({
        mode: activeMode,
        confirmationText: activeMode === 'replace' ? replaceText : undefined
      });
      setEmptyConfirmed(false);
      setReplaceText('');
    } catch {
      // Hook refreshes preview & surfaces error without claiming success.
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !isBusy) {
          onCancel();
        }
      }}
    >
      <DialogContent
        className="sm:max-w-2xl"
        onEscapeKeyDown={(e) => {
          if (isBusy) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (isBusy) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Database className="h-5 w-5 text-[#D6AD60]" />
            <span>Restore Preview & Verification</span>
          </DialogTitle>
          <DialogDescription>
            Review archive details and category compatibility before modifying your local database.
            Restore only works for backups belonging to your signed-in account.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-xs">
          {/* Backup Summary & Ownership Verification */}
          <div className="rounded-[10px] border border-[#303030] bg-[#141414] p-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="space-y-0.5">
                <span className="text-[11px] text-[#858078]">Selected Archive</span>
                <p className="text-sm font-medium text-[#F5F1E8]">
                  {fileName || 'Encrypted Backup Archive'}
                </p>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <Badge
                  variant={preview.ownerMatchesAuthenticatedUser ? 'income' : 'expense'}
                  size="sm"
                >
                  {preview.ownerMatchesAuthenticatedUser
                    ? 'Account Ownership Verified'
                    : 'Account Mismatch'}
                </Badge>
                <Badge variant="gold" size="sm">
                  Schema v{preview.manifestSummary.dexieSchemaVersion}
                </Badge>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 text-[11px]">
              <div>
                <span className="text-[#858078] block">Created On</span>
                <span className="text-[#F5F1E8] font-medium">
                  {formatExportTimestamp(preview.manifestSummary.exportedAt)}
                </span>
              </div>
              <div>
                <span className="text-[#858078] block">Backup Owner</span>
                <span className="text-[#F5F1E8] font-medium break-all">
                  {preview.manifestSummary.ownerEmail || preview.manifestSummary.ownerUserId}
                </span>
              </div>
              <div>
                <span className="text-[#858078] block">Target Mode</span>
                <span className="text-[#F5F1E8] font-medium">
                  {canEmptyRestore ? 'Empty Restore' : 'Replace Existing Local Data'}
                </span>
              </div>
            </div>
          </div>

          {/* Included Store Record Counts */}
          <div className="rounded-[10px] border border-[#303030] bg-[#141414] p-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-[#F5F1E8]">Backup Store Record Counts</span>
              {preview.excludedQuarantinedCounts.total > 0 && (
                <Badge variant="gold" size="sm">
                  {preview.excludedQuarantinedCounts.total} quarantined excluded
                </Badge>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {STORE_LABELS.map(({ key, label }) => (
                <div
                  key={key}
                  className="flex items-center justify-between rounded-md bg-[#1B1B1B] px-2.5 py-1.5 border border-[#282828]"
                >
                  <span className="text-[#B9B4AA]">{label}</span>
                  <span className="font-tabular font-semibold text-[#F5F1E8]">
                    {preview.backupCounts[key]}
                  </span>
                </div>
              ))}
            </div>
            {preview.excludedQuarantinedCounts.total > 0 && (
              <p className="text-[11px] text-[#D6AD60]">
                {preview.excludedQuarantinedCounts.total} quarantined or ambiguous record(s) from
                earlier local migrations were safely excluded when the backup was created.
              </p>
            )}
          </div>

          {/* Pending Outbox Restore Option */}
          <div className="flex items-start justify-between gap-4 rounded-[10px] border border-[#303030] bg-[#141414] p-3.5">
            <div className="space-y-0.5">
              <label
                htmlFor="restore-pending-outbox-toggle"
                className="text-xs font-medium text-[#F5F1E8] cursor-pointer"
              >
                Restore pending offline sync queue ({preview.backupCounts.pendingOutbox} queued)
              </label>
              <p className="text-[11px] text-[#858078] leading-relaxed">
                Enabled by default. Preserves original entity IDs and idempotency keys with reset
                retry counters. Restoring never triggers cloud synchronization automatically.
              </p>
            </div>
            <button
              id="restore-pending-outbox-toggle"
              type="button"
              role="switch"
              aria-checked={restorePendingOutbox}
              aria-label="Restore pending offline sync queue"
              disabled={isBusy}
              onClick={() => void onToggleOutbox(!restorePendingOutbox)}
              className={cn(
                'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D6AD60] focus-visible:ring-offset-2 focus-visible:ring-offset-[#1B1B1B] disabled:cursor-not-allowed disabled:opacity-50',
                restorePendingOutbox ? 'bg-[#D6AD60]' : 'bg-[#303030]'
              )}
            >
              <span
                className={cn(
                  'pointer-events-none inline-block h-5 w-5 rounded-full bg-[#101010] shadow-sm transition-transform',
                  restorePendingOutbox ? 'translate-x-5' : 'translate-x-0'
                )}
              />
            </button>
          </div>

          {/* Target DB Status & Category Identity Details */}
          <div className="rounded-[10px] border border-[#303030] bg-[#141414] p-3.5 space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="font-semibold text-[#F5F1E8]">Target Database & Category Identity</span>
              <Badge variant={canEmptyRestore ? 'income' : 'gold'} size="sm">
                {canEmptyRestore
                  ? preview.modeCompatibility.targetHasOnlyDefaultCategories
                    ? 'Fresh Seeded Defaults Only'
                    : 'Empty Target Ready'
                  : 'Existing Local Data Present'}
              </Badge>
            </div>

            {existingCounts && (
              <p className="text-[11px] text-[#B9B4AA]">
                Current local database holds{' '}
                <strong className="text-[#F5F1E8]">{existingTotalRecords}</strong> stored record(s)
                and{' '}
                <strong className="text-[#F5F1E8]">{existingCounts.pendingOutbox}</strong> pending
                sync queue item(s).
              </p>
            )}

            <div className="text-[11px] text-[#858078] space-y-1">
              <p>
                Backup default categories: {preview.defaultCategorySummary.backupDefaultCount} •
                Matching UUIDs on this device:{' '}
                {preview.defaultCategorySummary.matchedDefaultIdsCount} • Different seeded UUIDs:{' '}
                {preview.categoryIdentityContract.unresolvedSeededDefaultCategoryIds.length}
              </p>
              {preview.categoryIdentityContract.targetDefaultReconciliationAction ===
                'replace_unused_seeded_defaults' && (
                <p className="text-[#D6AD60]">
                  {preview.categoryIdentityContract.unresolvedSeededDefaultCategoryIds.length}{' '}
                  unused pre-seeded default category ID(s) on this device will be safely replaced
                  with your backup&apos;s original category UUIDs without matching by name alone.
                </p>
              )}
            </div>

            {preview.warnings.length > 0 && (
              <ul className="space-y-1 pt-1 list-disc list-inside text-[11px] text-[#B9B4AA]">
                {preview.warnings.map((warning, idx) => (
                  <li key={idx}>{warning}</li>
                ))}
              </ul>
            )}
          </div>

          {/* Mode-Specific Confirmation */}
          {canEmptyRestore ? (
            <div className="rounded-[10px] border border-[#72B895]/30 bg-[#72B895]/10 p-3.5 space-y-2.5">
              <div className="flex items-center gap-2 text-[#72B895] font-semibold">
                <ShieldCheck className="h-4 w-4 shrink-0" />
                <span>Ready for Safe Empty Restore</span>
              </div>
              <p className="text-[11px] text-[#B9B4AA] leading-relaxed">
                {preview.modeCompatibility.targetHasOnlyDefaultCategories
                  ? 'No financial transactions or custom data exist on this device. Untouched seeded default categories will be replaced with your backup’s original category UUIDs, preserving all financial links.'
                  : 'This device has no existing local user data. All backup records and original UUIDs will be restored into your local database.'}
              </p>
              <label className="flex items-start gap-2.5 cursor-pointer select-none pt-1">
                <input
                  id="backup-confirm-empty-restore"
                  type="checkbox"
                  checked={emptyConfirmed}
                  disabled={isBusy}
                  onChange={(e) => setEmptyConfirmed(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-[#303030] accent-[#D6AD60] cursor-pointer"
                />
                <span className="text-xs text-[#F5F1E8]">
                  I confirm restoring this backup into my local LaxmiLens database (cloud sync will
                  remain manual).
                </span>
              </label>
            </div>
          ) : (
            <div className="rounded-[10px] border border-[#D9827C]/40 bg-[#D9827C]/10 p-4 space-y-3">
              <div className="flex items-start gap-2 text-[#D9827C]">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold">
                    Replace Warning: Existing Local Data Will Be Overwritten
                  </p>
                  <p className="text-[11px] text-[#B9B4AA] leading-relaxed">
                    Restoring this archive will atomically replace{' '}
                    <strong className="text-[#F5F1E8]">{existingTotalRecords}</strong> local record(s)
                    and <strong className="text-[#F5F1E8]">{existingCounts?.pendingOutbox ?? 0}</strong>{' '}
                    pending offline sync item(s) across all 14 stores on this device. Cloud data on
                    Supabase is not altered until you manually sync later.
                  </p>
                </div>
              </div>

              {/* Mandatory Step 1: Verified Safety Backup */}
              <div className="rounded-[10px] border border-[#303030] bg-[#141414] p-3.5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-[#F5F1E8]">
                    Step 1: Download Safety Backup (Required)
                  </span>
                  {hasVerifiedSafetyReceipt && (
                    <Badge variant="income" size="sm">
                      Verified Receipt Issued
                    </Badge>
                  )}
                </div>

                {!hasVerifiedSafetyReceipt ? (
                  <form onSubmit={handleDownloadSafety} className="space-y-3">
                    <p className="text-[11px] text-[#858078] leading-relaxed">
                      Before replacing local data, encrypt and download a safety backup of your
                      current device database. A verifiable single-use receipt will unlock Step 2.
                    </p>
                    <PassphraseStrengthFieldPair
                      idPrefix="safety-backup"
                      passphrase={safetyPassphrase}
                      confirmPassphrase={safetyConfirmPassphrase}
                      disabled={isBusy}
                      passphraseLabel="Safety Backup Passphrase"
                      confirmLabel="Confirm Safety Passphrase"
                      onPassphraseChange={setSafetyPassphrase}
                      onConfirmPassphraseChange={setSafetyConfirmPassphrase}
                    />
                    <Button
                      type="submit"
                      variant="primary"
                      size="sm"
                      isLoading={isCreatingSafety}
                      disabled={!canGenerateSafetyBackup}
                      leftIcon={<Download className="h-3.5 w-3.5" />}
                    >
                      {isCreatingSafety ? 'Creating Safety Backup...' : 'Download Safety Backup'}
                    </Button>
                  </form>
                ) : (
                  <div className="space-y-1 text-[11px] text-[#72B895]">
                    <div className="flex items-center gap-1.5 font-medium">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      <span>
                        Safety backup ready: <code className="text-[#F5F1E8]">{safetyBackup?.filename}</code> (
                        {formatBackupByteSize(safetyBackup?.byteLength ?? 0)})
                      </span>
                    </div>
                    <p className="text-[#858078]">
                      Verifiable receipt{' '}
                      <code className="text-[#B9B4AA]">
                        {safetyBackup?.receipt.receiptId.slice(0, 8)}...
                      </code>{' '}
                      is bound to this local database state.
                    </p>
                  </div>
                )}
              </div>

              {/* Step 2 is ONLY exposed after a genuine safety-backup receipt is issued */}
              {hasVerifiedSafetyReceipt && (
                <div className="rounded-[10px] border border-[#D9827C]/30 bg-[#141414] p-3.5 space-y-2.5">
                  <span className="font-semibold text-[#F5F1E8] block">
                    Step 2: Confirm Replacement
                  </span>
                  <Input
                    id="backup-replace-confirm-input"
                    label={`Type ${BACKUP_REPLACE_CONFIRMATION_TEXT} to enable final replacement`}
                    placeholder={BACKUP_REPLACE_CONFIRMATION_TEXT}
                    value={replaceText}
                    disabled={isBusy}
                    onChange={(e) => setReplaceText(e.target.value)}
                  />
                </div>
              )}
            </div>
          )}

          {restoreError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-[10px] border border-[#D9827C]/40 bg-[#D9827C]/10 px-3 py-2.5 text-xs text-[#D9827C]"
            >
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{restoreError}</span>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" size="md" disabled={isBusy} onClick={onCancel}>
            Cancel
          </Button>
          {canEmptyRestore ? (
            <Button
              type="button"
              variant="primary"
              size="md"
              isLoading={isRestoring}
              disabled={!canExecuteEmpty}
              leftIcon={<RefreshCw className="h-4 w-4" />}
              onClick={() => void handleRestoreClick()}
            >
              {isRestoring ? 'Restoring Database...' : 'Restore Backup Locally'}
            </Button>
          ) : hasVerifiedSafetyReceipt ? (
            <Button
              type="button"
              variant="danger"
              size="md"
              isLoading={isRestoring}
              disabled={!canExecuteReplace}
              leftIcon={<RefreshCw className="h-4 w-4" />}
              onClick={() => void handleRestoreClick()}
            >
              {isRestoring ? 'Replacing Local Data...' : 'Replace Local Data & Restore'}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

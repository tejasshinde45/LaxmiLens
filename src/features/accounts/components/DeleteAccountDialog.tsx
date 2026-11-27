import React, { useEffect, useState } from 'react';
import { AlertTriangle, ShieldAlert, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { AccountWithBalanceDTO } from '@/application/dto/AccountDTO';
import { AccountDeletionEligibility } from '@/application/use-cases/accounts/DeleteAccountUseCase';
import { AccountType } from '@/domain/entities/Account';
import { ACCOUNT_TYPE_CONFIG } from '../schemas/accountSchemas';

export interface DeleteAccountDialogProps {
  isOpen: boolean;
  onClose: () => void;
  account: AccountWithBalanceDTO | null;
  checkEligibility: (accountId: string) => Promise<AccountDeletionEligibility>;
  onConfirmDelete: (accountId: string) => Promise<void>;
  isDeleting: boolean;
}

export const DeleteAccountDialog: React.FC<DeleteAccountDialogProps> = ({
  isOpen,
  onClose,
  account,
  checkEligibility,
  onConfirmDelete,
  isDeleting
}) => {
  const [eligibility, setEligibility] = useState<AccountDeletionEligibility | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isConfirmed, setIsConfirmed] = useState(false);

  useEffect(() => {
    if (!isOpen || !account) {
      setEligibility(null);
      setIsChecking(false);
      setCheckError(null);
      setDeleteError(null);
      setIsConfirmed(false);
      return;
    }

    let cancelled = false;
    setEligibility(null);
    setCheckError(null);
    setDeleteError(null);
    setIsConfirmed(false);
    setIsChecking(true);

    checkEligibility(account.id)
      .then((result) => {
        if (!cancelled) {
          setEligibility(result);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setCheckError(
            err instanceof Error
              ? err.message
              : 'Could not verify account deletion eligibility.'
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsChecking(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [account, checkEligibility, isOpen]);

  if (!account) return null;

  const typeKey =
    (account.accountType as AccountType) in ACCOUNT_TYPE_CONFIG
      ? (account.accountType as AccountType)
      : 'other';
  const typeConfig = ACCOUNT_TYPE_CONFIG[typeKey];

  const handleConfirm = async () => {
    if (!eligibility?.canDelete || !isConfirmed || isDeleting) return;
    try {
      setDeleteError(null);
      await onConfirmDelete(account.id);
      onClose();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Account deletion was blocked.');
      // Re-inspect eligibility so the UI displays any newly discovered blocker
      try {
        const refreshed = await checkEligibility(account.id);
        setEligibility(refreshed);
      } catch {
        // Keep the existing delete error banner if re-check fails
      }
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isDeleting && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2.5 mb-1">
            <span className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-[#D9827C]/10 text-[#D9827C]">
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </span>
            <DialogTitle className="text-base font-semibold text-[#F5F1E8]">
              Delete Account Permanently
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-[#858078] leading-relaxed">
            Permanently remove this unused account from your ledger. This action cannot be undone
            and never deletes existing transactions or financial history.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1 text-xs">
          {/* Account Identification */}
          <div className="rounded-[10px] border border-[#303030] bg-[#1B1B1B] p-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm text-[#F5F1E8] truncate">
                  {account.name}
                </span>
                {account.isArchived && (
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1.5 py-0 border-[#858078] text-[#858078]"
                  >
                    Archived
                  </Badge>
                )}
              </div>
              <span className="text-[11px] text-[#858078] block mt-0.5">
                {typeConfig.label}
              </span>
            </div>
            <div className="text-right shrink-0">
              <span className="text-[10px] text-[#858078] block">Balance</span>
              <span className="font-mono font-semibold text-[#F5F1E8]">
                {account.currentBalanceFormatted}
              </span>
            </div>
          </div>

          {isChecking && (
            <div
              role="status"
              className="rounded-[10px] border border-[#303030] bg-[#161616] p-3 text-[#B9B4AA]"
            >
              Checking transactions, recurring schedules, borrowings, and pending sync operations...
            </div>
          )}

          {(checkError || deleteError) && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-[10px] border border-[#D9827C]/30 bg-[#D9827C]/10 p-3 text-[#D9827C] leading-relaxed"
            >
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{deleteError || checkError}</span>
            </div>
          )}

          {!isChecking && !checkError && eligibility && !eligibility.canDelete && (
            <div
              role="alert"
              className="space-y-2 rounded-[10px] border border-[#D9827C]/30 bg-[#D9827C]/10 p-3.5 text-[#D9827C]"
            >
              <div className="flex items-center gap-2 font-semibold">
                <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Deletion Blocked by Existing Dependencies</span>
              </div>
              <ul className="list-disc pl-5 space-y-1 text-[11px] leading-relaxed">
                {eligibility.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
              <p className="text-[11px] text-[#B9B4AA] pt-1">
                Financial history and pending sync items are protected. Archive unused historical
                accounts instead, or wait until pending synchronization completes.
              </p>
            </div>
          )}

          {!isChecking && !checkError && eligibility?.canDelete && (
            <div className="space-y-3">
              <div className="rounded-[10px] border border-[#E4B66D]/30 bg-[#E4B66D]/10 p-3 text-[#E4B66D] text-[11px] leading-relaxed">
                Verified: no transactions, transfers, deleted tombstones, recurring rules,
                borrowings, or pending sync operations reference this account. Permanent deletion
                cannot be undone.
              </div>

              <label
                htmlFor="confirm-permanent-account-delete"
                className="flex items-start gap-2.5 rounded-[10px] border border-[#303030] bg-[#161616] p-3 cursor-pointer"
              >
                <input
                  id="confirm-permanent-account-delete"
                  type="checkbox"
                  checked={isConfirmed}
                  onChange={(e) => setIsConfirmed(e.target.checked)}
                  disabled={isDeleting}
                  className="mt-0.5 accent-[#D6AD60]"
                />
                <span className="text-xs text-[#F5F1E8] leading-relaxed">
                  I confirm I want to permanently delete{' '}
                  <strong className="font-semibold">{account.name}</strong> and understand this
                  action cannot be undone.
                </span>
              </label>
            </div>
          )}
        </div>

        <DialogFooter className="mt-3 gap-2 sm:gap-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={isDeleting}
          >
            {eligibility?.canDelete ? 'Cancel' : 'Close'}
          </Button>
          {!isChecking && eligibility?.canDelete && (
            <Button
              type="button"
              variant="danger"
              size="sm"
              onClick={() => void handleConfirm()}
              disabled={!isConfirmed || isDeleting}
              isLoading={isDeleting}
            >
              Delete Permanently
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

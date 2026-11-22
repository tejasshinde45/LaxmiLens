import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { AccountWithBalanceDTO } from '@/application/dto/AccountDTO';
import { ACCOUNT_TYPE_CONFIG } from '../schemas/accountSchemas';
import { AccountType } from '@/domain/entities/Account';
import { formatDate } from '@/utils/formatters';
import { Edit2, Archive, RotateCcw, Calendar, FileText, Building2 } from 'lucide-react';
import { cn } from '@/utils/cn';

export interface AccountDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  account: AccountWithBalanceDTO | null;
  onEdit: (account: AccountWithBalanceDTO) => void;
  onArchive: (account: AccountWithBalanceDTO) => void;
  onRestore: (account: AccountWithBalanceDTO) => void;
}

export const AccountDetailModal: React.FC<AccountDetailModalProps> = ({
  isOpen,
  onClose,
  account,
  onEdit,
  onArchive,
  onRestore
}) => {
  if (!account) return null;

  const typeKey = (account.accountType as AccountType) in ACCOUNT_TYPE_CONFIG
    ? (account.accountType as AccountType)
    : 'other';

  const typeConfig = ACCOUNT_TYPE_CONFIG[typeKey];
  const accentColor = account.color || typeConfig.defaultColor;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <span
              className="h-3 w-3 rounded-full shrink-0"
              style={{ backgroundColor: accentColor }}
            />
            <span className="text-xs font-medium text-[#858078] uppercase tracking-wider">
              {typeConfig.label}
            </span>
            {account.isArchived && (
              <Badge variant="outline" className="text-[10px] ml-auto border-[#858078] text-[#858078]">
                Archived
              </Badge>
            )}
          </div>
          <DialogTitle className="text-xl font-bold font-display">{account.name}</DialogTitle>
          <DialogDescription>
            {account.institutionName ? `Managed via ${account.institutionName}` : typeConfig.description}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Main Balance Display */}
          <div className="p-4 rounded-[12px] bg-[#242424] border border-[#303030] flex items-center justify-between">
            <div>
              <span className="text-xs text-[#858078] block">Current Derived Balance</span>
              <span
                className={cn(
                  'text-2xl font-bold font-display tracking-tight',
                  account.currentBalancePaise < 0 ? 'text-[#D9827C]' : 'text-[#72B895]'
                )}
              >
                {account.currentBalanceFormatted}
              </span>
            </div>
            <div className="text-right">
              <span className="text-[10px] text-[#858078] block">Opening Baseline</span>
              <span className="text-sm text-[#B9B4AA] font-mono">
                {account.openingBalanceFormatted}
              </span>
            </div>
          </div>

          {/* Details Grid */}
          <div className="space-y-2 text-xs">
            {account.institutionName && (
              <div className="flex items-center justify-between py-1.5 border-b border-[#303030]">
                <span className="text-[#858078] flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5" /> Institution
                </span>
                <span className="font-medium text-[#F5F1E8]">{account.institutionName}</span>
              </div>
            )}

            <div className="flex items-center justify-between py-1.5 border-b border-[#303030]">
              <span className="text-[#858078] flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" /> Established On
              </span>
              <span className="font-medium text-[#F5F1E8]">{formatDate(account.createdAt)}</span>
            </div>

            <div className="flex items-center justify-between py-1.5 border-b border-[#303030]">
              <span className="text-[#858078]">Account Currency</span>
              <span className="font-mono text-[#D6AD60] font-semibold">{account.currency}</span>
            </div>

            {account.notes && (
              <div className="pt-2">
                <span className="text-[#858078] flex items-center gap-1.5 mb-1">
                  <FileText className="h-3.5 w-3.5" /> Notes
                </span>
                <p className="p-2.5 rounded-[8px] bg-[#1B1B1B] border border-[#303030] text-[#B9B4AA] leading-relaxed">
                  {account.notes}
                </p>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2 pt-2">
          {!account.isArchived && (
            <Button
              type="button"
              variant="secondary"
              leftIcon={<Edit2 className="h-3.5 w-3.5" />}
              onClick={() => {
                onClose();
                onEdit(account);
              }}
              className="w-full sm:w-auto"
            >
              Edit
            </Button>
          )}

          {account.isArchived ? (
            <Button
              type="button"
              variant="outline"
              leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
              onClick={() => {
                onClose();
                onRestore(account);
              }}
              className="w-full sm:w-auto text-[#72B895] border-[#72B895]/30 hover:bg-[#72B895]/10"
            >
              Restore Account
            </Button>
          ) : (
            <Button
              type="button"
              variant="danger"
              leftIcon={<Archive className="h-3.5 w-3.5" />}
              onClick={() => {
                onClose();
                onArchive(account);
              }}
              className="w-full sm:w-auto"
            >
              Archive
            </Button>
          )}

          <Button type="button" variant="ghost" onClick={onClose} className="w-full sm:w-auto sm:ml-auto">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

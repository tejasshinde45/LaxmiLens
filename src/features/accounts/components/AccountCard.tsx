import React from 'react';
import {
  MoreVertical,
  Edit2,
  Archive,
  RotateCcw,
  Eye,
  Landmark,
  PiggyBank,
  Banknote,
  Wallet,
  CreditCard,
  HelpCircle
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@/components/ui/DropdownMenu';
import { AccountWithBalanceDTO } from '@/application/dto/AccountDTO';
import { ACCOUNT_TYPE_CONFIG } from '../schemas/accountSchemas';
import { AccountType } from '@/domain/entities/Account';
import { cn } from '@/utils/cn';

export interface AccountCardProps {
  account: AccountWithBalanceDTO;
  onViewDetails: (account: AccountWithBalanceDTO) => void;
  onEdit: (account: AccountWithBalanceDTO) => void;
  onArchive: (account: AccountWithBalanceDTO) => void;
  onRestore: (account: AccountWithBalanceDTO) => void;
}

const getAccountIcon = (type: AccountType) => {
  switch (type) {
    case 'bank':
      return Landmark;
    case 'savings':
      return PiggyBank;
    case 'cash':
      return Banknote;
    case 'wallet':
      return Wallet;
    case 'credit_card':
      return CreditCard;
    default:
      return HelpCircle;
  }
};

export const AccountCard: React.FC<AccountCardProps> = ({
  account,
  onViewDetails,
  onEdit,
  onArchive,
  onRestore
}) => {
  const typeKey = (account.accountType as AccountType) in ACCOUNT_TYPE_CONFIG
    ? (account.accountType as AccountType)
    : 'other';

  const typeConfig = ACCOUNT_TYPE_CONFIG[typeKey];
  const IconComponent = getAccountIcon(typeKey);
  const accentColor = account.color || typeConfig.defaultColor;

  const isDebt = account.isCreditCard && account.currentBalancePaise < 0;
  const isOverdraft = !account.isCreditCard && account.currentBalancePaise < 0;

  return (
    <Card
      variant="interactive"
      onClick={() => onViewDetails(account)}
      className={cn(
        'p-5 border-[#303030] bg-[#1B1B1B] relative flex flex-col justify-between transition-all group hover:border-[#454545]',
        account.isArchived && 'opacity-65 border-dashed border-[#454545] bg-[#161616]'
      )}
    >
      {/* Top Header: Icon + Info + Actions */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] text-sm shadow-sm"
            style={{
              backgroundColor: `${accentColor}18`,
              color: accentColor,
              border: `1px solid ${accentColor}30`
            }}
          >
            <IconComponent className="h-5 w-5" />
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-sm text-[#F5F1E8] truncate font-display group-hover:text-[#D6AD60] transition-colors">
                {account.name}
              </h3>
              {account.isArchived && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-[#858078] text-[#858078]">
                  Archived
                </Badge>
              )}
            </div>
            <p className="text-xs text-[#858078] truncate">
              {account.institutionName || typeConfig.label}
            </p>
          </div>
        </div>

        {/* Dropdown Menu */}
        <div onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Account options"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-[#858078] hover:bg-[#242424] hover:text-[#F5F1E8] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#D6AD60] transition-colors cursor-pointer"
              >
                <MoreVertical className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={() => onViewDetails(account)} className="cursor-pointer">
                <Eye className="h-4 w-4 mr-2 text-[#858078]" />
                <span>View Details</span>
              </DropdownMenuItem>

              {!account.isArchived && (
                <DropdownMenuItem onClick={() => onEdit(account)} className="cursor-pointer">
                  <Edit2 className="h-4 w-4 mr-2 text-[#858078]" />
                  <span>Edit Account</span>
                </DropdownMenuItem>
              )}

              <DropdownMenuSeparator />

              {account.isArchived ? (
                <DropdownMenuItem onClick={() => onRestore(account)} className="cursor-pointer text-[#72B895]">
                  <RotateCcw className="h-4 w-4 mr-2 text-[#72B895]" />
                  <span>Restore Account</span>
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  variant="danger"
                  onClick={() => onArchive(account)}
                  className="cursor-pointer"
                >
                  <Archive className="h-4 w-4 mr-2 text-[#D9827C]" />
                  <span>Archive</span>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Balance Section */}
      <div className="pt-2 border-t border-[#303030]/60 flex items-end justify-between">
        <div>
          <span className="text-[10px] font-medium tracking-wider text-[#858078] uppercase block">
            Current Balance
          </span>
          <div
            className={cn(
              'text-lg sm:text-xl font-bold font-display tracking-tight',
              isDebt || isOverdraft ? 'text-[#D9827C]' : 'text-[#F5F1E8]'
            )}
          >
            {account.currentBalanceFormatted}
          </div>
        </div>

        <div className="text-right">
          <span className="text-[10px] text-[#858078] block">Opening Balance</span>
          <span className="text-xs text-[#B9B4AA] font-mono">
            {account.openingBalanceFormatted}
          </span>
        </div>
      </div>
    </Card>
  );
};

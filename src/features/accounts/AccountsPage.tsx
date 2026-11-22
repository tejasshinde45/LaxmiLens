import React, { useState, useMemo } from 'react';
import { Wallet, Plus, AlertCircle, Archive, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/feedback/EmptyState';
import { cn } from '@/utils/cn';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/Dialog';
import { useAccounts } from './hooks/useAccounts';
import { useAccountSync } from './hooks/useAccountSync';
import { AccountSummaryMetrics } from './components/AccountSummaryMetrics';
import { AccountFilters, AccountFilterTab } from './components/AccountFilters';
import { AccountCard } from './components/AccountCard';
import { AccountFormModal } from './components/AccountFormModal';
import { AccountDetailModal } from './components/AccountDetailModal';
import { DevAccountRecoveryModal } from './components/DevAccountRecoveryModal';
import { AccountWithBalanceDTO } from '@/application/dto/AccountDTO';
import { CreateAccountFormValues, EditAccountFormValues } from './schemas/accountSchemas';

export const AccountsPage: React.FC = () => {
  const {
    accounts,
    summary,
    isLoading,
    isError,
    error,
    refetch,
    createAccount,
    isCreating,
    updateAccount,
    isUpdating,
    archiveAccount,
    isArchiving,
    restoreAccount
  } = useAccounts();

  const { syncNow, isSyncing, pendingCount, isAuthenticated } = useAccountSync();

  // Filter & Search State
  const [activeTab, setActiveTab] = useState<AccountFilterTab>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Modal State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [accountToEdit, setAccountToEdit] = useState<AccountWithBalanceDTO | null>(null);
  const [accountToView, setAccountToView] = useState<AccountWithBalanceDTO | null>(null);
  const [accountToArchive, setAccountToArchive] = useState<AccountWithBalanceDTO | null>(null);

  // Compute filter counts
  const counts = useMemo(() => {
    let all = 0;
    let bankSavings = 0;
    let cashWallet = 0;
    let credit = 0;
    let archived = 0;

    for (const a of accounts) {
      if (a.isArchived) {
        archived++;
      } else {
        all++;
        if (a.accountType === 'bank' || a.accountType === 'savings') {
          bankSavings++;
        } else if (a.accountType === 'cash' || a.accountType === 'wallet') {
          cashWallet++;
        } else if (a.accountType === 'credit_card') {
          credit++;
        }
      }
    }

    return {
      all,
      bank_savings: bankSavings,
      cash_wallet: cashWallet,
      credit,
      archived
    };
  }, [accounts]);

  // Compute filtered list
  const filteredAccounts = useMemo(() => {
    return accounts.filter((account) => {
      // 1. Tab filtering
      if (activeTab === 'archived') {
        if (!account.isArchived) return false;
      } else {
        if (account.isArchived) return false;

        if (activeTab === 'bank_savings') {
          if (account.accountType !== 'bank' && account.accountType !== 'savings') {
            return false;
          }
        } else if (activeTab === 'cash_wallet') {
          if (account.accountType !== 'cash' && account.accountType !== 'wallet') {
            return false;
          }
        } else if (activeTab === 'credit') {
          if (account.accountType !== 'credit_card') {
            return false;
          }
        }
      }

      // 2. Search query filtering
      if (searchQuery.trim()) {
        const query = searchQuery.trim().toLowerCase();
        const matchesName = account.name.toLowerCase().includes(query);
        const matchesInstitution = account.institutionName?.toLowerCase().includes(query);
        const matchesType = account.accountType.toLowerCase().includes(query);
        if (!matchesName && !matchesInstitution && !matchesType) {
          return false;
        }
      }

      return true;
    });
  }, [accounts, activeTab, searchQuery]);

  // Modal Handlers
  const handleCreateSubmit = async (values: CreateAccountFormValues) => {
    await createAccount(values);
    setIsCreateModalOpen(false);
  };

  const handleEditSubmit = async (values: EditAccountFormValues) => {
    await updateAccount(values);
    setAccountToEdit(null);
    // If the viewed account was updated, refresh the view modal's reference
    if (accountToView && accountToView.id === values.id) {
      const updatedAccount = accounts.find((a) => a.id === values.id);
      if (updatedAccount) setAccountToView(updatedAccount);
    }
  };

  const handleArchiveConfirm = async () => {
    if (!accountToArchive) return;
    await archiveAccount(accountToArchive.id);
    setAccountToArchive(null);
    if (accountToView && accountToView.id === accountToArchive.id) {
      setAccountToView(null);
    }
  };

  const handleRestoreAccount = async (account: AccountWithBalanceDTO) => {
    await restoreAccount(account.id);
    if (accountToView && accountToView.id === account.id) {
      setAccountToView({ ...accountToView, isArchived: false });
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        title="Accounts"
        description="Bank accounts, cash reserves, digital wallets, and credit cards with strictly derived balances."
        actions={
          <div className="flex items-center gap-2.5">
            {import.meta.env.DEV && <DevAccountRecoveryModal />}
            {isAuthenticated && (
              <Button
                variant="outline"
                size="sm"
                leftIcon={
                  <RefreshCw
                    className={cn('h-3.5 w-3.5', isSyncing && 'animate-spin text-[#D6AD60]')}
                  />
                }
                onClick={() => syncNow()}
                disabled={isSyncing}
                title="Synchronize pending account changes to Supabase cloud"
              >
                {isSyncing ? 'Syncing...' : 'Sync Now'}
                {pendingCount > 0 && (
                  <Badge variant="gold" size="sm" className="ml-1">
                    {pendingCount}
                  </Badge>
                )}
              </Button>
            )}
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Plus className="h-4 w-4" />}
              onClick={() => setIsCreateModalOpen(true)}
            >
              New Account
            </Button>
          </div>
        }
      />

      {/* Summary Metrics */}
      <AccountSummaryMetrics summary={summary} />

      {/* Filter and Search Bar */}
      <AccountFilters
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        counts={counts}
      />

      {/* Main Content Area */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} variant="surface" className="p-5 space-y-4">
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-[10px]" />
                <div className="space-y-1.5 flex-1">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
              <Skeleton className="h-7 w-28" />
              <div className="pt-2 border-t border-[#303030]/50 flex justify-between">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-16" />
              </div>
            </Card>
          ))}
        </div>
      ) : isError ? (
        <Card variant="surface" className="p-8 text-center border-[#D9827C]/30 bg-[#1B1B1B]">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[#D9827C]/10 text-[#D9827C] mb-4">
            <AlertCircle className="h-6 w-6" />
          </div>
          <h3 className="text-base font-semibold text-[#F5F1E8] mb-1">
            Failed to Load Financial Accounts
          </h3>
          <p className="text-sm text-[#858078] max-w-md mx-auto mb-5">
            {error instanceof Error ? error.message : 'An unexpected error occurred while fetching accounts.'}
          </p>
          <Button variant="secondary" size="sm" onClick={() => refetch()}>
            Retry Connection
          </Button>
        </Card>
      ) : accounts.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="No financial accounts registered"
          description="Add your first bank account, cash reserve, or credit card to begin tracking balances and executing transfers."
          actionLabel="Register First Account"
          onAction={() => setIsCreateModalOpen(true)}
        />
      ) : filteredAccounts.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="No matching accounts"
          description={
            searchQuery
              ? `No accounts found matching "${searchQuery}". Try adjusting your search query or switching filter tabs.`
              : `No accounts found in this category.`
          }
          actionLabel="Clear Filters"
          onAction={() => {
            setSearchQuery('');
            setActiveTab('all');
          }}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4.5">
          {filteredAccounts.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              onViewDetails={(acc) => setAccountToView(acc)}
              onEdit={(acc) => setAccountToEdit(acc)}
              onArchive={(acc) => setAccountToArchive(acc)}
              onRestore={handleRestoreAccount}
            />
          ))}
        </div>
      )}

      {/* Create Account Modal */}
      <AccountFormModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        mode="create"
        onSubmitCreate={handleCreateSubmit}
        onSubmitEdit={async () => {}}
        isLoading={isCreating}
      />

      {/* Edit Account Modal */}
      <AccountFormModal
        isOpen={!!accountToEdit}
        onClose={() => setAccountToEdit(null)}
        mode="edit"
        account={accountToEdit}
        onSubmitCreate={async () => {}}
        onSubmitEdit={handleEditSubmit}
        isLoading={isUpdating}
      />

      {/* Account Details Modal */}
      <AccountDetailModal
        isOpen={!!accountToView}
        onClose={() => setAccountToView(null)}
        account={accountToView}
        onEdit={(acc) => {
          setAccountToView(null);
          setAccountToEdit(acc);
        }}
        onArchive={(acc) => {
          setAccountToView(null);
          setAccountToArchive(acc);
        }}
        onRestore={handleRestoreAccount}
      />

      {/* Archive Confirmation Dialog */}
      <Dialog
        open={!!accountToArchive}
        onOpenChange={(open) => !open && setAccountToArchive(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2 mb-1">
              <span className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-[#D9827C]/10 text-[#D9827C]">
                <Archive className="h-4 w-4" />
              </span>
              <DialogTitle className="text-base font-semibold text-[#F5F1E8]">
                Archive Account
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs text-[#858078] leading-relaxed">
              Are you sure you want to archive{' '}
              <span className="font-semibold text-[#F5F1E8]">
                "{accountToArchive?.name}"
              </span>
              ? All historical transactions and audit ledger entries will be preserved, but this
              account will be hidden from everyday selectors. You can restore it at any time from
              the Archived tab.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="mt-4 gap-2 sm:gap-0">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setAccountToArchive(null)}
              disabled={isArchiving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              size="sm"
              onClick={handleArchiveConfirm}
              isLoading={isArchiving}
            >
              Archive Account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

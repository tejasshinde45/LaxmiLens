import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { DexieAccountRepository } from '@/infrastructure/database/local/repositories/DexieAccountRepository';
import { DexieTransactionRepository } from '@/infrastructure/database/local/repositories/DexieTransactionRepository';
import { OutboxManager } from '@/infrastructure/sync/OutboxManager';
import { DexieUnitOfWork } from '@/infrastructure/database/local/DexieUnitOfWork';
import { defaultDatabaseManager } from '@/infrastructure/database/local/DatabaseManager';
import {
  CreateAccountUseCase,
  UpdateAccountUseCase,
  ArchiveAccountUseCase,
  RestoreAccountUseCase,
  GetAccountsWithBalanceUseCase,
  AccountWithBalanceDTO
} from '@/application';
import { CreateAccountFormValues, EditAccountFormValues } from '../schemas/accountSchemas';
import { formatPaiseToINR } from '@/utils/formatters';
import { OFFLINE_QUERY_STALE_TIME_MS } from '@/features/sync/utils/pendingOutboxQuery';

// Fallback singleton infrastructure adapters for static/test contexts
const fallbackAccountRepo = new DexieAccountRepository();
const fallbackTransactionRepo = new DexieTransactionRepository();
const fallbackSyncPort = new OutboxManager();
const fallbackUow = new DexieUnitOfWork();

// Instantiated application use cases
const fallbackGetAccountsUseCase = new GetAccountsWithBalanceUseCase(
  fallbackAccountRepo,
  fallbackTransactionRepo
);
const fallbackCreateAccountUseCase = new CreateAccountUseCase(
  fallbackAccountRepo,
  fallbackSyncPort,
  fallbackUow
);
const fallbackUpdateAccountUseCase = new UpdateAccountUseCase(
  fallbackAccountRepo,
  fallbackSyncPort,
  fallbackUow
);
const fallbackArchiveAccountUseCase = new ArchiveAccountUseCase(
  fallbackAccountRepo,
  fallbackSyncPort,
  fallbackUow
);
const fallbackRestoreAccountUseCase = new RestoreAccountUseCase(
  fallbackAccountRepo,
  fallbackSyncPort,
  fallbackUow
);

export interface AccountsSummary {
  totalNetWorthPaise: number;
  totalNetWorthFormatted: string;
  totalAssetsPaise: number;
  totalAssetsFormatted: string;
  totalLiabilitiesPaise: number;
  totalLiabilitiesFormatted: string;
  activeAccountsCount: number;
  archivedAccountsCount: number;
}

export function useAccounts() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = ['accounts', user?.id];

  const {
    data: accounts = [],
    isLoading,
    isError,
    error,
    refetch
  } = useQuery<AccountWithBalanceDTO[]>({
    queryKey,
    queryFn: async () => {
      if (!user?.id) return [];
      try {
        const repos = await defaultDatabaseManager.getActiveRepositories();
        return repos.getAccountsUseCase.execute(user.id, true);
      } catch {
        return fallbackGetAccountsUseCase.execute(user.id, true);
      }
    },
    enabled: !!user?.id,
    staleTime: OFFLINE_QUERY_STALE_TIME_MS,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false
  });

  // Calculate high-level financial summary
  const summary: AccountsSummary = (() => {
    let assetsPaise = 0;
    let liabilitiesPaise = 0;
    let activeCount = 0;
    let archivedCount = 0;

    for (const acc of accounts) {
      if (acc.isArchived) {
        archivedCount++;
        continue;
      }

      activeCount++;

      if (acc.isCreditCard) {
        // Credit cards: negative balance represents debt/liability
        if (acc.currentBalancePaise < 0) {
          liabilitiesPaise += Math.abs(acc.currentBalancePaise);
        } else {
          assetsPaise += acc.currentBalancePaise;
        }
      } else {
        if (acc.currentBalancePaise >= 0) {
          assetsPaise += acc.currentBalancePaise;
        } else {
          // Overdraft
          liabilitiesPaise += Math.abs(acc.currentBalancePaise);
        }
      }
    }

    const netWorthPaise = assetsPaise - liabilitiesPaise;

    return {
      totalNetWorthPaise: netWorthPaise,
      totalNetWorthFormatted: formatPaiseToINR(netWorthPaise),
      totalAssetsPaise: assetsPaise,
      totalAssetsFormatted: formatPaiseToINR(assetsPaise),
      totalLiabilitiesPaise: liabilitiesPaise,
      totalLiabilitiesFormatted: formatPaiseToINR(liabilitiesPaise),
      activeAccountsCount: activeCount,
      archivedAccountsCount: archivedCount
    };
  })();

  // Create Account Mutation
  const createAccountMutation = useMutation({
    mutationFn: async (values: CreateAccountFormValues) => {
      if (!user?.id) throw new Error('You must be signed in to create an account.');

      // Convert Rupee string to integer paise safely
      const parsedRupees = parseFloat(values.openingBalance);
      const openingBalancePaise = Math.round(parsedRupees * 100);

      const params = {
        userId: user.id,
        name: values.name.trim(),
        accountType: values.accountType,
        openingBalancePaise,
        currency: 'INR',
        institutionName: values.institutionName?.trim() || undefined,
        color: values.color,
        icon: values.icon,
        notes: values.notes?.trim() || undefined
      };

      try {
        const repos = await defaultDatabaseManager.getActiveRepositories();
        return await repos.createAccountUseCase.execute(params);
      } catch {
        return await fallbackCreateAccountUseCase.execute(params);
      }
    },
    onSuccess: (newAccount) => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ['accountSyncPendingCount', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['syncPendingCount', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['pendingOutboxEntries', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['reports', user?.id] });
      toast.success(`Account "${newAccount.name}" created successfully`);
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : 'Could not create account';
      toast.error(msg);
    }
  });

  // Update Account Mutation
  const updateAccountMutation = useMutation({
    mutationFn: async (values: EditAccountFormValues) => {
      if (!user?.id) throw new Error('You must be signed in to update an account.');
      const params = {
        id: values.id,
        userId: user.id,
        name: values.name.trim(),
        accountType: values.accountType,
        institutionName: values.institutionName?.trim() || undefined,
        color: values.color,
        icon: values.icon,
        notes: values.notes?.trim() || undefined
      };
      try {
        const repos = await defaultDatabaseManager.getActiveRepositories();
        return await repos.updateAccountUseCase.execute(params);
      } catch {
        return await fallbackUpdateAccountUseCase.execute(params);
      }
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ['accountSyncPendingCount', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['syncPendingCount', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['pendingOutboxEntries', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['reports', user?.id] });
      toast.success(`Account "${updated.name}" updated successfully`);
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : 'Could not update account';
      toast.error(msg);
    }
  });

  // Archive Account Mutation
  const archiveAccountMutation = useMutation({
    mutationFn: async (accountId: string) => {
      if (!user?.id) throw new Error('You must be signed in to archive an account.');
      try {
        const repos = await defaultDatabaseManager.getActiveRepositories();
        return await repos.archiveAccountUseCase.execute(accountId, user.id);
      } catch {
        return await fallbackArchiveAccountUseCase.execute(accountId, user.id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ['accountSyncPendingCount', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['syncPendingCount', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['pendingOutboxEntries', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['reports', user?.id] });
      toast.success('Account archived successfully');
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : 'Could not archive account';
      toast.error(msg);
    }
  });

  // Restore Account Mutation
  const restoreAccountMutation = useMutation({
    mutationFn: async (accountId: string) => {
      if (!user?.id) throw new Error('You must be signed in to restore an account.');
      try {
        const repos = await defaultDatabaseManager.getActiveRepositories();
        return await repos.restoreAccountUseCase.execute(accountId, user.id);
      } catch {
        return await fallbackRestoreAccountUseCase.execute(accountId, user.id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ['accountSyncPendingCount', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['syncPendingCount', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['pendingOutboxEntries', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['reports', user?.id] });
      toast.success('Account restored successfully');
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : 'Could not restore account';
      toast.error(msg);
    }
  });

  return {
    accounts,
    summary,
    isLoading,
    isError,
    error,
    refetch,
    createAccount: createAccountMutation.mutateAsync,
    isCreating: createAccountMutation.isPending,
    updateAccount: updateAccountMutation.mutateAsync,
    isUpdating: updateAccountMutation.isPending,
    archiveAccount: archiveAccountMutation.mutateAsync,
    isArchiving: archiveAccountMutation.isPending,
    restoreAccount: restoreAccountMutation.mutateAsync,
    isRestoring: restoreAccountMutation.isPending
  };
}

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { useAccounts } from '@/features/accounts/hooks/useAccounts';
import { useCategories } from '@/features/categories/hooks/useCategories';
import { defaultDatabaseManager } from '@/infrastructure/database/local/DatabaseManager';
import { NoActiveDatabaseSessionError } from '@/infrastructure/database/local/errors/DatabaseErrors';
import { DexieAccountRepository } from '@/infrastructure/database/local/repositories/DexieAccountRepository';
import { DexieTransactionRepository } from '@/infrastructure/database/local/repositories/DexieTransactionRepository';
import { DexieCategoryRepository } from '@/infrastructure/database/local/repositories/DexieCategoryRepository';
import {
  AccountStatementReportDTO,
  CategoryReportDTO,
  FinancialReportDTO,
  FinancialSummaryReportDTO,
  GenerateFinancialReportUseCase,
  ReportFilterCriteria,
  ReportTabType
} from '@/application';
import { AccountWithBalanceDTO } from '@/application/dto/AccountDTO';
import {
  AnalyticsDatePreset,
  CustomDateRangeInput,
  formatLocalDateInput,
  parseLocalDateInput
} from '@/application/services/FinancialAnalyticsService';
import { TransactionType } from '@/domain/entities/Transaction';
import { createUserId } from '@/domain/value-objects/Identifiers';
import { OFFLINE_QUERY_STALE_TIME_MS } from '@/features/sync/utils/pendingOutboxQuery';

export type ReportTransactionTypeFilter = 'all' | TransactionType;

const fallbackGenerateFinancialReportUseCase = new GenerateFinancialReportUseCase(
  new DexieAccountRepository(),
  new DexieTransactionRepository(),
  new DexieCategoryRepository()
);

function getDefaultCustomRange(): CustomDateRangeInput {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    startDate: formatLocalDateInput(startOfMonth),
    endDate: formatLocalDateInput(now)
  };
}

function sortAccountsForReports(
  accounts: readonly AccountWithBalanceDTO[]
): AccountWithBalanceDTO[] {
  return [...accounts].sort((a, b) => {
    if (a.isArchived !== b.isArchived) {
      return a.isArchived ? 1 : -1;
    }
    const aSys = Boolean(a.systemTag);
    const bSys = Boolean(b.systemTag);
    if (aSys !== bSys) {
      return aSys ? 1 : -1;
    }
    return a.name.localeCompare(b.name);
  });
}

export function useReports() {
  let user: { id: string } | null = null;
  try {
    const auth = useAuth();
    user = auth.user;
  } catch {
    user = null;
  }

  const {
    accounts,
    isLoading: isAccountsLoading,
    isError: isAccountsError,
    error: accountsError,
    refetch: refetchAccounts
  } = useAccounts();

  const {
    categories,
    isLoading: isCategoriesLoading,
    isError: isCategoriesError,
    error: categoriesError,
    refetch: refetchCategories
  } = useCategories();

  const [activeTab, setActiveTab] = useState<ReportTabType>('summary');
  const [preset, setPreset] = useState<AnalyticsDatePreset>('this_month');
  const [customRange, setCustomRange] = useState<CustomDateRangeInput>(getDefaultCustomRange);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('all');
  const [selectedStatementAccountId, setSelectedStatementAccountId] = useState<string>('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<ReportTransactionTypeFilter>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [includeArchivedCategories, setIncludeArchivedCategories] = useState<boolean>(true);

  const sortedAccounts = useMemo(() => sortAccountsForReports(accounts), [accounts]);

  const sortedCategories = useMemo(
    () =>
      [...categories].sort((a, b) => {
        if (a.isArchived !== b.isArchived) {
          return a.isArchived ? 1 : -1;
        }
        if (a.type !== b.type) {
          return a.type.localeCompare(b.type);
        }
        return a.name.localeCompare(b.name);
      }),
    [categories]
  );

  // Resolve statement account: explicit selection -> single summary account filter -> first sorted account
  const effectiveStatementAccountId = useMemo(() => {
    if (sortedAccounts.length === 0) {
      return '';
    }
    if (
      selectedStatementAccountId &&
      sortedAccounts.some((acc) => acc.id === selectedStatementAccountId)
    ) {
      return selectedStatementAccountId;
    }
    if (
      selectedAccountId !== 'all' &&
      sortedAccounts.some((acc) => acc.id === selectedAccountId)
    ) {
      return selectedAccountId;
    }
    return sortedAccounts[0].id;
  }, [sortedAccounts, selectedStatementAccountId, selectedAccountId]);

  const dateRangeError = useMemo(() => {
    if (preset !== 'custom') return null;
    try {
      const start = parseLocalDateInput(customRange.startDate);
      const end = parseLocalDateInput(customRange.endDate);
      if (start.getTime() > end.getTime()) {
        return 'Start date must be on or before end date.';
      }
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Enter valid custom start and end dates.';
    }
  }, [preset, customRange]);

  // Keep category and transaction-type filters semantically aligned
  const handleTypeFilterChange = (nextType: ReportTransactionTypeFilter) => {
    setTypeFilter(nextType);
    if (nextType === 'transfer') {
      setSelectedCategoryId('all');
      return;
    }
    if (
      selectedCategoryId !== 'all' &&
      selectedCategoryId !== 'uncategorized' &&
      (nextType === 'income' || nextType === 'expense')
    ) {
      const matched = categories.find((c) => c.id === selectedCategoryId);
      if (matched && matched.type !== nextType) {
        setSelectedCategoryId('all');
      }
    }
  };

  const handleCategoryChange = (nextCategoryId: string) => {
    setSelectedCategoryId(nextCategoryId);
    if (nextCategoryId === 'all' || nextCategoryId === 'uncategorized') {
      return;
    }
    const matched = categories.find((c) => c.id === nextCategoryId);
    if (matched && typeFilter === 'transfer') {
      setTypeFilter(matched.type);
    }
  };

  const resetFilters = () => {
    setPreset('this_month');
    setCustomRange(getDefaultCustomRange());
    setSelectedAccountId('all');
    setSelectedStatementAccountId('');
    setSelectedCategoryId('all');
    setTypeFilter('all');
    setSearchQuery('');
    setIncludeArchivedCategories(true);
  };

  const hasActiveFilters =
    preset !== 'this_month' ||
    selectedAccountId !== 'all' ||
    selectedCategoryId !== 'all' ||
    typeFilter !== 'all' ||
    searchQuery.trim().length > 0 ||
    !includeArchivedCategories;

  const filters: ReportFilterCriteria = useMemo(() => {
    const criteria: ReportFilterCriteria = {
      preset,
      customRange: preset === 'custom' ? customRange : undefined,
      includeArchivedCategories,
      includeSystemAccounts: true
    };

    if (activeTab === 'statement') {
      if (effectiveStatementAccountId) {
        criteria.statementAccountId = effectiveStatementAccountId;
      }
    } else if (selectedAccountId !== 'all') {
      criteria.accountIds = [selectedAccountId];
    }

    if (typeFilter !== 'all') {
      criteria.types = [typeFilter];
    }

    if (selectedCategoryId !== 'all') {
      criteria.categoryIds = [selectedCategoryId];
    }

    const trimmedSearch = searchQuery.trim();
    if (trimmedSearch.length > 0) {
      criteria.searchQuery = trimmedSearch;
    }

    return criteria;
  }, [
    preset,
    customRange,
    includeArchivedCategories,
    activeTab,
    effectiveStatementAccountId,
    selectedAccountId,
    typeFilter,
    selectedCategoryId,
    searchQuery
  ]);

  const canRunReportQuery =
    Boolean(user?.id) &&
    !dateRangeError &&
    !isAccountsLoading &&
    !isCategoriesLoading &&
    (activeTab !== 'statement' || Boolean(effectiveStatementAccountId));

  const queryKey = [
    'reports',
    user?.id,
    activeTab,
    preset,
    preset === 'custom' ? customRange.startDate : null,
    preset === 'custom' ? customRange.endDate : null,
    activeTab === 'statement' ? effectiveStatementAccountId : selectedAccountId,
    selectedCategoryId,
    typeFilter,
    searchQuery.trim(),
    includeArchivedCategories
  ];

  const {
    data: report,
    isLoading: isReportLoading,
    isFetching: isReportFetching,
    isError: isReportError,
    error: reportError,
    refetch: refetchReport
  } = useQuery<FinancialReportDTO, Error>({
    queryKey,
    queryFn: async () => {
      if (!user?.id) {
        throw new Error('Authentication required to generate financial reports.');
      }
      const validatedUserId = createUserId(user.id);
      try {
        const repos = await defaultDatabaseManager.getActiveRepositories();
        return await repos.generateFinancialReportUseCase.execute({
          userId: validatedUserId,
          reportType: activeTab,
          filters
        });
      } catch (activeErr) {
        if (!(activeErr instanceof NoActiveDatabaseSessionError)) {
          throw activeErr;
        }
        return await fallbackGenerateFinancialReportUseCase.execute({
          userId: validatedUserId,
          reportType: activeTab,
          filters
        });
      }
    },
    enabled: canRunReportQuery,
    staleTime: OFFLINE_QUERY_STALE_TIME_MS,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false
  });

  const summaryReport =
    report && report.reportType === 'summary' ? (report as FinancialSummaryReportDTO) : null;
  const statementReport =
    report && report.reportType === 'statement' ? (report as AccountStatementReportDTO) : null;
  const categoryReport =
    report && report.reportType === 'category' ? (report as CategoryReportDTO) : null;

  const refetch = async () => {
    await Promise.all([refetchAccounts(), refetchCategories(), refetchReport()]);
  };

  const isLoading =
    isAccountsLoading ||
    isCategoriesLoading ||
    (canRunReportQuery && (isReportLoading || (isReportFetching && !report)));

  const isError = isAccountsError || isCategoriesError || isReportError;
  const error = accountsError || categoriesError || reportError || null;

  return {
    activeTab,
    setActiveTab,
    preset,
    setPreset,
    customRange,
    setCustomRange,
    dateRangeError,
    selectedAccountId,
    setSelectedAccountId,
    effectiveStatementAccountId,
    setSelectedStatementAccountId,
    selectedCategoryId,
    handleCategoryChange,
    typeFilter,
    handleTypeFilterChange,
    searchQuery,
    setSearchQuery,
    includeArchivedCategories,
    setIncludeArchivedCategories,
    hasActiveFilters,
    resetFilters,
    accounts: sortedAccounts,
    categories: sortedCategories,
    filters,
    report: report ?? null,
    summaryReport,
    statementReport,
    categoryReport,
    isLoading,
    isError,
    error,
    refetch
  };
}

import React, { useState, useMemo } from 'react';
import {
  Plus,
  AlertCircle
} from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { useTransactions, computeTransactionSummary } from './hooks/useTransactions';
import { useAccounts } from '@/features/accounts/hooks/useAccounts';
import { useCategories } from '@/features/categories/hooks/useCategories';
import { TransactionSummaryMetrics } from './components/TransactionSummaryMetrics';
import {
  TransactionFilters,
  TransactionFilterType,
  DateFilterPreset,
  SortDirection,
  SortField
} from './components/TransactionFilters';
import { TransactionTable } from './components/TransactionTable';
import { TransactionFormModal } from './components/TransactionFormModal';
import { TransactionDetailModal } from './components/TransactionDetailModal';
import { DeleteTransactionModal } from './components/DeleteTransactionModal';
import { TransactionResponseDTO } from '@/application/dto/TransactionDTO';
import {
  CreateTransactionFormValues,
  EditTransactionFormValues
} from './schemas/transactionSchemas';

export const TransactionsPage: React.FC = () => {
  const {
    transactions,
    pendingTxIdSet,
    isLoading: isTransactionsLoading,
    isError,
    error,
    refetch,
    createTransaction,
    isCreating,
    updateTransaction,
    isUpdating,
    deleteTransaction,
    isDeleting
  } = useTransactions();

  const { accounts, isLoading: isAccountsLoading } = useAccounts();
  const { categories, isLoading: isCategoriesLoading } = useCategories();

  // Filter & Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<TransactionFilterType>('all');
  const [selectedAccountId, setSelectedAccountId] = useState('all');
  const [selectedCategoryId, setSelectedCategoryId] = useState('all');
  const [dateFilter, setDateFilter] = useState<DateFilterPreset>('all');
  const [sortBy, setSortBy] = useState<SortField>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Modals State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [transactionToEdit, setTransactionToEdit] = useState<TransactionResponseDTO | null>(null);
  const [transactionToView, setTransactionToView] = useState<TransactionResponseDTO | null>(null);
  const [transactionToDelete, setTransactionToDelete] = useState<TransactionResponseDTO | null>(null);

  // Toggle or change sort field
  const handleSortChange = (field: SortField) => {
    if (sortBy === field) {
      setSortDirection((prev) => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortBy(field);
      setSortDirection('desc');
    }
  };

  // Reset all filters to default state
  const handleResetFilters = () => {
    setSearchQuery('');
    setTypeFilter('all');
    setSelectedAccountId('all');
    setSelectedCategoryId('all');
    setDateFilter('all');
    setSortBy('date');
    setSortDirection('desc');
  };

  const hasFiltersApplied =
    searchQuery.trim().length > 0 ||
    typeFilter !== 'all' ||
    selectedAccountId !== 'all' ||
    selectedCategoryId !== 'all' ||
    dateFilter !== 'all' ||
    sortBy !== 'date' ||
    sortDirection !== 'desc';

  // Compute filtered & sorted transactions
  const filteredTransactions = useMemo(() => {
    return transactions
      .filter((tx) => {
        // Exclude soft-deleted records
        if (tx.isDeleted) return false;

        // 1. Transaction Type filter
        if (typeFilter !== 'all' && tx.type !== typeFilter) {
          return false;
        }

        // 2. Account filter (matches source account or destination account)
        if (selectedAccountId !== 'all') {
          const isSource = tx.accountId === selectedAccountId;
          const isDest = tx.destinationAccountId === selectedAccountId;
          if (!isSource && !isDest) return false;
        }

        // 3. Category filter
        if (selectedCategoryId !== 'all') {
          if (tx.categoryId !== selectedCategoryId) return false;
        }

        // 4. Date preset filter
        if (dateFilter !== 'all') {
          const txDate = new Date(tx.transactionDate);
          const now = new Date();
          if (dateFilter === 'this_month') {
            const matchesMonth =
              txDate.getFullYear() === now.getFullYear() &&
              txDate.getMonth() === now.getMonth();
            if (!matchesMonth) return false;
          } else if (dateFilter === 'last_30_days') {
            const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            if (txDate < thirtyDaysAgo) return false;
          } else if (dateFilter === 'this_year') {
            if (txDate.getFullYear() !== now.getFullYear()) return false;
          }
        }

        // 5. Text search query
        if (searchQuery.trim().length > 0) {
          const q = searchQuery.toLowerCase();
          const titleMatch = (tx.title || '').toLowerCase().includes(q);
          const noteMatch = (tx.note || '').toLowerCase().includes(q);
          if (!titleMatch && !noteMatch) return false;
        }

        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'amount') {
          return sortDirection === 'desc'
            ? b.amountPaise - a.amountPaise
            : a.amountPaise - b.amountPaise;
        }
        const timeA = new Date(a.transactionDate).getTime();
        const timeB = new Date(b.transactionDate).getTime();
        return sortDirection === 'desc' ? timeB - timeA : timeA - timeB;
      });
  }, [
    transactions,
    typeFilter,
    selectedAccountId,
    selectedCategoryId,
    dateFilter,
    searchQuery,
    sortBy,
    sortDirection
  ]);

  // Compute scoped overview metrics adhering to LedgerRules
  const viewSummary = useMemo(() => {
    return computeTransactionSummary(filteredTransactions);
  }, [filteredTransactions]);

  const isLoading = isTransactionsLoading || isAccountsLoading || isCategoriesLoading;

  return (
    <div className="space-y-6">
      {/* Page Header with Actions */}
      <PageHeader
        title="Transactions"
        description="Immutable double-entry transactional ledger with offline capture and idempotency."
        badge={
          <Badge variant="neutral" size="sm">
            {transactions.length} entries
          </Badge>
        }
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Plus className="h-4 w-4" />}
              onClick={() => setIsCreateModalOpen(true)}
            >
              Add Transaction
            </Button>
          </div>
        }
      />

      {/* Error Banner */}
      {isError && (
        <Card variant="surface" className="p-4 border-[#D9827C]/30 bg-[#D9827C]/10 text-xs text-[#D9827C]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>Failed to load transaction ledger: {error?.message || 'Unknown error'}</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              className="border-[#D9827C]/40 text-[#D9827C] hover:bg-[#D9827C]/20"
            >
              Retry
            </Button>
          </div>
        </Card>
      )}

      {/* Overview Metrics Cards */}
      <TransactionSummaryMetrics summary={viewSummary} isLoading={isLoading} />

      {/* Filter and Search Controls */}
      <TransactionFilters
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
        selectedAccountId={selectedAccountId}
        onAccountChange={setSelectedAccountId}
        selectedCategoryId={selectedCategoryId}
        onCategoryChange={setSelectedCategoryId}
        dateFilter={dateFilter}
        onDateFilterChange={setDateFilter}
        sortBy={sortBy}
        onSortByChange={setSortBy}
        sortDirection={sortDirection}
        onToggleSortDirection={() =>
          setSortDirection((prev) => (prev === 'desc' ? 'asc' : 'desc'))
        }
        onResetFilters={handleResetFilters}
        accounts={accounts}
        categories={categories}
      />

      {/* Ledger Table / List */}
      <TransactionTable
        transactions={filteredTransactions}
        accounts={accounts}
        categories={categories}
        pendingTxIdSet={pendingTxIdSet}
        isLoading={isLoading}
        sortBy={sortBy}
        sortDirection={sortDirection}
        onSortChange={handleSortChange}
        onViewDetails={(tx) => setTransactionToView(tx)}
        onEdit={(tx) => setTransactionToEdit(tx)}
        onDelete={(tx) => setTransactionToDelete(tx)}
        onRecordFirstTransaction={() => setIsCreateModalOpen(true)}
        hasFiltersApplied={hasFiltersApplied}
      />

      {/* Create Transaction Modal */}
      <TransactionFormModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        mode="create"
        accounts={accounts}
        categories={categories}
        onSubmitCreate={async (values: CreateTransactionFormValues) => {
          await createTransaction(values);
        }}
        onSubmitEdit={async () => {}}
        isLoading={isCreating}
      />

      {/* Edit Transaction Modal */}
      <TransactionFormModal
        isOpen={!!transactionToEdit}
        onClose={() => setTransactionToEdit(null)}
        mode="edit"
        transaction={transactionToEdit}
        accounts={accounts}
        categories={categories}
        onSubmitCreate={async () => {}}
        onSubmitEdit={async (values: EditTransactionFormValues) => {
          await updateTransaction(values);
        }}
        isLoading={isUpdating}
      />

      {/* Transaction Detail View Modal */}
      <TransactionDetailModal
        isOpen={!!transactionToView}
        onClose={() => setTransactionToView(null)}
        transaction={transactionToView}
        accounts={accounts}
        categories={categories}
        isPendingSync={transactionToView ? pendingTxIdSet.has(transactionToView.id) : false}
        onEdit={(tx) => setTransactionToEdit(tx)}
        onDelete={(tx) => setTransactionToDelete(tx)}
      />

      {/* Delete Transaction Confirmation Modal */}
      <DeleteTransactionModal
        isOpen={!!transactionToDelete}
        onClose={() => setTransactionToDelete(null)}
        transaction={transactionToDelete}
        onConfirmDelete={async (id) => {
          await deleteTransaction(id);
        }}
        isLoading={isDeleting}
      />
    </div>
  );
};

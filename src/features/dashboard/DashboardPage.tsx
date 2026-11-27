import React, { useState, useMemo } from 'react';
import {
  LayoutDashboard,
  Wallet,
  Landmark,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  Plus,
  Sparkles,
  HandCoins
} from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/feedback/EmptyState';
import { Link, useNavigate } from 'react-router-dom';
import { useAccounts, computeCashAndBankBalance } from '@/features/accounts/hooks/useAccounts';
import { useTransactions } from '@/features/transactions/hooks/useTransactions';
import { useCategories } from '@/features/categories/hooks/useCategories';
import { useBudgets } from '@/features/budgets/hooks/useBudgets';
import { getCurrentBudgetPeriod } from '@/features/budgets/schemas/budgetSchemas';
import { CategoryIcon } from '@/features/categories/components/CategoryIcon';
import { TransactionDetailModal } from '@/features/transactions/components/TransactionDetailModal';
import { DashboardBudgetSection } from './components/DashboardBudgetSection';
import { TransactionResponseDTO } from '@/application/dto/TransactionDTO';
import { AccountWithBalanceDTO } from '@/application/dto/AccountDTO';
import { Category } from '@/domain/entities/Category';
import { formatPaiseToINR, formatDate } from '@/utils/formatters';
import { cn } from '@/utils/cn';

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();

  const {
    accounts,
    summary: accountsSummary,
    isLoading: isAccountsLoading
  } = useAccounts();

  const {
    transactions,
    pendingTxIdSet,
    isLoading: isTransactionsLoading
  } = useTransactions();

  const { categories } = useCategories();
  const currentBudgetPeriod = getCurrentBudgetPeriod();
  const {
    period: budgetPeriod,
    summary: budgetSummary,
    budgets,
    isLoading: isBudgetsLoading,
    isError: isBudgetsError,
    error: budgetsError,
    refetch: refetchBudgets
  } = useBudgets(currentBudgetPeriod);

  const [selectedDetailTx, setSelectedDetailTx] = useState<TransactionResponseDTO | null>(null);

  // Account & Category Fast Lookup Maps
  const accountMap = useMemo(
    () => new Map<string, AccountWithBalanceDTO>(accounts.map((a) => [a.id, a])),
    [accounts]
  );
  const cashAndBankSummary = useMemo(() => computeCashAndBankBalance(accounts), [accounts]);
  const categoryMap = useMemo(
    () => new Map<string, Category>(categories.map((c) => [c.id, c])),
    [categories]
  );

  // Derive current calendar month inflow and outflow
  // Excludes soft-deleted transactions and account transfers (which are cashflow neutral)
  const monthlyMetrics = useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    let inflowPaise = 0;
    let outflowPaise = 0;
    let inflowCount = 0;
    let outflowCount = 0;

    for (const tx of transactions) {
      if (tx.isDeleted) continue;

      const txDate = new Date(tx.transactionDate);
      if (isNaN(txDate.getTime())) continue;

      const isCurrentMonth =
        txDate.getFullYear() === currentYear && txDate.getMonth() === currentMonth;

      if (!isCurrentMonth) continue;

      if (tx.type === 'income') {
        inflowPaise += tx.amountPaise;
        inflowCount++;
      } else if (tx.type === 'expense') {
        outflowPaise += tx.amountPaise;
        outflowCount++;
      }
    }

    return {
      inflowPaise,
      inflowFormatted: formatPaiseToINR(inflowPaise),
      outflowPaise,
      outflowFormatted: formatPaiseToINR(outflowPaise),
      inflowCount,
      outflowCount,
      totalCount: inflowCount + outflowCount
    };
  }, [transactions]);

  // Top 5 most recent active transactions sorted by transaction date descending
  const recentTransactions = useMemo(() => {
    return transactions
      .filter((tx) => !tx.isDeleted)
      .sort((a, b) => new Date(b.transactionDate).getTime() - new Date(a.transactionDate).getTime())
      .slice(0, 5);
  }, [transactions]);

  const activeTransactionsCount = useMemo(
    () => transactions.filter((t) => !t.isDeleted).length,
    [transactions]
  );

  const personalBorrowingsAccount = useMemo(
    () =>
      accounts.find(
        (a) => a.name.trim().toLowerCase() === 'personal borrowings' && !a.isArchived
      ),
    [accounts]
  );

  const outstandingBorrowingsPaise = useMemo(() => {
    if (!personalBorrowingsAccount) return 0;
    return Math.abs(Math.min(0, personalBorrowingsAccount.currentBalancePaise));
  }, [personalBorrowingsAccount]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        description="Consolidated financial posture, account liquidity, and verified ledger activity."
        badge={
          <Badge variant="gold" size="sm" dot>
            Offline-Ready
          </Badge>
        }
        actions={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="primary"
              size="sm"
              leftIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
              onClick={() => navigate('/transactions')}
            >
              Add Transaction
            </Button>
          </div>
        }
      />

      {/* Top Posture Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Net Worth */}
        <Card variant="surface" className="space-y-2">
          <div className="flex items-center justify-between text-[#858078]">
            <span className="text-xs font-medium">Net Worth</span>
            <Wallet className="h-4 w-4 text-[#D6AD60]" />
          </div>
          <div className="space-y-0.5">
            {isAccountsLoading ? (
              <Skeleton className="h-8 w-28 my-0.5" />
            ) : (
              <div className="text-2xl font-bold font-tabular text-[#F5F1E8]">
                {accountsSummary.totalNetWorthFormatted}
              </div>
            )}
            <p className="text-[11px] text-[#858078]">
              {accountsSummary.activeAccountsCount > 0
                ? `Derived across ${accountsSummary.activeAccountsCount} active account${accountsSummary.activeAccountsCount > 1 ? 's' : ''}`
                : 'Derived across all active accounts'}
            </p>
          </div>
        </Card>

        {/* Monthly Inflow */}
        <Card variant="surface" className="space-y-2">
          <div className="flex items-center justify-between text-[#858078]">
            <span className="text-xs font-medium">Monthly Inflow</span>
            <ArrowUpRight className="h-4 w-4 text-[#72B895]" />
          </div>
          <div className="space-y-0.5">
            {isTransactionsLoading ? (
              <Skeleton className="h-8 w-24 my-0.5" />
            ) : (
              <div className="text-2xl font-bold font-tabular text-[#72B895]">
                {monthlyMetrics.inflowFormatted}
              </div>
            )}
            <p className="text-[11px] text-[#858078]">
              {monthlyMetrics.inflowCount > 0
                ? `${monthlyMetrics.inflowCount} income record${monthlyMetrics.inflowCount > 1 ? 's' : ''} this month`
                : 'Current billing period'}
            </p>
          </div>
        </Card>

        {/* Monthly Outflow */}
        <Card variant="surface" className="space-y-2">
          <div className="flex items-center justify-between text-[#858078]">
            <span className="text-xs font-medium">Monthly Outflow</span>
            <ArrowDownLeft className="h-4 w-4 text-[#D9827C]" />
          </div>
          <div className="space-y-0.5">
            {isTransactionsLoading ? (
              <Skeleton className="h-8 w-24 my-0.5" />
            ) : (
              <div className="text-2xl font-bold font-tabular text-[#D9827C]">
                {monthlyMetrics.outflowFormatted}
              </div>
            )}
            <p className="text-[11px] text-[#858078]">
              {monthlyMetrics.outflowCount} transaction{monthlyMetrics.outflowCount !== 1 ? 's' : ''} recorded
            </p>
          </div>
        </Card>

        {/* Cash & Bank Balance */}
        <Card variant="surface" className="space-y-2">
          <div className="flex items-center justify-between text-[#858078]">
            <span className="text-xs font-medium">Cash & Bank Balance</span>
            <Landmark className="h-4 w-4 text-[#82A9CF]" />
          </div>
          <div className="space-y-0.5">
            {isAccountsLoading ? (
              <Skeleton className="h-8 w-28 my-0.5" />
            ) : (
              <div className="text-2xl font-bold font-tabular text-[#F5F1E8]">
                {cashAndBankSummary.formattedBalance}
              </div>
            )}
            <p className="text-[11px] text-[#858078]">
              {cashAndBankSummary.accountCount > 0
                ? `Across ${cashAndBankSummary.accountCount} active cash & bank account${cashAndBankSummary.accountCount > 1 ? 's' : ''}`
                : 'No active cash or bank accounts'}
            </p>
          </div>
        </Card>
      </div>

      {/* Budget Intelligence & Category Insights */}
      <DashboardBudgetSection
        period={budgetPeriod}
        summary={budgetSummary}
        budgets={budgets}
        isLoading={isBudgetsLoading}
        isError={isBudgetsError}
        error={budgetsError}
        onRetry={() => refetchBudgets()}
        onNavigateToBudgets={() => navigate('/budgets')}
      />

      {/* Main Grid: Recent Transactions & Architecture Status */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-[#F5F1E8] font-display uppercase tracking-wider">
              Recent Transactions
            </h2>
            <Link
              to="/transactions"
              className="text-xs text-[#D6AD60] hover:underline rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D6AD60]"
            >
              View all
            </Link>
          </div>

          {isTransactionsLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Card key={i} variant="surface" className="p-3.5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-9 w-9 rounded-full" />
                    <div className="space-y-1.5">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-20" />
                    </div>
                  </div>
                  <Skeleton className="h-4 w-16" />
                </Card>
              ))}
            </div>
          ) : recentTransactions.length === 0 ? (
            <EmptyState
              icon={LayoutDashboard}
              title="No transactions logged yet"
              description="Your ledger is empty. Click Quick Add or press Ctrl+K to log your first income, expense, or account transfer."
              actionLabel="View Transactions"
              onAction={() => navigate('/transactions')}
            />
          ) : (
            <Card variant="surface" className="divide-y divide-[#303030]/60 p-0 overflow-hidden">
              {recentTransactions.map((tx) => {
                const isIncome = tx.type === 'income';
                const isExpense = tx.type === 'expense';
                const isTransfer = tx.type === 'transfer';
                const isPending = pendingTxIdSet.has(tx.id);

                const category = tx.categoryId ? categoryMap.get(tx.categoryId) : undefined;
                const sourceAccount = accountMap.get(tx.accountId);
                const destAccount = tx.destinationAccountId
                  ? accountMap.get(tx.destinationAccountId)
                  : undefined;

                const amountColor = isIncome
                  ? 'text-[#72B895]'
                  : isExpense
                  ? 'text-[#D9827C]'
                  : 'text-[#82A9CF]';

                const amountSign = isIncome ? '+' : isExpense ? '-' : '';

                return (
                  <button
                    key={tx.id}
                    type="button"
                    onClick={() => setSelectedDetailTx(tx)}
                    className="w-full text-left p-3.5 flex items-center justify-between hover:bg-[#202020]/60 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#D6AD60]"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        aria-hidden="true"
                        className={cn(
                          'h-9 w-9 rounded-full flex items-center justify-center shrink-0',
                          isIncome
                            ? 'bg-[#72B895]/10 text-[#72B895]'
                            : isExpense
                            ? 'bg-[#D9827C]/10 text-[#D9827C]'
                            : 'bg-[#82A9CF]/10 text-[#82A9CF]'
                        )}
                      >
                        {isTransfer ? (
                          <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <CategoryIcon
                            name={category?.icon}
                            className="h-4 w-4"
                            color={category?.color}
                          />
                        )}
                      </div>

                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-[#F5F1E8] truncate">
                            {tx.title}
                          </span>
                          {isPending ? (
                            <Badge variant="warning" size="sm" dot>
                              Saved Locally
                            </Badge>
                          ) : (
                            <Badge variant="neutral" size="sm" dot>
                              Synced
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-[#858078] truncate">
                          {isTransfer ? (
                            <>
                              <span>{sourceAccount?.name || 'Account'}</span>
                              <span aria-hidden="true">→</span>
                              <span>{destAccount?.name || 'Account'}</span>
                            </>
                          ) : (
                            <>
                              <span>
                                {category?.name || (isIncome ? 'Income' : 'Expense')}
                              </span>
                              <span aria-hidden="true">•</span>
                              <span>{sourceAccount?.name || 'Account'}</span>
                            </>
                          )}
                          <span aria-hidden="true">•</span>
                          <span>{formatDate(tx.transactionDate, 'dd MMM yyyy')}</span>
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0 pl-3">
                      <span className={cn('font-bold font-tabular text-sm', amountColor)}>
                        {amountSign}
                        {tx.amountFormatted}
                      </span>
                    </div>
                  </button>
                );
              })}
            </Card>
          )}
        </div>

        {/* Architecture & Ledger Status */}
        <div className="space-y-4">
          {/* Outstanding Personal Borrowings Banner */}
          {outstandingBorrowingsPaise > 0 && (
            <Card variant="surface" className="p-4 bg-[#161616] border-[#D6AD60]/30 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <HandCoins className="h-4 w-4 text-[#D6AD60]" />
                  <span className="text-xs font-semibold text-[#F5F1E8]">Personal Borrowings</span>
                </div>
                <Link to="/borrowings" className="text-xs text-[#D6AD60] hover:underline">
                  Manage
                </Link>
              </div>
              <div>
                <p className="text-xl font-bold font-tabular text-[#D6AD60]">
                  {formatPaiseToINR(outstandingBorrowingsPaise)}
                </p>
                <p className="text-[11px] text-[#858078] mt-0.5">
                  Factored into liabilities and current net worth
                </p>
              </div>
            </Card>
          )}

          <h2 className="text-sm font-bold text-[#F5F1E8] font-display uppercase tracking-wider">
            Architecture Status
          </h2>
          <Card variant="elevated" className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#D6AD60]">
              <Sparkles className="h-4 w-4" />
              <span>Obsidian Gold Shell Ready</span>
            </div>
            <p className="text-xs text-[#B9B4AA] leading-relaxed">
              Design tokens, desktop collapsible sidebar, mobile bottom navigation, command palette, and quick-add modals are initialized.
            </p>
            <div className="space-y-2 pt-2 border-t border-[#303030]/60 text-xs">
              <div className="flex justify-between text-[#858078]">
                <span>Active Accounts:</span>
                <span className="text-[#F5F1E8] font-medium font-tabular">
                  {accountsSummary.activeAccountsCount}
                </span>
              </div>
              <div className="flex justify-between text-[#858078]">
                <span>Total Transactions:</span>
                <span className="text-[#F5F1E8] font-medium font-tabular">
                  {activeTransactionsCount}
                </span>
              </div>
              <div className="flex justify-between text-[#858078]">
                <span>Monetary Precision:</span>
                <span className="text-[#F5F1E8] font-medium font-tabular">Integer Paise (₹)</span>
              </div>
              <div className="flex justify-between text-[#858078]">
                <span>Cloud Source:</span>
                <span className="text-[#F5F1E8] font-medium">Supabase PG</span>
              </div>
              <div className="flex justify-between text-[#858078]">
                <span>Local Store:</span>
                <span className="text-[#F5F1E8] font-medium">Dexie 4.x</span>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Transaction Detail Modal */}
      <TransactionDetailModal
        isOpen={!!selectedDetailTx}
        onClose={() => setSelectedDetailTx(null)}
        transaction={selectedDetailTx}
        accounts={accounts}
        categories={categories}
        isPendingSync={selectedDetailTx ? pendingTxIdSet.has(selectedDetailTx.id) : false}
        onEdit={() => {
          setSelectedDetailTx(null);
          navigate('/transactions');
        }}
        onDelete={() => {
          setSelectedDetailTx(null);
          navigate('/transactions');
        }}
      />
    </div>
  );
};

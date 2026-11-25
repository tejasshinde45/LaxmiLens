import React, { useMemo, useState } from 'react';
import {
  PiggyBank,
  Plus,
  RefreshCw,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Calendar
} from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/feedback/EmptyState';
import { BUDGET_PERIOD_REGEX } from '@/domain/entities/Budget';
import { BudgetOverviewItemDTO } from '@/application/dto/BudgetDTO';
import { useCategories } from '@/features/categories/hooks/useCategories';
import { useAccountSync } from '@/features/accounts/hooks/useAccountSync';
import { cn } from '@/utils/cn';
import { useBudgets } from './hooks/useBudgets';
import {
  CreateBudgetFormValues,
  EditBudgetFormValues,
  formatBudgetPeriodLabel,
  getCurrentBudgetPeriod,
  shiftBudgetPeriod
} from './schemas/budgetSchemas';
import { BudgetSummaryMetrics } from './components/BudgetSummaryMetrics';
import { BudgetCard } from './components/BudgetCard';
import { CreateBudgetModal } from './components/CreateBudgetModal';
import { EditBudgetModal } from './components/EditBudgetModal';
import { DeleteBudgetModal } from './components/DeleteBudgetModal';

export const BudgetsPage: React.FC = () => {
  const currentMonthPeriod = getCurrentBudgetPeriod();
  const [selectedPeriod, setSelectedPeriod] = useState<string>(currentMonthPeriod);

  const {
    period,
    summary,
    budgets,
    pendingBudgetIdSet,
    isLoading,
    isError,
    error,
    refetch,
    createBudget,
    isCreating,
    updateBudget,
    isUpdating,
    deleteBudget,
    isDeleting
  } = useBudgets(selectedPeriod);

  const { categories, isLoading: isCategoriesLoading } = useCategories();
  const { syncNow, isSyncing, pendingCount, isAuthenticated } = useAccountSync();

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [budgetToEdit, setBudgetToEdit] = useState<BudgetOverviewItemDTO | null>(null);
  const [budgetToDelete, setBudgetToDelete] = useState<BudgetOverviewItemDTO | null>(null);

  const existingCategoryIds = useMemo(
    () => budgets.map((b) => b.categoryId),
    [budgets]
  );

  const periodLabel = useMemo(() => formatBudgetPeriodLabel(period), [period]);

  const handlePeriodInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (BUDGET_PERIOD_REGEX.test(val)) {
      setSelectedPeriod(val);
    }
  };

  const handleCreateSubmit = async (values: CreateBudgetFormValues) => {
    await createBudget(values);
  };

  const handleEditSubmit = async (values: EditBudgetFormValues) => {
    await updateBudget(values);
  };

  const handleDeleteConfirm = async (budgetId: string) => {
    await deleteBudget(budgetId);
  };

  const showLoadingSkeleton = isLoading || isCategoriesLoading;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        title="Budgets"
        description="Category spending caps and burn-rate tracking to keep monthly outflows disciplined."
        badge={
          <Badge variant="gold" size="sm">
            {periodLabel}
          </Badge>
        }
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            {isAuthenticated && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => syncNow()}
                disabled={isSyncing}
                title="Synchronize local budget and ledger updates with Supabase cloud"
              >
                <RefreshCw
                  className={cn('h-3.5 w-3.5 mr-1.5', isSyncing && 'animate-spin text-[#D6AD60]')}
                />
                {isSyncing ? 'Syncing...' : 'Sync Cloud'}
                {pendingCount > 0 && !isSyncing && (
                  <Badge variant="gold" size="sm" className="ml-1.5 px-1.5 py-0">
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
              Create Budget
            </Button>
          </div>
        }
      />

      {/* Calendar Month Selector Strip */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-[#303030] bg-[#161616] px-4 py-3">
        <div className="flex items-center gap-2 text-xs text-[#B9B4AA]">
          <Calendar className="h-4 w-4 text-[#D6AD60]" />
          <span className="font-medium">Budget Period:</span>
          <span className="font-semibold text-[#F5F1E8]">{periodLabel}</span>
          {period !== currentMonthPeriod && (
            <Button
              type="button"
              variant="gold-subtle"
              size="sm"
              className="h-6 px-2 text-[11px]"
              onClick={() => setSelectedPeriod(currentMonthPeriod)}
            >
              Current Month
            </Button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Previous month"
            onClick={() => setSelectedPeriod((p) => shiftBudgetPeriod(p, -1))}
            className="h-8 w-8 p-0"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <input
            type="month"
            aria-label="Select budget month"
            value={period}
            onChange={handlePeriodInputChange}
            className="h-8 rounded-[8px] border border-[#303030] bg-[#1B1B1B] px-2.5 text-xs text-[#F5F1E8] focus-visible:outline-none focus-visible:border-[#D6AD60]"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Next month"
            onClick={() => setSelectedPeriod((p) => shiftBudgetPeriod(p, 1))}
            className="h-8 w-8 p-0"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Main Content States: Loading -> Error -> Empty -> Overview & Cards */}
      {showLoadingSkeleton ? (
        <div className="space-y-6" aria-label="Loading budgets">
          <BudgetSummaryMetrics summary={summary} isLoading />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <Card key={i} variant="surface" className="p-5 space-y-4">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-10 w-10 rounded-[10px]" />
                  <div className="space-y-1.5 flex-1">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                </div>
                <Skeleton className="h-2 w-full rounded-full" />
                <div className="flex justify-between pt-2">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </Card>
            ))}
          </div>
        </div>
      ) : isError ? (
        <Card variant="surface" className="p-8 text-center border-[#D9827C]/30 bg-[#1B1B1B]">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[#D9827C]/10 text-[#D9827C] mb-4">
            <AlertCircle className="h-6 w-6" />
          </div>
          <h3 className="text-base font-semibold text-[#F5F1E8] mb-1">
            Failed to Load Budgets
          </h3>
          <p className="text-sm text-[#858078] max-w-md mx-auto mb-5">
            {error instanceof Error
              ? error.message
              : 'An unexpected error occurred while loading monthly budgets.'}
          </p>
          <Button variant="secondary" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </Card>
      ) : budgets.length === 0 ? (
        <EmptyState
          icon={PiggyBank}
          title={`No budgets for ${periodLabel}`}
          description="Create your first monthly budget to set spending limits by expense category, monitor real-time utilization, and spot threshold warnings early."
          actionLabel="Create Budget"
          onAction={() => setIsCreateModalOpen(true)}
        />
      ) : (
        <div className="space-y-6">
          <BudgetSummaryMetrics summary={summary} />

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {budgets.map((budget) => (
              <BudgetCard
                key={budget.budgetId}
                budget={budget}
                isPendingSync={pendingBudgetIdSet.has(budget.budgetId)}
                onEdit={setBudgetToEdit}
                onDelete={setBudgetToDelete}
              />
            ))}
          </div>
        </div>
      )}

      {/* Modals */}
      <CreateBudgetModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        period={period}
        categories={categories}
        existingCategoryIds={existingCategoryIds}
        onSubmit={handleCreateSubmit}
        isLoading={isCreating}
      />

      <EditBudgetModal
        isOpen={!!budgetToEdit}
        onClose={() => setBudgetToEdit(null)}
        budget={budgetToEdit}
        onSubmit={handleEditSubmit}
        isLoading={isUpdating}
      />

      <DeleteBudgetModal
        isOpen={!!budgetToDelete}
        onClose={() => setBudgetToDelete(null)}
        budget={budgetToDelete}
        onConfirmDelete={handleDeleteConfirm}
        isLoading={isDeleting}
      />
    </div>
  );
};

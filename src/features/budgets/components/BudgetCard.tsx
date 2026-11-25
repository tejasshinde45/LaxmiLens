import React from 'react';
import { Edit2, Trash2, Clock } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { CategoryIcon } from '@/features/categories/components/CategoryIcon';
import { BudgetOverviewItemDTO } from '@/application/dto/BudgetDTO';
import { formatPaiseToINR } from '@/utils/formatters';
import { cn } from '@/utils/cn';
import { getBudgetUtilizationStatus } from '../hooks/useBudgets';

export interface BudgetCardProps {
  budget: BudgetOverviewItemDTO;
  isPendingSync?: boolean;
  onEdit: (budget: BudgetOverviewItemDTO) => void;
  onDelete: (budget: BudgetOverviewItemDTO) => void;
}

export const BudgetCard: React.FC<BudgetCardProps> = ({
  budget,
  isPendingSync = false,
  onEdit,
  onDelete
}) => {
  const status = getBudgetUtilizationStatus(budget.utilizationPercentage, budget.isExceeded);
  const accentColor = budget.categoryColor || '#D6AD60';
  const clampedWidth = Math.min(100, Math.max(0, budget.utilizationPercentage));
  const overspentPaise =
    budget.spentPaise > budget.limitPaise ? budget.spentPaise - budget.limitPaise : 0;

  const statusConfig = {
    normal: {
      label: 'Normal',
      badgeVariant: 'income' as const,
      barClass: 'bg-[#72B895]',
      textClass: 'text-[#72B895]'
    },
    warning: {
      label: 'Warning',
      badgeVariant: 'warning' as const,
      barClass: 'bg-[#E4B66D]',
      textClass: 'text-[#E4B66D]'
    },
    exceeded: {
      label: 'Exceeded',
      badgeVariant: 'expense' as const,
      barClass: 'bg-[#D9827C]',
      textClass: 'text-[#D9827C]'
    }
  }[status];

  return (
    <Card
      variant="surface"
      className={cn(
        'p-5 bg-[#1B1B1B] border-[#303030] flex flex-col justify-between gap-4 transition-colors hover:border-[#454545]',
        status === 'exceeded' && 'border-[#D9827C]/35',
        status === 'warning' && 'border-[#E4B66D]/30'
      )}
    >
      {/* Header: Category icon, name, badges, and status */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px]"
            style={{
              backgroundColor: `${accentColor}1A`,
              border: `1px solid ${accentColor}38`
            }}
          >
            <CategoryIcon
              name={budget.categoryIcon}
              color={accentColor}
              className="h-5 w-5"
            />
          </div>

          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[#F5F1E8] truncate font-display">
              {budget.categoryName}
            </h3>
            <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
              {budget.categoryIsArchived && (
                <Badge variant="outline" size="sm" className="text-[10px] px-1.5 py-0">
                  Archived
                </Badge>
              )}
              {isPendingSync && (
                <Badge variant="gold" size="sm" className="text-[10px] px-1.5 py-0">
                  <Clock className="h-2.5 w-2.5 mr-0.5" />
                  Pending Sync
                </Badge>
              )}
            </div>
          </div>
        </div>

        <Badge variant={statusConfig.badgeVariant} size="sm" dot>
          {statusConfig.label}
        </Badge>
      </div>

      {/* Utilization & Progress Bar */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <div>
            <span className="text-xs text-[#858078]">Spent </span>
            <span className="text-sm font-bold font-tabular text-[#F5F1E8]">
              {budget.spentFormatted}
            </span>
            <span className="text-xs text-[#858078] font-tabular">
              {' '}
              of {budget.limitFormatted}
            </span>
          </div>
          <span className={cn('text-sm font-bold font-tabular', statusConfig.textClass)}>
            {budget.utilizationPercentage}%
          </span>
        </div>

        <div
          role="progressbar"
          aria-label={`${budget.categoryName} budget utilization`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={budget.utilizationPercentage}
          className="h-2 w-full rounded-full bg-[#242424] overflow-hidden border border-[#303030]/60"
        >
          <div
            className={cn('h-full rounded-full transition-all duration-300', statusConfig.barClass)}
            style={{ width: `${clampedWidth}%` }}
          />
        </div>

        <div className="flex items-center justify-between text-xs pt-0.5">
          <span className="text-[#858078]">
            {overspentPaise > 0 ? 'Over budget by' : 'Remaining'}
          </span>
          <span
            className={cn(
              'font-semibold font-tabular',
              overspentPaise > 0 ? 'text-[#D9827C]' : 'text-[#72B895]'
            )}
          >
            {overspentPaise > 0 ? formatPaiseToINR(overspentPaise) : budget.remainingFormatted}
          </span>
        </div>
      </div>

      {/* Footer Actions */}
      <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#303030]/70">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`Edit ${budget.categoryName} budget`}
          leftIcon={<Edit2 className="h-3.5 w-3.5" />}
          onClick={() => onEdit(budget)}
        >
          Edit
        </Button>
        <Button
          type="button"
          variant="danger"
          size="sm"
          aria-label={`Delete ${budget.categoryName} budget`}
          leftIcon={<Trash2 className="h-3.5 w-3.5" />}
          onClick={() => onDelete(budget)}
        >
          Delete
        </Button>
      </div>
    </Card>
  );
};

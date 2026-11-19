import { PiggyBank, Plus } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/feedback/EmptyState';

export const BudgetsPage: React.FC = () => {
  const currentMonth = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(new Date());

  return (
    <div className="space-y-6">
      <PageHeader
        title="Budgets"
        description="Category spending caps and burn-rate tracking to keep monthly outflows disciplined."
        badge={
          <Badge variant="gold" size="sm">
            {currentMonth}
          </Badge>
        }
        actions={
          <Button variant="primary" size="sm" leftIcon={<Plus className="h-4 w-4" />}>
            New Budget
          </Button>
        }
      />

      <EmptyState
        icon={PiggyBank}
        title="No active category budgets"
        description="Set monthly spending thresholds for groceries, dining, utilities, and lifestyle categories to receive proactive burn-rate alerts."
        actionLabel="Configure Monthly Budget"
        onAction={() => {}}
      />
    </div>
  );
};

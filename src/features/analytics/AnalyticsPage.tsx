import { PieChart, TrendingUp, BarChart3 } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/feedback/EmptyState';

export const AnalyticsPage: React.FC = () => {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        description="Comprehensive spending analysis, category distributions, and historical cashflow trajectories."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card variant="surface" className="space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-[#F5F1E8]">
            <TrendingUp className="h-4 w-4 text-[#D6AD60]" />
            <span>Monthly Cashflow Trajectory</span>
          </div>
          <div className="flex h-56 items-center justify-center rounded-[10px] border border-dashed border-[#303030] bg-[#101010]/60 p-6 text-center">
            <p className="text-xs text-[#858078] max-w-xs">
              Trajectory graphs will plot income vs expense inflows and net monthly savings as transactions are committed.
            </p>
          </div>
        </Card>

        <Card variant="surface" className="space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-[#F5F1E8]">
            <BarChart3 className="h-4 w-4 text-[#82A9CF]" />
            <span>Category Spending Breakdown</span>
          </div>
          <div className="flex h-56 items-center justify-center rounded-[10px] border border-dashed border-[#303030] bg-[#101010]/60 p-6 text-center">
            <p className="text-xs text-[#858078] max-w-xs">
              Radial category distribution chart will render once transactions are assigned to food, rent, and utility categories.
            </p>
          </div>
        </Card>
      </div>

      <EmptyState
        icon={PieChart}
        title="Insufficient data for deep analysis"
        description="Analytics require at least one verified ledger cycle to generate accurate trends, averages, and forecasting models."
      />
    </div>
  );
};

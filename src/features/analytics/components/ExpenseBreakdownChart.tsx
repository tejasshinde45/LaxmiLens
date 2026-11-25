import React from 'react';
import {
  ResponsiveContainer,
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  Tooltip
} from 'recharts';
import { PieChart } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { CategoryIcon } from '@/features/categories/components/CategoryIcon';
import { ExpenseCategoryBreakdownItem } from '@/application/services/FinancialAnalyticsService';

export interface ExpenseBreakdownChartProps {
  breakdown: ExpenseCategoryBreakdownItem[];
  totalExpenseFormatted: string;
}

const BreakdownTooltip: React.FC<{
  active?: boolean;
  payload?: Array<{ payload: ExpenseCategoryBreakdownItem }>;
}> = ({ active, payload }) => {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0].payload;

  return (
    <div className="rounded-[10px] border border-[#303030] bg-[#161616] p-3 text-xs shadow-xl shadow-black/60 space-y-1">
      <p className="font-semibold text-[#F5F1E8]">{item.categoryName}</p>
      <p className="font-bold font-tabular text-[#D9827C]">{item.totalFormatted}</p>
      <p className="text-[#858078]">
        {item.percentageOfExpenses}% of expenses ({item.transactionCount} txn
        {item.transactionCount === 1 ? '' : 's'})
      </p>
    </div>
  );
};

export const ExpenseBreakdownChart: React.FC<ExpenseBreakdownChartProps> = ({
  breakdown,
  totalExpenseFormatted
}) => {
  return (
    <Card variant="surface" className="p-5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <PieChart className="h-4 w-4 text-[#82A9CF]" />
          <h2 className="text-sm font-semibold text-[#F5F1E8] font-display">
            Expense Breakdown
          </h2>
        </div>
        {breakdown.length > 0 && (
          <span className="text-xs font-tabular font-semibold text-[#D9827C]">
            {totalExpenseFormatted}
          </span>
        )}
      </div>

      {breakdown.length === 0 ? (
        <div className="flex h-64 items-center justify-center rounded-[10px] border border-dashed border-[#303030] bg-[#101010]/60 p-6 text-center">
          <p className="text-xs text-[#858078] max-w-xs">
            No categorized or uncategorized expense transactions recorded in this date range.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-center">
          {/* Donut Chart */}
          <div
            className="md:col-span-2 h-56 w-full"
            role="img"
            aria-label="Category-wise expense breakdown chart"
          >
            <ResponsiveContainer
              width="100%"
              height="100%"
              initialDimension={{ width: 220, height: 224 }}
            >
              <RechartsPieChart>
                <Pie
                  data={breakdown}
                  dataKey="totalPaise"
                  nameKey="categoryName"
                  cx="50%"
                  cy="50%"
                  innerRadius={52}
                  outerRadius={82}
                  paddingAngle={2}
                  stroke="#1B1B1B"
                  strokeWidth={2}
                >
                  {breakdown.map((entry) => (
                    <Cell key={entry.categoryId} fill={entry.categoryColor} />
                  ))}
                </Pie>
                <Tooltip content={<BreakdownTooltip />} />
              </RechartsPieChart>
            </ResponsiveContainer>
          </div>

          {/* Ranked Category List */}
          <div className="md:col-span-3 space-y-2.5 max-h-60 overflow-y-auto pr-1">
            {breakdown.map((item) => (
              <div key={item.categoryId} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px]"
                      style={{
                        backgroundColor: `${item.categoryColor}1A`,
                        border: `1px solid ${item.categoryColor}40`
                      }}
                    >
                      <CategoryIcon
                        name={item.categoryIcon}
                        color={item.categoryColor}
                        className="h-3.5 w-3.5"
                      />
                    </span>
                    <span className="font-medium text-[#F5F1E8] truncate">
                      {item.categoryName}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 font-tabular">
                    <span className="font-semibold text-[#F5F1E8]">{item.totalFormatted}</span>
                    <span className="text-[#858078] w-11 text-right">
                      {item.percentageOfExpenses}%
                    </span>
                  </div>
                </div>

                <div className="h-1.5 w-full rounded-full bg-[#242424] overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(100, Math.max(0, item.percentageOfExpenses))}%`,
                      backgroundColor: item.categoryColor
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
};

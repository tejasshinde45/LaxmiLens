import React from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip
} from 'recharts';
import { TrendingUp } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { AnalyticsTrendPoint } from '@/application/services/FinancialAnalyticsService';
import { formatPaiseToINR } from '@/utils/formatters';

export interface IncomeExpenseTrendChartProps {
  data: AnalyticsTrendPoint[];
  hasData: boolean;
  granularity: 'daily' | 'monthly';
}

const TrendTooltip: React.FC<{
  active?: boolean;
  payload?: Array<{ payload: AnalyticsTrendPoint }>;
}> = ({ active, payload }) => {
  if (!active || !payload || payload.length === 0) return null;
  const pt = payload[0].payload;

  return (
    <div className="rounded-[10px] border border-[#303030] bg-[#161616] p-3 text-xs shadow-xl shadow-black/60 space-y-1.5">
      <p className="font-semibold text-[#F5F1E8]">{pt.label}</p>
      <div className="flex items-center justify-between gap-4">
        <span className="text-[#72B895]">Income:</span>
        <span className="font-bold font-tabular text-[#72B895]">{pt.incomeFormatted}</span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-[#D9827C]">Expenses:</span>
        <span className="font-bold font-tabular text-[#D9827C]">{pt.expenseFormatted}</span>
      </div>
      <div className="flex items-center justify-between gap-4 pt-1 border-t border-[#303030]/60">
        <span className="text-[#858078]">Net:</span>
        <span className="font-semibold font-tabular text-[#F5F1E8]">
          {formatPaiseToINR(pt.netPaise)}
        </span>
      </div>
    </div>
  );
};

export const IncomeExpenseTrendChart: React.FC<IncomeExpenseTrendChartProps> = ({
  data,
  hasData,
  granularity
}) => {
  return (
    <Card variant="surface" className="p-5 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-[#D6AD60]" />
          <h2 className="text-sm font-semibold text-[#F5F1E8] font-display">
            Income vs Expense Trends
          </h2>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="neutral" size="sm">
            {granularity === 'daily' ? 'Daily' : 'Monthly'}
          </Badge>
          <span className="inline-flex items-center gap-1 text-[11px] text-[#72B895]">
            <span className="h-2 w-2 rounded-full bg-[#72B895]" aria-hidden="true" />
            Income
          </span>
          <span className="inline-flex items-center gap-1 text-[11px] text-[#D9827C]">
            <span className="h-2 w-2 rounded-full bg-[#D9827C]" aria-hidden="true" />
            Expenses
          </span>
        </div>
      </div>

      {!hasData ? (
        <div className="flex h-64 items-center justify-center rounded-[10px] border border-dashed border-[#303030] bg-[#101010]/60 p-6 text-center">
          <p className="text-xs text-[#858078] max-w-xs">
            No income or expense transactions recorded in this date range to plot trends.
          </p>
        </div>
      ) : (
        <div
          className="h-64 w-full"
          role="img"
          aria-label={`Income versus expenses ${granularity} chart`}
        >
          <ResponsiveContainer
            width="100%"
            height="100%"
            initialDimension={{ width: 520, height: 256 }}
          >
            <BarChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#303030" vertical={false} />
              <XAxis
                dataKey="label"
                stroke="#858078"
                fontSize={11}
                tickLine={false}
                axisLine={{ stroke: '#303030' }}
                minTickGap={16}
              />
              <YAxis
                stroke="#858078"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                width={72}
                tickFormatter={(val: number) =>
                  formatPaiseToINR(Math.round(val * 100), { showDecimals: false })
                }
              />
              <Tooltip content={<TrendTooltip />} cursor={{ fill: '#242424', opacity: 0.45 }} />
              <Bar
                dataKey="incomeRupees"
                name="Income"
                fill="#72B895"
                radius={[4, 4, 0, 0]}
                maxBarSize={32}
              />
              <Bar
                dataKey="expenseRupees"
                name="Expenses"
                fill="#D9827C"
                radius={[4, 4, 0, 0]}
                maxBarSize={32}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
};

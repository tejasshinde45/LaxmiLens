import React from 'react';
import { Calendar, AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import {
  AnalyticsDatePreset,
  CustomDateRangeInput
} from '@/application/services/FinancialAnalyticsService';
import { cn } from '@/utils/cn';

export interface AnalyticsFiltersProps {
  preset: AnalyticsDatePreset;
  onPresetChange: (preset: AnalyticsDatePreset) => void;
  customRange: CustomDateRangeInput;
  onCustomRangeChange: (next: CustomDateRangeInput) => void;
  periodLabel?: string;
  startInput?: string;
  endInput?: string;
  dateRangeError?: string | null;
}

const PRESET_OPTIONS: ReadonlyArray<{ id: AnalyticsDatePreset; label: string }> = [
  { id: 'this_month', label: 'This Month' },
  { id: 'last_month', label: 'Last Month' },
  { id: 'last_3_months', label: 'Last 3 Months' },
  { id: 'last_6_months', label: 'Last 6 Months' },
  { id: 'this_year', label: 'This Year' },
  { id: 'all_time', label: 'All Time' },
  { id: 'custom', label: 'Custom Date Range' }
];

export const AnalyticsFilters: React.FC<AnalyticsFiltersProps> = ({
  preset,
  onPresetChange,
  customRange,
  onCustomRangeChange,
  periodLabel,
  startInput,
  endInput,
  dateRangeError
}) => {
  return (
    <div className="rounded-xl border border-[#303030] bg-[#161616] p-4 space-y-3">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Analytics date range presets"
          className="flex items-center gap-1.5 flex-wrap"
        >
          {PRESET_OPTIONS.map((option) => {
            const isActive = preset === option.id;
            return (
              <button
                key={option.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onPresetChange(option.id)}
                className={cn(
                  'px-3 py-1.5 rounded-[8px] text-xs font-medium transition-colors cursor-pointer',
                  isActive
                    ? 'bg-[#D6AD60] text-[#101010] font-semibold shadow-sm'
                    : 'bg-[#1B1B1B] text-[#B9B4AA] border border-[#303030] hover:text-[#F5F1E8] hover:border-[#454545]'
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        {periodLabel && (
          <div className="flex items-center gap-2 shrink-0 text-xs text-[#858078]">
            <Calendar className="h-3.5 w-3.5 text-[#D6AD60]" />
            <Badge variant="gold" size="sm">
              {periodLabel}
            </Badge>
            {startInput && endInput && preset !== 'this_month' && preset !== 'last_month' && (
              <span className="font-tabular text-[11px]">
                ({startInput} to {endInput})
              </span>
            )}
          </div>
        )}
      </div>

      {preset === 'custom' && (
        <div className="pt-3 border-t border-[#303030]/60 flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="space-y-1">
            <label htmlFor="analytics-start-date" className="block text-xs font-medium text-[#B9B4AA]">
              From Date
            </label>
            <input
              id="analytics-start-date"
              type="date"
              value={customRange.startDate}
              onChange={(e) =>
                onCustomRangeChange({ ...customRange, startDate: e.target.value })
              }
              className="h-9 rounded-[8px] border border-[#303030] bg-[#1B1B1B] px-3 text-xs text-[#F5F1E8] focus-visible:outline-none focus-visible:border-[#D6AD60]"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="analytics-end-date" className="block text-xs font-medium text-[#B9B4AA]">
              To Date
            </label>
            <input
              id="analytics-end-date"
              type="date"
              value={customRange.endDate}
              onChange={(e) =>
                onCustomRangeChange({ ...customRange, endDate: e.target.value })
              }
              className="h-9 rounded-[8px] border border-[#303030] bg-[#1B1B1B] px-3 text-xs text-[#F5F1E8] focus-visible:outline-none focus-visible:border-[#D6AD60]"
            />
          </div>

          {dateRangeError && (
            <div
              role="alert"
              className="flex items-center gap-1.5 text-xs text-[#D9827C] pb-1.5"
            >
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{dateRangeError}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

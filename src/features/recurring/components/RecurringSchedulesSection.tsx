import React from 'react';
import { Edit2, PauseCircle, PlayCircle, Trash2, Calendar, Repeat } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/feedback/EmptyState';
import { RecurringRuleResponseDTO } from '@/application/dto/RecurringDTO';
import { formatFrequencyLabel, formatLocalDateDisplay } from '../schemas/recurringSchemas';
import { cn } from '@/utils/cn';

export interface RecurringSchedulesSectionProps {
  schedules: RecurringRuleResponseDTO[];
  pendingRecurringIdSet: Set<string>;
  onEdit: (schedule: RecurringRuleResponseDTO) => void;
  onPause: (id: string) => Promise<unknown>;
  onResume: (id: string) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
  onCreate: () => void;
}

export const RecurringSchedulesSection: React.FC<RecurringSchedulesSectionProps> = ({
  schedules,
  pendingRecurringIdSet,
  onEdit,
  onPause,
  onResume,
  onDelete,
  onCreate
}) => {
  if (schedules.length === 0) {
    return (
      <EmptyState
        icon={Repeat}
        title="No recurring schedules defined"
        description="Set up recurring expenses or income streams like rent, EMIs, SIPs, utilities, or salary."
        actionLabel="Create First Schedule"
        onAction={onCreate}
      />
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {schedules.map((rule) => {
        const isPendingSync = pendingRecurringIdSet.has(rule.id);
        const statusBadgeVariant =
          rule.status === 'active'
            ? 'income'
            : rule.status === 'paused'
            ? 'warning'
            : 'outline';

        return (
          <Card key={rule.id} variant="surface" className="p-4 flex flex-col justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="text-sm font-semibold text-[#F5F1E8] truncate">
                      {rule.title}
                    </h4>
                    <Badge variant={statusBadgeVariant} size="sm" className="capitalize">
                      {rule.status}
                    </Badge>
                    {isPendingSync && (
                      <Badge variant="warning" size="sm">
                        Pending sync
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-[#858078]">
                    {formatFrequencyLabel(rule.frequency, rule.interval)} · {rule.accountName}
                    {rule.categoryName ? ` · ${rule.categoryName}` : ''}
                  </p>
                </div>

                <span
                  className={cn(
                    'text-base font-bold font-tabular shrink-0',
                    rule.type === 'income' ? 'text-[#72B895]' : 'text-[#F5F1E8]'
                  )}
                >
                  {rule.type === 'income' ? '+' : '-'}
                  {rule.amountFormatted}
                </span>
              </div>

              {rule.description && (
                <p className="text-xs text-[#B9B4AA] line-clamp-2">{rule.description}</p>
              )}

              <div className="flex items-center gap-4 text-[11px] text-[#858078] flex-wrap pt-1">
                <span className="inline-flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5 text-[#D6AD60]" />
                  Next Due: <strong className="text-[#F5F1E8]">{formatLocalDateDisplay(rule.nextDueDate)}</strong>
                </span>
                {rule.lastGeneratedDate && (
                  <span>Last Recorded: {formatLocalDateDisplay(rule.lastGeneratedDate)}</span>
                )}
              </div>

              {rule.previewDates.length > 0 && rule.status === 'active' && (
                <div className="flex items-center gap-1.5 flex-wrap pt-1">
                  <span className="text-[10px] text-[#858078] uppercase tracking-wider">
                    Next cycles:
                  </span>
                  {rule.previewDates.slice(0, 3).map((d) => (
                    <Badge key={d} variant="outline" size="sm" className="text-[10px]">
                      {formatLocalDateDisplay(d)}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#303030]/60">
              {rule.status === 'active' && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  leftIcon={<PauseCircle className="h-3.5 w-3.5" />}
                  onClick={() => void onPause(rule.id)}
                >
                  Pause
                </Button>
              )}
              {rule.status === 'paused' && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  leftIcon={<PlayCircle className="h-3.5 w-3.5 text-[#72B895]" />}
                  onClick={() => void onResume(rule.id)}
                >
                  Resume
                </Button>
              )}
              {rule.status !== 'completed' && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  leftIcon={<Edit2 className="h-3.5 w-3.5" />}
                  onClick={() => onEdit(rule)}
                >
                  Edit
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Delete schedule ${rule.title}`}
                onClick={() => void onDelete(rule.id)}
              >
                <Trash2 className="h-3.5 w-3.5 text-[#D9827C]" />
              </Button>
            </div>
          </Card>
        );
      })}
    </div>
  );
};

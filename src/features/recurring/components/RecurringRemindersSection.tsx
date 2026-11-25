import React from 'react';
import {
  CheckCircle2,
  SkipForward,
  Clock,
  XCircle,
  ArrowUpRight,
  Calendar,
  ExternalLink,
  BellRing
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/feedback/EmptyState';
import { RecurringReminderDTO } from '@/application/dto/RecurringDTO';
import { formatFrequencyLabel, formatLocalDateDisplay } from '../schemas/recurringSchemas';
import { cn } from '@/utils/cn';

export interface RecurringRemindersSectionProps {
  overdue: RecurringReminderDTO[];
  dueToday: RecurringReminderDTO[];
  upcoming: RecurringReminderDTO[];
  snoozed: RecurringReminderDTO[];
  recentlyGenerated: RecurringReminderDTO[];
  pendingRecurringIdSet: Set<string>;
  onConfirmClick: (reminder: RecurringReminderDTO) => void;
  onSkipClick: (reminder: RecurringReminderDTO) => Promise<unknown>;
  onSnoozeClick: (reminder: RecurringReminderDTO) => void;
  onDismissClick: (reminder: RecurringReminderDTO) => Promise<unknown>;
  onCreateSchedule: () => void;
}

const ReminderCard: React.FC<{
  item: RecurringReminderDTO;
  variant: 'overdue' | 'dueToday' | 'upcoming' | 'snoozed';
  isPendingSync: boolean;
  onConfirmClick: (item: RecurringReminderDTO) => void;
  onSkipClick: (item: RecurringReminderDTO) => Promise<unknown>;
  onSnoozeClick: (item: RecurringReminderDTO) => void;
  onDismissClick: (item: RecurringReminderDTO) => Promise<unknown>;
}> = ({
  item,
  variant,
  isPendingSync,
  onConfirmClick,
  onSkipClick,
  onSnoozeClick,
  onDismissClick
}) => {
  const dueBadge = () => {
    if (variant === 'overdue') {
      const days = Math.abs(item.daysUntilDue);
      return (
        <Badge variant="expense" size="sm">
          {days === 1 ? '1 day overdue' : `${days} days overdue`}
        </Badge>
      );
    }
    if (variant === 'dueToday') {
      return (
        <Badge variant="gold" size="sm">
          Due today
        </Badge>
      );
    }
    if (variant === 'snoozed') {
      return (
        <Badge variant="warning" size="sm">
          Snoozed until {formatLocalDateDisplay(item.effectiveDueDate)}
        </Badge>
      );
    }
    return (
      <Badge variant="outline" size="sm">
        In {item.daysUntilDue} {item.daysUntilDue === 1 ? 'day' : 'days'}
      </Badge>
    );
  };

  return (
    <Card
      variant="surface"
      className={cn(
        'p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors',
        variant === 'overdue' && 'border-[#D9827C]/40',
        variant === 'dueToday' && 'border-[#D6AD60]/40'
      )}
    >
      <div className="space-y-1.5 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h4 className="text-sm font-semibold text-[#F5F1E8] truncate">{item.title}</h4>
          {dueBadge()}
          <Badge variant="outline" size="sm">
            {formatFrequencyLabel(item.frequency, item.interval)}
          </Badge>
          {isPendingSync && (
            <Badge variant="warning" size="sm">
              Pending sync
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-3 text-xs text-[#858078] flex-wrap">
          <span className="inline-flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5 text-[#D6AD60]" />
            Scheduled: {formatLocalDateDisplay(item.occurrenceDate)}
          </span>
          <span>Account: {item.accountName}</span>
          {item.categoryName && <span>Category: {item.categoryName}</span>}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3 shrink-0">
        <span
          className={cn(
            'text-base font-bold font-tabular',
            item.type === 'income' ? 'text-[#72B895]' : 'text-[#F5F1E8]'
          )}
        >
          {item.type === 'income' ? '+' : '-'}
          {item.amountFormatted}
        </span>

        <div className="flex items-center gap-1.5 flex-wrap">
          <Button
            type="button"
            variant="primary"
            size="sm"
            leftIcon={<CheckCircle2 className="h-3.5 w-3.5" />}
            onClick={() => onConfirmClick(item)}
          >
            Confirm
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            leftIcon={<Clock className="h-3.5 w-3.5" />}
            onClick={() => onSnoozeClick(item)}
            title="Snooze reminder"
          >
            Snooze
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            leftIcon={<SkipForward className="h-3.5 w-3.5" />}
            onClick={() => void onSkipClick(item)}
            title="Skip this occurrence"
          >
            Skip
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Dismiss ${item.title}`}
            onClick={() => void onDismissClick(item)}
            title="Dismiss reminder"
          >
            <XCircle className="h-3.5 w-3.5 text-[#858078]" />
          </Button>
        </div>
      </div>
    </Card>
  );
};

export const RecurringRemindersSection: React.FC<RecurringRemindersSectionProps> = ({
  overdue,
  dueToday,
  upcoming,
  snoozed,
  recentlyGenerated,
  pendingRecurringIdSet,
  onConfirmClick,
  onSkipClick,
  onSnoozeClick,
  onDismissClick,
  onCreateSchedule
}) => {
  const hasAnyActionable =
    overdue.length > 0 || dueToday.length > 0 || upcoming.length > 0 || snoozed.length > 0;

  return (
    <div className="space-y-6">
      {!hasAnyActionable && recentlyGenerated.length === 0 ? (
        <EmptyState
          icon={BellRing}
          title="No payment reminders yet"
          description="Create a recurring bill, subscription, or salary schedule to track upcoming due dates and confirm transactions safely."
          actionLabel="New Recurring Schedule"
          onAction={onCreateSchedule}
        />
      ) : (
        <>
          {overdue.length > 0 && (
            <section className="space-y-2.5">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#D9827C]">
                  Overdue Reminders ({overdue.length})
                </h3>
              </div>
              <div className="space-y-2.5">
                {overdue.map((item) => (
                  <ReminderCard
                    key={`${item.recurringRuleId}:${item.occurrenceDate}`}
                    item={item}
                    variant="overdue"
                    isPendingSync={
                      pendingRecurringIdSet.has(item.recurringRuleId) ||
                      Boolean(item.occurrenceId && pendingRecurringIdSet.has(item.occurrenceId))
                    }
                    onConfirmClick={onConfirmClick}
                    onSkipClick={onSkipClick}
                    onSnoozeClick={onSnoozeClick}
                    onDismissClick={onDismissClick}
                  />
                ))}
              </div>
            </section>
          )}

          {dueToday.length > 0 && (
            <section className="space-y-2.5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#D6AD60]">
                Due Today ({dueToday.length})
              </h3>
              <div className="space-y-2.5">
                {dueToday.map((item) => (
                  <ReminderCard
                    key={`${item.recurringRuleId}:${item.occurrenceDate}`}
                    item={item}
                    variant="dueToday"
                    isPendingSync={
                      pendingRecurringIdSet.has(item.recurringRuleId) ||
                      Boolean(item.occurrenceId && pendingRecurringIdSet.has(item.occurrenceId))
                    }
                    onConfirmClick={onConfirmClick}
                    onSkipClick={onSkipClick}
                    onSnoozeClick={onSnoozeClick}
                    onDismissClick={onDismissClick}
                  />
                ))}
              </div>
            </section>
          )}

          {upcoming.length > 0 && (
            <section className="space-y-2.5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#B9B4AA]">
                Upcoming Payments ({upcoming.length})
              </h3>
              <div className="space-y-2.5">
                {upcoming.map((item) => (
                  <ReminderCard
                    key={`${item.recurringRuleId}:${item.occurrenceDate}`}
                    item={item}
                    variant="upcoming"
                    isPendingSync={
                      pendingRecurringIdSet.has(item.recurringRuleId) ||
                      Boolean(item.occurrenceId && pendingRecurringIdSet.has(item.occurrenceId))
                    }
                    onConfirmClick={onConfirmClick}
                    onSkipClick={onSkipClick}
                    onSnoozeClick={onSnoozeClick}
                    onDismissClick={onDismissClick}
                  />
                ))}
              </div>
            </section>
          )}

          {snoozed.length > 0 && (
            <section className="space-y-2.5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#E4B66D]">
                Snoozed Reminders ({snoozed.length})
              </h3>
              <div className="space-y-2.5">
                {snoozed.map((item) => (
                  <ReminderCard
                    key={`${item.recurringRuleId}:${item.occurrenceDate}`}
                    item={item}
                    variant="snoozed"
                    isPendingSync={
                      pendingRecurringIdSet.has(item.recurringRuleId) ||
                      Boolean(item.occurrenceId && pendingRecurringIdSet.has(item.occurrenceId))
                    }
                    onConfirmClick={onConfirmClick}
                    onSkipClick={onSkipClick}
                    onSnoozeClick={onSnoozeClick}
                    onDismissClick={onDismissClick}
                  />
                ))}
              </div>
            </section>
          )}

          {recentlyGenerated.length > 0 && (
            <section className="space-y-2.5 pt-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#72B895]">
                  Recently Generated Ledger Transactions ({recentlyGenerated.length})
                </h3>
                <Link
                  to="/transactions"
                  className="inline-flex items-center gap-1 text-xs text-[#D6AD60] hover:underline"
                >
                  <span>View Transactions</span>
                  <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {recentlyGenerated.slice(0, 6).map((item) => (
                  <Card
                    key={item.occurrenceId ?? `${item.recurringRuleId}:${item.occurrenceDate}`}
                    variant="surface"
                    className="p-3.5 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <ArrowUpRight className="h-3.5 w-3.5 text-[#72B895] shrink-0" />
                        <span className="text-xs font-semibold text-[#F5F1E8] truncate">
                          {item.title}
                        </span>
                      </div>
                      <p className="text-[11px] text-[#858078]">
                        {formatLocalDateDisplay(item.occurrenceDate)} · {item.accountName}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <div
                        className={cn(
                          'text-xs font-bold font-tabular',
                          item.type === 'income' ? 'text-[#72B895]' : 'text-[#F5F1E8]'
                        )}
                      >
                        {item.type === 'income' ? '+' : '-'}
                        {item.amountFormatted}
                      </div>
                      <span className="text-[10px] text-[#72B895]">Confirmed</span>
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
};

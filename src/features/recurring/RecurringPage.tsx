import React, { useState } from 'react';
import { Plus, AlertCircle, ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { RecurringReminderDTO, RecurringRuleResponseDTO } from '@/application/dto/RecurringDTO';
import { useAccounts } from '@/features/accounts/hooks/useAccounts';
import { useCategories } from '@/features/categories/hooks/useCategories';
import { useRecurring } from './hooks/useRecurring';
import { RecurringRuleFormValues } from './schemas/recurringSchemas';
import { RecurringSummaryMetrics } from './components/RecurringSummaryMetrics';
import { RecurringRemindersSection } from './components/RecurringRemindersSection';
import { RecurringSchedulesSection } from './components/RecurringSchedulesSection';
import { RecurringRuleFormModal } from './components/RecurringRuleFormModal';
import { ConfirmOccurrenceModal } from './components/ConfirmOccurrenceModal';
import { SnoozeOccurrenceModal } from './components/SnoozeOccurrenceModal';

export const RecurringPage: React.FC = () => {
  const {
    summary,
    overdue,
    dueToday,
    upcoming,
    snoozed,
    recentlyGenerated,
    schedules,
    pendingRecurringIdSet,
    isLoading,
    isError,
    error,
    refetch,
    createRule,
    isCreating,
    updateRule,
    isUpdating,
    pauseRule,
    resumeRule,
    deleteRule,
    confirmOccurrence,
    isConfirming,
    skipOccurrence,
    snoozeOccurrence,
    dismissOccurrence
  } = useRecurring();

  const { accounts, isLoading: isAccountsLoading } = useAccounts();
  const { categories, isLoading: isCategoriesLoading } = useCategories();

  const [activeTab, setActiveTab] = useState<'reminders' | 'schedules'>('reminders');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [scheduleToEdit, setScheduleToEdit] = useState<RecurringRuleResponseDTO | null>(null);
  const [reminderToConfirm, setReminderToConfirm] = useState<RecurringReminderDTO | null>(null);
  const [reminderToSnooze, setReminderToSnooze] = useState<RecurringReminderDTO | null>(null);

  const showLoading = isLoading || isAccountsLoading || isCategoriesLoading;

  const handleRuleFormSubmit = async (
    values: RecurringRuleFormValues,
    editRuleId?: string
  ) => {
    if (editRuleId) {
      await updateRule({ id: editRuleId, values });
    } else {
      await createRule(values);
    }
  };

  const handleOpenCreate = () => {
    setScheduleToEdit(null);
    setIsFormOpen(true);
  };

  const handleOpenEdit = (rule: RecurringRuleResponseDTO) => {
    setScheduleToEdit(rule);
    setIsFormOpen(true);
  };

  const urgentReminderCount = overdue.length + dueToday.length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recurring & Reminders"
        description="Manage scheduled bills and income streams. Transactions enter your ledger only after explicit confirmation."
        badge={
          urgentReminderCount > 0 ? (
            <Badge variant={overdue.length > 0 ? 'expense' : 'gold'} size="sm">
              {urgentReminderCount} Actionable
            </Badge>
          ) : (
            <Badge variant="gold" size="sm">
              Manual Confirm
            </Badge>
          )
        }
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Plus className="h-4 w-4" />}
              onClick={handleOpenCreate}
            >
              New Schedule
            </Button>
          </div>
        }
      />

      {/* Explicit Confirmation Integrity Banner */}
      <div className="flex items-center justify-between gap-3 rounded-xl border border-[#303030] bg-[#161616] px-4 py-2.5 text-xs text-[#B9B4AA]">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-[#72B895] shrink-0" />
          <span>
            Upcoming, overdue, and snoozed reminders never modify your account balances until you
            explicitly confirm them.
          </span>
        </div>
      </div>

      {showLoading ? (
        <div className="space-y-6" aria-label="Loading recurring schedules">
          <RecurringSummaryMetrics summary={summary} isLoading />
          <Card variant="surface" className="p-5 space-y-3">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </Card>
        </div>
      ) : isError ? (
        <Card variant="surface" className="p-8 text-center border-[#D9827C]/30 bg-[#1B1B1B]">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[#D9827C]/10 text-[#D9827C] mb-4">
            <AlertCircle className="h-6 w-6" />
          </div>
          <h3 className="text-base font-semibold text-[#F5F1E8] mb-1">
            Failed to Load Recurring Schedules
          </h3>
          <p className="text-sm text-[#858078] max-w-md mx-auto mb-5">
            {error instanceof Error
              ? error.message
              : 'An error occurred reading recurring schedules from your device.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </Card>
      ) : (
        <>
          <RecurringSummaryMetrics summary={summary} />

          {/* View Switcher Tabs */}
          <div className="flex items-center gap-2 border-b border-[#303030] pb-2">
            <Button
              type="button"
              size="sm"
              variant={activeTab === 'reminders' ? 'primary' : 'ghost'}
              onClick={() => setActiveTab('reminders')}
            >
              Reminders ({overdue.length + dueToday.length + upcoming.length + snoozed.length})
            </Button>
            <Button
              type="button"
              size="sm"
              variant={activeTab === 'schedules' ? 'primary' : 'ghost'}
              onClick={() => setActiveTab('schedules')}
            >
              All Schedules ({schedules.length})
            </Button>
          </div>

          {activeTab === 'reminders' ? (
            <RecurringRemindersSection
              overdue={overdue}
              dueToday={dueToday}
              upcoming={upcoming}
              snoozed={snoozed}
              recentlyGenerated={recentlyGenerated}
              pendingRecurringIdSet={pendingRecurringIdSet}
              onConfirmClick={(item) => setReminderToConfirm(item)}
              onSkipClick={(item) =>
                skipOccurrence({
                  recurringRuleId: item.recurringRuleId,
                  occurrenceDate: item.occurrenceDate,
                  occurrenceId: item.occurrenceId
                })
              }
              onSnoozeClick={(item) => setReminderToSnooze(item)}
              onDismissClick={(item) =>
                dismissOccurrence({
                  recurringRuleId: item.recurringRuleId,
                  occurrenceDate: item.occurrenceDate,
                  occurrenceId: item.occurrenceId
                })
              }
              onCreateSchedule={handleOpenCreate}
            />
          ) : (
            <RecurringSchedulesSection
              schedules={schedules}
              pendingRecurringIdSet={pendingRecurringIdSet}
              onEdit={handleOpenEdit}
              onPause={(id) => pauseRule(id)}
              onResume={(id) => resumeRule(id)}
              onDelete={(id) => deleteRule(id)}
              onCreate={handleOpenCreate}
            />
          )}
        </>
      )}

      <RecurringRuleFormModal
        isOpen={isFormOpen}
        onClose={() => {
          setIsFormOpen(false);
          setScheduleToEdit(null);
        }}
        accounts={accounts}
        categories={categories}
        scheduleToEdit={scheduleToEdit}
        onSubmit={handleRuleFormSubmit}
        isLoading={isCreating || isUpdating}
      />

      <ConfirmOccurrenceModal
        reminder={reminderToConfirm}
        onClose={() => setReminderToConfirm(null)}
        onConfirm={(payload) => confirmOccurrence(payload)}
        isLoading={isConfirming}
      />

      <SnoozeOccurrenceModal
        reminder={reminderToSnooze}
        onClose={() => setReminderToSnooze(null)}
        onSnooze={(payload) => snoozeOccurrence(payload)}
      />
    </div>
  );
};

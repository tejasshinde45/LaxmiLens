import React, { useEffect, useState } from 'react';
import { Clock, AlertCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { RecurringReminderDTO } from '@/application/dto/RecurringDTO';
import {
  addDaysToLocalDate,
  getLocalTodayDateString,
  isValidLocalCalendarDate
} from '@/domain/services/RecurrenceScheduleService';

export interface SnoozeOccurrenceModalProps {
  reminder: RecurringReminderDTO | null;
  onClose: () => void;
  onSnooze: (payload: {
    recurringRuleId: string;
    occurrenceDate: string;
    snoozeUntilDate: string;
    occurrenceId?: string;
  }) => Promise<unknown>;
  isLoading?: boolean;
}

export const SnoozeOccurrenceModal: React.FC<SnoozeOccurrenceModalProps> = ({
  reminder,
  onClose,
  onSnooze,
  isLoading = false
}) => {
  const today = getLocalTodayDateString();
  const [snoozeDate, setSnoozeDate] = useState(addDaysToLocalDate(today, 1));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!reminder) return;
    setSnoozeDate(addDaysToLocalDate(getLocalTodayDateString(), 1));
    setError(null);
  }, [reminder]);

  const handleSnoozeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reminder || isLoading) return;
    if (!isValidLocalCalendarDate(snoozeDate)) {
      setError('Please select a valid snooze date.');
      return;
    }

    setError(null);
    try {
      await onSnooze({
        recurringRuleId: reminder.recurringRuleId,
        occurrenceDate: reminder.occurrenceDate,
        snoozeUntilDate: snoozeDate,
        occurrenceId: reminder.occurrenceId
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to snooze reminder.');
    }
  };

  const quickOptions = [
    { label: 'Tomorrow', date: addDaysToLocalDate(today, 1) },
    { label: '+3 Days', date: addDaysToLocalDate(today, 3) },
    { label: 'Next Week', date: addDaysToLocalDate(today, 7) }
  ];

  return (
    <Dialog open={Boolean(reminder)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-[#D6AD60]" />
            <span>Snooze Reminder</span>
          </DialogTitle>
          <DialogDescription>
            Choose when you want to be reminded again for "{reminder?.title}". Your recurring
            schedule cadence remains unchanged.
          </DialogDescription>
        </DialogHeader>

        {reminder && (
          <form onSubmit={handleSnoozeSubmit} className="space-y-4">
            {error && (
              <div className="flex items-start gap-2 rounded-[10px] border border-[#D9827C]/40 bg-[#D9827C]/10 p-3 text-xs text-[#D9827C]">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {quickOptions.map((opt) => (
                <Button
                  key={opt.label}
                  type="button"
                  size="sm"
                  variant={snoozeDate === opt.date ? 'gold-subtle' : 'outline'}
                  onClick={() => setSnoozeDate(opt.date)}
                >
                  {opt.label}
                </Button>
              ))}
            </div>

            <Input
              id="snooze-until-date"
              label="Remind Me On"
              type="date"
              min={today}
              value={snoozeDate}
              onChange={(e) => setSnoozeDate(e.target.value)}
              disabled={isLoading}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" isLoading={isLoading}>
                Snooze Reminder
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};

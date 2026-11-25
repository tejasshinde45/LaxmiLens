import React, { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle } from 'lucide-react';
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
import { Badge } from '@/components/ui/Badge';
import { RecurringReminderDTO } from '@/application/dto/RecurringDTO';
import { formatLocalDateDisplay } from '../schemas/recurringSchemas';

export interface ConfirmOccurrenceModalProps {
  reminder: RecurringReminderDTO | null;
  onClose: () => void;
  onConfirm: (payload: {
    recurringRuleId: string;
    occurrenceDate: string;
    occurrenceId?: string;
    overrideTitle?: string;
    overrideNote?: string;
  }) => Promise<unknown>;
  isLoading?: boolean;
}

export const ConfirmOccurrenceModal: React.FC<ConfirmOccurrenceModalProps> = ({
  reminder,
  onClose,
  onConfirm,
  isLoading = false
}) => {
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!reminder) return;
    setTitle(reminder.title);
    setNote(reminder.description ?? '');
    setError(null);
  }, [reminder]);

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reminder || isLoading) return;
    setError(null);

    try {
      await onConfirm({
        recurringRuleId: reminder.recurringRuleId,
        occurrenceDate: reminder.occurrenceDate,
        occurrenceId: reminder.occurrenceId,
        overrideTitle: title.trim() || reminder.title,
        overrideNote: note.trim()
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to confirm recurring payment.');
    }
  };

  return (
    <Dialog open={Boolean(reminder)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-[#72B895]" />
            <span>Confirm & Record Transaction</span>
          </DialogTitle>
          <DialogDescription>
            Confirming records a genuine ledger transaction in your selected account using the
            scheduled date and amount.
          </DialogDescription>
        </DialogHeader>

        {reminder && (
          <form onSubmit={handleConfirm} className="space-y-4">
            {error && (
              <div className="flex items-start gap-2 rounded-[10px] border border-[#D9827C]/40 bg-[#D9827C]/10 p-3 text-xs text-[#D9827C]">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div className="rounded-[12px] border border-[#303030] bg-[#161616] p-3.5 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-[#858078]">Amount</span>
                <span
                  className={
                    reminder.type === 'income'
                      ? 'text-base font-bold font-tabular text-[#72B895]'
                      : 'text-base font-bold font-tabular text-[#F5F1E8]'
                  }
                >
                  {reminder.type === 'income' ? '+' : '-'}
                  {reminder.amountFormatted}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#858078]">Account</span>
                <span className="text-[#F5F1E8] font-medium">{reminder.accountName}</span>
              </div>
              {reminder.categoryName && (
                <div className="flex items-center justify-between">
                  <span className="text-[#858078]">Category</span>
                  <Badge variant="outline" size="sm">
                    {reminder.categoryName}
                  </Badge>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-[#858078]">Scheduled Date</span>
                <span className="text-[#F5F1E8] font-medium">
                  {formatLocalDateDisplay(reminder.occurrenceDate)}
                </span>
              </div>
            </div>

            <Input
              id="confirm-occurrence-title"
              label="Transaction Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isLoading}
            />

            <Input
              id="confirm-occurrence-note"
              label="Note (Optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Payment reference or note"
              disabled={isLoading}
            />

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" isLoading={isLoading}>
                Confirm & Record
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};

import { useEffect, useState } from 'react';
import { Bell, CheckCircle2, AlertCircle } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/utils/cn';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  MAX_UPCOMING_LEAD_DAYS,
  MIN_UPCOMING_LEAD_DAYS
} from '@/domain/entities/NotificationPreference';
import { useNotificationPreferences } from '../hooks/useNotificationPreferences';

interface PreferenceToggleRowProps {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (nextChecked: boolean) => void;
}

const PreferenceToggleRow: React.FC<PreferenceToggleRowProps> = ({
  id,
  label,
  description,
  checked,
  disabled,
  onChange
}) => {
  return (
    <div className="flex items-start justify-between gap-4 rounded-[10px] border border-[#303030] bg-[#141414] p-3.5">
      <div className="space-y-0.5">
        <label htmlFor={id} className="text-sm font-medium text-[#F5F1E8] cursor-pointer">
          {label}
        </label>
        <p className="text-xs text-[#858078] leading-relaxed">{description}</p>
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D6AD60] focus-visible:ring-offset-2 focus-visible:ring-offset-[#1B1B1B] disabled:cursor-not-allowed disabled:opacity-50',
          checked ? 'bg-[#D6AD60]' : 'bg-[#303030]'
        )}
      >
        <span
          className={cn(
            'pointer-events-none inline-block h-5 w-5 rounded-full bg-[#101010] shadow-sm transition-transform',
            checked ? 'translate-x-5' : 'translate-x-0'
          )}
        />
      </button>
    </div>
  );
};

export const NotificationPreferencesSection: React.FC = () => {
  const {
    preferences,
    isLoading,
    isError,
    error,
    refetch,
    updatePreferences,
    isSaving,
    saveError
  } = useNotificationPreferences();

  const [recurringPaymentEnabled, setRecurringPaymentEnabled] = useState<boolean>(
    DEFAULT_NOTIFICATION_PREFERENCES.recurringPaymentEnabled
  );
  const [budgetWarningEnabled, setBudgetWarningEnabled] = useState<boolean>(
    DEFAULT_NOTIFICATION_PREFERENCES.budgetWarningEnabled
  );
  const [budgetExceededEnabled, setBudgetExceededEnabled] = useState<boolean>(
    DEFAULT_NOTIFICATION_PREFERENCES.budgetExceededEnabled
  );
  const [leadDaysInput, setLeadDaysInput] = useState<string>(
    String(DEFAULT_NOTIFICATION_PREFERENCES.upcomingLeadDays)
  );
  const [statusFeedback, setStatusFeedback] = useState<'idle' | 'saved'>('idle');

  useEffect(() => {
    setRecurringPaymentEnabled(preferences.recurringPaymentEnabled);
    setBudgetWarningEnabled(preferences.budgetWarningEnabled);
    setBudgetExceededEnabled(preferences.budgetExceededEnabled);
    setLeadDaysInput(String(preferences.upcomingLeadDays));
  }, [
    preferences.recurringPaymentEnabled,
    preferences.budgetWarningEnabled,
    preferences.budgetExceededEnabled,
    preferences.upcomingLeadDays
  ]);

  const parsedLeadDays =
    leadDaysInput.trim() === '' ? NaN : Number(leadDaysInput.trim());
  const leadDaysError =
    !Number.isSafeInteger(parsedLeadDays) ||
    parsedLeadDays < MIN_UPCOMING_LEAD_DAYS ||
    parsedLeadDays > MAX_UPCOMING_LEAD_DAYS
      ? `Upcoming lead days must be a whole number between ${MIN_UPCOMING_LEAD_DAYS} and ${MAX_UPCOMING_LEAD_DAYS}.`
      : undefined;

  const isDirty =
    recurringPaymentEnabled !== preferences.recurringPaymentEnabled ||
    budgetWarningEnabled !== preferences.budgetWarningEnabled ||
    budgetExceededEnabled !== preferences.budgetExceededEnabled ||
    (!leadDaysError && parsedLeadDays !== preferences.upcomingLeadDays);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (leadDaysError || isSaving) {
      return;
    }
    setStatusFeedback('idle');
    await updatePreferences({
      recurringPaymentEnabled,
      budgetWarningEnabled,
      budgetExceededEnabled,
      upcomingLeadDays: parsedLeadDays
    });
    setStatusFeedback('saved');
  };

  const handleToggle = (
    setter: React.Dispatch<React.SetStateAction<boolean>>,
    value: boolean
  ) => {
    setStatusFeedback('idle');
    setter(value);
  };

  return (
    <Card variant="surface" className="space-y-4 p-5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2.5 text-sm font-semibold text-[#F5F1E8]">
          <Bell className="h-4 w-4 text-[#D6AD60]" />
          <span>Notification Preferences</span>
        </div>
        <Badge variant={preferences.isDefault ? 'neutral' : 'gold'} size="sm">
          {preferences.isDefault ? 'Default Settings' : 'Custom Saved'}
        </Badge>
      </div>

      {isLoading ? (
        <div className="space-y-3 pt-1">
          <Skeleton className="h-16 w-full rounded-[10px]" />
          <Skeleton className="h-16 w-full rounded-[10px]" />
          <Skeleton className="h-16 w-full rounded-[10px]" />
        </div>
      ) : isError ? (
        <div className="rounded-[10px] border border-[#D9827C]/30 bg-[#D9827C]/10 p-4 text-xs text-[#F5F1E8] space-y-2">
          <div className="flex items-center gap-2 text-[#D9827C] font-medium">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>Failed to load notification preferences</span>
          </div>
          <p className="text-[#B9B4AA]">
            {error?.message || 'Unable to read stored notification settings.'}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
            Retry
          </Button>
        </div>
      ) : (
        <form onSubmit={handleSave} className="space-y-3 pt-1">
          <PreferenceToggleRow
            id="pref-recurring-payment"
            label="Recurring Payment Reminders"
            description="Notify before scheduled recurring expenses or income, when due today, and when overdue."
            checked={recurringPaymentEnabled}
            disabled={isSaving}
            onChange={(val) => handleToggle(setRecurringPaymentEnabled, val)}
          />

          <PreferenceToggleRow
            id="pref-budget-warning"
            label="Budget Warning Alerts"
            description="Notify when monthly category spending reaches 80% of the configured budget limit."
            checked={budgetWarningEnabled}
            disabled={isSaving}
            onChange={(val) => handleToggle(setBudgetWarningEnabled, val)}
          />

          <PreferenceToggleRow
            id="pref-budget-exceeded"
            label="Budget Exceeded Alerts"
            description="Send a critical alert when monthly category spending reaches or exceeds 100% of the budget limit."
            checked={budgetExceededEnabled}
            disabled={isSaving}
            onChange={(val) => handleToggle(setBudgetExceededEnabled, val)}
          />

          <div className="rounded-[10px] border border-[#303030] bg-[#141414] p-3.5 space-y-2">
            <Input
              id="pref-upcoming-lead-days"
              type="number"
              min={MIN_UPCOMING_LEAD_DAYS}
              max={MAX_UPCOMING_LEAD_DAYS}
              step={1}
              label="Upcoming Reminder Lead Days"
              value={leadDaysInput}
              disabled={isSaving}
              error={leadDaysError}
              helperText={`Show upcoming recurring alerts 0–30 days before the scheduled date (default: ${DEFAULT_NOTIFICATION_PREFERENCES.upcomingLeadDays} days).`}
              onChange={(e) => {
                setStatusFeedback('idle');
                setLeadDaysInput(e.target.value);
              }}
            />
          </div>

          {saveError && (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-[10px] border border-[#D9827C]/30 bg-[#D9827C]/10 px-3 py-2 text-xs text-[#D9827C]"
            >
              <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{saveError.message || 'Could not save notification preferences.'}</span>
            </div>
          )}

          {statusFeedback === 'saved' && !isDirty && !saveError && (
            <div
              role="status"
              className="flex items-center gap-2 rounded-[10px] border border-[#72B895]/30 bg-[#72B895]/10 px-3 py-2 text-xs text-[#72B895]"
            >
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Preferences saved locally.</span>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 pt-1 flex-wrap">
            <p className="text-[11px] text-[#858078]">
              Changes save locally and synchronize automatically when connected.
            </p>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              isLoading={isSaving}
              disabled={!isDirty || !!leadDaysError || isSaving}
            >
              Save Preferences
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
};

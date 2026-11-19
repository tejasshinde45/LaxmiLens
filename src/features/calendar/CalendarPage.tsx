import { CalendarDays, Plus } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/feedback/EmptyState';

export const CalendarPage: React.FC = () => {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Calendar"
        description="Upcoming recurring rules, subscription renewals, loan EMIs, and scheduled financial commitments."
        actions={
          <Button variant="primary" size="sm" leftIcon={<Plus className="h-4 w-4" />}>
            Add Recurring Rule
          </Button>
        }
      />

      <EmptyState
        icon={CalendarDays}
        title="No scheduled commitments"
        description="Set up recurring rules for SIP investments, rent payments, streaming subscriptions, and utility bills with confirmation workflows."
        actionLabel="Create Scheduled Commitment"
        onAction={() => {}}
      />
    </div>
  );
};

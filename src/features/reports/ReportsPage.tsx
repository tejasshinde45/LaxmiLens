import { FileText, Download, ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/feedback/EmptyState';

export const ReportsPage: React.FC = () => {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Structured cashflow statements, annual tax summaries, and encrypted client backups."
        actions={
          <Button variant="outline" size="sm" leftIcon={<Download className="h-3.5 w-3.5" />}>
            Generate Report
          </Button>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card variant="surface" className="space-y-2 p-5">
          <div className="text-xs font-semibold text-[#D6AD60]">Monthly Statement</div>
          <p className="text-xs text-[#858078]">
            Detailed double-entry ledger statement of all account balances and transaction details.
          </p>
        </Card>

        <Card variant="surface" className="space-y-2 p-5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-[#82A9CF]">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Encrypted Export</span>
          </div>
          <p className="text-xs text-[#858078]">
            Client-side AES-256-GCM encrypted backup derivation of your IndexedDB database.
          </p>
        </Card>

        <Card variant="surface" className="space-y-2 p-5">
          <div className="text-xs font-semibold text-[#72B895]">Tax Summary</div>
          <p className="text-xs text-[#858078]">
            Aggregated investment distributions and deductions for Indian fiscal tax filing.
          </p>
        </Card>
      </div>

      <EmptyState
        icon={FileText}
        title="No historical statements generated"
        description="Select a reporting date range to generate an exportable PDF or spreadsheet summary."
      />
    </div>
  );
};

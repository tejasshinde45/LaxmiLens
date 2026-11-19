import { LayoutDashboard, Wallet, ArrowDownLeft, ArrowUpRight, Plus, Sparkles, ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/feedback/EmptyState';
import { Link } from 'react-router-dom';

export const DashboardPage: React.FC = () => {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        description="Consolidated financial posture, account liquidity, and verified ledger activity."
        badge={
          <Badge variant="gold" size="sm" dot>
            Offline-Ready
          </Badge>
        }
        actions={
          <Link to="/transactions">
            <Button variant="primary" size="sm" leftIcon={<Plus className="h-4 w-4" />}>
              Add Transaction
            </Button>
          </Link>
        }
      />

      {/* Top Posture Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card variant="surface" className="space-y-2">
          <div className="flex items-center justify-between text-[#858078]">
            <span className="text-xs font-medium">Net Worth</span>
            <Wallet className="h-4 w-4 text-[#D6AD60]" />
          </div>
          <div className="space-y-0.5">
            <div className="text-2xl font-bold font-tabular text-[#F5F1E8]">₹0.00</div>
            <p className="text-[11px] text-[#858078]">Derived across all active accounts</p>
          </div>
        </Card>

        <Card variant="surface" className="space-y-2">
          <div className="flex items-center justify-between text-[#858078]">
            <span className="text-xs font-medium">Monthly Inflow</span>
            <ArrowUpRight className="h-4 w-4 text-[#72B895]" />
          </div>
          <div className="space-y-0.5">
            <div className="text-2xl font-bold font-tabular text-[#72B895]">₹0.00</div>
            <p className="text-[11px] text-[#858078]">Current billing period</p>
          </div>
        </Card>

        <Card variant="surface" className="space-y-2">
          <div className="flex items-center justify-between text-[#858078]">
            <span className="text-xs font-medium">Monthly Outflow</span>
            <ArrowDownLeft className="h-4 w-4 text-[#D9827C]" />
          </div>
          <div className="space-y-0.5">
            <div className="text-2xl font-bold font-tabular text-[#D9827C]">₹0.00</div>
            <p className="text-[11px] text-[#858078]">0 transactions recorded</p>
          </div>
        </Card>

        <Card variant="surface" className="space-y-2">
          <div className="flex items-center justify-between text-[#858078]">
            <span className="text-xs font-medium">Security & Storage</span>
            <ShieldCheck className="h-4 w-4 text-[#82A9CF]" />
          </div>
          <div className="space-y-0.5">
            <div className="text-sm font-semibold text-[#F5F1E8]">IndexedDB Active</div>
            <p className="text-[11px] text-[#858078]">Encrypted storage ready</p>
          </div>
        </Card>
      </div>

      {/* Main Grid: Ledger & Architecture Brief */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-[#F5F1E8] font-display uppercase tracking-wider">
              Recent Transactions
            </h2>
            <Link to="/transactions" className="text-xs text-[#D6AD60] hover:underline">
              View all
            </Link>
          </div>

          <EmptyState
            icon={LayoutDashboard}
            title="No transactions logged yet"
            description="Your ledger is empty. Click Quick Add or press Ctrl+K to log your first income, expense, or account transfer."
            actionLabel="View Transactions View"
            onAction={() => {}}
          />
        </div>

        <div className="space-y-4">
          <h2 className="text-sm font-bold text-[#F5F1E8] font-display uppercase tracking-wider">
            Architecture Status
          </h2>
          <Card variant="elevated" className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#D6AD60]">
              <Sparkles className="h-4 w-4" />
              <span>Obsidian Gold Shell Ready</span>
            </div>
            <p className="text-xs text-[#B9B4AA] leading-relaxed">
              Design tokens, desktop collapsible sidebar, mobile bottom navigation, command palette, and quick-add modals are initialized.
            </p>
            <div className="space-y-2 pt-2 border-t border-[#303030]/60 text-xs">
              <div className="flex justify-between text-[#858078]">
                <span>Monetary Precision:</span>
                <span className="text-[#F5F1E8] font-medium font-tabular">Integer Paise (₹)</span>
              </div>
              <div className="flex justify-between text-[#858078]">
                <span>Cloud Source:</span>
                <span className="text-[#F5F1E8] font-medium">Supabase PG</span>
              </div>
              <div className="flex justify-between text-[#858078]">
                <span>Local Store:</span>
                <span className="text-[#F5F1E8] font-medium">Dexie 4.x</span>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

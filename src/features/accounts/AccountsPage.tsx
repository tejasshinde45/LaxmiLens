import { Wallet, Plus, CreditCard, Banknote, Landmark } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/feedback/EmptyState';

export const AccountsPage: React.FC = () => {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Accounts"
        description="Bank accounts, cash reserves, digital wallets, and credit cards with strictly derived balances."
        actions={
          <Button variant="primary" size="sm" leftIcon={<Plus className="h-4 w-4" />}>
            New Account
          </Button>
        }
      />

      {/* Account Type Classification Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card variant="surface" className="flex items-center gap-3.5 p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-[#D6AD60]/10 text-[#D6AD60]">
            <Landmark className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs text-[#858078]">Bank Accounts</div>
            <div className="text-sm font-bold text-[#F5F1E8]">Savings & Current</div>
          </div>
        </Card>

        <Card variant="surface" className="flex items-center gap-3.5 p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-[#72B895]/10 text-[#72B895]">
            <Banknote className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs text-[#858078]">Physical Cash</div>
            <div className="text-sm font-bold text-[#F5F1E8]">Wallets & Envelopes</div>
          </div>
        </Card>

        <Card variant="surface" className="flex items-center gap-3.5 p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-[#82A9CF]/10 text-[#82A9CF]">
            <Wallet className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs text-[#858078]">Digital Wallets</div>
            <div className="text-sm font-bold text-[#F5F1E8]">UPI & Prepaid</div>
          </div>
        </Card>

        <Card variant="surface" className="flex items-center gap-3.5 p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-[#D9827C]/10 text-[#D9827C]">
            <CreditCard className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs text-[#858078]">Liabilities</div>
            <div className="text-sm font-bold text-[#F5F1E8]">Credit Cards</div>
          </div>
        </Card>
      </div>

      <EmptyState
        icon={Wallet}
        title="No financial accounts registered"
        description="Add your first bank account, cash reserve, or credit card to begin tracking balances and executing transfers."
        actionLabel="Register First Account"
        onAction={() => {}}
      />
    </div>
  );
};

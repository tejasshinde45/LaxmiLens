import React, { useState, useMemo } from 'react';
import {
  Plus,
  RefreshCw,
  Search,
  Users,
  ArrowDownLeft,
  ArrowUpRight
} from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { useBorrowings } from './hooks/useBorrowings';
import { useAccounts } from '@/features/accounts/hooks/useAccounts';
import { useAccountSync } from '@/features/accounts/hooks/useAccountSync';
import { BorrowingsSummaryMetrics } from './components/BorrowingsSummaryMetrics';
import { LenderTable } from './components/LenderTable';
import { BorrowingHistoryTable } from './components/BorrowingHistoryTable';
import { RepaymentHistoryTable } from './components/RepaymentHistoryTable';
import { AddBorrowingModal } from './components/AddBorrowingModal';
import { RecordRepaymentModal } from './components/RecordRepaymentModal';
import { BorrowingDetailModal } from './components/BorrowingDetailModal';
import { BorrowingDTO, LenderDTO } from '@/application/dto/BorrowingDTO';
import { cn } from '@/utils/cn';

type BorrowingsTab = 'lenders' | 'borrowings' | 'repayments';

export const BorrowingsPage: React.FC = () => {
  const {
    summary,
    lenders,
    borrowings,
    repayments,
    isLoading: isBorrowingsLoading,
    addBorrowing,
    isAddingBorrowing,
    recordRepayment,
    isRecordingRepayment
  } = useBorrowings();

  const { accounts, isLoading: isAccountsLoading } = useAccounts();
  const { syncNow, isSyncing, pendingCount } = useAccountSync();

  // Tab & Search State
  const [activeTab, setActiveTab] = useState<BorrowingsTab>('lenders');
  const [searchQuery, setSearchQuery] = useState('');

  // Modal State
  const [isAddBorrowingOpen, setIsAddBorrowingOpen] = useState(false);
  const [isRecordRepaymentOpen, setIsRecordRepaymentOpen] = useState(false);
  const [selectedLenderForRepayment, setSelectedLenderForRepayment] = useState<string | null>(null);
  const [selectedBorrowingForRepayment, setSelectedBorrowingForRepayment] = useState<string | null>(null);

  // Detail Modal State
  const [detailBorrowing, setDetailBorrowing] = useState<BorrowingDTO | null>(null);
  const [detailLender, setDetailLender] = useState<LenderDTO | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  // Search filtering
  const filteredLenders = useMemo(() => {
    if (!searchQuery.trim()) return lenders;
    const q = searchQuery.toLowerCase();
    return lenders.filter((l) => l.name.toLowerCase().includes(q));
  }, [lenders, searchQuery]);

  const filteredBorrowings = useMemo(() => {
    if (!searchQuery.trim()) return borrowings;
    const q = searchQuery.toLowerCase();
    return borrowings.filter((b) => b.lenderName.toLowerCase().includes(q));
  }, [borrowings, searchQuery]);

  const filteredRepayments = useMemo(() => {
    if (!searchQuery.trim()) return repayments;
    const q = searchQuery.toLowerCase();
    return repayments.filter((r) => r.lenderName.toLowerCase().includes(q));
  }, [repayments, searchQuery]);

  // Handlers
  const handleOpenRepayForLender = (lender: LenderDTO) => {
    setSelectedLenderForRepayment(lender.id);
    setSelectedBorrowingForRepayment(null);
    setIsRecordRepaymentOpen(true);
  };

  const handleOpenRepayForBorrowing = (borrowing: BorrowingDTO) => {
    setSelectedLenderForRepayment(borrowing.lenderId);
    setSelectedBorrowingForRepayment(borrowing.id);
    setIsRecordRepaymentOpen(true);
  };

  const handleOpenLenderDetail = (lender: LenderDTO) => {
    setDetailLender(lender);
    setDetailBorrowing(null);
    setIsDetailOpen(true);
  };

  const handleOpenBorrowingDetail = (borrowing: BorrowingDTO) => {
    setDetailBorrowing(borrowing);
    setDetailLender(null);
    setIsDetailOpen(true);
  };

  const isLoading = isBorrowingsLoading || isAccountsLoading;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        title="Personal Borrowings"
        description="Track money borrowed from multiple individuals under one aggregate liability account. Borrowings are not income; repayments are not expenses."
        badge={
          <Badge variant="gold" size="sm" dot>
            Liability Sub-Ledger
          </Badge>
        }
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => syncNow()}
              disabled={isSyncing}
              className="text-xs"
            >
              <RefreshCw
                className={cn('h-3.5 w-3.5 mr-1.5', isSyncing && 'animate-spin text-[#D6AD60]')}
              />
              {isSyncing ? 'Syncing...' : 'Sync Cloud'}
              {pendingCount > 0 && !isSyncing && (
                <span className="ml-1.5 px-1.5 py-0.2 bg-[#D6AD60]/20 text-[#D6AD60] rounded-full text-[10px] font-bold">
                  {pendingCount}
                </span>
              )}
            </Button>
            {summary.activeLendersCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="text-[#72B895] border-[#72B895]/40 hover:bg-[#72B895]/10 text-xs"
                onClick={() => {
                  setSelectedLenderForRepayment(null);
                  setSelectedBorrowingForRepayment(null);
                  setIsRecordRepaymentOpen(true);
                }}
              >
                Record Repayment
              </Button>
            )}
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Plus className="h-4 w-4" />}
              onClick={() => setIsAddBorrowingOpen(true)}
            >
              Add Borrowing
            </Button>
          </div>
        }
      />

      {/* Top 4 Summary Metrics */}
      <BorrowingsSummaryMetrics summary={summary} isLoading={isLoading} />

      {/* Filters and Navigation Tabs */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Navigation Tabs */}
        <div
          role="group"
          aria-label="Borrowings views"
          className="flex items-center gap-1.5 bg-[#161616] p-1 rounded-lg border border-[#303030]"
        >
          <button
            type="button"
            aria-pressed={activeTab === 'lenders'}
            onClick={() => setActiveTab('lenders')}
            className={cn(
              'px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D6AD60]',
              activeTab === 'lenders'
                ? 'bg-[#1B1B1B] text-[#D6AD60] shadow-sm font-semibold'
                : 'text-[#858078] hover:text-[#F5F1E8]'
            )}
          >
            <Users className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Lenders</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[#303030] text-[#B9B4AA]">
              {lenders.length}
            </span>
          </button>

          <button
            type="button"
            aria-pressed={activeTab === 'borrowings'}
            onClick={() => setActiveTab('borrowings')}
            className={cn(
              'px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D6AD60]',
              activeTab === 'borrowings'
                ? 'bg-[#1B1B1B] text-[#D6AD60] shadow-sm font-semibold'
                : 'text-[#858078] hover:text-[#F5F1E8]'
            )}
          >
            <ArrowDownLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Borrowing History</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[#303030] text-[#B9B4AA]">
              {borrowings.length}
            </span>
          </button>

          <button
            type="button"
            aria-pressed={activeTab === 'repayments'}
            onClick={() => setActiveTab('repayments')}
            className={cn(
              'px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D6AD60]',
              activeTab === 'repayments'
                ? 'bg-[#1B1B1B] text-[#D6AD60] shadow-sm font-semibold'
                : 'text-[#858078] hover:text-[#F5F1E8]'
            )}
          >
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Repayment History</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[#303030] text-[#B9B4AA]">
              {repayments.length}
            </span>
          </button>
        </div>

        {/* Search Input */}
        <div className="relative w-full sm:w-64">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#858078] z-10"
            aria-hidden="true"
          />
          <Input
            id="borrowings-search-input"
            aria-label="Search lenders or borrowings"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search lenders..."
            className="pl-9 h-9 text-xs"
          />
        </div>
      </div>

      {/* Main Content Area based on Tab */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} variant="surface" className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Skeleton className="h-9 w-9 rounded-full" />
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
              <Skeleton className="h-5 w-24" />
            </Card>
          ))}
        </div>
      ) : activeTab === 'lenders' ? (
        <LenderTable
          lenders={filteredLenders}
          onSelectLender={handleOpenLenderDetail}
          onRepayLender={handleOpenRepayForLender}
          onAddBorrowing={() => setIsAddBorrowingOpen(true)}
        />
      ) : activeTab === 'borrowings' ? (
        <BorrowingHistoryTable
          borrowings={filteredBorrowings}
          onSelectBorrowing={handleOpenBorrowingDetail}
          onRepayBorrowing={handleOpenRepayForBorrowing}
          onAddBorrowing={() => setIsAddBorrowingOpen(true)}
        />
      ) : (
        <RepaymentHistoryTable
          repayments={filteredRepayments}
          onRecordRepayment={() => {
            setSelectedLenderForRepayment(null);
            setSelectedBorrowingForRepayment(null);
            setIsRecordRepaymentOpen(true);
          }}
        />
      )}

      {/* Modals */}
      <AddBorrowingModal
        isOpen={isAddBorrowingOpen}
        onClose={() => setIsAddBorrowingOpen(false)}
        accounts={accounts}
        existingLenders={lenders}
        onSubmit={async (values) => {
          await addBorrowing(values);
        }}
        isLoading={isAddingBorrowing}
      />

      <RecordRepaymentModal
        isOpen={isRecordRepaymentOpen}
        onClose={() => {
          setIsRecordRepaymentOpen(false);
          setSelectedLenderForRepayment(null);
          setSelectedBorrowingForRepayment(null);
        }}
        accounts={accounts}
        lenders={lenders}
        borrowings={borrowings}
        initialLenderId={selectedLenderForRepayment}
        initialBorrowingId={selectedBorrowingForRepayment}
        onSubmit={async (values) => {
          await recordRepayment(values);
        }}
        isLoading={isRecordingRepayment}
      />

      <BorrowingDetailModal
        isOpen={isDetailOpen}
        onClose={() => {
          setIsDetailOpen(false);
          setDetailBorrowing(null);
          setDetailLender(null);
        }}
        borrowing={detailBorrowing}
        lender={detailLender}
        onRepay={() => {
          if (detailLender) {
            handleOpenRepayForLender(detailLender);
          } else if (detailBorrowing) {
            handleOpenRepayForBorrowing(detailBorrowing);
          }
        }}
      />
    </div>
  );
};

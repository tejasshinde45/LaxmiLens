import React from 'react';
import {
  FileText,
  Landmark,
  PieChart,
  BarChart3,
  AlertCircle,
  RefreshCw,
  CalendarX2
} from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/feedback/EmptyState';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { ReportTabType } from '@/application/dto/ReportDTO';
import { useReports } from './hooks/useReports';
import { ReportFiltersBar } from './components/ReportFiltersBar';
import { ReportExportActions } from './components/ReportExportActions';
import { PrintableReportHeader } from './components/PrintableReportHeader';
import { FinancialSummaryReportView } from './components/FinancialSummaryReportView';
import { AccountStatementView } from './components/AccountStatementView';
import { CategoryReportView } from './components/CategoryReportView';

export const ReportsPage: React.FC = () => {
  const {
    activeTab,
    setActiveTab,
    preset,
    setPreset,
    customRange,
    setCustomRange,
    dateRangeError,
    selectedAccountId,
    setSelectedAccountId,
    effectiveStatementAccountId,
    setSelectedStatementAccountId,
    selectedCategoryId,
    handleCategoryChange,
    typeFilter,
    handleTypeFilterChange,
    searchQuery,
    setSearchQuery,
    includeArchivedCategories,
    setIncludeArchivedCategories,
    hasActiveFilters,
    resetFilters,
    accounts,
    categories,
    report,
    summaryReport,
    statementReport,
    categoryReport,
    isLoading,
    isError,
    error,
    refetch
  } = useReports();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Structured cash flow statements, chronological account ledgers, category breakdowns, and offline CSV / PDF exports."
        badge={
          <Badge variant="gold" size="sm" dot>
            Offline-Ready
          </Badge>
        }
        actions={
          <ReportExportActions
            report={report}
            disabled={isLoading || isError || Boolean(dateRangeError)}
          />
        }
        className="print:hidden"
      />

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as ReportTabType)}
        className="space-y-4"
      >
        <div className="print:hidden">
          <TabsList aria-label="Report workspaces" className="w-full sm:w-auto grid grid-cols-3 sm:inline-flex">
            <TabsTrigger value="summary" className="gap-1.5">
              <BarChart3 className="h-3.5 w-3.5" />
              <span>Financial Summary</span>
            </TabsTrigger>
            <TabsTrigger value="statement" className="gap-1.5">
              <Landmark className="h-3.5 w-3.5" />
              <span>Account Statement</span>
            </TabsTrigger>
            <TabsTrigger value="category" className="gap-1.5">
              <PieChart className="h-3.5 w-3.5" />
              <span>Category Report</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <ReportFiltersBar
          activeTab={activeTab}
          preset={preset}
          onPresetChange={setPreset}
          customRange={customRange}
          onCustomRangeChange={setCustomRange}
          dateRangeError={dateRangeError}
          periodLabel={report?.period.label}
          startInput={report?.period.startInput}
          endInput={report?.period.endInput}
          accounts={accounts}
          selectedAccountId={selectedAccountId}
          onAccountChange={setSelectedAccountId}
          effectiveStatementAccountId={effectiveStatementAccountId}
          onStatementAccountChange={setSelectedStatementAccountId}
          categories={categories}
          selectedCategoryId={selectedCategoryId}
          onCategoryChange={handleCategoryChange}
          typeFilter={typeFilter}
          onTypeFilterChange={handleTypeFilterChange}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          includeArchivedCategories={includeArchivedCategories}
          onIncludeArchivedCategoriesChange={setIncludeArchivedCategories}
          hasActiveFilters={hasActiveFilters}
          onResetFilters={resetFilters}
        />

        <div className="report-print-root">
          {dateRangeError ? (
            <EmptyState
              icon={CalendarX2}
              title="Invalid reporting date range"
              description={dateRangeError}
              actionLabel="Reset Filters"
              onAction={resetFilters}
            />
          ) : isLoading ? (
            <div className="space-y-4" aria-label="Loading report">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map((i) => (
                  <Card key={i} variant="surface" className="p-4 space-y-2">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-7 w-28" />
                    <Skeleton className="h-3 w-32" />
                  </Card>
                ))}
              </div>
              <Card variant="surface" className="p-5 space-y-3">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-56 w-full rounded-[10px]" />
              </Card>
            </div>
          ) : isError ? (
            <Card
              variant="surface"
              role="alert"
              className="p-8 text-center border-[#D9827C]/30 bg-[#1B1B1B]"
            >
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[#D9827C]/10 text-[#D9827C] mb-4">
                <AlertCircle className="h-6 w-6" />
              </div>
              <h2 className="text-base font-semibold text-[#F5F1E8] mb-1">
                Unable to generate report
              </h2>
              <p className="text-xs text-[#858078] max-w-md mx-auto mb-5">
                {error?.message || 'An unexpected error occurred while reading local financial records.'}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void refetch()}
                leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
              >
                Retry
              </Button>
            </Card>
          ) : activeTab === 'statement' && accounts.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No accounts available for statements"
              description="Create an account first to generate a chronological ledger statement."
            />
          ) : (
            report && (
              <>
                <PrintableReportHeader
                  report={report}
                  accounts={accounts}
                  categories={categories}
                />

                <TabsContent value="summary" className="mt-0">
                  {summaryReport && (
                    <FinancialSummaryReportView
                      report={summaryReport}
                      hasActiveFilters={hasActiveFilters}
                      onResetFilters={resetFilters}
                    />
                  )}
                </TabsContent>

                <TabsContent value="statement" className="mt-0">
                  {statementReport && (
                    <AccountStatementView
                      report={statementReport}
                      hasActiveFilters={hasActiveFilters}
                      onResetFilters={resetFilters}
                    />
                  )}
                </TabsContent>

                <TabsContent value="category" className="mt-0">
                  {categoryReport && (
                    <CategoryReportView
                      report={categoryReport}
                      hasActiveFilters={hasActiveFilters}
                      onResetFilters={resetFilters}
                    />
                  )}
                </TabsContent>
              </>
            )
          )}
        </div>
      </Tabs>
    </div>
  );
};

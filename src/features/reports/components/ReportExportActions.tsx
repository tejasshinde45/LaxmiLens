import React from 'react';
import { Download, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { FinancialReportDTO } from '@/application';
import {
  buildAccountStatementCsv,
  buildCategoryReportCsv,
  buildFinancialSummaryCsv,
  downloadCsv
} from '../utils/csvExport';
import { printReport } from '../utils/printReport';

export interface ReportExportActionsProps {
  report: FinancialReportDTO | null;
  disabled?: boolean;
}

function buildCsvPayload(report: FinancialReportDTO): {
  csvContent: string;
  filename: string;
  printTitle: string;
} {
  const dateSuffix = `${report.period.startInput}-to-${report.period.endInput}`;

  switch (report.reportType) {
    case 'summary':
      return {
        csvContent: buildFinancialSummaryCsv(report),
        filename: `laxmilens-financial-summary-${dateSuffix}.csv`,
        printTitle: `LaxmiLens Financial Summary - ${report.period.label}`
      };
    case 'statement':
      return {
        csvContent: buildAccountStatementCsv(report),
        filename: `laxmilens-statement-${report.account.name}-${dateSuffix}.csv`,
        printTitle: `LaxmiLens Account Statement - ${report.account.name} (${report.period.label})`
      };
    case 'category':
      return {
        csvContent: buildCategoryReportCsv(report),
        filename: `laxmilens-category-report-${dateSuffix}.csv`,
        printTitle: `LaxmiLens Category Report - ${report.period.label}`
      };
  }
}

export const ReportExportActions: React.FC<ReportExportActionsProps> = ({
  report,
  disabled = false
}) => {
  const isActionDisabled = disabled || !report;

  const handleExportCsv = () => {
    if (!report) return;
    try {
      const { csvContent, filename } = buildCsvPayload(report);
      downloadCsv(csvContent, filename);
      toast.success('Report exported as CSV');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to export CSV report.');
    }
  };

  const handlePrint = () => {
    if (!report) return;
    try {
      const { printTitle } = buildCsvPayload(report);
      printReport(printTitle);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to initiate report print.');
    }
  };

  return (
    <div className="flex items-center gap-2 flex-wrap print:hidden">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isActionDisabled}
        onClick={handleExportCsv}
        leftIcon={<Download className="h-3.5 w-3.5" />}
      >
        Export CSV
      </Button>
      <Button
        type="button"
        variant="primary"
        size="sm"
        disabled={isActionDisabled}
        onClick={handlePrint}
        leftIcon={<Printer className="h-3.5 w-3.5" />}
      >
        Print / Save as PDF
      </Button>
    </div>
  );
};

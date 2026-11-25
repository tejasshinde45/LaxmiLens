import { TransactionType } from '@/domain/entities/Transaction';
import {
  AnalyticsDatePreset,
  CustomDateRangeInput,
  ResolvedAnalyticsPeriod
} from '@/application/services/FinancialAnalyticsService';

export type ReportTabType = 'summary' | 'statement' | 'category';

/**
 * Minimal account shape accepted by FinancialReportService.
 * Compatible with both domain Account entities and AccountWithBalanceDTO/AccountResponseDTO.
 */
export interface ReportAccountRecord {
  id: string;
  userId: string;
  name: string;
  accountType: string;
  openingBalancePaise: number;
  currency?: string;
  institutionName?: string;
  color?: string;
  icon?: string;
  systemTag?: string | null;
  isArchived: boolean;
}

/**
 * Minimal transaction shape accepted by FinancialReportService.
 * Compatible with both domain Transaction entities and TransactionResponseDTO.
 */
export interface ReportTransactionRecord {
  id: string;
  userId: string;
  type: TransactionType;
  amountPaise: number;
  currency?: string;
  accountId: string;
  destinationAccountId?: string;
  targetAccountId?: string;
  categoryId?: string;
  title: string;
  note?: string;
  notes?: string;
  transactionDate: Date | string;
  deletedAt?: Date | string | null;
  isDeleted?: boolean;
  createdAt?: Date | string;
  idempotencyKey?: string;
}

/**
 * Minimal category shape accepted by FinancialReportService.
 * Compatible with both domain Category entities and CategoryResponseDTO.
 */
export interface ReportCategoryRecord {
  id: string;
  userId: string;
  name: string;
  type: 'income' | 'expense';
  icon?: string;
  color?: string;
  isDefault?: boolean;
  isArchived: boolean;
}

export interface ReportFilterCriteria {
  preset: AnalyticsDatePreset;
  customRange?: CustomDateRangeInput;
  /**
   * Multi-account scope for Summary and Category reports.
   * Empty or omitted includes all accounts within system-account scope.
   */
  accountIds?: readonly string[];
  /**
   * Target account ID for Account Statement generation.
   * Falls back to accountIds[0] when exactly one account is supplied there.
   */
  statementAccountId?: string;
  /**
   * Category IDs filter (supports category UUIDs and 'uncategorized').
   */
  categoryIds?: readonly string[];
  /**
   * Transaction type filter. Empty or omitted includes all applicable types.
   */
  types?: readonly TransactionType[];
  /**
   * Case-insensitive substring matched against transaction title and note.
   */
  searchQuery?: string;
  /**
   * Whether transactions mapped to archived categories are included.
   * Defaults to true to preserve historical financial accuracy.
   */
  includeArchivedCategories?: boolean;
  /**
   * Whether system accounts (e.g. Personal Borrowings) are included in scope.
   * Defaults to true.
   */
  includeSystemAccounts?: boolean;
}

export interface AppliedReportFiltersMetadata {
  accountIds: string[];
  statementAccountId?: string;
  categoryIds: string[];
  types: TransactionType[];
  searchQuery: string;
  includeArchivedCategories: boolean;
  includeSystemAccounts: boolean;
}

export interface ReportMetricComparisonDTO {
  currentPaise: number;
  currentFormatted: string;
  previousPaise: number | null;
  previousFormatted: string | null;
  deltaPaise: number | null;
  deltaFormatted: string | null;
  percentageChange: number | null;
  direction: 'increase' | 'decrease' | 'flat' | 'unavailable';
}

export interface SavingsRateComparisonDTO {
  currentPercent: number | null;
  currentFormatted: string;
  previousPercent: number | null;
  previousFormatted: string;
  deltaPercentagePoints: number | null;
  deltaFormatted: string | null;
  direction: 'increase' | 'decrease' | 'flat' | 'unavailable';
}

export interface FinancialSummaryMetricsDTO {
  totalIncomePaise: number;
  totalIncomeFormatted: string;
  totalExpensePaise: number;
  totalExpenseFormatted: string;
  netCashFlowPaise: number;
  netCashFlowFormatted: string;
  savingsRatePercent: number | null;
  savingsRateFormatted: string;
  transfersInPaise: number;
  transfersInFormatted: string;
  transfersOutPaise: number;
  transfersOutFormatted: string;
  netTransfersPaise: number;
  netTransfersFormatted: string;
  totalTransferVolumePaise: number;
  totalTransferVolumeFormatted: string;
  activeTransactionCount: number;
  incomeCount: number;
  expenseCount: number;
  transferCount: number;
}

export interface FinancialSummaryComparisonDTO {
  comparisonAvailable: boolean;
  hasPreviousPeriodData: boolean;
  insufficientDataReason?: string;
  income: ReportMetricComparisonDTO;
  expense: ReportMetricComparisonDTO;
  netCashFlow: ReportMetricComparisonDTO;
  savingsRate: SavingsRateComparisonDTO;
}

export interface SummaryPeriodBucketDTO {
  bucketKey: string;
  label: string;
  incomePaise: number;
  incomeFormatted: string;
  expensePaise: number;
  expenseFormatted: string;
  netCashFlowPaise: number;
  netCashFlowFormatted: string;
  transfersInPaise: number;
  transfersInFormatted: string;
  transfersOutPaise: number;
  transfersOutFormatted: string;
  transactionCount: number;
}

export interface FinancialSummaryReportDTO {
  reportType: 'summary';
  period: ResolvedAnalyticsPeriod;
  appliedFilters: AppliedReportFiltersMetadata;
  metrics: FinancialSummaryMetricsDTO;
  comparison: FinancialSummaryComparisonDTO;
  periodBreakdown: SummaryPeriodBucketDTO[];
  isEmpty: boolean;
}

export interface AccountStatementAccountDTO {
  id: string;
  name: string;
  accountType: string;
  currency: string;
  institutionName?: string;
  isCreditCard: boolean;
  isArchived: boolean;
  isSystemAccount: boolean;
  systemTag?: string;
}

export interface AccountStatementEntryDTO {
  transactionId: string;
  transactionDate: string;
  transactionDateLocal: string;
  createdAt: string;
  type: TransactionType;
  direction: 'credit' | 'debit';
  transferDirection: 'incoming' | 'outgoing' | null;
  title: string;
  note?: string;
  categoryId?: string;
  categoryName?: string;
  categoryArchived: boolean;
  counterpartyAccountId?: string;
  counterpartyAccountName?: string;
  amountPaise: number;
  amountFormatted: string;
  creditPaise: number;
  creditFormatted: string;
  debitPaise: number;
  debitFormatted: string;
  signedDeltaPaise: number;
  signedDeltaFormatted: string;
  runningBalancePaise: number;
  runningBalanceFormatted: string;
  currency: string;
}

export interface AccountStatementBalancesDTO {
  inceptionOpeningBalancePaise: number;
  inceptionOpeningBalanceFormatted: string;
  prePeriodDeltaPaise: number;
  prePeriodDeltaFormatted: string;
  prePeriodTransactionCount: number;
  periodOpeningBalancePaise: number;
  periodOpeningBalanceFormatted: string;
  totalCreditsPaise: number;
  totalCreditsFormatted: string;
  totalDebitsPaise: number;
  totalDebitsFormatted: string;
  totalIncomeCreditsPaise: number;
  totalIncomeCreditsFormatted: string;
  totalTransferCreditsPaise: number;
  totalTransferCreditsFormatted: string;
  totalExpenseDebitsPaise: number;
  totalExpenseDebitsFormatted: string;
  totalTransferDebitsPaise: number;
  totalTransferDebitsFormatted: string;
  netPeriodChangePaise: number;
  netPeriodChangeFormatted: string;
  periodClosingBalancePaise: number;
  periodClosingBalanceFormatted: string;
  currentLiveBalancePaise: number;
  currentLiveBalanceFormatted: string;
  postPeriodTransactionCount: number;
  postPeriodNetDeltaPaise: number;
  postPeriodNetDeltaFormatted: string;
  hasPostPeriodActivity: boolean;
  closingDiffersFromLiveBalance: boolean;
  isCreditCardLiability: boolean;
  balanceSemanticsNote?: string;
}

export interface AccountStatementReportDTO {
  reportType: 'statement';
  period: ResolvedAnalyticsPeriod;
  appliedFilters: AppliedReportFiltersMetadata;
  account: AccountStatementAccountDTO;
  balances: AccountStatementBalancesDTO;
  entries: AccountStatementEntryDTO[];
  totalPeriodEntryCount: number;
  displayedEntryCount: number;
  isSubFiltered: boolean;
  isEmpty: boolean;
}

export interface CategoryBreakdownRowDTO {
  categoryId: string;
  categoryName: string;
  type: 'income' | 'expense';
  categoryIcon?: string;
  categoryColor: string;
  isArchived: boolean;
  totalPaise: number;
  totalFormatted: string;
  percentageShare: number;
  transactionCount: number;
  previousPaise: number | null;
  previousFormatted: string | null;
  deltaPaise: number | null;
  deltaFormatted: string | null;
  percentageChange: number | null;
  direction: 'increase' | 'decrease' | 'flat' | 'new' | 'unavailable';
}

export interface CategoryReportSummaryDTO {
  totalPaise: number;
  totalFormatted: string;
  transactionCount: number;
  categoryCount: number;
  archivedCategoryCount: number;
  previousTotalPaise: number | null;
  previousTotalFormatted: string | null;
  deltaPaise: number | null;
  deltaFormatted: string | null;
  percentageChange: number | null;
  direction: 'increase' | 'decrease' | 'flat' | 'unavailable';
}

export interface CategoryReportDTO {
  reportType: 'category';
  period: ResolvedAnalyticsPeriod;
  appliedFilters: AppliedReportFiltersMetadata;
  expenseSummary: CategoryReportSummaryDTO;
  incomeSummary: CategoryReportSummaryDTO;
  expenseBreakdown: CategoryBreakdownRowDTO[];
  incomeBreakdown: CategoryBreakdownRowDTO[];
  comparisonAvailable: boolean;
  insufficientDataReason?: string;
  excludedTransferCount: number;
  isEmpty: boolean;
}

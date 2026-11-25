import { Transaction, TransactionType } from '@/domain/entities/Transaction';
import { LedgerRules } from '@/domain/rules/LedgerRules';
import {
  AccountNotFoundError,
  InvalidTransactionAmountError,
  TransferAccountMismatchError,
  UnauthorizedEntityAccessError
} from '@/domain/errors/DomainErrors';
import {
  createAccountId,
  createCategoryId,
  createTransactionId,
  createUserId,
  validateUserId
} from '@/domain/value-objects/Identifiers';
import { Money } from '@/domain/value-objects/Money';
import {
  formatLocalDateInput,
  formatLocalMonthKey,
  resolveAnalyticsDateRange,
  safeAddAnalyticsPaise
} from '@/application/services/FinancialAnalyticsService';
import {
  AccountStatementEntryDTO,
  AccountStatementReportDTO,
  AppliedReportFiltersMetadata,
  CategoryBreakdownRowDTO,
  CategoryReportDTO,
  CategoryReportSummaryDTO,
  FinancialSummaryMetricsDTO,
  FinancialSummaryReportDTO,
  ReportAccountRecord,
  ReportCategoryRecord,
  ReportFilterCriteria,
  ReportMetricComparisonDTO,
  ReportTransactionRecord,
  SavingsRateComparisonDTO,
  SummaryPeriodBucketDTO
} from '@/application/dto/ReportDTO';
import { formatDate, formatPaiseToINR } from '@/utils/formatters';

export interface GenerateReportBaseParams {
  userId: string;
  accounts: readonly ReportAccountRecord[];
  transactions: readonly ReportTransactionRecord[];
  categories: readonly ReportCategoryRecord[];
  filters: ReportFilterCriteria;
  now?: Date;
}

const EXPENSE_FALLBACK_COLORS = [
  '#D9827C',
  '#E4B66D',
  '#D6AD60',
  '#82A9CF',
  '#B9B4AA'
] as const;

const INCOME_FALLBACK_COLORS = [
  '#72B895',
  '#D6AD60',
  '#82A9CF',
  '#E4B66D',
  '#B9B4AA'
] as const;

interface NormalizedTransaction {
  record: ReportTransactionRecord;
  date: Date;
  createdAt: Date;
  destinationAccountId?: string;
  note?: string;
  currency: string;
  domainEntity: Transaction;
}

interface NormalizedInputs {
  userId: string;
  now: Date;
  allAccountMap: Map<string, ReportAccountRecord>;
  reportableAccountIds: Set<string>;
  categoryMap: Map<string, ReportCategoryRecord>;
  activeTransactions: NormalizedTransaction[];
  appliedFilters: AppliedReportFiltersMetadata;
}

/**
 * Local helper matching FinancialAnalyticsService.safeAddAnalyticsPaise for signed subtraction.
 * Kept local so FinancialAnalyticsService.ts remains unmodified in Stage 1.
 */
function safeSubtractReportPaise(a: number, b: number): number {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) {
    throw new InvalidTransactionAmountError(
      `Invalid monetary amount in report calculation: expected safe integers, received ${a} and ${b}.`
    );
  }
  const diff = a - b;
  if (!Number.isSafeInteger(diff)) {
    throw new InvalidTransactionAmountError(
      'Calculated monetary difference exceeds Number.MAX_SAFE_INTEGER.'
    );
  }
  return diff;
}

/**
 * Local calendar start-of-day helper aligned with FinancialAnalyticsService.
 * Kept private because FinancialAnalyticsService's own startOfLocalDay is module-private.
 */
function startOfLocalDay(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  d.setFullYear(date.getFullYear());
  return d;
}

function parseReportDate(raw: Date | string, txId: string, fieldName: string): Date {
  const d = raw instanceof Date ? new Date(raw.getTime()) : new Date(raw);
  if (isNaN(d.getTime())) {
    throw new Error(`Transaction '${txId}' contains an invalid ${fieldName}.`);
  }
  return d;
}

function isSoftDeletedRecord(tx: ReportTransactionRecord): boolean {
  return Boolean(tx.isDeleted) || (tx.deletedAt !== null && tx.deletedAt !== undefined);
}

function formatSignedDeltaPaise(deltaPaise: number): string {
  if (deltaPaise > 0) {
    return `+${formatPaiseToINR(deltaPaise)}`;
  }
  return formatPaiseToINR(deltaPaise);
}

function calculateSavingsRatePercent(incomePaise: number, expensePaise: number): number | null {
  if (incomePaise <= 0) {
    return null;
  }
  const net = safeSubtractReportPaise(incomePaise, expensePaise);
  return Math.round((net / incomePaise) * 1000) / 10;
}

function formatSavingsRate(percent: number | null): string {
  if (percent === null) {
    return '—';
  }
  return `${percent.toFixed(1).replace(/\.0$/, '')}%`;
}

function buildMetricComparison(
  currentPaise: number,
  previousPaise: number | null
): ReportMetricComparisonDTO {
  if (previousPaise === null) {
    return {
      currentPaise,
      currentFormatted: formatPaiseToINR(currentPaise),
      previousPaise: null,
      previousFormatted: null,
      deltaPaise: null,
      deltaFormatted: null,
      percentageChange: null,
      direction: 'unavailable'
    };
  }

  const deltaPaise = safeSubtractReportPaise(currentPaise, previousPaise);
  const percentageChange =
    previousPaise !== 0
      ? Math.round((deltaPaise / Math.abs(previousPaise)) * 1000) / 10
      : null;

  return {
    currentPaise,
    currentFormatted: formatPaiseToINR(currentPaise),
    previousPaise,
    previousFormatted: formatPaiseToINR(previousPaise),
    deltaPaise,
    deltaFormatted: formatSignedDeltaPaise(deltaPaise),
    percentageChange,
    direction: deltaPaise > 0 ? 'increase' : deltaPaise < 0 ? 'decrease' : 'flat'
  };
}

function buildSavingsRateComparison(
  currentPercent: number | null,
  previousPercent: number | null,
  comparisonAvailable: boolean
): SavingsRateComparisonDTO {
  if (!comparisonAvailable || currentPercent === null || previousPercent === null) {
    return {
      currentPercent,
      currentFormatted: formatSavingsRate(currentPercent),
      previousPercent,
      previousFormatted: formatSavingsRate(previousPercent),
      deltaPercentagePoints: null,
      deltaFormatted: null,
      direction: 'unavailable'
    };
  }

  const deltaPoints = Math.round((currentPercent - previousPercent) * 10) / 10;
  const absFormatted = `${Math.abs(deltaPoints).toFixed(1).replace(/\.0$/, '')} pp`;
  const deltaFormatted =
    deltaPoints > 0 ? `+${absFormatted}` : deltaPoints < 0 ? `-${absFormatted}` : '0 pp';

  return {
    currentPercent,
    currentFormatted: formatSavingsRate(currentPercent),
    previousPercent,
    previousFormatted: formatSavingsRate(previousPercent),
    deltaPercentagePoints: deltaPoints,
    deltaFormatted,
    direction: deltaPoints > 0 ? 'increase' : deltaPoints < 0 ? 'decrease' : 'flat'
  };
}

function resolveEffectiveCategory(
  tx: NormalizedTransaction,
  categoryMap: Map<string, ReportCategoryRecord>
): {
  categoryId: string;
  category?: ReportCategoryRecord;
} {
  if (tx.record.type === 'transfer') {
    return { categoryId: 'uncategorized', category: undefined };
  }

  const rawId = tx.record.categoryId;
  if (!rawId) {
    return { categoryId: 'uncategorized', category: undefined };
  }

  const matched = categoryMap.get(rawId);
  if (!matched || matched.type !== tx.record.type) {
    return { categoryId: 'uncategorized', category: undefined };
  }

  return { categoryId: matched.id, category: matched };
}

function matchesSearchText(tx: NormalizedTransaction, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  const titleMatch = tx.record.title.toLowerCase().includes(normalizedQuery);
  const noteMatch = (tx.note ?? '').toLowerCase().includes(normalizedQuery);
  return titleMatch || noteMatch;
}

function buildAppliedFilters(filters: ReportFilterCriteria): AppliedReportFiltersMetadata {
  const uniqueAccountIds = Array.from(
    new Set((filters.accountIds ?? []).map((id) => id.trim()).filter(Boolean))
  );
  const uniqueCategoryIds = Array.from(
    new Set((filters.categoryIds ?? []).map((id) => id.trim()).filter(Boolean))
  );
  const uniqueTypes = Array.from(new Set(filters.types ?? []));

  return {
    accountIds: uniqueAccountIds,
    statementAccountId: filters.statementAccountId?.trim() || undefined,
    categoryIds: uniqueCategoryIds,
    types: uniqueTypes,
    searchQuery: (filters.searchQuery ?? '').trim(),
    includeArchivedCategories: filters.includeArchivedCategories ?? true,
    includeSystemAccounts: filters.includeSystemAccounts ?? true
  };
}

function validateAndNormalizeInputs(params: GenerateReportBaseParams): NormalizedInputs {
  const validatedUserId = validateUserId(params.userId);
  const now = params.now ? new Date(params.now.getTime()) : new Date();
  const appliedFilters = buildAppliedFilters(params.filters);

  const allAccountMap = new Map<string, ReportAccountRecord>();
  const reportableAccountIds = new Set<string>();

  for (const acc of params.accounts) {
    if (acc.userId !== validatedUserId) {
      throw new UnauthorizedEntityAccessError('Account', acc.id);
    }
    if (!Number.isSafeInteger(acc.openingBalancePaise)) {
      throw new InvalidTransactionAmountError(
        `Account '${acc.id}' has non-integer openingBalancePaise '${acc.openingBalancePaise}'.`
      );
    }
    allAccountMap.set(acc.id, acc);
    const isSystem = Boolean(acc.systemTag && acc.systemTag.trim().length > 0);
    if (appliedFilters.includeSystemAccounts || !isSystem) {
      reportableAccountIds.add(acc.id);
    }
  }

  const categoryMap = new Map<string, ReportCategoryRecord>();
  for (const cat of params.categories) {
    if (cat.userId !== validatedUserId && !cat.isDefault) {
      throw new UnauthorizedEntityAccessError('Category', cat.id);
    }
    categoryMap.set(cat.id, cat);
  }

  const activeTransactions: NormalizedTransaction[] = [];

  for (const tx of params.transactions) {
    if (tx.userId !== validatedUserId) {
      throw new UnauthorizedEntityAccessError('Transaction', tx.id);
    }

    if (isSoftDeletedRecord(tx)) {
      continue;
    }

    const currency = tx.currency ?? 'INR';
    const money = Money.fromPaise(tx.amountPaise, currency);
    if (!money.isPositive()) {
      throw new InvalidTransactionAmountError(
        `Transaction '${tx.id}' has non-positive amountPaise '${tx.amountPaise}'.`
      );
    }

    const destinationAccountId = tx.destinationAccountId ?? tx.targetAccountId;
    if (tx.type === 'transfer') {
      if (!destinationAccountId || destinationAccountId === tx.accountId) {
        throw new TransferAccountMismatchError(
          `Transfer transaction '${tx.id}' must specify distinct source and destination accounts.`
        );
      }
    }

    const date = parseReportDate(tx.transactionDate, tx.id, 'transactionDate');
    const createdAt =
      tx.createdAt !== undefined
        ? parseReportDate(tx.createdAt, tx.id, 'createdAt')
        : date;
    const note = (tx.note ?? tx.notes)?.trim();

    const domainEntity =
      tx instanceof Transaction
        ? tx
        : new Transaction({
            id: createTransactionId(tx.id),
            userId: createUserId(tx.userId),
            type: tx.type,
            amountPaise: tx.amountPaise,
            currency,
            accountId: createAccountId(tx.accountId),
            destinationAccountId: destinationAccountId
              ? createAccountId(destinationAccountId)
              : undefined,
            categoryId: tx.categoryId ? createCategoryId(tx.categoryId) : undefined,
            title:
              tx.title && tx.title.trim().length > 0 ? tx.title.trim() : 'Untitled Transaction',
            note,
            transactionDate: date,
            deletedAt: null,
            idempotencyKey:
              tx.idempotencyKey && tx.idempotencyKey.trim().length > 0
                ? tx.idempotencyKey
                : tx.id,
            createdAt
          });

    activeTransactions.push({
      record: tx,
      date,
      createdAt,
      destinationAccountId,
      note,
      currency,
      domainEntity
    });
  }

  return {
    userId: validatedUserId,
    now,
    allAccountMap,
    reportableAccountIds,
    categoryMap,
    activeTransactions,
    appliedFilters
  };
}

function createScopedAccountSet(
  appliedFilters: AppliedReportFiltersMetadata,
  reportableAccountIds: Set<string>
): Set<string> | null {
  if (appliedFilters.accountIds.length === 0) {
    return null;
  }
  const selected = new Set<string>();
  for (const id of appliedFilters.accountIds) {
    if (reportableAccountIds.has(id)) {
      selected.add(id);
    }
  }
  return selected;
}

function isAccountInScope(
  accountId: string,
  allAccountMap: Map<string, ReportAccountRecord>,
  reportableAccountIds: Set<string>,
  selectedAccountSet: Set<string> | null,
  includeSystemAccounts: boolean
): boolean {
  if (selectedAccountSet !== null) {
    return selectedAccountSet.has(accountId);
  }
  if (!includeSystemAccounts) {
    const acc = allAccountMap.get(accountId);
    if (acc && acc.systemTag && acc.systemTag.trim().length > 0) {
      return false;
    }
  }
  if (allAccountMap.has(accountId)) {
    return reportableAccountIds.has(accountId);
  }
  return true;
}

function evaluateCashflowOrCategoryScope(
  tx: NormalizedTransaction,
  inputs: NormalizedInputs,
  selectedAccountSet: Set<string> | null,
  selectedTypeSet: Set<TransactionType> | null,
  selectedCategorySet: Set<string> | null,
  normalizedQuery: string
): {
  included: boolean;
  transferIn: boolean;
  transferOut: boolean;
  effectiveCategoryId: string;
  matchedCategory?: ReportCategoryRecord;
} {
  const { allAccountMap, reportableAccountIds, categoryMap, appliedFilters } = inputs;

  if (selectedTypeSet !== null && !selectedTypeSet.has(tx.record.type)) {
    return {
      included: false,
      transferIn: false,
      transferOut: false,
      effectiveCategoryId: 'uncategorized'
    };
  }

  if (!matchesSearchText(tx, normalizedQuery)) {
    return {
      included: false,
      transferIn: false,
      transferOut: false,
      effectiveCategoryId: 'uncategorized'
    };
  }

  if (tx.record.type === 'transfer') {
    // Transfers never carry income/expense categories, so any active category filter rejects them.
    if (selectedCategorySet !== null) {
      return {
        included: false,
        transferIn: false,
        transferOut: false,
        effectiveCategoryId: 'uncategorized'
      };
    }

    const outInScope = isAccountInScope(
      tx.record.accountId,
      allAccountMap,
      reportableAccountIds,
      selectedAccountSet,
      appliedFilters.includeSystemAccounts
    );
    const inInScope = tx.destinationAccountId
      ? isAccountInScope(
          tx.destinationAccountId,
          allAccountMap,
          reportableAccountIds,
          selectedAccountSet,
          appliedFilters.includeSystemAccounts
        )
      : false;

    return {
      included: outInScope || inInScope,
      transferIn: inInScope,
      transferOut: outInScope,
      effectiveCategoryId: 'uncategorized'
    };
  }

  const accountIncluded = isAccountInScope(
    tx.record.accountId,
    allAccountMap,
    reportableAccountIds,
    selectedAccountSet,
    appliedFilters.includeSystemAccounts
  );

  if (!accountIncluded) {
    return {
      included: false,
      transferIn: false,
      transferOut: false,
      effectiveCategoryId: 'uncategorized'
    };
  }

  const resolvedCat = resolveEffectiveCategory(tx, categoryMap);
  if (!appliedFilters.includeArchivedCategories && resolvedCat.category?.isArchived) {
    return {
      included: false,
      transferIn: false,
      transferOut: false,
      effectiveCategoryId: resolvedCat.categoryId,
      matchedCategory: resolvedCat.category
    };
  }

  if (selectedCategorySet !== null && !selectedCategorySet.has(resolvedCat.categoryId)) {
    return {
      included: false,
      transferIn: false,
      transferOut: false,
      effectiveCategoryId: resolvedCat.categoryId,
      matchedCategory: resolvedCat.category
    };
  }

  return {
    included: true,
    transferIn: false,
    transferOut: false,
    effectiveCategoryId: resolvedCat.categoryId,
    matchedCategory: resolvedCat.category
  };
}

function compareAccountEntriesAsc(a: NormalizedTransaction, b: NormalizedTransaction): number {
  const dateDiff = a.date.getTime() - b.date.getTime();
  if (dateDiff !== 0) {
    return dateDiff;
  }
  const createdDiff = a.createdAt.getTime() - b.createdAt.getTime();
  if (createdDiff !== 0) {
    return createdDiff;
  }
  return a.record.id.localeCompare(b.record.id);
}

/**
 * FinancialReportService
 *
 * Pure, deterministic application service generating Financial Summary,
 * Account Statement, and Category Reports strictly in integer paise.
 * Contains zero side effects or React/DOM/storage/network dependencies.
 */
export class FinancialReportService {
  /**
   * Generates a Financial Summary report covering income, expenses, net cash flow,
   * savings rate, separated transfers in/out, periodic breakdown, and prior-period comparison.
   */
  public static generateFinancialSummary(
    params: GenerateReportBaseParams
  ): FinancialSummaryReportDTO {
    const inputs = validateAndNormalizeInputs(params);
    const { appliedFilters, activeTransactions, now, reportableAccountIds } = inputs;

    const period = resolveAnalyticsDateRange(
      params.filters.preset,
      now,
      params.filters.customRange,
      activeTransactions.map((t) => t.record)
    );

    const selectedAccountSet = createScopedAccountSet(appliedFilters, reportableAccountIds);
    const selectedCategorySet =
      appliedFilters.categoryIds.length > 0 ? new Set(appliedFilters.categoryIds) : null;
    const selectedTypeSet =
      appliedFilters.types.length > 0 ? new Set(appliedFilters.types) : null;
    const normalizedQuery = appliedFilters.searchQuery.toLowerCase();

    const bucketOrder: string[] = [];
    const bucketMap = new Map<
      string,
      {
        label: string;
        incomePaise: number;
        expensePaise: number;
        transfersInPaise: number;
        transfersOutPaise: number;
        transactionCount: number;
      }
    >();

    if (period.granularity === 'daily') {
      const cursor = startOfLocalDay(period.range.startDate);
      const endDay = startOfLocalDay(period.range.endDate);
      while (cursor.getTime() <= endDay.getTime()) {
        const key = formatLocalDateInput(cursor);
        bucketOrder.push(key);
        bucketMap.set(key, {
          label: formatDate(cursor, 'dd MMM'),
          incomePaise: 0,
          expensePaise: 0,
          transfersInPaise: 0,
          transfersOutPaise: 0,
          transactionCount: 0
        });
        cursor.setDate(cursor.getDate() + 1);
      }
    } else {
      const cursor = new Date(
        period.range.startDate.getFullYear(),
        period.range.startDate.getMonth(),
        1
      );
      const endMonth = new Date(
        period.range.endDate.getFullYear(),
        period.range.endDate.getMonth(),
        1
      );
      while (cursor.getTime() <= endMonth.getTime()) {
        const key = formatLocalMonthKey(cursor);
        bucketOrder.push(key);
        bucketMap.set(key, {
          label: formatDate(cursor, 'MMM yyyy'),
          incomePaise: 0,
          expensePaise: 0,
          transfersInPaise: 0,
          transfersOutPaise: 0,
          transactionCount: 0
        });
        cursor.setMonth(cursor.getMonth() + 1);
      }
    }

    const currentCashflowEntities: Transaction[] = [];
    let transfersInPaise = 0;
    let transfersOutPaise = 0;
    let totalTransferVolumePaise = 0;
    let incomeCount = 0;
    let expenseCount = 0;
    let transferCount = 0;

    let prevIncomePaise = 0;
    let prevExpensePaise = 0;
    let prevActivityCount = 0;

    for (const tx of activeTransactions) {
      const scope = evaluateCashflowOrCategoryScope(
        tx,
        inputs,
        selectedAccountSet,
        selectedTypeSet,
        selectedCategorySet,
        normalizedQuery
      );

      if (!scope.included) {
        continue;
      }

      if (period.range.contains(tx.date)) {
        const bucketKey =
          period.granularity === 'daily'
            ? formatLocalDateInput(tx.date)
            : formatLocalMonthKey(tx.date);
        const bucket = bucketMap.get(bucketKey);

        if (tx.record.type === 'transfer') {
          transferCount++;
          totalTransferVolumePaise = safeAddAnalyticsPaise(
            totalTransferVolumePaise,
            tx.record.amountPaise
          );
          if (scope.transferIn) {
            transfersInPaise = safeAddAnalyticsPaise(transfersInPaise, tx.record.amountPaise);
          }
          if (scope.transferOut) {
            transfersOutPaise = safeAddAnalyticsPaise(transfersOutPaise, tx.record.amountPaise);
          }
          if (bucket) {
            bucket.transactionCount++;
            if (scope.transferIn) {
              bucket.transfersInPaise = safeAddAnalyticsPaise(
                bucket.transfersInPaise,
                tx.record.amountPaise
              );
            }
            if (scope.transferOut) {
              bucket.transfersOutPaise = safeAddAnalyticsPaise(
                bucket.transfersOutPaise,
                tx.record.amountPaise
              );
            }
          }
        } else {
          currentCashflowEntities.push(tx.domainEntity);
          if (tx.record.type === 'income') {
            incomeCount++;
            if (bucket) {
              bucket.incomePaise = safeAddAnalyticsPaise(bucket.incomePaise, tx.record.amountPaise);
              bucket.transactionCount++;
            }
          } else {
            expenseCount++;
            if (bucket) {
              bucket.expensePaise = safeAddAnalyticsPaise(
                bucket.expensePaise,
                tx.record.amountPaise
              );
              bucket.transactionCount++;
            }
          }
        }
      } else if (period.previousRange && period.previousRange.contains(tx.date)) {
        prevActivityCount++;
        if (tx.record.type === 'income') {
          prevIncomePaise = safeAddAnalyticsPaise(prevIncomePaise, tx.record.amountPaise);
        } else if (tx.record.type === 'expense') {
          prevExpensePaise = safeAddAnalyticsPaise(prevExpensePaise, tx.record.amountPaise);
        }
      }
    }

    // Use LedgerRules.calculateTotals for authoritative cashflow aggregation and transfer exclusion.
    const ledgerTotals = LedgerRules.calculateTotals(currentCashflowEntities);
    const totalIncomePaise = ledgerTotals.totalIncome.paise;
    const totalExpensePaise = ledgerTotals.totalExpense.paise;
    const netCashFlowPaise = ledgerTotals.netSavings.paise;
    const savingsRatePercent = calculateSavingsRatePercent(totalIncomePaise, totalExpensePaise);
    const netTransfersPaise = safeSubtractReportPaise(transfersInPaise, transfersOutPaise);

    const metrics: FinancialSummaryMetricsDTO = {
      totalIncomePaise,
      totalIncomeFormatted: formatPaiseToINR(totalIncomePaise),
      totalExpensePaise,
      totalExpenseFormatted: formatPaiseToINR(totalExpensePaise),
      netCashFlowPaise,
      netCashFlowFormatted: formatPaiseToINR(netCashFlowPaise),
      savingsRatePercent,
      savingsRateFormatted: formatSavingsRate(savingsRatePercent),
      transfersInPaise,
      transfersInFormatted: formatPaiseToINR(transfersInPaise),
      transfersOutPaise,
      transfersOutFormatted: formatPaiseToINR(transfersOutPaise),
      netTransfersPaise,
      netTransfersFormatted: formatPaiseToINR(netTransfersPaise),
      totalTransferVolumePaise,
      totalTransferVolumeFormatted: formatPaiseToINR(totalTransferVolumePaise),
      activeTransactionCount: incomeCount + expenseCount + transferCount,
      incomeCount,
      expenseCount,
      transferCount
    };

    const comparisonAvailable = period.previousRange !== null;
    const hasPreviousPeriodData = comparisonAvailable && prevActivityCount > 0;
    const prevNetCashFlowPaise = comparisonAvailable
      ? safeSubtractReportPaise(prevIncomePaise, prevExpensePaise)
      : null;
    const prevSavingsRate = comparisonAvailable
      ? calculateSavingsRatePercent(prevIncomePaise, prevExpensePaise)
      : null;

    const comparison = {
      comparisonAvailable,
      hasPreviousPeriodData,
      insufficientDataReason: !comparisonAvailable
        ? 'No prior equivalent period exists for All Time.'
        : !hasPreviousPeriodData
        ? 'No matching activity recorded in the prior period.'
        : undefined,
      income: buildMetricComparison(
        totalIncomePaise,
        comparisonAvailable ? prevIncomePaise : null
      ),
      expense: buildMetricComparison(
        totalExpensePaise,
        comparisonAvailable ? prevExpensePaise : null
      ),
      netCashFlow: buildMetricComparison(netCashFlowPaise, prevNetCashFlowPaise),
      savingsRate: buildSavingsRateComparison(
        savingsRatePercent,
        prevSavingsRate,
        comparisonAvailable
      )
    };

    const periodBreakdown: SummaryPeriodBucketDTO[] = bucketOrder.map((key) => {
      const b = bucketMap.get(key)!;
      const bucketNet = safeSubtractReportPaise(b.incomePaise, b.expensePaise);
      return {
        bucketKey: key,
        label: b.label,
        incomePaise: b.incomePaise,
        incomeFormatted: formatPaiseToINR(b.incomePaise),
        expensePaise: b.expensePaise,
        expenseFormatted: formatPaiseToINR(b.expensePaise),
        netCashFlowPaise: bucketNet,
        netCashFlowFormatted: formatPaiseToINR(bucketNet),
        transfersInPaise: b.transfersInPaise,
        transfersInFormatted: formatPaiseToINR(b.transfersInPaise),
        transfersOutPaise: b.transfersOutPaise,
        transfersOutFormatted: formatPaiseToINR(b.transfersOutPaise),
        transactionCount: b.transactionCount
      };
    });

    return {
      reportType: 'summary',
      period,
      appliedFilters,
      metrics,
      comparison,
      periodBreakdown,
      isEmpty: metrics.activeTransactionCount === 0
    };
  }

  /**
   * Generates a chronological Account Statement for a single account with period opening
   * balance roll-forward, running balance per entry, period closing balance, and current live balance.
   */
  public static generateAccountStatement(
    params: GenerateReportBaseParams
  ): AccountStatementReportDTO {
    const inputs = validateAndNormalizeInputs(params);
    const { appliedFilters, allAccountMap, categoryMap, activeTransactions, now } = inputs;

    const targetAccountId =
      appliedFilters.statementAccountId ||
      (appliedFilters.accountIds.length === 1 ? appliedFilters.accountIds[0] : undefined);

    if (!targetAccountId) {
      throw new AccountNotFoundError('');
    }

    const targetAccount = allAccountMap.get(targetAccountId);
    if (!targetAccount) {
      throw new AccountNotFoundError(targetAccountId);
    }

    const period = resolveAnalyticsDateRange(
      params.filters.preset,
      now,
      params.filters.customRange,
      activeTransactions.map((t) => t.record)
    );

    const accountCurrency = targetAccount.currency ?? 'INR';
    const isCreditCard = targetAccount.accountType === 'credit_card';
    const isSystemAccount = Boolean(
      targetAccount.systemTag && targetAccount.systemTag.trim().length > 0
    );

    // Collect every active transaction affecting this account (source or destination).
    const accountTransactions: NormalizedTransaction[] = [];
    for (const tx of activeTransactions) {
      if (tx.record.accountId === targetAccount.id || tx.destinationAccountId === targetAccount.id) {
        accountTransactions.push(tx);
      }
    }

    // Partition by period boundaries and sort in-period chronologically ascending.
    const prePeriodTxs: NormalizedTransaction[] = [];
    const inPeriodTxs: NormalizedTransaction[] = [];
    const postPeriodTxs: NormalizedTransaction[] = [];

    const periodStartMs = period.range.startDate.getTime();
    const periodEndMs = period.range.endDate.getTime();

    for (const tx of accountTransactions) {
      const timeMs = tx.date.getTime();
      if (timeMs < periodStartMs) {
        prePeriodTxs.push(tx);
      } else if (timeMs > periodEndMs) {
        postPeriodTxs.push(tx);
      } else {
        inPeriodTxs.push(tx);
      }
    }

    inPeriodTxs.sort(compareAccountEntriesAsc);

    // Compute pre-period opening balance using LedgerRules on prePeriod transactions only.
    const inceptionMoney = Money.fromPaise(targetAccount.openingBalancePaise, accountCurrency);
    const targetDomainAccountId = createAccountId(targetAccount.id);

    const periodOpeningMoney = LedgerRules.calculateAccountBalance(
      inceptionMoney,
      targetDomainAccountId,
      prePeriodTxs.map((t) => t.domainEntity)
    );

    // Compute true current live balance across all active transactions for this account.
    const currentLiveMoney = LedgerRules.calculateAccountBalance(
      inceptionMoney,
      targetDomainAccountId,
      accountTransactions.map((t) => t.domainEntity)
    );

    const periodOpeningBalancePaise = periodOpeningMoney.paise;
    const prePeriodDeltaPaise = safeSubtractReportPaise(
      periodOpeningBalancePaise,
      targetAccount.openingBalancePaise
    );

    // Compute post-period net delta strictly using integer paise.
    const closingBeforePost = LedgerRules.calculateAccountBalance(
      periodOpeningMoney,
      targetDomainAccountId,
      inPeriodTxs.map((t) => t.domainEntity)
    );
    const postPeriodNetDeltaPaise = safeSubtractReportPaise(
      currentLiveMoney.paise,
      closingBeforePost.paise
    );

    // Walk sorted in-period ledger chronologically to compute running balances and statement totals.
    let runningBalancePaise = periodOpeningBalancePaise;
    let totalCreditsPaise = 0;
    let totalDebitsPaise = 0;
    let totalIncomeCreditsPaise = 0;
    let totalTransferCreditsPaise = 0;
    let totalExpenseDebitsPaise = 0;
    let totalTransferDebitsPaise = 0;

    const selectedTypeSet =
      appliedFilters.types.length > 0 ? new Set(appliedFilters.types) : null;
    const selectedCategorySet =
      appliedFilters.categoryIds.length > 0 ? new Set(appliedFilters.categoryIds) : null;
    const normalizedQuery = appliedFilters.searchQuery.toLowerCase();
    const isSubFiltered =
      selectedTypeSet !== null ||
      selectedCategorySet !== null ||
      normalizedQuery.length > 0 ||
      !appliedFilters.includeArchivedCategories;

    const entries: AccountStatementEntryDTO[] = [];

    for (const tx of inPeriodTxs) {
      let direction: 'credit' | 'debit';
      let transferDirection: 'incoming' | 'outgoing' | null = null;
      let creditPaise = 0;
      let debitPaise = 0;
      let signedDeltaPaise = 0;
      let counterpartyAccountId: string | undefined;
      let counterpartyAccountName: string | undefined;

      if (tx.record.type === 'income') {
        direction = 'credit';
        creditPaise = tx.record.amountPaise;
        signedDeltaPaise = tx.record.amountPaise;
        totalIncomeCreditsPaise = safeAddAnalyticsPaise(totalIncomeCreditsPaise, creditPaise);
        totalCreditsPaise = safeAddAnalyticsPaise(totalCreditsPaise, creditPaise);
      } else if (tx.record.type === 'expense') {
        direction = 'debit';
        debitPaise = tx.record.amountPaise;
        signedDeltaPaise = -tx.record.amountPaise;
        totalExpenseDebitsPaise = safeAddAnalyticsPaise(totalExpenseDebitsPaise, debitPaise);
        totalDebitsPaise = safeAddAnalyticsPaise(totalDebitsPaise, debitPaise);
      } else if (tx.record.accountId === targetAccount.id) {
        direction = 'debit';
        transferDirection = 'outgoing';
        debitPaise = tx.record.amountPaise;
        signedDeltaPaise = -tx.record.amountPaise;
        totalTransferDebitsPaise = safeAddAnalyticsPaise(totalTransferDebitsPaise, debitPaise);
        totalDebitsPaise = safeAddAnalyticsPaise(totalDebitsPaise, debitPaise);
        counterpartyAccountId = tx.destinationAccountId;
        counterpartyAccountName = counterpartyAccountId
          ? allAccountMap.get(counterpartyAccountId)?.name ?? 'Unknown Account'
          : 'Unknown Account';
      } else {
        direction = 'credit';
        transferDirection = 'incoming';
        creditPaise = tx.record.amountPaise;
        signedDeltaPaise = tx.record.amountPaise;
        totalTransferCreditsPaise = safeAddAnalyticsPaise(totalTransferCreditsPaise, creditPaise);
        totalCreditsPaise = safeAddAnalyticsPaise(totalCreditsPaise, creditPaise);
        counterpartyAccountId = tx.record.accountId;
        counterpartyAccountName =
          allAccountMap.get(tx.record.accountId)?.name ?? 'Unknown Account';
      }

      runningBalancePaise = safeAddAnalyticsPaise(runningBalancePaise, signedDeltaPaise);

      const resolvedCat =
        tx.record.type === 'transfer' ? undefined : resolveEffectiveCategory(tx, categoryMap);

      // Apply optional row-level display filters after preserving exact ledger running balance.
      let includeRow = true;
      if (selectedTypeSet !== null && !selectedTypeSet.has(tx.record.type)) {
        includeRow = false;
      }
      if (includeRow && !matchesSearchText(tx, normalizedQuery)) {
        includeRow = false;
      }
      if (includeRow && selectedCategorySet !== null) {
        if (tx.record.type === 'transfer') {
          includeRow = false;
        } else if (resolvedCat && !selectedCategorySet.has(resolvedCat.categoryId)) {
          includeRow = false;
        }
      }
      if (
        includeRow &&
        !appliedFilters.includeArchivedCategories &&
        resolvedCat?.category?.isArchived
      ) {
        includeRow = false;
      }

      if (!includeRow) {
        continue;
      }

      entries.push({
        transactionId: tx.record.id,
        transactionDate: tx.date.toISOString(),
        transactionDateLocal: formatLocalDateInput(tx.date),
        createdAt: tx.createdAt.toISOString(),
        type: tx.record.type,
        direction,
        transferDirection,
        title: tx.record.title,
        note: tx.note,
        categoryId: tx.record.type === 'transfer' ? undefined : resolvedCat?.categoryId,
        categoryName:
          tx.record.type === 'transfer'
            ? undefined
            : resolvedCat?.category?.name ?? 'Uncategorized',
        categoryArchived: Boolean(resolvedCat?.category?.isArchived),
        counterpartyAccountId,
        counterpartyAccountName,
        amountPaise: tx.record.amountPaise,
        amountFormatted: formatPaiseToINR(tx.record.amountPaise),
        creditPaise,
        creditFormatted: creditPaise > 0 ? formatPaiseToINR(creditPaise) : '',
        debitPaise,
        debitFormatted: debitPaise > 0 ? formatPaiseToINR(debitPaise) : '',
        signedDeltaPaise,
        signedDeltaFormatted: formatSignedDeltaPaise(signedDeltaPaise),
        runningBalancePaise,
        runningBalanceFormatted: formatPaiseToINR(runningBalancePaise),
        currency: tx.currency
      });
    }

    const netPeriodChangePaise = safeSubtractReportPaise(totalCreditsPaise, totalDebitsPaise);
    const periodClosingBalancePaise = runningBalancePaise;
    const currentLiveBalancePaise = currentLiveMoney.paise;
    const hasPostPeriodActivity = postPeriodTxs.length > 0;
    const closingDiffersFromLiveBalance = periodClosingBalancePaise !== currentLiveBalancePaise;
    const isCreditCardLiability = isCreditCard && currentLiveBalancePaise < 0;

    const noteParts: string[] = [];
    if (isCreditCard && (periodClosingBalancePaise < 0 || currentLiveBalancePaise < 0)) {
      noteParts.push('Negative credit-card balance represents amount owed.');
    }
    if (hasPostPeriodActivity) {
      noteParts.push(
        `${postPeriodTxs.length} post-period transaction${postPeriodTxs.length === 1 ? '' : 's'} occurred after ${period.endInput}; current live balance reflects activity beyond the statement period.`
      );
    }

    return {
      reportType: 'statement',
      period,
      appliedFilters,
      account: {
        id: targetAccount.id,
        name: targetAccount.name,
        accountType: targetAccount.accountType,
        currency: accountCurrency,
        institutionName: targetAccount.institutionName,
        isCreditCard,
        isArchived: targetAccount.isArchived,
        isSystemAccount,
        systemTag: targetAccount.systemTag?.trim() || undefined
      },
      balances: {
        inceptionOpeningBalancePaise: targetAccount.openingBalancePaise,
        inceptionOpeningBalanceFormatted: formatPaiseToINR(targetAccount.openingBalancePaise),
        prePeriodDeltaPaise,
        prePeriodDeltaFormatted: formatSignedDeltaPaise(prePeriodDeltaPaise),
        prePeriodTransactionCount: prePeriodTxs.length,
        periodOpeningBalancePaise,
        periodOpeningBalanceFormatted: formatPaiseToINR(periodOpeningBalancePaise),
        totalCreditsPaise,
        totalCreditsFormatted: formatPaiseToINR(totalCreditsPaise),
        totalDebitsPaise,
        totalDebitsFormatted: formatPaiseToINR(totalDebitsPaise),
        totalIncomeCreditsPaise,
        totalIncomeCreditsFormatted: formatPaiseToINR(totalIncomeCreditsPaise),
        totalTransferCreditsPaise,
        totalTransferCreditsFormatted: formatPaiseToINR(totalTransferCreditsPaise),
        totalExpenseDebitsPaise,
        totalExpenseDebitsFormatted: formatPaiseToINR(totalExpenseDebitsPaise),
        totalTransferDebitsPaise,
        totalTransferDebitsFormatted: formatPaiseToINR(totalTransferDebitsPaise),
        netPeriodChangePaise,
        netPeriodChangeFormatted: formatSignedDeltaPaise(netPeriodChangePaise),
        periodClosingBalancePaise,
        periodClosingBalanceFormatted: formatPaiseToINR(periodClosingBalancePaise),
        currentLiveBalancePaise,
        currentLiveBalanceFormatted: formatPaiseToINR(currentLiveBalancePaise),
        postPeriodTransactionCount: postPeriodTxs.length,
        postPeriodNetDeltaPaise,
        postPeriodNetDeltaFormatted: formatSignedDeltaPaise(postPeriodNetDeltaPaise),
        hasPostPeriodActivity,
        closingDiffersFromLiveBalance,
        isCreditCardLiability,
        balanceSemanticsNote: noteParts.length > 0 ? noteParts.join(' ') : undefined
      },
      entries,
      totalPeriodEntryCount: inPeriodTxs.length,
      displayedEntryCount: entries.length,
      isSubFiltered,
      isEmpty: entries.length === 0
    };
  }

  /**
   * Generates separate Expense and Income Category Reports with percentages,
   * historical archived category metadata preservation, and prior-period comparison.
   */
  public static generateCategoryReport(params: GenerateReportBaseParams): CategoryReportDTO {
    const inputs = validateAndNormalizeInputs(params);
    const { appliedFilters, activeTransactions, categoryMap, now, reportableAccountIds } = inputs;

    const period = resolveAnalyticsDateRange(
      params.filters.preset,
      now,
      params.filters.customRange,
      activeTransactions.map((t) => t.record)
    );

    const selectedAccountSet = createScopedAccountSet(appliedFilters, reportableAccountIds);
    const selectedCategorySet =
      appliedFilters.categoryIds.length > 0 ? new Set(appliedFilters.categoryIds) : null;
    const selectedTypeSet =
      appliedFilters.types.length > 0 ? new Set(appliedFilters.types) : null;
    const normalizedQuery = appliedFilters.searchQuery.toLowerCase();

    const expenseBuckets = new Map<string, { paise: number; count: number }>();
    const incomeBuckets = new Map<string, { paise: number; count: number }>();
    const prevExpenseBuckets = new Map<string, number>();
    const prevIncomeBuckets = new Map<string, number>();

    let totalExpensePaise = 0;
    let totalIncomePaise = 0;
    let expenseTxCount = 0;
    let incomeTxCount = 0;

    let prevTotalExpensePaise = 0;
    let prevTotalIncomePaise = 0;
    let excludedTransferCount = 0;

    for (const tx of activeTransactions) {
      const inCurrent = period.range.contains(tx.date);
      const inPrevious = Boolean(period.previousRange && period.previousRange.contains(tx.date));

      if (!inCurrent && !inPrevious) {
        continue;
      }

      if (tx.record.type === 'transfer') {
        if (inCurrent && matchesSearchText(tx, normalizedQuery)) {
          const outInScope = isAccountInScope(
            tx.record.accountId,
            inputs.allAccountMap,
            reportableAccountIds,
            selectedAccountSet,
            appliedFilters.includeSystemAccounts
          );
          const inInScope = tx.destinationAccountId
            ? isAccountInScope(
                tx.destinationAccountId,
                inputs.allAccountMap,
                reportableAccountIds,
                selectedAccountSet,
                appliedFilters.includeSystemAccounts
              )
            : false;
          if (outInScope || inInScope) {
            excludedTransferCount++;
          }
        }
        continue;
      }

      const scope = evaluateCashflowOrCategoryScope(
        tx,
        inputs,
        selectedAccountSet,
        selectedTypeSet,
        selectedCategorySet,
        normalizedQuery
      );

      if (!scope.included) {
        continue;
      }

      if (inCurrent) {
        if (tx.record.type === 'expense') {
          totalExpensePaise = safeAddAnalyticsPaise(totalExpensePaise, tx.record.amountPaise);
          expenseTxCount++;
          const prev = expenseBuckets.get(scope.effectiveCategoryId) ?? { paise: 0, count: 0 };
          expenseBuckets.set(scope.effectiveCategoryId, {
            paise: safeAddAnalyticsPaise(prev.paise, tx.record.amountPaise),
            count: prev.count + 1
          });
        } else {
          totalIncomePaise = safeAddAnalyticsPaise(totalIncomePaise, tx.record.amountPaise);
          incomeTxCount++;
          const prev = incomeBuckets.get(scope.effectiveCategoryId) ?? { paise: 0, count: 0 };
          incomeBuckets.set(scope.effectiveCategoryId, {
            paise: safeAddAnalyticsPaise(prev.paise, tx.record.amountPaise),
            count: prev.count + 1
          });
        }
      } else if (inPrevious) {
        if (tx.record.type === 'expense') {
          prevTotalExpensePaise = safeAddAnalyticsPaise(
            prevTotalExpensePaise,
            tx.record.amountPaise
          );
          prevExpenseBuckets.set(
            scope.effectiveCategoryId,
            safeAddAnalyticsPaise(
              prevExpenseBuckets.get(scope.effectiveCategoryId) ?? 0,
              tx.record.amountPaise
            )
          );
        } else {
          prevTotalIncomePaise = safeAddAnalyticsPaise(prevTotalIncomePaise, tx.record.amountPaise);
          prevIncomeBuckets.set(
            scope.effectiveCategoryId,
            safeAddAnalyticsPaise(
              prevIncomeBuckets.get(scope.effectiveCategoryId) ?? 0,
              tx.record.amountPaise
            )
          );
        }
      }
    }

    const comparisonAvailable = period.previousRange !== null;

    const buildRows = (
      type: 'income' | 'expense',
      buckets: Map<string, { paise: number; count: number }>,
      prevBuckets: Map<string, number>,
      totalOfTypePaise: number,
      fallbackPalette: readonly string[]
    ): CategoryBreakdownRowDTO[] => {
      const entries = Array.from(buckets.entries()).map(([catId, agg]) => {
        const cat = catId !== 'uncategorized' ? categoryMap.get(catId) : undefined;
        return {
          categoryId: catId,
          categoryName: cat?.name ?? 'Uncategorized',
          categoryIcon: cat?.icon,
          explicitColor: cat?.color,
          isArchived: Boolean(cat?.isArchived),
          totalPaise: agg.paise,
          transactionCount: agg.count
        };
      });

      entries.sort((a, b) => {
        if (b.totalPaise !== a.totalPaise) {
          return b.totalPaise - a.totalPaise;
        }
        const nameCmp = a.categoryName.localeCompare(b.categoryName);
        return nameCmp !== 0 ? nameCmp : a.categoryId.localeCompare(b.categoryId);
      });

      return entries.map((item, index) => {
        const percentageShare =
          totalOfTypePaise > 0
            ? Math.round((item.totalPaise / totalOfTypePaise) * 1000) / 10
            : 0;

        let previousPaise: number | null = null;
        let previousFormatted: string | null = null;
        let deltaPaise: number | null = null;
        let deltaFormatted: string | null = null;
        let percentageChange: number | null = null;
        let direction: CategoryBreakdownRowDTO['direction'] = 'unavailable';

        if (comparisonAvailable) {
          previousPaise = prevBuckets.get(item.categoryId) ?? 0;
          previousFormatted = formatPaiseToINR(previousPaise);
          deltaPaise = safeSubtractReportPaise(item.totalPaise, previousPaise);
          deltaFormatted = formatSignedDeltaPaise(deltaPaise);

          if (previousPaise === 0) {
            direction = item.totalPaise > 0 ? 'new' : 'flat';
            percentageChange = null;
          } else {
            percentageChange = Math.round((deltaPaise / previousPaise) * 1000) / 10;
            direction = deltaPaise > 0 ? 'increase' : deltaPaise < 0 ? 'decrease' : 'flat';
          }
        }

        return {
          categoryId: item.categoryId,
          categoryName: item.categoryName,
          type,
          categoryIcon: item.categoryIcon,
          categoryColor:
            item.explicitColor || fallbackPalette[index % fallbackPalette.length],
          isArchived: item.isArchived,
          totalPaise: item.totalPaise,
          totalFormatted: formatPaiseToINR(item.totalPaise),
          percentageShare,
          transactionCount: item.transactionCount,
          previousPaise,
          previousFormatted,
          deltaPaise,
          deltaFormatted,
          percentageChange,
          direction
        };
      });
    };

    const buildSummary = (
      totalPaise: number,
      transactionCount: number,
      rows: readonly CategoryBreakdownRowDTO[],
      previousTotalPaise: number
    ): CategoryReportSummaryDTO => {
      const archivedCategoryCount = rows.filter((r) => r.isArchived).length;
      if (!comparisonAvailable) {
        return {
          totalPaise,
          totalFormatted: formatPaiseToINR(totalPaise),
          transactionCount,
          categoryCount: rows.length,
          archivedCategoryCount,
          previousTotalPaise: null,
          previousTotalFormatted: null,
          deltaPaise: null,
          deltaFormatted: null,
          percentageChange: null,
          direction: 'unavailable'
        };
      }

      const deltaPaise = safeSubtractReportPaise(totalPaise, previousTotalPaise);
      const percentageChange =
        previousTotalPaise > 0
          ? Math.round((deltaPaise / previousTotalPaise) * 1000) / 10
          : null;

      return {
        totalPaise,
        totalFormatted: formatPaiseToINR(totalPaise),
        transactionCount,
        categoryCount: rows.length,
        archivedCategoryCount,
        previousTotalPaise,
        previousTotalFormatted: formatPaiseToINR(previousTotalPaise),
        deltaPaise,
        deltaFormatted: formatSignedDeltaPaise(deltaPaise),
        percentageChange,
        direction: deltaPaise > 0 ? 'increase' : deltaPaise < 0 ? 'decrease' : 'flat'
      };
    };

    const expenseBreakdown = buildRows(
      'expense',
      expenseBuckets,
      prevExpenseBuckets,
      totalExpensePaise,
      EXPENSE_FALLBACK_COLORS
    );
    const incomeBreakdown = buildRows(
      'income',
      incomeBuckets,
      prevIncomeBuckets,
      totalIncomePaise,
      INCOME_FALLBACK_COLORS
    );

    const expenseSummary = buildSummary(
      totalExpensePaise,
      expenseTxCount,
      expenseBreakdown,
      prevTotalExpensePaise
    );
    const incomeSummary = buildSummary(
      totalIncomePaise,
      incomeTxCount,
      incomeBreakdown,
      prevTotalIncomePaise
    );

    return {
      reportType: 'category',
      period,
      appliedFilters,
      expenseSummary,
      incomeSummary,
      expenseBreakdown,
      incomeBreakdown,
      comparisonAvailable,
      insufficientDataReason: !comparisonAvailable
        ? 'No prior equivalent period exists for All Time.'
        : undefined,
      excludedTransferCount,
      isEmpty: expenseBreakdown.length === 0 && incomeBreakdown.length === 0
    };
  }
}

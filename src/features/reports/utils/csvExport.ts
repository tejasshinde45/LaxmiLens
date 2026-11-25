import {
  AccountStatementReportDTO,
  CategoryBreakdownRowDTO,
  CategoryReportDTO,
  FinancialSummaryReportDTO,
  SummaryPeriodBucketDTO
} from '@/application/dto/ReportDTO';
import { InvalidTransactionAmountError } from '@/domain/errors/DomainErrors';

const UTF8_BOM = '\uFEFF';
const CSV_LINE_BREAK = '\r\n';
const FORMULA_TRIGGER_CHARS = new Set(['=', '+', '-', '@', '\t', '\r']);

export type CsvColumnKind = 'text' | 'paise' | 'number';

export interface CsvColumnDefinition<T> {
  header: string;
  kind?: CsvColumnKind;
  accessor: (row: T) => string | number | boolean | null | undefined;
}

/**
 * Converts integer paise cleanly into a fixed 2-decimal rupee string without
 * floating-point division or locale grouping separators (e.g., -125050 -> "-1250.50").
 */
export function formatPaiseToCsvDecimal(paise: number): string {
  if (typeof paise !== 'number' || !Number.isSafeInteger(paise)) {
    throw new InvalidTransactionAmountError(
      `CSV monetary formatting requires a safe integer in paise, received '${paise}'.`
    );
  }

  const sign = paise < 0 ? '-' : '';
  const absDigits = String(Math.abs(paise));
  const padded = absDigits.padStart(3, '0');
  const integerPart = padded.slice(0, -2);
  const fractionalPart = padded.slice(-2);

  return `${sign}${integerPart}.${fractionalPart}`;
}

/**
 * Neutralizes spreadsheet formula injection on untrusted text cells whose first
 * meaningful character (or raw leading tab/CR) could trigger formula evaluation.
 */
export function sanitizeCsvTextCell(value: string): string {
  if (value.length === 0) {
    return '';
  }

  if (FORMULA_TRIGGER_CHARS.has(value[0])) {
    return `'${value}`;
  }

  const trimmedLeadingSpacesOrLf = value.replace(/^[ \n\f\v]+/, '');
  if (
    trimmedLeadingSpacesOrLf.length > 0 &&
    FORMULA_TRIGGER_CHARS.has(trimmedLeadingSpacesOrLf[0])
  ) {
    return `'${value}`;
  }

  return value;
}

/**
 * Applies RFC 4180 field quoting for commas, double quotes, CR, and LF.
 */
export function escapeCsvField(value: string): string {
  if (
    value.includes(',') ||
    value.includes('"') ||
    value.includes('\r') ||
    value.includes('\n')
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatTypedCsvCell<T>(column: CsvColumnDefinition<T>, row: T): string {
  const raw = column.accessor(row);
  const kind = column.kind ?? 'text';

  if (kind === 'paise') {
    if (raw === null || raw === undefined || raw === '') {
      return '';
    }
    if (typeof raw !== 'number') {
      throw new InvalidTransactionAmountError(
        `CSV column '${column.header}' expected integer paise, received '${String(raw)}'.`
      );
    }
    return escapeCsvField(formatPaiseToCsvDecimal(raw));
  }

  if (kind === 'number') {
    if (raw === null || raw === undefined || raw === '') {
      return '';
    }
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      throw new Error(
        `CSV numeric column '${column.header}' expected finite number, received '${String(raw)}'.`
      );
    }
    const normalized = Object.is(raw, -0) ? 0 : raw;
    return escapeCsvField(String(normalized));
  }

  const textValue = raw === null || raw === undefined ? '' : String(raw);
  return escapeCsvField(sanitizeCsvTextCell(textValue));
}

/**
 * Serializes typed rows to RFC 4180 CSV with UTF-8 BOM, CRLF line endings,
 * formula-injection defense on text cells, and untouched numeric columns.
 */
export function serializeCsv<T>(
  columns: readonly CsvColumnDefinition<T>[],
  rows: readonly T[]
): string {
  if (columns.length === 0) {
    return UTF8_BOM;
  }

  const headerLine = columns
    .map((col) => escapeCsvField(sanitizeCsvTextCell(col.header)))
    .join(',');

  const lines: string[] = new Array(rows.length + 1);
  lines[0] = headerLine;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const cells: string[] = new Array(columns.length);
    for (let c = 0; c < columns.length; c++) {
      cells[c] = formatTypedCsvCell(columns[c], row);
    }
    lines[i + 1] = cells.join(',');
  }

  return `${UTF8_BOM}${lines.join(CSV_LINE_BREAK)}`;
}

/**
 * Produces a safe cross-platform CSV filename ending with '.csv'.
 */
export function sanitizeCsvFilename(
  rawFilename: string,
  fallback = 'laxmilens-report.csv'
): string {
  const withoutExtension = (rawFilename || '')
    .replace(/\.[cC][sS][vV]$/, '')
    .replace(/[\x00-\x1f<>:"/\\|?*]+/g, ' ')
    .replace(/\.\.+/g, '.')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 110)
    .replace(/[.-]+$/, '');

  if (!withoutExtension) {
    return fallback;
  }

  return `${withoutExtension}.csv`;
}

const OBJECT_URL_REVOKE_DELAY_MS = 1000;
const pendingObjectUrlTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleObjectUrlRevoke(objectUrl: string): void {
  const existingTimer = pendingObjectUrlTimers.get(objectUrl);
  if (existingTimer !== undefined) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(() => {
    pendingObjectUrlTimers.delete(objectUrl);
    if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(objectUrl);
    }
  }, OBJECT_URL_REVOKE_DELAY_MS);

  pendingObjectUrlTimers.set(objectUrl, timer);
}

/**
 * Initiates a client-side UTF-8 CSV download, removes the temporary anchor immediately,
 * and defers object URL revocation briefly so browsers can finish consuming the Blob URL.
 */
export function downloadCsv(csvContent: string, filename: string): void {
  if (
    typeof document === 'undefined' ||
    typeof Blob === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function' ||
    typeof URL.revokeObjectURL !== 'function'
  ) {
    return;
  }

  const safeName = sanitizeCsvFilename(filename);
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const objectUrl = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = safeName;
  link.style.display = 'none';

  try {
    document.body.appendChild(link);
    link.click();
  } finally {
    if (link.parentNode) {
      link.parentNode.removeChild(link);
    }
    scheduleObjectUrlRevoke(objectUrl);
  }
}

export const FINANCIAL_SUMMARY_BUCKET_COLUMNS: readonly CsvColumnDefinition<SummaryPeriodBucketDTO>[] =
  [
    { header: 'Period Key', kind: 'text', accessor: (r) => r.bucketKey },
    { header: 'Period Label', kind: 'text', accessor: (r) => r.label },
    { header: 'Income (INR)', kind: 'paise', accessor: (r) => r.incomePaise },
    { header: 'Expenses (INR)', kind: 'paise', accessor: (r) => r.expensePaise },
    { header: 'Net Cash Flow (INR)', kind: 'paise', accessor: (r) => r.netCashFlowPaise },
    { header: 'Transfers In (INR)', kind: 'paise', accessor: (r) => r.transfersInPaise },
    { header: 'Transfers Out (INR)', kind: 'paise', accessor: (r) => r.transfersOutPaise },
    { header: 'Transaction Count', kind: 'number', accessor: (r) => r.transactionCount }
  ];

export function buildFinancialSummaryCsv(report: FinancialSummaryReportDTO): string {
  return serializeCsv(FINANCIAL_SUMMARY_BUCKET_COLUMNS, report.periodBreakdown);
}

export const ACCOUNT_STATEMENT_ENTRY_COLUMNS: readonly CsvColumnDefinition<
  AccountStatementReportDTO['entries'][number]
>[] = [
  { header: 'Date', kind: 'text', accessor: (e) => e.transactionDateLocal },
  { header: 'Title', kind: 'text', accessor: (e) => e.title },
  { header: 'Type', kind: 'text', accessor: (e) => e.type },
  {
    header: 'Category',
    kind: 'text',
    accessor: (e) => e.categoryName ?? (e.type === 'transfer' ? 'Transfer' : '')
  },
  {
    header: 'Counterparty Account',
    kind: 'text',
    accessor: (e) => e.counterpartyAccountName ?? ''
  },
  { header: 'Direction', kind: 'text', accessor: (e) => e.direction },
  {
    header: 'Credit (INR)',
    kind: 'paise',
    accessor: (e) => (e.creditPaise > 0 ? e.creditPaise : null)
  },
  {
    header: 'Debit (INR)',
    kind: 'paise',
    accessor: (e) => (e.debitPaise > 0 ? e.debitPaise : null)
  },
  { header: 'Net Change (INR)', kind: 'paise', accessor: (e) => e.signedDeltaPaise },
  { header: 'Running Balance (INR)', kind: 'paise', accessor: (e) => e.runningBalancePaise },
  { header: 'Currency', kind: 'text', accessor: (e) => e.currency },
  { header: 'Notes', kind: 'text', accessor: (e) => e.note ?? '' }
];

export function buildAccountStatementCsv(report: AccountStatementReportDTO): string {
  return serializeCsv(ACCOUNT_STATEMENT_ENTRY_COLUMNS, report.entries);
}

export const CATEGORY_REPORT_ROW_COLUMNS: readonly CsvColumnDefinition<CategoryBreakdownRowDTO>[] =
  [
    { header: 'Category', kind: 'text', accessor: (r) => r.categoryName },
    { header: 'Type', kind: 'text', accessor: (r) => r.type },
    { header: 'Archived', kind: 'text', accessor: (r) => (r.isArchived ? 'Yes' : 'No') },
    { header: 'Transaction Count', kind: 'number', accessor: (r) => r.transactionCount },
    { header: 'Total (INR)', kind: 'paise', accessor: (r) => r.totalPaise },
    { header: 'Share (%)', kind: 'number', accessor: (r) => r.percentageShare },
    { header: 'Previous Period (INR)', kind: 'paise', accessor: (r) => r.previousPaise },
    { header: 'Delta (INR)', kind: 'paise', accessor: (r) => r.deltaPaise },
    { header: 'Change (%)', kind: 'number', accessor: (r) => r.percentageChange }
  ];

export function buildCategoryReportCsv(report: CategoryReportDTO): string {
  const combinedRows: CategoryBreakdownRowDTO[] = [
    ...report.expenseBreakdown,
    ...report.incomeBreakdown
  ];
  return serializeCsv(CATEGORY_REPORT_ROW_COLUMNS, combinedRows);
}

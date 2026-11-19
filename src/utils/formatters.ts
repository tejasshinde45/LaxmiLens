import { format, parseISO } from 'date-fns';

/**
 * Formats integer paise into an Indian Rupee string representation with standard
 * Indian numbering system (e.g., 1,00,000.50).
 */
export function formatPaiseToINR(paise: number | bigint, options: { showSymbol?: boolean; showDecimals?: boolean } = {}): string {
  const { showSymbol = true, showDecimals = true } = options;
  const numPaise = typeof paise === 'bigint' ? Number(paise) : paise;
  const isNegative = numPaise < 0;
  const absPaise = Math.abs(numPaise);

  const rupees = Math.floor(absPaise / 100);
  const remainingPaise = absPaise % 100;

  // Format rupees according to Indian numbering format
  const rupeesStr = rupees.toLocaleString('en-IN');
  const decimalsStr = showDecimals ? `.${remainingPaise.toString().padStart(2, '0')}` : '';

  const prefix = isNegative ? '-' : '';
  const symbol = showSymbol ? '₹' : '';

  return `${prefix}${symbol}${rupeesStr}${decimalsStr}`;
}

/**
 * Safe date formatter handling ISO strings and Date objects.
 */
export function formatDate(date: string | Date, formatPattern = 'dd MMM yyyy'): string {
  const dateObj = typeof date === 'string' ? parseISO(date) : date;
  return format(dateObj, formatPattern);
}

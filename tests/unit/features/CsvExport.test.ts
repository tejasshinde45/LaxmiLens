import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  CsvColumnDefinition,
  buildAccountStatementCsv,
  buildCategoryReportCsv,
  buildFinancialSummaryCsv,
  downloadCsv,
  formatPaiseToCsvDecimal,
  sanitizeCsvFilename,
  sanitizeCsvTextCell,
  serializeCsv
} from '@/features/reports/utils/csvExport';
import { FinancialReportService } from '@/application/services/FinancialReportService';
import { InvalidTransactionAmountError } from '@/domain/errors/DomainErrors';

describe('CSV Export Utility (Phase 10 Stage 3)', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const accBankId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  const accCardId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
  const catGroceriesId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
  const now = new Date(2026, 10, 25, 11, 30, 0);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Integer-paise decimal formatting', () => {
    it('formats positive, negative, zero, sub-rupee, and large safe integer paise without floating-point artifacts', () => {
      expect(formatPaiseToCsvDecimal(0)).toBe('0.00');
      expect(formatPaiseToCsvDecimal(-0)).toBe('0.00');
      expect(formatPaiseToCsvDecimal(5)).toBe('0.05');
      expect(formatPaiseToCsvDecimal(-5)).toBe('-0.05');
      expect(formatPaiseToCsvDecimal(50)).toBe('0.50');
      expect(formatPaiseToCsvDecimal(-125050)).toBe('-1250.50');
      expect(formatPaiseToCsvDecimal(10000005)).toBe('100000.05');
      // Avoid classic float artifacts like 19.99 * 100 or large numbers
      expect(formatPaiseToCsvDecimal(1999)).toBe('19.99');
      expect(formatPaiseToCsvDecimal(Number.MAX_SAFE_INTEGER)).toBe('90071992547409.91');
    });

    it('rejects non-integer floats, NaN, and unsafe integers', () => {
      expect(() => formatPaiseToCsvDecimal(12.34)).toThrow(InvalidTransactionAmountError);
      expect(() => formatPaiseToCsvDecimal(Number.NaN)).toThrow(InvalidTransactionAmountError);
      expect(() => formatPaiseToCsvDecimal(Number.POSITIVE_INFINITY)).toThrow(
        InvalidTransactionAmountError
      );
      expect(() => formatPaiseToCsvDecimal(Number.MAX_SAFE_INTEGER + 1)).toThrow(
        InvalidTransactionAmountError
      );
    });
  });

  describe('RFC 4180 compliance & formula-injection protection', () => {
    interface SampleRow {
      title: string;
      note: string;
      amountPaise: number;
      count: number;
    }

    const columns: readonly CsvColumnDefinition<SampleRow>[] = [
      { header: 'Title', kind: 'text', accessor: (r) => r.title },
      { header: 'Note', kind: 'text', accessor: (r) => r.note },
      { header: 'Amount (INR)', kind: 'paise', accessor: (r) => r.amountPaise },
      { header: 'Count', kind: 'number', accessor: (r) => r.count }
    ];

    it('prepends UTF-8 BOM, enforces CRLF row breaks, preserves column order, and escapes commas, double quotes, and CR/LF', () => {
      const csv = serializeCsv(columns, [
        {
          title: 'Rent, Utilities',
          note: 'Line 1 "Quoted"\r\nLine 2\nLine 3\rEnd',
          amountPaise: 250050,
          count: 1
        }
      ]);

      expect(csv.startsWith('\uFEFF')).toBe(true);
      const body = csv.slice(1);
      const firstBreak = body.indexOf('\r\n');
      expect(firstBreak).toBeGreaterThan(0);
      expect(body.slice(0, firstBreak)).toBe('Title,Note,Amount (INR),Count');

      const dataRow = body.slice(firstBreak + 2);
      expect(dataRow).toBe(
        '"Rent, Utilities","Line 1 ""Quoted""\r\nLine 2\nLine 3\rEnd",2500.50,1'
      );
    });

    it('neutralizes all formula trigger prefixes on text cells while keeping negative numeric amounts untouched', () => {
      expect(sanitizeCsvTextCell('=CMD("calc")')).toBe('\'=CMD("calc")');
      expect(sanitizeCsvTextCell('+SUM(A1:A2)')).toBe("'+SUM(A1:A2)");
      expect(sanitizeCsvTextCell('-100+CMD()')).toBe("'-100+CMD()");
      expect(sanitizeCsvTextCell('@SUM(1,2)')).toBe("'@SUM(1,2)");
      expect(sanitizeCsvTextCell('\t=1+1')).toBe("'\t=1+1");
      expect(sanitizeCsvTextCell('\r=1+1')).toBe("'\r=1+1");
      // Leading spaces or LF before trigger char
      expect(sanitizeCsvTextCell('  =HYPERLINK("http://evil")')).toBe(
        '\'  =HYPERLINK("http://evil")'
      );
      expect(sanitizeCsvTextCell('\n+1+1')).toBe("'\n+1+1");
      // Safe strings with internal hyphen remain untouched
      expect(sanitizeCsvTextCell('Coffee - Blue Tokai')).toBe('Coffee - Blue Tokai');

      const csv = serializeCsv(columns, [
        {
          title: '=HYPERLINK("https://evil.example","Click")',
          note: '-2+3*cmd',
          amountPaise: -150075,
          count: -2
        },
        {
          title: '\t@SUM(A1)',
          note: '+100',
          amountPaise: 0,
          count: 0
        },
        {
          title: '\r1+1',
          note: 'Normal note',
          amountPaise: -50,
          count: 1
        }
      ]);

      const rows = csv.slice(1).split('\r\n');
      expect(rows).toHaveLength(4);
      // Text fields sanitized; numeric negative INR and count remain plain numeric without apostrophes
      expect(rows[1]).toBe(
        '"\'=HYPERLINK(""https://evil.example"",""Click"")",\'-2+3*cmd,-1500.75,-2'
      );
      expect(rows[2]).toBe("'\t@SUM(A1),'+100,0.00,0");
      expect(rows[3]).toBe('"\'\r1+1",Normal note,-0.50,1');
    });

    it('outputs BOM + headers only cleanly for empty datasets', () => {
      const csv = serializeCsv(columns, []);
      expect(csv).toBe('\uFEFFTitle,Note,Amount (INR),Count');
    });

    it('serializes large exports (5,000+ rows) deterministically and quickly', () => {
      const largeRows: SampleRow[] = Array.from({ length: 5500 }, (_, i) => ({
        title: `Merchant ${i}`,
        note: i % 2 === 0 ? `=ROW-${i}` : `Ref ${i}`,
        amountPaise: (i + 1) * 105 * (i % 3 === 0 ? -1 : 1),
        count: i + 1
      }));

      const csv = serializeCsv(columns, largeRows);
      expect(csv.startsWith('\uFEFF')).toBe(true);
      const lines = csv.slice(1).split('\r\n');
      expect(lines).toHaveLength(5501);
      expect(lines[1]).toBe("Merchant 0,'=ROW-0,-1.05,1");
      // 5498 % 3 === 2 (positive), 5499 % 3 === 0 (negative)
      expect(lines[5499]).toBe("Merchant 5498,'=ROW-5498,5773.95,5499");
      expect(lines[5500]).toBe('Merchant 5499,Ref 5499,-5775.00,5500');
    });
  });

  describe('Report DTO CSV adapters', () => {
    it('exports Financial Summary, Account Statement (with negative credit card balance & untrusted titles), and Category Reports accurately', () => {
      const accounts = [
        {
          id: accBankId,
          userId,
          name: '+HDFC Bank',
          accountType: 'bank',
          openingBalancePaise: 500000,
          isArchived: false
        },
        {
          id: accCardId,
          userId,
          name: 'Card',
          accountType: 'credit_card',
          openingBalancePaise: -1500000,
          isArchived: false
        }
      ];
      const categories = [
        {
          id: catGroceriesId,
          userId,
          name: '@Food & Groceries',
          type: 'expense' as const,
          isArchived: true
        }
      ];
      const transactions = [
        {
          id: 'tx-1',
          userId,
          type: 'expense' as const,
          amountPaise: 250050,
          accountId: accCardId,
          categoryId: catGroceriesId,
          title: '=Evil Merchant',
          note: 'Monthly groceries',
          transactionDate: new Date(2026, 10, 5, 10, 0, 0),
          createdAt: new Date(2026, 10, 5, 10, 0, 0)
        }
      ];

      const summary = FinancialReportService.generateFinancialSummary({
        userId,
        accounts,
        transactions,
        categories,
        filters: { preset: 'this_month' },
        now
      });
      const summaryCsv = buildFinancialSummaryCsv(summary);
      expect(summaryCsv.startsWith('\uFEFF')).toBe(true);
      expect(summaryCsv).toContain('2026-11-05,05 Nov,0.00,2500.50,-2500.50,0.00,0.00,1');

      const statement = FinancialReportService.generateAccountStatement({
        userId,
        accounts,
        transactions,
        categories,
        filters: { preset: 'this_month', statementAccountId: accCardId },
        now
      });
      const stmtCsv = buildAccountStatementCsv(statement);
      const stmtLines = stmtCsv.slice(1).split('\r\n');
      expect(stmtLines).toHaveLength(2);
      // Title '=Evil Merchant' and Category '@Food & Groceries' escaped; Debit=2500.50, Net=-2500.50, Running=-17500.50
      expect(stmtLines[1]).toBe(
        "2026-11-05,'=Evil Merchant,expense,'@Food & Groceries,,debit,,2500.50,-2500.50,-17500.50,INR,Monthly groceries"
      );

      const categoryReport = FinancialReportService.generateCategoryReport({
        userId,
        accounts,
        transactions,
        categories,
        filters: { preset: 'this_month' },
        now
      });
      const catCsv = buildCategoryReportCsv(categoryReport);
      const catLines = catCsv.slice(1).split('\r\n');
      expect(catLines).toHaveLength(2);
      expect(catLines[1]).toBe("'@Food & Groceries,expense,Yes,1,2500.50,100,0.00,2500.50,");
    });
  });

  describe('Filename sanitization & Blob download lifecycle', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('sanitizes unsafe filenames cleanly and ensures .csv extension', () => {
      expect(sanitizeCsvFilename('November 2026: Summary / Report?.csv')).toBe(
        'November-2026-Summary-Report.csv'
      );
      expect(sanitizeCsvFilename('../../secret\\path*name')).toBe('secret-path-name.csv');
      expect(sanitizeCsvFilename('  ///   ')).toBe('laxmilens-report.csv');
      expect(sanitizeCsvFilename('account-statement.CSV')).toBe('account-statement.csv');
    });

    function runWithMockedDownloadEnv(
      objectUrlValue: string,
      fn: (env: {
        createObjectURLMock: ReturnType<typeof vi.fn>;
        revokeObjectURLMock: ReturnType<typeof vi.fn>;
        setTimeoutSpy: ReturnType<typeof vi.spyOn>;
        anchor: HTMLAnchorElement;
      }) => void
    ): void {
      vi.useFakeTimers();
      const origCreateDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
      const origRevokeDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');

      const createObjectURLMock = vi.fn().mockReturnValue(objectUrlValue);
      const revokeObjectURLMock = vi.fn();

      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        writable: true,
        value: createObjectURLMock
      });
      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        writable: true,
        value: revokeObjectURLMock
      });

      try {
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
        const anchor = document.createElement('a');
        const createElementOrig = document.createElement.bind(document);
        vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
          if (tagName.toLowerCase() === 'a') {
            return anchor;
          }
          return createElementOrig(tagName);
        });

        fn({ createObjectURLMock, revokeObjectURLMock, setTimeoutSpy, anchor });
      } finally {
        vi.useRealTimers();
        if (origCreateDescriptor) {
          Object.defineProperty(URL, 'createObjectURL', origCreateDescriptor);
        } else {
          delete (URL as unknown as Record<string, unknown>).createObjectURL;
        }
        if (origRevokeDescriptor) {
          Object.defineProperty(URL, 'revokeObjectURL', origRevokeDescriptor);
        } else {
          delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
        }
      }
    }

    it('creates a UTF-8 CSV Blob, removes anchor immediately, and defers Blob URL revocation after cleanup delay', () => {
      runWithMockedDownloadEnv(
        'blob:laxmilens-test-url',
        ({ createObjectURLMock, revokeObjectURLMock, setTimeoutSpy, anchor }) => {
          const clickSpy = vi.spyOn(anchor, 'click').mockImplementation(() => {});

          downloadCsv('\uFEFFA,B\r\n1,2', 'Nov/Statement: HDFC.csv');

          expect(createObjectURLMock).toHaveBeenCalledTimes(1);
          const blobArg = createObjectURLMock.mock.calls[0][0] as Blob;
          expect(blobArg).toBeInstanceOf(Blob);
          expect(blobArg.type).toContain('text/csv');

          expect(anchor.download).toBe('Nov-Statement-HDFC.csv');
          expect(clickSpy).toHaveBeenCalledTimes(1);
          expect(anchor.parentNode).toBeNull();

          // Must NOT revoke synchronously before browser consumes download URL
          expect(revokeObjectURLMock).not.toHaveBeenCalled();
          expect(setTimeoutSpy).toHaveBeenCalledTimes(1);

          vi.advanceTimersByTime(999);
          expect(revokeObjectURLMock).not.toHaveBeenCalled();

          vi.advanceTimersByTime(1);
          expect(revokeObjectURLMock).toHaveBeenCalledTimes(1);
          expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:laxmilens-test-url');

          vi.advanceTimersByTime(5000);
          expect(revokeObjectURLMock).toHaveBeenCalledTimes(1);
        }
      );
    });

    it('removes temporary anchor immediately and still schedules URL cleanup if anchor click throws', () => {
      runWithMockedDownloadEnv(
        'blob:laxmilens-error-url',
        ({ revokeObjectURLMock, setTimeoutSpy, anchor }) => {
          vi.spyOn(anchor, 'click').mockImplementation(() => {
            throw new Error('Click blocked');
          });

          expect(() => downloadCsv('\uFEFFA\r\n1', 'error-report.csv')).toThrow('Click blocked');

          expect(anchor.parentNode).toBeNull();
          expect(revokeObjectURLMock).not.toHaveBeenCalled();
          expect(setTimeoutSpy).toHaveBeenCalledTimes(1);

          vi.advanceTimersByTime(1000);
          expect(revokeObjectURLMock).toHaveBeenCalledTimes(1);
          expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:laxmilens-error-url');
        }
      );
    });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  printReport,
  resetPrintReportState,
  sanitizePrintTitle
} from '@/features/reports/utils/printReport';

describe('printReport Utility (Phase 10 Stage 3)', () => {
  const originalTitle = 'LaxmiLens - Personal Finance';

  beforeEach(() => {
    resetPrintReportState();
    document.title = originalTitle;
  });

  afterEach(() => {
    resetPrintReportState();
    vi.restoreAllMocks();
    document.title = originalTitle;
  });

  it('sanitizes report titles against control characters and empty strings', () => {
    expect(sanitizePrintTitle('HDFC Statement\r\n\tNov 2026')).toBe('HDFC Statement Nov 2026');
    expect(sanitizePrintTitle('   ')).toBe('LaxmiLens Financial Report');
  });

  it('temporarily updates document.title, calls window.print, restores title on afterprint, and cleans up listener', () => {
    let titleDuringPrint = '';
    const printSpy = vi.fn(() => {
      titleDuringPrint = document.title;
    });
    window.print = printSpy;

    const addListenerSpy = vi.spyOn(window, 'addEventListener');
    const removeListenerSpy = vi.spyOn(window, 'removeEventListener');

    printReport('Financial Summary — November 2026');

    expect(printSpy).toHaveBeenCalledTimes(1);
    expect(titleDuringPrint).toBe('Financial Summary — November 2026');
    expect(addListenerSpy).toHaveBeenCalledWith('afterprint', expect.any(Function));

    window.dispatchEvent(new Event('afterprint'));

    expect(document.title).toBe(originalTitle);
    expect(removeListenerSpy).toHaveBeenCalledWith('afterprint', expect.any(Function));
  });

  it('handles repeated print calls without accumulating listeners or losing original title', () => {
    window.print = vi.fn();

    const registeredHandlers = new Set<EventListenerOrEventListenerObject>();
    const origAdd = window.addEventListener.bind(window);
    const origRemove = window.removeEventListener.bind(window);

    vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
      if (type === 'afterprint' && listener) {
        registeredHandlers.add(listener);
      }
      return origAdd(type, listener, options);
    });
    vi.spyOn(window, 'removeEventListener').mockImplementation((type, listener, options) => {
      if (type === 'afterprint' && listener) {
        registeredHandlers.delete(listener);
      }
      return origRemove(type, listener, options);
    });

    printReport('Report One');
    expect(document.title).toBe('Report One');
    expect(registeredHandlers.size).toBe(1);

    // Trigger second print before afterprint fires for first print
    printReport('Report Two');
    expect(document.title).toBe('Report Two');
    expect(registeredHandlers.size).toBe(1);

    window.dispatchEvent(new Event('afterprint'));
    expect(document.title).toBe(originalTitle);
    expect(registeredHandlers.size).toBe(0);
  });

  it('restores document.title and removes listener immediately if window.print throws', () => {
    window.print = vi.fn(() => {
      throw new Error('Print dialog blocked');
    });

    const removeListenerSpy = vi.spyOn(window, 'removeEventListener');

    expect(() => printReport('Account Statement')).toThrow('Print dialog blocked');
    expect(document.title).toBe(originalTitle);
    expect(removeListenerSpy).toHaveBeenCalledWith('afterprint', expect.any(Function));
  });
});

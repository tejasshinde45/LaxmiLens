let activeCleanup: (() => void) | null = null;
let originalDocumentTitle: string | null = null;

/**
 * Normalizes a report title into a safe single-line browser document title.
 */
export function sanitizePrintTitle(
  rawTitle: string,
  fallback = 'LaxmiLens Financial Report'
): string {
  const cleaned = (rawTitle || '')
    .replace(/[\r\n\t\x00-\x1f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);

  return cleaned || fallback;
}

/**
 * Temporarily applies a report-specific document.title, invokes window.print(),
 * and restores the original title cleanly via the 'afterprint' lifecycle event.
 * Guarantees idempotent listener cleanup across repeated invocations.
 */
export function printReport(reportTitle: string): void {
  if (
    typeof window === 'undefined' ||
    typeof document === 'undefined' ||
    typeof window.print !== 'function'
  ) {
    return;
  }

  if (activeCleanup) {
    activeCleanup();
  }

  const savedTitle = originalDocumentTitle ?? document.title;
  originalDocumentTitle = savedTitle;

  const safeTitle = sanitizePrintTitle(reportTitle);
  document.title = safeTitle;

  let cleanedUp = false;

  const cleanup = () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    window.removeEventListener('afterprint', onAfterPrint);
    if (originalDocumentTitle !== null) {
      document.title = originalDocumentTitle;
      originalDocumentTitle = null;
    }
    if (activeCleanup === cleanup) {
      activeCleanup = null;
    }
  };

  const onAfterPrint = () => {
    cleanup();
  };

  activeCleanup = cleanup;
  window.addEventListener('afterprint', onAfterPrint);

  try {
    window.print();
  } catch (err) {
    cleanup();
    throw err;
  }
}

/**
 * Resets any active print listener/title state (intended primarily for tests).
 */
export function resetPrintReportState(): void {
  if (activeCleanup) {
    activeCleanup();
  }
}

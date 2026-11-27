export interface DiagnosticContext {
  boundaryName?: string;
  pathname?: string;
  statusCode?: number;
}

export interface SafeErrorDiagnostic {
  category: 'runtime_boundary' | 'route_error' | 'startup_config';
  boundaryName: string;
  errorName: string;
  errorCode?: string;
  statusCode?: number;
  pathname: string;
  timestamp: string;
}

const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;
const SAFE_CODE_PATTERN = /^[A-Z0-9_:-]{2,64}$/;

function sanitizeErrorName(error: unknown): string {
  if (error instanceof Error && typeof error.name === 'string') {
    const trimmed = error.name.trim();
    if (SAFE_IDENTIFIER_PATTERN.test(trimmed)) {
      return trimmed;
    }
  }
  if (
    error &&
    typeof error === 'object' &&
    'status' in error &&
    typeof (error as { status?: unknown }).status === 'number'
  ) {
    return 'RouteErrorResponse';
  }
  return 'UnexpectedError';
}

function sanitizeErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return undefined;
  }
  const rawCode = (error as { code?: unknown }).code;
  if (typeof rawCode !== 'string') {
    return undefined;
  }
  const trimmed = rawCode.trim();
  return SAFE_CODE_PATTERN.test(trimmed) ? trimmed : undefined;
}

function getSafePathname(explicitPathname?: string): string {
  const candidate =
    explicitPathname ??
    (typeof window !== 'undefined' && window.location ? window.location.pathname : '/');
  // Strip any accidental query string or fragment so tokens/OAuth params never enter logs
  const pathOnly = candidate.split('?')[0]?.split('#')[0] || '/';
  return pathOnly.slice(0, 128);
}

/**
 * Produces a strictly scrubbed diagnostic payload suitable for console logging.
 * Intentionally omits error.message, error.stack, componentStack, credentials,
 * URL query strings, and any local database or financial records.
 */
export function sanitizeErrorForLog(
  error: unknown,
  context: DiagnosticContext = {},
  category: SafeErrorDiagnostic['category'] = 'runtime_boundary'
): SafeErrorDiagnostic {
  const diagnostic: SafeErrorDiagnostic = {
    category,
    boundaryName:
      context.boundaryName && SAFE_IDENTIFIER_PATTERN.test(context.boundaryName)
        ? context.boundaryName
        : 'ApplicationBoundary',
    errorName: sanitizeErrorName(error),
    pathname: getSafePathname(context.pathname),
    timestamp: new Date().toISOString()
  };

  const safeCode = sanitizeErrorCode(error);
  if (safeCode) {
    diagnostic.errorCode = safeCode;
  }

  if (typeof context.statusCode === 'number' && Number.isFinite(context.statusCode)) {
    diagnostic.statusCode = context.statusCode;
  } else if (
    error &&
    typeof error === 'object' &&
    'status' in error &&
    typeof (error as { status?: unknown }).status === 'number'
  ) {
    diagnostic.statusCode = (error as { status: number }).status;
  }

  return diagnostic;
}

/**
 * Logs only non-sensitive diagnostic metadata for application boundaries.
 */
export function logBoundaryDiagnostic(
  error: unknown,
  context: DiagnosticContext = {},
  category: SafeErrorDiagnostic['category'] = 'runtime_boundary'
): SafeErrorDiagnostic {
  const diagnostic = sanitizeErrorForLog(error, context, category);
  console.error('[LaxmiLens Diagnostic]', diagnostic);
  return diagnostic;
}

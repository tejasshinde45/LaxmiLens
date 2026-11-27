import { ZodError } from 'zod';
import { DomainError } from '@/domain/errors/DomainErrors';
import {
  DatabaseSessionError,
  DiagnosticIntegrityError,
  MigrationConflictError
} from '@/infrastructure/database/local/errors/DatabaseErrors';
import {
  SyncAccountDependencyError,
  SyncAuthError,
  SyncBorrowingDependencyError,
  SyncConflictError,
  SyncDatabaseError,
  SyncInProgressError,
  SyncLenderDependencyError,
  SyncTransactionDependencyError,
  SyncUnresolvedCategoryError
} from '@/infrastructure/sync/errors/SyncErrors';

export const OFFLINE_QUERY_STALE_TIME_MS = 5 * 60 * 1000;
export const MAX_QUERY_RETRY_ATTEMPTS = 2;
export const BASE_QUERY_RETRY_DELAY_MS = 250;
export const MAX_QUERY_RETRY_DELAY_MS = 2000;

const PERMANENT_ERROR_NAMES = new Set<string>([
  'ConstraintError',
  'DataError',
  'DataCloneError',
  'QuotaExceededError',
  'ReadOnlyError',
  'SecurityError',
  'VersionError',
  'SchemaError',
  'UpgradeError',
  'ModifyError',
  'BulkError',
  'MissingAPIError',
  'DatabaseClosedError',
  'InvalidStateError',
  'NotFoundError',
  'SyntaxError',
  'RangeError',
  'URIError',
  'ReferenceError',
  'AuthError',
  'AuthApiError',
  'AuthSessionMissingError',
  'AuthInvalidCredentialsError',
  'ZodError'
]);

const TRANSIENT_ERROR_NAMES = new Set<string>([
  'AbortError',
  'TimeoutError',
  'TransactionInactiveError',
  'UnknownError',
  'OpenFailedError'
]);

const PERMANENT_ERROR_CODES = new Set<string>([
  'ERR_INVALID_ARG_TYPE',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'INVALID_INPUT',
  'VALIDATION_ERROR',
  'AUTH_ERROR',
  'SESSION_EXPIRED',
  'RLS_DENIED',
  'NOT_FOUND',
  'CONFLICT',
  'PGRST301',
  '22P02'
]);

const TRANSIENT_ERROR_CODES = new Set<string>([
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'EPIPE',
  'NETWORK_ERROR',
  'TIMEOUT',
  'ERR_NETWORK',
  'TEMPORARY_UNAVAILABLE',
  'IDB_TRANSIENT',
  '57014',
  'PGRST500'
]);

const NETWORK_FETCH_MESSAGES = [
  'failed to fetch',
  'networkerror',
  'network request failed',
  'load failed',
  'fetch failed'
];

const TRANSIENT_MESSAGE_PHRASES = [
  ...NETWORK_FETCH_MESSAGES,
  'timed out',
  'timeout',
  'network error',
  'network failure',
  'connection reset',
  'connection refused',
  'temporarily unavailable',
  'temporary failure',
  'database locked',
  'database busy',
  'transaction aborted'
];

function extractNumericHttpStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const record = error as Record<string, unknown>;
  const candidates = [
    record.status,
    record.statusCode,
    record.response && typeof record.response === 'object'
      ? (record.response as Record<string, unknown>).status
      : undefined,
    record.cause && typeof record.cause === 'object'
      ? (record.cause as Record<string, unknown>).status
      : undefined
  ];

  for (const candidate of candidates) {
    if (
      typeof candidate === 'number' &&
      Number.isInteger(candidate) &&
      candidate >= 100 &&
      candidate <= 599
    ) {
      return candidate;
    }
  }

  return null;
}

function extractStringCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code.trim().length > 0 ? code.trim().toUpperCase() : null;
}

function hasNetworkFetchMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return NETWORK_FETCH_MESSAGES.some((phrase) => normalized.includes(phrase));
}

function hasTransientMessagePhrase(error: unknown): boolean {
  if (!(error instanceof Error) || typeof error.message !== 'string') {
    return false;
  }
  const normalized = error.message.toLowerCase();
  return TRANSIENT_MESSAGE_PHRASES.some((phrase) => normalized.includes(phrase));
}

function isTransientHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

/**
 * Identifies permanent domain, validation, authorization, session, or client HTTP errors
 * that must never be retried automatically.
 */
export function isNonRetryableError(error: unknown): boolean {
  if (error == null) {
    return true;
  }

  if (
    error instanceof DomainError ||
    error instanceof DatabaseSessionError ||
    error instanceof MigrationConflictError ||
    error instanceof DiagnosticIntegrityError ||
    error instanceof ZodError ||
    error instanceof SyncAuthError ||
    error instanceof SyncConflictError ||
    error instanceof SyncInProgressError ||
    error instanceof SyncUnresolvedCategoryError ||
    error instanceof SyncAccountDependencyError ||
    error instanceof SyncTransactionDependencyError ||
    error instanceof SyncLenderDependencyError ||
    error instanceof SyncBorrowingDependencyError
  ) {
    return true;
  }

  if (error instanceof SyncDatabaseError) {
    if (
      error.isRlsError() ||
      error.isDuplicateKey() ||
      error.isForeignKeyViolation() ||
      error.isCheckViolation()
    ) {
      return true;
    }
  }

  const httpStatus = extractNumericHttpStatus(error);
  if (httpStatus !== null) {
    if (isTransientHttpStatus(httpStatus)) {
      return false;
    }
    if (httpStatus >= 400 && httpStatus <= 499) {
      return true;
    }
  }

  const code = extractStringCode(error);
  if (code && PERMANENT_ERROR_CODES.has(code)) {
    return true;
  }

  if (error instanceof TypeError && !hasNetworkFetchMessage(error.message)) {
    return true;
  }

  if (error instanceof Error && PERMANENT_ERROR_NAMES.has(error.name)) {
    return true;
  }

  if (
    typeof DOMException !== 'undefined' &&
    error instanceof DOMException &&
    PERMANENT_ERROR_NAMES.has(error.name)
  ) {
    return true;
  }

  return false;
}

/**
 * Classifies genuinely transient storage, timeout, network, or 5xx/408/429 server errors
 * without treating arbitrary digits in error messages as HTTP status codes.
 */
export function isTransientRetryableError(error: unknown): boolean {
  if (isNonRetryableError(error)) {
    return false;
  }

  if (typeof error === 'object' && error !== null) {
    const flags = error as { isTransient?: unknown; retryable?: unknown };
    if (flags.isTransient === true || flags.retryable === true) {
      return true;
    }
  }

  const httpStatus = extractNumericHttpStatus(error);
  if (httpStatus !== null && isTransientHttpStatus(httpStatus)) {
    return true;
  }

  if (error instanceof SyncDatabaseError) {
    const pgCode = (error.pgCode || '').trim().toUpperCase();
    if (
      pgCode === 'PGRST500' ||
      pgCode === '57014' ||
      pgCode === '502' ||
      pgCode === '503' ||
      pgCode === '504' ||
      pgCode.startsWith('08') ||
      pgCode.startsWith('53')
    ) {
      return true;
    }
  }

  const code = extractStringCode(error);
  if (code && TRANSIENT_ERROR_CODES.has(code)) {
    return true;
  }

  if (error instanceof TypeError && hasNetworkFetchMessage(error.message)) {
    return true;
  }

  if (error instanceof Error && TRANSIENT_ERROR_NAMES.has(error.name)) {
    return true;
  }

  if (
    typeof DOMException !== 'undefined' &&
    error instanceof DOMException &&
    TRANSIENT_ERROR_NAMES.has(error.name)
  ) {
    return true;
  }

  return hasTransientMessagePhrase(error);
}

/**
 * Bounded query retry predicate for TanStack Query.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (!Number.isFinite(failureCount) || failureCount < 0) {
    return false;
  }
  if (failureCount >= MAX_QUERY_RETRY_ATTEMPTS) {
    return false;
  }
  return isTransientRetryableError(error);
}

/**
 * Bounded exponential backoff for transient query retries (250ms, 500ms, capped at 2000ms).
 */
export function computeQueryRetryDelay(attemptIndex: number): number {
  const safeAttempt = Math.max(0, Math.floor(attemptIndex));
  return Math.min(BASE_QUERY_RETRY_DELAY_MS * 2 ** safeAttempt, MAX_QUERY_RETRY_DELAY_MS);
}

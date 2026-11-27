import { ZodError } from 'zod';
import { APP_CONFIG } from '@/config/constants';
import { DomainError } from '@/domain/errors/DomainErrors';
import { LocalOutboxRecord } from '@/infrastructure/database/local/schema';
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

export type SyncFailureClass =
  | 'transient_network'
  | 'transient_http'
  | 'auth'
  | 'conflict'
  | 'validation_permission'
  | 'dependency'
  | 'other';

export type SyncRetryDisposition = 'transient' | 'auth' | 'permanent';

export type SyncCoordinatorErrorCategory =
  | 'dependency'
  | 'category'
  | 'conflict'
  | 'auth'
  | 'database'
  | 'validation'
  | 'other';

export interface SyncRetryConfig {
  readonly maxRetries: number;
  readonly initialRetryDelayMs: number;
  readonly maxRetryDelayMs: number;
}

export interface ClassifiedSyncError {
  readonly errorClass: SyncFailureClass;
  readonly disposition: SyncRetryDisposition;
  readonly retryable: boolean;
  readonly errorCategory: SyncCoordinatorErrorCategory;
}

export interface OutboxFailureRuntimeState {
  readonly classification: ClassifiedSyncError;
  readonly attempts: number;
  readonly nextRetryAtMs: number;
}

export interface OutboxEligibilityDecision {
  readonly eligible: boolean;
  readonly reason:
    | 'eligible'
    | 'manual_override'
    | 'auth_paused'
    | 'permanent_failure'
    | 'max_retries_exhausted'
    | 'backoff_active';
  readonly classification?: ClassifiedSyncError;
  readonly nextRetryAtMs?: number;
}

const TRANSIENT_NETWORK_CODES = new Set<string>([
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
  'ABORT_ERR'
]);

const TRANSIENT_ERROR_NAMES = new Set<string>([
  'AbortError',
  'TimeoutError'
]);

const TRANSIENT_NETWORK_PHRASES = [
  'failed to fetch',
  'networkerror',
  'network request failed',
  'load failed',
  'fetch failed',
  'network error',
  'network failure',
  'connection lost',
  'connection failed',
  'connection reset',
  'connection refused',
  'socket hang up',
  'timed out',
  'timeout',
  'temporarily unavailable',
  'temporary failure',
  'service unavailable',
  'gateway timeout',
  'bad gateway',
  'too many requests',
  'rate limit'
];

const AUTH_ERROR_NAMES = new Set<string>([
  'AuthError',
  'AuthApiError',
  'AuthSessionMissingError',
  'AuthInvalidCredentialsError',
  'AuthRetryableFetchError'
]);

const AUTH_ERROR_CODES = new Set<string>([
  'PGRST301',
  'UNAUTHORIZED',
  'AUTH_ERROR',
  'SESSION_EXPIRED',
  'INVALID_JWT',
  'JWT_EXPIRED'
]);

const AUTH_MESSAGE_PHRASES = [
  'not authenticated',
  'jwt expired',
  'invalid jwt',
  'session missing',
  'auth session missing',
  'token expired',
  'pgrst301'
];

function extractHttpStatus(error: unknown): number | null {
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

function extractCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') {
    return null;
  }
  const record = error as { code?: unknown; pgCode?: unknown };
  const raw = record.pgCode ?? record.code;
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim().toUpperCase() : null;
}

function isTransientHttpCode(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

function isTransientPgCode(pgCode: string): boolean {
  return (
    pgCode === 'PGRST500' ||
    pgCode === '57014' ||
    pgCode === '408' ||
    pgCode === '429' ||
    pgCode === '500' ||
    pgCode === '502' ||
    pgCode === '503' ||
    pgCode === '504' ||
    pgCode.startsWith('08') ||
    pgCode.startsWith('53')
  );
}

function makeClassification(
  errorClass: SyncFailureClass,
  disposition: SyncRetryDisposition,
  errorCategory: SyncCoordinatorErrorCategory
): ClassifiedSyncError {
  return {
    errorClass,
    disposition,
    retryable: disposition === 'transient',
    errorCategory
  };
}

export function classifySyncError(error: unknown): ClassifiedSyncError {
  if (
    error instanceof SyncAccountDependencyError ||
    error instanceof SyncTransactionDependencyError ||
    error instanceof SyncLenderDependencyError ||
    error instanceof SyncBorrowingDependencyError
  ) {
    return makeClassification('dependency', 'permanent', 'dependency');
  }

  if (error instanceof SyncUnresolvedCategoryError) {
    return makeClassification('dependency', 'permanent', 'category');
  }

  if (error instanceof SyncConflictError) {
    return makeClassification('conflict', 'permanent', 'conflict');
  }

  if (error instanceof SyncAuthError) {
    return makeClassification('auth', 'auth', 'auth');
  }

  if (error instanceof SyncInProgressError) {
    return makeClassification('other', 'permanent', 'other');
  }

  const httpStatus = extractHttpStatus(error);
  const code = extractCode(error);
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';
  const lowerMessage = message.toLowerCase();

  // Authentication & session failures (unless specifically retryable network fetch inside AuthRetryableFetchError)
  if (
    error instanceof Error &&
    error.name === 'AuthRetryableFetchError'
  ) {
    return makeClassification('transient_network', 'transient', 'other');
  }

  if (
    httpStatus === 401 ||
    (code !== null && AUTH_ERROR_CODES.has(code)) ||
    (error instanceof Error && AUTH_ERROR_NAMES.has(error.name)) ||
    AUTH_MESSAGE_PHRASES.some((phrase) => lowerMessage.includes(phrase))
  ) {
    return makeClassification('auth', 'auth', 'auth');
  }

  // HTTP 408, 429, 5xx
  if (httpStatus !== null) {
    if (isTransientHttpCode(httpStatus)) {
      return makeClassification('transient_http', 'transient', 'database');
    }
    if (httpStatus === 409) {
      return makeClassification('conflict', 'permanent', 'conflict');
    }
    if (httpStatus >= 400 && httpStatus <= 499) {
      return makeClassification('validation_permission', 'permanent', 'validation');
    }
  }

  // PostgreSQL / SyncDatabaseError classification
  if (error instanceof SyncDatabaseError) {
    if (error.isDuplicateKey()) {
      return makeClassification('conflict', 'permanent', 'conflict');
    }
    if (error.isForeignKeyViolation()) {
      return makeClassification('dependency', 'permanent', 'dependency');
    }
    if (error.isRlsError() || error.isCheckViolation()) {
      return makeClassification('validation_permission', 'permanent', 'database');
    }
    if (code && isTransientPgCode(code)) {
      return makeClassification('transient_http', 'transient', 'database');
    }
    if (code && (code.startsWith('22') || code.startsWith('23') || code.startsWith('42'))) {
      return makeClassification('validation_permission', 'permanent', 'database');
    }
    if (TRANSIENT_NETWORK_PHRASES.some((phrase) => lowerMessage.includes(phrase))) {
      return makeClassification('transient_http', 'transient', 'database');
    }
    return makeClassification('validation_permission', 'permanent', 'database');
  }

  if (code && isTransientPgCode(code)) {
    return makeClassification('transient_http', 'transient', 'database');
  }

  if (code && (code === '23505' || code === '40001')) {
    return makeClassification('conflict', 'permanent', 'conflict');
  }

  if (code && (code === '23503')) {
    return makeClassification('dependency', 'permanent', 'dependency');
  }

  if (code && (code === '42501' || code === '23514' || code.startsWith('22') || code.startsWith('23'))) {
    return makeClassification('validation_permission', 'permanent', 'validation');
  }

  // Network transport errors
  if (
    (code && TRANSIENT_NETWORK_CODES.has(code)) ||
    (error instanceof Error && TRANSIENT_ERROR_NAMES.has(error.name)) ||
    TRANSIENT_NETWORK_PHRASES.some((phrase) => lowerMessage.includes(phrase))
  ) {
    return makeClassification('transient_network', 'transient', 'other');
  }

  // Permanent validation / domain / programming errors
  if (
    error instanceof DomainError ||
    error instanceof ZodError ||
    error instanceof TypeError ||
    lowerMessage.includes('validation') ||
    lowerMessage.includes('invalid') ||
    lowerMessage.includes('payload') ||
    lowerMessage.includes('missing or invalid') ||
    lowerMessage.includes('only processes') ||
    lowerMessage.includes('unsupported')
  ) {
    return makeClassification('validation_permission', 'permanent', 'validation');
  }

  return makeClassification('other', 'permanent', 'other');
}

/**
 * Reconstructs failure classification from persisted `LocalOutboxRecord.lastError`
 * after browser reloads when in-memory retry state is cleared.
 */
export function inferSyncErrorClassificationFromMessage(
  lastError?: string
): ClassifiedSyncError {
  if (!lastError || lastError.trim().length === 0) {
    return makeClassification('other', 'permanent', 'other');
  }

  const lower = lastError.toLowerCase();

  if (
    AUTH_MESSAGE_PHRASES.some((p) => lower.includes(p)) ||
    lower.includes('http 401') ||
    lower.includes('status 401')
  ) {
    return makeClassification('auth', 'auth', 'auth');
  }

  if (
    lower.includes('version conflict') ||
    lower.includes('version mismatch') ||
    lower.includes('occ conflict') ||
    lower.includes('concurrency conflict') ||
    lower.includes('already exists in cloud') ||
    lower.includes('already exists and belongs') ||
    lower.includes('tombstoned') ||
    lower.includes('23505')
  ) {
    return makeClassification('conflict', 'permanent', 'conflict');
  }

  if (
    lower.includes('category reference') ||
    lower.includes('could not be resolved to cloud') ||
    lower.includes('failed synchronization') ||
    lower.includes('not found in cloud') ||
    lower.includes('foreign key') ||
    lower.includes('23503')
  ) {
    return makeClassification(
      'dependency',
      'permanent',
      lower.includes('category') ? 'category' : 'dependency'
    );
  }

  if (
    lower.includes('pgrst500') ||
    lower.includes('57014') ||
    /\b(408|429|500|502|503|504)\b/.test(lower)
  ) {
    return makeClassification('transient_http', 'transient', 'database');
  }

  if (TRANSIENT_NETWORK_PHRASES.some((p) => lower.includes(p))) {
    return makeClassification('transient_network', 'transient', 'other');
  }

  if (
    lower.includes('rls permission denied') ||
    lower.includes('42501') ||
    lower.includes('23514') ||
    lower.includes('22000') ||
    lower.includes('22p02') ||
    lower.includes('invalid') ||
    lower.includes('payload') ||
    lower.includes('validation')
  ) {
    return makeClassification('validation_permission', 'permanent', 'validation');
  }

  return makeClassification('other', 'permanent', 'other');
}

export function computeSyncBackoffDelayMs(
  attempts: number,
  config: SyncRetryConfig = APP_CONFIG.sync,
  randomFn: () => number = Math.random
): number {
  if (!Number.isFinite(attempts) || attempts <= 0) {
    return 0;
  }

  const exponent = Math.max(0, Math.floor(attempts) - 1);
  const uncapped = config.initialRetryDelayMs * 2 ** exponent;
  const baseDelay = Math.min(uncapped, config.maxRetryDelayMs);

  const rawRandom = randomFn();
  const clampedRandom = Number.isFinite(rawRandom) ? Math.min(1, Math.max(0, rawRandom)) : 0.5;
  // Equal/symmetric ±20% jitter [0.80, 1.20], always bounded by maxRetryDelayMs
  const jittered = Math.round(baseDelay * (0.8 + clampedRandom * 0.4));
  return Math.min(config.maxRetryDelayMs, Math.max(jittered, 1));
}

export function evaluateOutboxEntryEligibility(params: {
  entry: LocalOutboxRecord;
  runtimeState?: OutboxFailureRuntimeState;
  authPaused: boolean;
  respectRetryPolicy: boolean;
  config?: SyncRetryConfig;
  nowMs?: number;
}): OutboxEligibilityDecision {
  const {
    entry,
    runtimeState,
    authPaused,
    respectRetryPolicy,
    config = APP_CONFIG.sync,
    nowMs = Date.now()
  } = params;

  if (!respectRetryPolicy) {
    return { eligible: true, reason: 'manual_override' };
  }

  if (authPaused) {
    return { eligible: false, reason: 'auth_paused' };
  }

  const attempts = runtimeState?.attempts ?? entry.attempts ?? 0;
  if (attempts <= 0 && !runtimeState) {
    return { eligible: true, reason: 'eligible' };
  }

  const classification =
    runtimeState?.classification ?? inferSyncErrorClassificationFromMessage(entry.lastError);

  if (classification.disposition === 'auth') {
    return { eligible: false, reason: 'auth_paused', classification };
  }

  if (classification.disposition === 'permanent') {
    return { eligible: false, reason: 'permanent_failure', classification };
  }

  if (attempts >= config.maxRetries) {
    return { eligible: false, reason: 'max_retries_exhausted', classification };
  }

  let nextRetryAtMs = runtimeState?.nextRetryAtMs;
  if (nextRetryAtMs === undefined && entry.lastAttemptAt) {
    const lastAttemptMs = Date.parse(entry.lastAttemptAt);
    if (Number.isFinite(lastAttemptMs)) {
      nextRetryAtMs = lastAttemptMs + computeSyncBackoffDelayMs(attempts, config, () => 0.5);
    }
  }

  if (nextRetryAtMs !== undefined && nowMs < nextRetryAtMs) {
    return {
      eligible: false,
      reason: 'backoff_active',
      classification,
      nextRetryAtMs
    };
  }

  return { eligible: true, reason: 'eligible', classification };
}

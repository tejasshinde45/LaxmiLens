import { z } from 'zod';

export const KNOWN_PROJECT_REFS = {
  MAIN: 'ujbbhvbtjfzsoalzmqve',
  PRODUCTION: 'ujbbhvbtjfzsoalzmqve',
  STAGING: 'vtnygwjcwbufsreswhjw'
} as const;

export const PLACEHOLDER_PATTERNS = [
  'your-project-id',
  'placeholder',
  'your-anon-key',
  'your-publishable-key',
  'example',
  '<'
];

export function extractProjectRef(urlStr: string): string | null {
  try {
    const parsed = new URL(urlStr);
    const hostname = parsed.hostname;
    const match = hostname.match(/^([a-z0-9-]+)\.supabase\.co$/i);
    return match ? match[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

export interface ValidatedEnv {
  VITE_SUPABASE_URL: string;
  VITE_SUPABASE_PUBLISHABLE_KEY: string;
  VITE_SUPABASE_ANON_KEY: string;
  VITE_APP_ENV: 'development' | 'staging' | 'production' | 'test';
}

export type EnvFailureCode =
  | 'CONFIG_INVALID_APP_ENV'
  | 'CONFIG_MISSING_URL'
  | 'CONFIG_PLACEHOLDER_URL'
  | 'CONFIG_INVALID_URL'
  | 'CONFIG_INSECURE_URL'
  | 'CONFIG_PROJECT_REF_MISMATCH'
  | 'CONFIG_MISSING_KEY'
  | 'CONFIG_PLACEHOLDER_KEY'
  | 'CONFIG_INVALID_KEY'
  | 'CONFIG_UNKNOWN';

export class EnvConfigurationError extends Error {
  public readonly code: EnvFailureCode;

  constructor(code: EnvFailureCode, message: string) {
    super(message);
    this.name = 'EnvConfigurationError';
    this.code = code;
  }
}

export interface SafeEnvErrorSummary {
  code: EnvFailureCode;
  title: string;
  message: string;
}

/**
 * Returns non-sensitive, user-safe guidance for deployment configuration failures.
 * Never reveals URLs, project refs, API keys, tokens, or raw environment strings.
 */
export function getSafeEnvErrorSummary(error: unknown): SafeEnvErrorSummary {
  const code: EnvFailureCode =
    error instanceof EnvConfigurationError ? error.code : 'CONFIG_UNKNOWN';

  switch (code) {
    case 'CONFIG_MISSING_URL':
    case 'CONFIG_MISSING_KEY':
    case 'CONFIG_PLACEHOLDER_URL':
    case 'CONFIG_PLACEHOLDER_KEY':
      return {
        code,
        title: 'Incomplete Deployment Configuration',
        message:
          'Required cloud connection settings are missing or still set to template placeholders. Verify the deployment environment variables and retry.'
      };
    case 'CONFIG_PROJECT_REF_MISMATCH':
      return {
        code,
        title: 'Environment Isolation Mismatch',
        message:
          'The configured cloud backend does not match this environment isolation policy. Startup was paused safely without modifying any local data.'
      };
    case 'CONFIG_INSECURE_URL':
    case 'CONFIG_INVALID_URL':
    case 'CONFIG_INVALID_KEY':
    case 'CONFIG_INVALID_APP_ENV':
      return {
        code,
        title: 'Invalid Application Configuration',
        message:
          'One or more deployment settings failed startup validation checks. Contact your administrator or review the build configuration before retrying.'
      };
    default:
      return {
        code: 'CONFIG_UNKNOWN',
        title: 'Startup Configuration Error',
        message:
          'LaxmiLens could not verify its startup configuration. No local records were altered.'
      };
  }
}

/**
 * Validates a raw environment object against LaxmiLens multi-environment isolation rules.
 * Never prints secret values in error messages.
 */
export function validateEnv(rawEnv: Record<string, unknown>): ValidatedEnv {
  // 1. Determine environment mode
  const rawAppEnv =
    rawEnv.VITE_APP_ENV ??
    (rawEnv.MODE === 'production'
      ? 'production'
      : rawEnv.MODE === 'staging'
        ? 'staging'
        : rawEnv.MODE === 'test'
          ? 'test'
          : 'development');
  const appEnvResult = z.enum(['development', 'staging', 'production', 'test']).safeParse(rawAppEnv);

  if (!appEnvResult.success) {
    throw new EnvConfigurationError(
      'CONFIG_INVALID_APP_ENV',
      `Environment validation failed: VITE_APP_ENV must be one of 'development', 'staging', 'production', 'test'. Received '${String(rawAppEnv)}'.`
    );
  }
  const appEnv = appEnvResult.data;

  // 2. Validate URL
  const rawUrl = rawEnv.VITE_SUPABASE_URL;
  if (typeof rawUrl !== 'string' || rawUrl.trim().length === 0) {
    throw new EnvConfigurationError(
      'CONFIG_MISSING_URL',
      'Environment validation failed: VITE_SUPABASE_URL is required and cannot be empty.'
    );
  }
  const trimmedUrl = rawUrl.trim();

  // Check URL placeholder
  if (PLACEHOLDER_PATTERNS.some((p) => trimmedUrl.toLowerCase().includes(p))) {
    throw new EnvConfigurationError(
      'CONFIG_PLACEHOLDER_URL',
      'Environment validation failed: VITE_SUPABASE_URL contains placeholder values.'
    );
  }

  // Validate URL structure
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmedUrl);
  } catch {
    throw new EnvConfigurationError(
      'CONFIG_INVALID_URL',
      `Environment validation failed: VITE_SUPABASE_URL must be a valid URL. Received '${trimmedUrl}'.`
    );
  }

  if (parsedUrl.protocol !== 'https:' && parsedUrl.hostname !== 'localhost') {
    throw new EnvConfigurationError(
      'CONFIG_INSECURE_URL',
      'Environment validation failed: VITE_SUPABASE_URL must use the HTTPS protocol.'
    );
  }

  const projectRef = extractProjectRef(trimmedUrl);

  // 3. Project Reference and Cross-Environment Checks
  // Local development connects directly to the main Supabase project (ujbbhvbtjfzsoalzmqve) or localhost
  if (appEnv === 'development') {
    if (
      projectRef === KNOWN_PROJECT_REFS.STAGING ||
      trimmedUrl.toLowerCase().includes(KNOWN_PROJECT_REFS.STAGING)
    ) {
      throw new EnvConfigurationError(
        'CONFIG_PROJECT_REF_MISMATCH',
        `Environment validation failed: Development environment must not connect to legacy staging Supabase project (${KNOWN_PROJECT_REFS.STAGING}). Please configure the main Supabase project (${KNOWN_PROJECT_REFS.MAIN}).`
      );
    }
    if (projectRef && projectRef !== KNOWN_PROJECT_REFS.MAIN) {
      throw new EnvConfigurationError(
        'CONFIG_PROJECT_REF_MISMATCH',
        `Environment validation failed: Project reference mismatch for development. Expected '${KNOWN_PROJECT_REFS.MAIN}', but URL specifies '${projectRef}'.`
      );
    }
  }

  if (appEnv === 'production') {
    if (
      projectRef === KNOWN_PROJECT_REFS.STAGING ||
      trimmedUrl.toLowerCase().includes(KNOWN_PROJECT_REFS.STAGING)
    ) {
      throw new EnvConfigurationError(
        'CONFIG_PROJECT_REF_MISMATCH',
        `Environment validation failed: Production environment must not connect to staging Supabase project (${KNOWN_PROJECT_REFS.STAGING}). Please configure the production Supabase project.`
      );
    }
    if (projectRef && projectRef !== KNOWN_PROJECT_REFS.PRODUCTION) {
      throw new EnvConfigurationError(
        'CONFIG_PROJECT_REF_MISMATCH',
        `Environment validation failed: Project reference mismatch for production. Expected '${KNOWN_PROJECT_REFS.PRODUCTION}', but URL specifies '${projectRef}'.`
      );
    }
  }

  // Staging URL / Project Ref check (legacy compatibility)
  if (appEnv === 'staging' && projectRef && projectRef !== KNOWN_PROJECT_REFS.STAGING) {
    throw new EnvConfigurationError(
      'CONFIG_PROJECT_REF_MISMATCH',
      `Environment validation failed: Project reference mismatch for staging. Expected '${KNOWN_PROJECT_REFS.STAGING}', but URL specifies '${projectRef}'.`
    );
  }

  // 4. Validate Credentials (Never print key values in error messages)
  const rawPublishableKey = rawEnv.VITE_SUPABASE_PUBLISHABLE_KEY;
  const rawAnonKey = rawEnv.VITE_SUPABASE_ANON_KEY;

  const hasPublishable = typeof rawPublishableKey === 'string' && rawPublishableKey.trim().length > 0;
  const hasAnon = typeof rawAnonKey === 'string' && rawAnonKey.trim().length > 0;

  if (!hasPublishable && !hasAnon) {
    throw new EnvConfigurationError(
      'CONFIG_MISSING_KEY',
      'Environment validation failed: Either VITE_SUPABASE_PUBLISHABLE_KEY or VITE_SUPABASE_ANON_KEY must be provided.'
    );
  }

  const effectiveKey = (hasPublishable ? rawPublishableKey : rawAnonKey) as string;
  const trimmedKey = effectiveKey.trim();

  if (PLACEHOLDER_PATTERNS.some((p) => trimmedKey.toLowerCase().includes(p))) {
    throw new EnvConfigurationError(
      'CONFIG_PLACEHOLDER_KEY',
      'Environment validation failed: Supabase API key contains placeholder values. A valid key is required.'
    );
  }

  if (trimmedKey.length < 20 || /\s/.test(trimmedKey)) {
    throw new EnvConfigurationError(
      'CONFIG_INVALID_KEY',
      'Environment validation failed: Supabase API key format is invalid. Key must be at least 20 characters and contain no whitespace.'
    );
  }

  return {
    VITE_SUPABASE_URL: trimmedUrl,
    VITE_SUPABASE_PUBLISHABLE_KEY: trimmedKey,
    VITE_SUPABASE_ANON_KEY: trimmedKey,
    VITE_APP_ENV: appEnv
  };
}

export type EnvValidationResult =
  | { ok: true; env: ValidatedEnv }
  | { ok: false; error: EnvConfigurationError };

export const parseEnv = (rawEnv?: Record<string, unknown>): ValidatedEnv => {
  const effectiveEnv = rawEnv ?? (import.meta.env as Record<string, unknown>);
  const isVitestDefaultEnv =
    rawEnv === undefined &&
    typeof process !== 'undefined' &&
    (process.env.VITEST === 'true' || process.env.NODE_ENV === 'test');

  // In test runners (Vitest), when using implicit environment defaults, normalize missing/placeholder vars for tests
  if (isVitestDefaultEnv) {
    const testEnv: Record<string, unknown> = {
      ...effectiveEnv,
      VITE_APP_ENV: effectiveEnv.VITE_APP_ENV ?? 'test',
      VITE_SUPABASE_URL:
        typeof effectiveEnv.VITE_SUPABASE_URL === 'string' &&
        !PLACEHOLDER_PATTERNS.some((p) => String(effectiveEnv.VITE_SUPABASE_URL).includes(p))
          ? effectiveEnv.VITE_SUPABASE_URL
          : `https://${KNOWN_PROJECT_REFS.MAIN}.supabase.co`,
      VITE_SUPABASE_PUBLISHABLE_KEY:
        typeof effectiveEnv.VITE_SUPABASE_PUBLISHABLE_KEY === 'string' &&
        !PLACEHOLDER_PATTERNS.some((p) => String(effectiveEnv.VITE_SUPABASE_PUBLISHABLE_KEY).includes(p))
          ? effectiveEnv.VITE_SUPABASE_PUBLISHABLE_KEY
          : 'sb_publishable_test_valid_format_dummy_key_1234567890'
    };
    return validateEnv(testEnv);
  }

  // In production builds (vite build), ensure environment defaults to production if not set
  if (effectiveEnv.MODE === 'production' && !effectiveEnv.VITE_APP_ENV) {
    return validateEnv({ ...effectiveEnv, VITE_APP_ENV: 'production' });
  }

  return validateEnv(effectiveEnv);
};

/**
 * Validates startup environment without throwing during ES module evaluation.
 */
export const safeParseEnv = (rawEnv?: Record<string, unknown>): EnvValidationResult => {
  try {
    return {
      ok: true,
      env: parseEnv(rawEnv)
    };
  } catch (err) {
    const configError =
      err instanceof EnvConfigurationError
        ? err
        : new EnvConfigurationError('CONFIG_UNKNOWN', 'Environment validation failed.');
    return {
      ok: false,
      error: configError
    };
  }
};

export const getEnv = (): ValidatedEnv => parseEnv();

/**
 * Lazy environment accessor so invalid deployment configuration does not abort
 * module evaluation before React renders the startup error screen.
 */
export const env: ValidatedEnv = {
  get VITE_SUPABASE_URL() {
    return getEnv().VITE_SUPABASE_URL;
  },
  get VITE_SUPABASE_PUBLISHABLE_KEY() {
    return getEnv().VITE_SUPABASE_PUBLISHABLE_KEY;
  },
  get VITE_SUPABASE_ANON_KEY() {
    return getEnv().VITE_SUPABASE_ANON_KEY;
  },
  get VITE_APP_ENV() {
    return getEnv().VITE_APP_ENV;
  }
};
export type Env = ValidatedEnv;

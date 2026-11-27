export interface ParsedAuthRedirectParams {
  error: string | null;
  errorCode: string | null;
  errorDescription: string | null;
  type: string | null;
}

function toSearchParams(raw: string): URLSearchParams {
  if (!raw) {
    return new URLSearchParams();
  }

  let normalized = raw.trim();
  if (normalized.startsWith('#')) {
    normalized = normalized.slice(1);
    if (normalized.startsWith('/')) {
      const queryStart = normalized.indexOf('?');
      normalized = queryStart >= 0 ? normalized.slice(queryStart + 1) : '';
    }
  } else if (normalized.startsWith('?')) {
    normalized = normalized.slice(1);
  }

  return new URLSearchParams(normalized);
}

/**
 * Safely parses non-secret metadata parameters from auth redirect search/hash segments.
 * Deliberately ignores access_token, refresh_token, code, and other secret credentials.
 */
export function parseAuthRedirectParams(
  search: string = '',
  hash: string = ''
): ParsedAuthRedirectParams {
  const searchParams = toSearchParams(search);
  const hashParams = toSearchParams(hash);

  const readParam = (key: string): string | null => {
    const hashValue = hashParams.get(key);
    if (hashValue && hashValue.trim()) return hashValue.trim();
    const searchValue = searchParams.get(key);
    if (searchValue && searchValue.trim()) return searchValue.trim();
    return null;
  };

  return {
    error: readParam('error'),
    errorCode: readParam('error_code'),
    errorDescription: readParam('error_description'),
    type: readParam('type')
  };
}

/**
 * Returns true when redirect metadata explicitly indicates a Supabase recovery flow
 * without error parameters.
 */
export function hasRecoveryRedirectHint(search: string = '', hash: string = ''): boolean {
  const params = parseAuthRedirectParams(search, hash);
  return (
    params.type === 'recovery' &&
    !params.error &&
    !params.errorCode &&
    !params.errorDescription
  );
}

/**
 * Maps Supabase auth error redirect parameters into a safe, user-facing error message
 * without reflecting raw URLs, tokens, or untrusted parameter payloads.
 */
export function getRecoveryUrlError(search: string = '', hash: string = ''): string | null {
  const params = parseAuthRedirectParams(search, hash);
  if (!params.error && !params.errorCode && !params.errorDescription) {
    return null;
  }

  const normalizedCode = params.errorCode?.toLowerCase() ?? '';
  const normalizedDescription = params.errorDescription?.toLowerCase() ?? '';

  if (normalizedCode === 'otp_expired' || normalizedDescription.includes('expired')) {
    return 'This password reset link is invalid or has expired. Please request a new password reset email.';
  }

  return 'We could not verify this password reset link. It may be invalid, expired, or already used. Please request a new reset link.';
}

/**
 * Blacklist of routes that should never be used as a post-login or post-callback redirect target
 * to prevent redirect loops.
 */
const FORBIDDEN_REDIRECT_ROUTES = [
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/auth/callback'
];

/**
 * Validates and sanitizes a requested redirect destination.
 * 
 * Guarantees that:
 * 1. The target is an internal relative URL (starts with '/').
 * 2. It does not start with '//' (preventing protocol-relative open redirects).
 * 3. It does not contain scheme exploits (e.g. 'javascript:').
 * 4. It is not an authentication page that would cause infinite loops.
 * 
 * @param target The raw requested redirect destination.
 * @param fallback The safe default fallback route (defaults to '/dashboard').
 * @returns A safe relative route string.
 */
export function getSafeRedirectUrl(target: string | null | undefined, fallback: string = '/dashboard'): string {
  if (!target || typeof target !== 'string') {
    return fallback;
  }

  const trimmed = target.trim();

  // Must begin with a single slash
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return fallback;
  }

  // Reject explicit schemes or javascript execution
  if (trimmed.includes(':') || trimmed.toLowerCase().includes('javascript:')) {
    return fallback;
  }

  // Extract base pathname without query string or hash for route checking
  const pathname = trimmed.split('?')[0].split('#')[0].toLowerCase();

  // Prevent redirect loops back to auth pages
  if (FORBIDDEN_REDIRECT_ROUTES.includes(pathname)) {
    return fallback;
  }

  return trimmed;
}

import { describe, it, expect } from 'vitest';
import { getSafeRedirectUrl } from '@/features/auth/utils/redirects';

describe('getSafeRedirectUrl', () => {
  it('allows valid internal relative paths', () => {
    expect(getSafeRedirectUrl('/dashboard')).toBe('/dashboard');
    expect(getSafeRedirectUrl('/accounts')).toBe('/accounts');
    expect(getSafeRedirectUrl('/transactions?tab=income')).toBe('/transactions?tab=income');
    expect(getSafeRedirectUrl('/settings#security')).toBe('/settings#security');
  });

  it('rejects protocol-relative open redirect attacks (e.g. //evil.com)', () => {
    expect(getSafeRedirectUrl('//evil.com')).toBe('/dashboard');
    expect(getSafeRedirectUrl('//attacker.org/steal')).toBe('/dashboard');
  });

  it('rejects absolute URLs with external schemes', () => {
    expect(getSafeRedirectUrl('https://evil.com')).toBe('/dashboard');
    expect(getSafeRedirectUrl('http://attacker.com/dashboard')).toBe('/dashboard');
    expect(getSafeRedirectUrl('javascript:alert(1)')).toBe('/dashboard');
  });

  it('prevents redirect loops back to authentication pages', () => {
    expect(getSafeRedirectUrl('/login')).toBe('/dashboard');
    expect(getSafeRedirectUrl('/register')).toBe('/dashboard');
    expect(getSafeRedirectUrl('/forgot-password')).toBe('/dashboard');
    expect(getSafeRedirectUrl('/reset-password')).toBe('/dashboard');
    expect(getSafeRedirectUrl('/auth/callback')).toBe('/dashboard');
    expect(getSafeRedirectUrl('/login?redirect=/accounts')).toBe('/dashboard');
  });

  it('falls back to custom fallback if provided on invalid input', () => {
    expect(getSafeRedirectUrl(null, '/overview')).toBe('/overview');
    expect(getSafeRedirectUrl(undefined, '/overview')).toBe('/overview');
    expect(getSafeRedirectUrl('', '/overview')).toBe('/overview');
    expect(getSafeRedirectUrl('invalid-path', '/overview')).toBe('/overview');
  });
});

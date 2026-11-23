import { describe, it, expect } from 'vitest';
import {
  validateEnv,
  extractProjectRef,
  KNOWN_PROJECT_REFS
} from '@/config/env';

describe('Environment Validation & Isolation', () => {
  const validProdKey = 'sb_publishable_valid_production_test_token_1234567890';
  const validStagingKey = 'sb_publishable_valid_staging_test_token_1234567890';

  describe('1. Valid Development Configuration with Main Supabase Project', () => {
    it('accepts valid development configuration with main project and publishable key', () => {
      const result = validateEnv({
        VITE_APP_ENV: 'development',
        VITE_SUPABASE_URL: `https://${KNOWN_PROJECT_REFS.MAIN}.supabase.co`,
        VITE_SUPABASE_PUBLISHABLE_KEY: validProdKey
      });

      expect(result.VITE_APP_ENV).toBe('development');
      expect(result.VITE_SUPABASE_URL).toBe(`https://${KNOWN_PROJECT_REFS.MAIN}.supabase.co`);
      expect(result.VITE_SUPABASE_PUBLISHABLE_KEY).toBe(validProdKey);
      expect(result.VITE_SUPABASE_ANON_KEY).toBe(validProdKey);
    });

    it('accepts valid development configuration with anon key alias', () => {
      const result = validateEnv({
        VITE_APP_ENV: 'development',
        VITE_SUPABASE_URL: `https://${KNOWN_PROJECT_REFS.MAIN}.supabase.co`,
        VITE_SUPABASE_ANON_KEY: validProdKey
      });

      expect(result.VITE_APP_ENV).toBe('development');
      expect(result.VITE_SUPABASE_PUBLISHABLE_KEY).toBe(validProdKey);
    });

    it('accepts valid production configuration with main project reference', () => {
      const result = validateEnv({
        VITE_APP_ENV: 'production',
        VITE_SUPABASE_URL: `https://${KNOWN_PROJECT_REFS.PRODUCTION}.supabase.co`,
        VITE_SUPABASE_PUBLISHABLE_KEY: validProdKey
      });

      expect(result.VITE_APP_ENV).toBe('production');
      expect(result.VITE_SUPABASE_URL).toBe(`https://${KNOWN_PROJECT_REFS.PRODUCTION}.supabase.co`);
      expect(result.VITE_SUPABASE_PUBLISHABLE_KEY).toBe(validProdKey);
    });

    it('accepts localhost Supabase configuration for local development', () => {
      const result = validateEnv({
        VITE_APP_ENV: 'development',
        VITE_SUPABASE_URL: 'http://localhost:54321',
        VITE_SUPABASE_PUBLISHABLE_KEY: validProdKey
      });

      expect(result.VITE_APP_ENV).toBe('development');
      expect(result.VITE_SUPABASE_URL).toBe('http://localhost:54321');
    });
  });

  describe('2. Development Pointing to Legacy Staging or Foreign Project (Rejected)', () => {
    it('rejects development environment pointing to legacy staging project reference', () => {
      expect(() =>
        validateEnv({
          VITE_APP_ENV: 'development',
          VITE_SUPABASE_URL: `https://${KNOWN_PROJECT_REFS.STAGING}.supabase.co`,
          VITE_SUPABASE_PUBLISHABLE_KEY: validStagingKey
        })
      ).toThrowError(/Development environment must not connect to legacy staging Supabase project/);
    });

    it('rejects development environment with legacy staging project ref in any part of URL', () => {
      expect(() =>
        validateEnv({
          VITE_APP_ENV: 'development',
          VITE_SUPABASE_URL: `https://custom-domain.com/${KNOWN_PROJECT_REFS.STAGING}`,
          VITE_SUPABASE_PUBLISHABLE_KEY: validStagingKey
        })
      ).toThrowError(/Development environment must not connect to legacy staging Supabase project/);
    });

    it('rejects development environment pointing to unexpected foreign project reference', () => {
      expect(() =>
        validateEnv({
          VITE_APP_ENV: 'development',
          VITE_SUPABASE_URL: 'https://foreignproject12345.supabase.co',
          VITE_SUPABASE_PUBLISHABLE_KEY: validProdKey
        })
      ).toThrowError(/Project reference mismatch for development. Expected 'ujbbhvbtjfzsoalzmqve', but URL specifies 'foreignproject12345'/);
    });
  });

  describe('3. Production Pointing to Staging (Rejected)', () => {
    it('rejects production environment pointing to known staging project reference', () => {
      expect(() =>
        validateEnv({
          VITE_APP_ENV: 'production',
          VITE_SUPABASE_URL: `https://${KNOWN_PROJECT_REFS.STAGING}.supabase.co`,
          VITE_SUPABASE_PUBLISHABLE_KEY: validStagingKey
        })
      ).toThrowError(/Production environment must not connect to staging Supabase project/);
    });

    it('rejects production environment with staging project ref in any part of URL', () => {
      expect(() =>
        validateEnv({
          VITE_APP_ENV: 'production',
          VITE_SUPABASE_URL: `https://custom-domain.com/${KNOWN_PROJECT_REFS.STAGING}`,
          VITE_SUPABASE_PUBLISHABLE_KEY: validStagingKey
        })
      ).toThrowError(/Production environment must not connect to staging Supabase project/);
    });
  });

  describe('4. Missing Credentials (Rejected)', () => {
    it('rejects when both publishable key and anon key are missing', () => {
      expect(() =>
        validateEnv({
          VITE_APP_ENV: 'development',
          VITE_SUPABASE_URL: `https://${KNOWN_PROJECT_REFS.MAIN}.supabase.co`
        })
      ).toThrowError(/Either VITE_SUPABASE_PUBLISHABLE_KEY or VITE_SUPABASE_ANON_KEY must be provided/);
    });

    it('rejects when keys are empty strings or whitespace only', () => {
      expect(() =>
        validateEnv({
          VITE_APP_ENV: 'development',
          VITE_SUPABASE_URL: `https://${KNOWN_PROJECT_REFS.MAIN}.supabase.co`,
          VITE_SUPABASE_PUBLISHABLE_KEY: '   '
        })
      ).toThrowError(/Either VITE_SUPABASE_PUBLISHABLE_KEY or VITE_SUPABASE_ANON_KEY must be provided/);
    });

    it('rejects when VITE_SUPABASE_URL is missing', () => {
      expect(() =>
        validateEnv({
          VITE_APP_ENV: 'development',
          VITE_SUPABASE_PUBLISHABLE_KEY: validProdKey
        })
      ).toThrowError(/VITE_SUPABASE_URL is required/);
    });
  });

  describe('5. Placeholder Credentials (Rejected)', () => {
    it('rejects URL containing your-project-id placeholder', () => {
      expect(() =>
        validateEnv({
          VITE_APP_ENV: 'development',
          VITE_SUPABASE_URL: 'https://your-project-id.supabase.co',
          VITE_SUPABASE_PUBLISHABLE_KEY: validProdKey
        })
      ).toThrowError(/VITE_SUPABASE_URL contains placeholder values/);
    });

    it('rejects URL containing placeholder substring', () => {
      expect(() =>
        validateEnv({
          VITE_APP_ENV: 'development',
          VITE_SUPABASE_URL: 'https://placeholder-project.supabase.co',
          VITE_SUPABASE_PUBLISHABLE_KEY: validProdKey
        })
      ).toThrowError(/VITE_SUPABASE_URL contains placeholder values/);
    });

    it('rejects publishable key containing your-publishable-key-here placeholder', () => {
      expect(() =>
        validateEnv({
          VITE_APP_ENV: 'development',
          VITE_SUPABASE_URL: `https://${KNOWN_PROJECT_REFS.MAIN}.supabase.co`,
          VITE_SUPABASE_PUBLISHABLE_KEY: 'your-publishable-key-here'
        })
      ).toThrowError(/Supabase API key contains placeholder values/);
    });

    it('rejects anon key containing your-anon-key placeholder', () => {
      expect(() =>
        validateEnv({
          VITE_APP_ENV: 'development',
          VITE_SUPABASE_URL: `https://${KNOWN_PROJECT_REFS.MAIN}.supabase.co`,
          VITE_SUPABASE_ANON_KEY: 'your-anon-key-here'
        })
      ).toThrowError(/Supabase API key contains placeholder values/);
    });
  });

  describe('6. URL & Project-Reference Mismatch (Rejected)', () => {
    it('rejects production when URL references an unexpected foreign Supabase project', () => {
      expect(() =>
        validateEnv({
          VITE_APP_ENV: 'production',
          VITE_SUPABASE_URL: 'https://foreignproject12345.supabase.co',
          VITE_SUPABASE_PUBLISHABLE_KEY: validProdKey
        })
      ).toThrowError(/Project reference mismatch for production. Expected 'ujbbhvbtjfzsoalzmqve', but URL specifies 'foreignproject12345'/);
    });

    it('rejects unparseable URL', () => {
      expect(() =>
        validateEnv({
          VITE_APP_ENV: 'development',
          VITE_SUPABASE_URL: 'not-a-valid-url',
          VITE_SUPABASE_PUBLISHABLE_KEY: validProdKey
        })
      ).toThrowError(/VITE_SUPABASE_URL must be a valid URL/);
    });

    it('rejects non-HTTPS URL (except localhost)', () => {
      expect(() =>
        validateEnv({
          VITE_APP_ENV: 'development',
          VITE_SUPABASE_URL: `http://${KNOWN_PROJECT_REFS.MAIN}.supabase.co`,
          VITE_SUPABASE_PUBLISHABLE_KEY: validProdKey
        })
      ).toThrowError(/VITE_SUPABASE_URL must use the HTTPS protocol/);
    });
  });

  describe('7. Credential Confidentiality (Never Logged)', () => {
    it('does not include the sensitive key value in error messages', () => {
      const secretTokenWithWhitespace = 'sb_publishable_secret_token with whitespace';
      try {
        validateEnv({
          VITE_APP_ENV: 'development',
          VITE_SUPABASE_URL: `https://${KNOWN_PROJECT_REFS.MAIN}.supabase.co`,
          VITE_SUPABASE_PUBLISHABLE_KEY: secretTokenWithWhitespace
        });
        expect.unreachable('Should have thrown');
      } catch (err) {
        const errorMsg = (err as Error).message;
        expect(errorMsg).not.toContain(secretTokenWithWhitespace);
        expect(errorMsg).not.toContain('secret_token');
        expect(errorMsg).toContain('Supabase API key format is invalid');
      }
    });
  });

  describe('8. extractProjectRef helper', () => {
    it('correctly extracts project reference from supabase.co URLs', () => {
      expect(extractProjectRef('https://ujbbhvbtjfzsoalzmqve.supabase.co')).toBe('ujbbhvbtjfzsoalzmqve');
      expect(extractProjectRef('https://vtnygwjcwbufsreswhjw.supabase.co')).toBe('vtnygwjcwbufsreswhjw');
      expect(extractProjectRef('https://custom-host.com')).toBeNull();
      expect(extractProjectRef('invalid-url')).toBeNull();
    });
  });

  describe('9. Configured Project Reference Verification', () => {
    it('configures the main Supabase project reference (ujbbhvbtjfzsoalzmqve) without exposing secrets', async () => {
      const { env } = await import('@/config/env');
      expect(extractProjectRef(env.VITE_SUPABASE_URL)).toBe(KNOWN_PROJECT_REFS.MAIN);
      expect(KNOWN_PROJECT_REFS.MAIN).toBe('ujbbhvbtjfzsoalzmqve');
      expect(env.VITE_SUPABASE_URL).toBe('https://ujbbhvbtjfzsoalzmqve.supabase.co');
      expect(typeof env.VITE_SUPABASE_PUBLISHABLE_KEY).toBe('string');
      expect(env.VITE_SUPABASE_PUBLISHABLE_KEY.length).toBeGreaterThanOrEqual(20);
    });
  });
});

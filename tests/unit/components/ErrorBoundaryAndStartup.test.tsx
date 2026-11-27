import React from 'react';
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { ErrorBoundary } from '@/components/feedback/ErrorBoundary';
import { RouteErrorFallback } from '@/components/feedback/RouteErrorFallback';
import { AppStartupErrorScreen } from '@/components/feedback/AppStartupErrorScreen';
import { App } from '@/App';
import { appRoutes } from '@/app/router/routes';
import {
  EnvConfigurationError,
  getSafeEnvErrorSummary,
  KNOWN_PROJECT_REFS,
  safeParseEnv
} from '@/config/env';

const OriginalRequest = globalThis.Request;

describe('Phase 12 Stage 1B: Error Boundaries, Router Resilience & Startup Config', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    // Align jsdom AbortSignal with Node/undici global Request when React Router constructs client Requests
    const CompatibleRequest = function (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Request {
      try {
        return new OriginalRequest(input, init);
      } catch (err) {
        if (err instanceof TypeError && init?.signal) {
          const { signal: _crossRealmSignal, ...rest } = init;
          return new OriginalRequest(input, rest);
        }
        throw err;
      }
    } as unknown as typeof Request;
    CompatibleRequest.prototype = OriginalRequest.prototype;
    globalThis.Request = CompatibleRequest;
  });

  afterAll(() => {
    globalThis.Request = OriginalRequest;
  });

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  describe('1. Root ErrorBoundary & Fallback UI', () => {
    it('catches descendant render exceptions and shows Obsidian Gold fallback without leaking sensitive data', () => {
      const sensitiveErrorMessage =
        'Ledger crash for TX ₹1,25,000 HDFCBank-Acct-9988 sb_publishable_secret_token_xyz';

      const CrashingWidget: React.FC = () => {
        throw new Error(sensitiveErrorMessage);
      };

      const { container } = render(
        <ErrorBoundary boundaryName="TestRootBoundary">
          <CrashingWidget />
        </ErrorBoundary>
      );

      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('LaxmiLens')).toBeInTheDocument();
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      expect(screen.getByText('Local Data Preserved')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /reload app/i })).toBeInTheDocument();

      // UI fallback must never expose internal error messages, financial figures, credentials, or stack traces
      expect(container.textContent).not.toContain('1,25,000');
      expect(container.textContent).not.toContain('HDFCBank');
      expect(container.textContent).not.toContain('sb_publishable_secret_token_xyz');
      expect(container.textContent).not.toContain('CrashingWidget');

      // Verify our structured diagnostic log omits raw message, secrets, and stack traces
      const diagnosticCall = consoleErrorSpy.mock.calls.find(
        (call) => call[0] === '[LaxmiLens Diagnostic]'
      );
      expect(diagnosticCall).toBeDefined();
      const serializedDiagnostic = JSON.stringify(diagnosticCall?.[1]);
      expect(serializedDiagnostic).toContain('TestRootBoundary');
      expect(serializedDiagnostic).toContain('Error');
      expect(serializedDiagnostic).not.toContain('1,25,000');
      expect(serializedDiagnostic).not.toContain('HDFCBank');
      expect(serializedDiagnostic).not.toContain('sb_publishable_secret_token_xyz');
      expect(serializedDiagnostic).not.toContain('stack');
    });

    it('catches descendant lifecycle errors from componentDidMount', () => {
      class LifecycleCrashingChild extends React.Component {
        public componentDidMount(): void {
          throw new RangeError('Lifecycle mount failure with internal passphrase');
        }

        public render(): React.ReactNode {
          return <div>Mounted content</div>;
        }
      }

      const { container } = render(
        <ErrorBoundary boundaryName="LifecycleBoundary">
          <LifecycleCrashingChild />
        </ErrorBoundary>
      );

      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      expect(container.textContent).not.toContain('passphrase');
    });

    it('recovers cleanly on Try Again without wiping localStorage or triggering reload', () => {
      let shouldThrow = true;
      const handleRetry = vi.fn();
      const handleReload = vi.fn();
      const clearStorageSpy = vi.spyOn(Storage.prototype, 'clear');

      localStorage.setItem('laxmilens.preserve.check', 'intact');

      const RecoverableWidget: React.FC = () => {
        if (shouldThrow) {
          throw new Error('Transient render error');
        }
        return <div>Recovered Dashboard Panel</div>;
      };

      render(
        <ErrorBoundary onRetry={handleRetry} onReload={handleReload}>
          <RecoverableWidget />
        </ErrorBoundary>
      );

      expect(screen.getByText('Something went wrong')).toBeInTheDocument();

      shouldThrow = false;
      fireEvent.click(screen.getByRole('button', { name: /try again/i }));

      expect(screen.getByText('Recovered Dashboard Panel')).toBeInTheDocument();
      expect(handleRetry).toHaveBeenCalledTimes(1);
      expect(handleReload).not.toHaveBeenCalled();
      expect(clearStorageSpy).not.toHaveBeenCalled();
      expect(localStorage.getItem('laxmilens.preserve.check')).toBe('intact');

      localStorage.removeItem('laxmilens.preserve.check');
      clearStorageSpy.mockRestore();
    });

    it('invokes explicit reload handler when Reload App is clicked and resets when resetKeys change', () => {
      const handleReload = vi.fn();

      const ConditionalCrash: React.FC<{ fail: boolean }> = ({ fail }) => {
        if (fail) {
          throw new Error('Route key crash');
        }
        return <div>Healthy Keyed Content</div>;
      };

      const { rerender } = render(
        <ErrorBoundary resetKeys={['route-a']} onReload={handleReload}>
          <ConditionalCrash fail />
        </ErrorBoundary>
      );

      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /reload app/i }));
      expect(handleReload).toHaveBeenCalledTimes(1);

      rerender(
        <ErrorBoundary resetKeys={['route-b']} onReload={handleReload}>
          <ConditionalCrash fail={false} />
        </ErrorBoundary>
      );

      expect(screen.getByText('Healthy Keyed Content')).toBeInTheDocument();
    });
  });

  describe('2. Router Error Handling & Route Fallback', () => {
    it('configures errorElement across the application route hierarchy', () => {
      expect(appRoutes.length).toBeGreaterThan(0);
      expect(appRoutes[0]?.errorElement).toBeDefined();

      const topChildren = appRoutes[0]?.children ?? [];
      expect(topChildren.every((route) => Boolean(route.errorElement))).toBe(true);

      const protectedBranch = topChildren.find((route) => route.path === '/');
      const appLayoutBranch = protectedBranch?.children?.[0];
      expect(appLayoutBranch?.errorElement).toBeDefined();
      expect(appLayoutBranch?.children?.[0]?.errorElement).toBeDefined();
    });

    it('renders safe fallback on route render failure, hides secrets, and allows retry recovery', async () => {
      let shouldCrash = true;

      const FailingTransactionsView: React.FC = () => {
        if (shouldCrash) {
          throw new Error('Bearer secret_supabase_jwt_token and ₹42,000 balance');
        }
        return <div>Transactions Ledger Loaded</div>;
      };

      const memoryRouter = createMemoryRouter(
        [
          {
            errorElement: <RouteErrorFallback homePath="/dashboard" homeLabel="Back to Dashboard" />,
            children: [
              { path: '/dashboard', element: <div>Dashboard Home</div> },
              {
                path: '/transactions',
                element: <FailingTransactionsView />,
                errorElement: (
                  <RouteErrorFallback
                    embedded
                    homePath="/dashboard"
                    homeLabel="Back to Dashboard"
                  />
                )
              }
            ]
          }
        ],
        { initialEntries: ['/transactions'] }
      );

      const { container } = render(<RouterProvider router={memoryRouter} />);

      expect(screen.getByText('Unable to Display Page')).toBeInTheDocument();
      expect(screen.getByText('ROUTE_RENDER_ERROR')).toBeInTheDocument();
      expect(container.textContent).not.toContain('secret_supabase_jwt_token');
      expect(container.textContent).not.toContain('42,000');

      shouldCrash = false;
      fireEvent.click(screen.getByRole('button', { name: /try again/i }));

      await waitFor(() => {
        expect(screen.getByText('Transactions Ledger Loaded')).toBeInTheDocument();
      });
    });

    it('renders 404 route error safely and navigates back to dashboard', async () => {
      const memoryRouter = createMemoryRouter(
        [
          {
            errorElement: <RouteErrorFallback homePath="/dashboard" homeLabel="Back to Dashboard" />,
            children: [
              { path: '/dashboard', element: <div>Safe Dashboard Landing</div> },
              {
                path: '/reports/:id',
                loader: () => {
                  throw new Response('Internal database query leak', { status: 404 });
                },
                element: <div>Report Details</div>
              }
            ]
          }
        ],
        { initialEntries: ['/reports/missing'] }
      );

      const { container } = render(<RouterProvider router={memoryRouter} />);

      await waitFor(() => {
        expect(screen.getByText('Page Not Found')).toBeInTheDocument();
      });

      expect(screen.getByText('ROUTE_NOT_FOUND_404')).toBeInTheDocument();
      expect(container.textContent).not.toContain('Internal database query leak');

      fireEvent.click(screen.getByRole('button', { name: /back to dashboard/i }));

      await waitFor(() => {
        expect(screen.getByText('Safe Dashboard Landing')).toBeInTheDocument();
      });
    });
  });

  describe('3. Environment Startup Failure & Lazy Client Safety', () => {
    it('returns structured failure results in safeParseEnv without throwing or exposing credentials', () => {
      const missingKeyResult = safeParseEnv({
        VITE_APP_ENV: 'production',
        VITE_SUPABASE_URL: `https://${KNOWN_PROJECT_REFS.PRODUCTION}.supabase.co`
      });

      expect(missingKeyResult.ok).toBe(false);
      if (!missingKeyResult.ok) {
        expect(missingKeyResult.error).toBeInstanceOf(EnvConfigurationError);
        expect(missingKeyResult.error.code).toBe('CONFIG_MISSING_KEY');
      }

      const leakedToken = 'sb_secret_with whitespace_never_display';
      const invalidKeyResult = safeParseEnv({
        VITE_APP_ENV: 'production',
        VITE_SUPABASE_URL: `https://${KNOWN_PROJECT_REFS.PRODUCTION}.supabase.co`,
        VITE_SUPABASE_PUBLISHABLE_KEY: leakedToken
      });

      expect(invalidKeyResult.ok).toBe(false);
      if (!invalidKeyResult.ok) {
        const summary = getSafeEnvErrorSummary(invalidKeyResult.error);
        expect(summary.code).toBe('CONFIG_INVALID_KEY');
        expect(summary.message).not.toContain(leakedToken);
        expect(summary.message).not.toContain(KNOWN_PROJECT_REFS.PRODUCTION);
      }

      const stagingInProdResult = safeParseEnv({
        VITE_APP_ENV: 'production',
        VITE_SUPABASE_URL: `https://${KNOWN_PROJECT_REFS.STAGING}.supabase.co`,
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_valid_length_token_123456'
      });

      expect(stagingInProdResult.ok).toBe(false);
      if (!stagingInProdResult.ok) {
        const summary = getSafeEnvErrorSummary(stagingInProdResult.error);
        expect(summary.code).toBe('CONFIG_PROJECT_REF_MISMATCH');
        expect(summary.message).not.toContain(KNOWN_PROJECT_REFS.STAGING);
      }
    });

    it('renders controlled startup fallback in App without blank screen or secret leakage', () => {
      const onRetryStartup = vi.fn();
      const failedValidation = safeParseEnv({
        VITE_APP_ENV: 'production',
        VITE_SUPABASE_URL: 'https://foreignproject999.supabase.co',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_should_not_appear_in_ui'
      });

      expect(failedValidation.ok).toBe(false);

      const { container } = render(
        <App envValidation={failedValidation} onRetryStartup={onRetryStartup} />
      );

      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('LaxmiLens')).toBeInTheDocument();
      expect(screen.getByText('Environment Isolation Mismatch')).toBeInTheDocument();
      expect(screen.getByText('CONFIG_PROJECT_REF_MISMATCH')).toBeInTheDocument();
      expect(screen.getByText('Local Data Preserved')).toBeInTheDocument();

      // Must never render URLs, project refs, keys, or stack traces
      expect(container.textContent).not.toContain('foreignproject999');
      expect(container.textContent).not.toContain(KNOWN_PROJECT_REFS.PRODUCTION);
      expect(container.textContent).not.toContain('sb_publishable_should_not_appear_in_ui');

      fireEvent.click(screen.getByRole('button', { name: /retry startup/i }));
      expect(onRetryStartup).toHaveBeenCalledTimes(1);
    });

    it('does not crash at module import time when env/supabase modules are imported alongside invalid env', async () => {
      vi.resetModules();
      vi.stubEnv('VITE_APP_ENV', 'production');
      vi.stubEnv('VITE_SUPABASE_URL', 'https://foreignproject999.supabase.co');

      const envModule = await import('@/config/env');
      await expect(import('@/infrastructure/database/cloud/supabaseClient')).resolves.toBeDefined();
      await expect(import('@/infrastructure/logging/ConsoleLogger')).resolves.toBeDefined();
      const appModule = await import('@/App');

      expect(() => envModule.getEnv()).toThrow(envModule.EnvConfigurationError);

      const FreshApp = appModule.App;
      const { container } = render(<FreshApp />);
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('Environment Isolation Mismatch')).toBeInTheDocument();
      expect(container.textContent).not.toContain('foreignproject999');
    });

    it('supports safe standalone rendering of AppStartupErrorScreen', () => {
      const err = new EnvConfigurationError(
        'CONFIG_MISSING_URL',
        'Environment validation failed: secret_value_should_stay_hidden'
      );

      const { container } = render(<AppStartupErrorScreen error={err} />);

      expect(screen.getByText('Incomplete Deployment Configuration')).toBeInTheDocument();
      expect(screen.getByText('CONFIG_MISSING_URL')).toBeInTheDocument();
      expect(container.textContent).not.toContain('secret_value_should_stay_hidden');
    });
  });
});

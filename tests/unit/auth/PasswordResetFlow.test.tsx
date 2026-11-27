import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/features/auth/context/AuthContext';
import { AuthChangeEvent, AuthPort, AuthUser } from '@/application/ports/AuthPort';
import { ProtectedRoute } from '@/app/router/ProtectedRoute';
import { GuestRoute } from '@/app/router/GuestRoute';
import { ResetPasswordPage } from '@/features/auth/pages/ResetPasswordPage';
import { AuthCallbackPage } from '@/features/auth/pages/AuthCallbackPage';
import { LoginPage } from '@/features/auth/pages/LoginPage';
import { defaultDatabaseManager } from '@/infrastructure/database/local/DatabaseManager';
import { defaultLegacyMigrator } from '@/infrastructure/database/local/LegacyDatabaseMigrator';
import { LaxmiLensDB } from '@/infrastructure/database/local/DexieDatabase';
import { supabase } from '@/infrastructure/database/cloud/supabaseClient';

const RECOVERY_USER: AuthUser = {
  id: 'aa854190-e763-45d8-a840-ea90f668f561',
  email: 'recovery@laxmilens.app'
};

interface MockAuthHarness {
  adapter: AuthPort;
  emitAuthEvent: (user: AuthUser | null, event: AuthChangeEvent) => void;
}

function createMockAuthHarness(initialUser: AuthUser | null = null): MockAuthHarness {
  let listener: ((user: AuthUser | null, event: AuthChangeEvent) => void) | null = null;

  const adapter: AuthPort = {
    getCurrentUser: vi.fn().mockResolvedValue(initialUser),
    signInWithEmail: vi.fn().mockResolvedValue(RECOVERY_USER),
    signUpWithEmail: vi.fn().mockResolvedValue(RECOVERY_USER),
    signInWithOAuth: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
    resetPasswordForEmail: vi.fn().mockResolvedValue(undefined),
    updatePassword: vi.fn().mockResolvedValue(undefined),
    onAuthStateChange: vi.fn((cb) => {
      listener = cb;
      return () => {
        listener = null;
      };
    })
  };

  return {
    adapter,
    emitAuthEvent: (user, event) => {
      listener?.(user, event);
    }
  };
}

function renderRecoveryRouter(
  harness: MockAuthHarness,
  initialEntries: string[]
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });

  const result = render(
    <QueryClientProvider client={qc}>
      <AuthProvider authAdapter={harness.adapter}>
        <MemoryRouter initialEntries={initialEntries}>
          <Routes>
            <Route path="/auth/callback" element={<AuthCallbackPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route element={<GuestRoute />}>
              <Route path="/login" element={<LoginPage />} />
              <Route
                path="/forgot-password"
                element={<div data-testid="forgot-password-view">Forgot Password Screen</div>}
              />
            </Route>
            <Route element={<ProtectedRoute />}>
              <Route
                path="/"
                element={<div data-testid="dashboard-view">Dashboard Screen</div>}
              />
              <Route
                path="/dashboard"
                element={<div data-testid="dashboard-view">Dashboard Screen</div>}
              />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );

  return { ...result, queryClient: qc };
}

describe('Password Reset Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    window.history.replaceState({}, '', '/');

    const mockDb = {
      name: `LaxmiLens_LocalDB_${RECOVERY_USER.id}`,
      isOpen: () => true
    } as unknown as LaxmiLensDB;

    vi.spyOn(defaultDatabaseManager, 'openForUser').mockResolvedValue(mockDb);
    vi.spyOn(defaultDatabaseManager, 'closeCurrentDatabase').mockResolvedValue(undefined);
    vi.spyOn(defaultDatabaseManager, 'isUserActive').mockReturnValue(true);
    vi.spyOn(defaultDatabaseManager, 'notifySessionReady').mockImplementation(() => {});
    vi.spyOn(defaultDatabaseManager, 'notifyAuthRefreshed').mockImplementation(() => {});
    vi.spyOn(defaultDatabaseManager, 'subscribeSyncCompletion').mockReturnValue(() => {});

    vi.spyOn(defaultLegacyMigrator, 'migrate').mockResolvedValue({
      userId: RECOVERY_USER.id,
      accountsMigrated: 0,
      transactionsMigrated: 0,
      categoriesMigrated: 0,
      profilesMigrated: 0,
      outboxEntriesMigrated: 0,
      skippedForeignRecords: 0,
      skippedAmbiguousRecords: 0,
      alreadyMigratedRecords: 0,
      isComplete: true,
      errors: []
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.sessionStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('redirects PASSWORD_RECOVERY auth event from protected and guest routes to /reset-password without exposing /dashboard', async () => {
    const harness = createMockAuthHarness(null);
    const { queryClient } = renderRecoveryRouter(harness, ['/dashboard']);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
    });

    await act(async () => {
      harness.emitAuthEvent(RECOVERY_USER, 'PASSWORD_RECOVERY');
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /set new password/i })).toBeInTheDocument();
    });

    expect(screen.queryByTestId('dashboard-view')).not.toBeInTheDocument();
    queryClient.clear();
  });

  it('keeps user on /reset-password instead of redirecting to /dashboard when recovery link establishes a session', async () => {
    window.history.replaceState(
      {},
      '',
      '/reset-password#access_token=secret-access-token&refresh_token=secret-refresh&type=recovery'
    );
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const harness = createMockAuthHarness(RECOVERY_USER);
    const { queryClient } = renderRecoveryRouter(harness, [
      '/reset-password#access_token=secret-access-token&refresh_token=secret-refresh&type=recovery'
    ]);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /set new password/i })).toBeInTheDocument();
    });

    expect(screen.queryByTestId('dashboard-view')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^new password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm new password/i)).toBeInTheDocument();

    // Ensure secret tokens never appear in rendered UI or console output
    expect(document.body.textContent).not.toContain('secret-access-token');
    expect(document.body.textContent).not.toContain('secret-refresh');
    expect(JSON.stringify(consoleLogSpy.mock.calls)).not.toContain('secret-access-token');
    expect(JSON.stringify(consoleErrorSpy.mock.calls)).not.toContain('secret-access-token');
    queryClient.clear();
  });

  it('redirects /auth/callback PASSWORD_RECOVERY events to /reset-password instead of /dashboard', async () => {
    const harness = createMockAuthHarness(null);
    let callbackListener: ((event: string, session: unknown) => void) | null = null;

    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
      data: { session: null },
      error: null
    } as Awaited<ReturnType<typeof supabase.auth.getSession>>);

    vi.spyOn(supabase.auth, 'onAuthStateChange').mockImplementation((cb) => {
      callbackListener = cb as (event: string, session: unknown) => void;
      return {
        data: {
          subscription: {
            id: 'sub-1',
            callback: cb,
            unsubscribe: vi.fn()
          }
        }
      };
    });

    const { queryClient } = renderRecoveryRouter(harness, ['/auth/callback']);

    await waitFor(() => {
      expect(callbackListener).not.toBeNull();
    });

    await act(async () => {
      harness.emitAuthEvent(RECOVERY_USER, 'PASSWORD_RECOVERY');
      callbackListener?.('PASSWORD_RECOVERY', { user: RECOVERY_USER });
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /set new password/i })).toBeInTheDocument();
    });

    expect(screen.queryByTestId('dashboard-view')).not.toBeInTheDocument();
    queryClient.clear();
  });

  it('rejects password mismatch and invalid weak passwords without calling updatePassword', async () => {
    const harness = createMockAuthHarness(RECOVERY_USER);
    const { queryClient } = renderRecoveryRouter(harness, ['/reset-password']);

    await act(async () => {
      harness.emitAuthEvent(RECOVERY_USER, 'PASSWORD_RECOVERY');
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /set new password/i })).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/^new password/i), {
      target: { value: 'StrongPass123' }
    });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: 'MismatchPass123' }
    });
    fireEvent.click(screen.getByRole('button', { name: /update password/i }));

    await waitFor(() => {
      expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
    });
    expect(harness.adapter.updatePassword).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/^new password/i), {
      target: { value: 'short' }
    });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: 'short' }
    });
    fireEvent.click(screen.getByRole('button', { name: /update password/i }));

    await waitFor(() => {
      expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument();
    });
    expect(harness.adapter.updatePassword).not.toHaveBeenCalled();
    queryClient.clear();
  });

  it('updates password, displays confirmation, and allows continuing to /dashboard once completed', async () => {
    const harness = createMockAuthHarness(RECOVERY_USER);
    const { queryClient } = renderRecoveryRouter(harness, ['/reset-password']);

    await act(async () => {
      harness.emitAuthEvent(RECOVERY_USER, 'PASSWORD_RECOVERY');
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /set new password/i })).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/^new password/i), {
      target: { value: 'NewStrongPass99' }
    });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: 'NewStrongPass99' }
    });
    fireEvent.click(screen.getByRole('button', { name: /update password/i }));

    await waitFor(() => {
      expect(harness.adapter.updatePassword).toHaveBeenCalledWith('NewStrongPass99');
      expect(screen.getByRole('heading', { name: /password updated/i })).toBeInTheDocument();
    });

    // Confirmation screen remains visible before explicit user continuation
    expect(screen.queryByTestId('dashboard-view')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /continue to dashboard/i }));

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-view')).toBeInTheDocument();
    });
    queryClient.clear();
  });

  it('displays a clear, safe error when recovery link is expired, invalid, or lacks an active session', async () => {
    const harness = createMockAuthHarness(null);
    const { queryClient } = renderRecoveryRouter(harness, [
      '/reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&access_token=leaked-token'
    ]);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /reset link invalid or expired/i })).toBeInTheDocument();
    });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/invalid or has expired/i);
    expect(document.body.textContent).not.toContain('leaked-token');
    expect(screen.queryByLabelText(/^new password/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /request new reset link/i }));
    await waitFor(() => {
      expect(screen.getByTestId('forgot-password-view')).toBeInTheDocument();
    });

    queryClient.clear();
  });

  it('shows invalid/expired message when /reset-password is opened without any active session', async () => {
    const harness = createMockAuthHarness(null);
    const { queryClient } = renderRecoveryRouter(harness, ['/reset-password']);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /reset link invalid or expired/i })).toBeInTheDocument();
    });

    expect(screen.getByRole('alert')).toHaveTextContent(/invalid, expired/i);
    queryClient.clear();
  });

  it('preserves normal session restoration, sign-in, and sign-out behavior', async () => {
    const harness = createMockAuthHarness(RECOVERY_USER);
    const { queryClient } = renderRecoveryRouter(harness, ['/login']);

    // Existing authenticated session redirects /login -> /dashboard normally
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-view')).toBeInTheDocument();
    });

    // Sign out redirects protected routes back to /login
    await act(async () => {
      harness.emitAuthEvent(null, 'SIGNED_OUT');
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
    });

    // Normal sign-in event restores authenticated dashboard access
    await act(async () => {
      harness.emitAuthEvent(RECOVERY_USER, 'SIGNED_IN');
    });

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-view')).toBeInTheDocument();
    });

    queryClient.clear();
  });
});

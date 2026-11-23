import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthProvider } from '@/features/auth/context/AuthContext';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { AuthPort, AuthUser } from '@/application/ports/AuthPort';
import { defaultDatabaseManager } from '@/infrastructure/database/local/DatabaseManager';
import { defaultLegacyMigrator } from '@/infrastructure/database/local/LegacyDatabaseMigrator';
import { LaxmiLensDB } from '@/infrastructure/database/local/DexieDatabase';

const user1 = 'aa854190-e763-45d8-a840-ea90f668f561';
const user2 = 'e76bcf5d-fb6c-4427-bf18-785552905785';

const TestConsumer: React.FC = () => {
  const { user, isLoading, isAuthenticated, initError } = useAuth();

  if (isLoading) return <div data-testid="status">Loading...</div>;
  if (initError) return <div data-testid="status">Error: {initError}</div>;

  return (
    <div>
      <div data-testid="status">Ready</div>
      <div data-testid="auth-state">{isAuthenticated ? 'Authenticated' : 'Anonymous'}</div>
      <div data-testid="user-id">{user?.id || 'none'}</div>
    </div>
  );
};

describe('Correction 2 & 3: AuthContext Session Transition Serialization & Awaited Migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('awaits legacy migration before setting isLoading to false and exposing authenticated state', async () => {
    let migrationResolved = false;

    const mockAdapter: AuthPort = {
      getCurrentUser: vi.fn().mockResolvedValue({ id: user1, email: 'u1@example.com' }),
      signInWithEmail: vi.fn(),
      signUpWithEmail: vi.fn(),
      signInWithOAuth: vi.fn(),
      signOut: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      updatePassword: vi.fn(),
      onAuthStateChange: vi.fn().mockReturnValue(() => {})
    };

    const mockTargetDb = { name: `LaxmiLens_LocalDB_${user1}`, isOpen: () => true } as unknown as LaxmiLensDB;

    vi.spyOn(defaultDatabaseManager, 'openForUser').mockResolvedValue(mockTargetDb);
    vi.spyOn(defaultDatabaseManager, 'isUserActive').mockReturnValue(true);

    vi.spyOn(defaultLegacyMigrator, 'migrate').mockImplementation(async () => {
      // Simulate asynchronous migration delay
      await new Promise((r) => setTimeout(r, 50));
      migrationResolved = true;
      return {
        userId: user1,
        accountsMigrated: 1,
        transactionsMigrated: 0,
        categoriesMigrated: 0,
        profilesMigrated: 0,
        outboxEntriesMigrated: 0,
        skippedForeignRecords: 0,
        skippedAmbiguousRecords: 0,
        alreadyMigratedRecords: 0,
        isComplete: true,
        errors: []
      };
    });

    render(
      <AuthProvider authAdapter={mockAdapter}>
        <TestConsumer />
      </AuthProvider>
    );

    // Initial state must be Loading
    expect(screen.getByTestId('status')).toHaveTextContent('Loading...');
    expect(migrationResolved).toBe(false);

    // Wait for migration and ready state
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('Ready');
    });

    expect(migrationResolved).toBe(true);
    expect(screen.getByTestId('auth-state')).toHaveTextContent('Authenticated');
    expect(screen.getByTestId('user-id')).toHaveTextContent(user1);
  });

  it('prevents exposing authenticated application when database open or migration fails', async () => {
    const mockAdapter: AuthPort = {
      getCurrentUser: vi.fn().mockResolvedValue({ id: user1, email: 'u1@example.com' }),
      signInWithEmail: vi.fn(),
      signUpWithEmail: vi.fn(),
      signInWithOAuth: vi.fn(),
      signOut: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      updatePassword: vi.fn(),
      onAuthStateChange: vi.fn().mockReturnValue(() => {})
    };

    vi.spyOn(defaultDatabaseManager, 'openForUser').mockRejectedValue(
      new Error('IndexedDB QuotaExceededError: Storage quota reached')
    );

    render(
      <AuthProvider authAdapter={mockAdapter}>
        <TestConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('Error: IndexedDB QuotaExceededError');
    });

    // Does NOT expose authenticated application
    expect(screen.queryByTestId('user-id')).not.toBeInTheDocument();
  });

  it('serializes transitions: a newer user switch supersedes an in-flight older initialization', async () => {
    let authCallback: ((u: AuthUser | null) => void) | null = null;

    const mockAdapter: AuthPort = {
      getCurrentUser: vi.fn().mockResolvedValue({ id: user1, email: 'u1@example.com' }),
      signInWithEmail: vi.fn(),
      signUpWithEmail: vi.fn(),
      signInWithOAuth: vi.fn(),
      signOut: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      updatePassword: vi.fn(),
      onAuthStateChange: vi.fn().mockImplementation((cb) => {
        authCallback = cb;
        return () => {};
      })
    };

    const mockDb1 = { name: `LaxmiLens_LocalDB_${user1}`, isOpen: () => true } as unknown as LaxmiLensDB;
    const mockDb2 = { name: `LaxmiLens_LocalDB_${user2}`, isOpen: () => true } as unknown as LaxmiLensDB;

    vi.spyOn(defaultDatabaseManager, 'openForUser').mockImplementation(async (id: string) => {
      if (id === user1) {
        // Slow initialization for user1
        await new Promise((r) => setTimeout(r, 80));
        return mockDb1;
      }
      return mockDb2;
    });

    vi.spyOn(defaultLegacyMigrator, 'migrate').mockResolvedValue({
      userId: user2,
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

    render(
      <AuthProvider authAdapter={mockAdapter}>
        <TestConsumer />
      </AuthProvider>
    );

    expect(screen.getByTestId('status')).toHaveTextContent('Loading...');

    // Wait until User 1's initialization has commenced and is in-flight
    await waitFor(() => {
      expect(defaultDatabaseManager.openForUser).toHaveBeenCalledWith(user1);
    });

    // Before User 1 finishes, auth switches rapidly to User 2
    act(() => {
      if (authCallback) {
        authCallback({ id: user2, email: 'u2@example.com' });
      }
    });

    // Settle all promises
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('Ready');
      expect(screen.getByTestId('user-id')).toHaveTextContent(user2);
    });

    // User 1 must NEVER have overwritten User 2
    expect(screen.getByTestId('user-id')).toHaveTextContent(user2);
  });
});

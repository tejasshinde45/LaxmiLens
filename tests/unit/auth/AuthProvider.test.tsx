import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthProvider } from '@/features/auth/context/AuthContext';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { AuthPort, AuthUser } from '@/application/ports/AuthPort';
import { queryClient } from '@/lib/queryClient';

const createMockAdapter = (overrides: Partial<AuthPort> = {}): AuthPort => ({
  getCurrentUser: vi.fn().mockResolvedValue(null),
  signInWithEmail: vi.fn(),
  signUpWithEmail: vi.fn(),
  signInWithOAuth: vi.fn(),
  signOut: vi.fn().mockResolvedValue(undefined),
  resetPasswordForEmail: vi.fn(),
  updatePassword: vi.fn(),
  onAuthStateChange: vi.fn().mockReturnValue(() => {}),
  ...overrides
});

const ConsumerComponent: React.FC = () => {
  const { user, isLoading, isAuthenticated, signOut } = useAuth();

  if (isLoading) return <div>Loading consumer...</div>;

  return (
    <div>
      <div>Authenticated: {isAuthenticated ? 'YES' : 'NO'}</div>
      {user && <div>Email: {user.email}</div>}
      <button onClick={() => signOut()}>Sign Out Button</button>
    </div>
  );
};

describe('AuthProvider & useAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws error when useAuth is consumed outside AuthProvider', () => {
    // Suppress console.error from React boundary
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => render(<ConsumerComponent />)).toThrow(
      'useAuth must be used within an AuthProvider'
    );

    consoleSpy.mockRestore();
  });

  it('restores initial session and renders authenticated state', async () => {
    const mockUser: AuthUser = {
      id: 'usr-1',
      email: 'arjun@laxmilens.app',
      displayName: 'Arjun'
    };

    const mockAdapter = createMockAdapter({
      getCurrentUser: vi.fn().mockResolvedValue(mockUser)
    });

    render(
      <AuthProvider authAdapter={mockAdapter}>
        <ConsumerComponent />
      </AuthProvider>
    );

    expect(screen.getByText('Loading consumer...')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Authenticated: YES')).toBeInTheDocument();
      expect(screen.getByText('Email: arjun@laxmilens.app')).toBeInTheDocument();
    });
  });

  it('clears query cache on sign out', async () => {
    const mockUser: AuthUser = {
      id: 'usr-1',
      email: 'arjun@laxmilens.app'
    };

    const mockAdapter = createMockAdapter({
      getCurrentUser: vi.fn().mockResolvedValue(mockUser)
    });

    const clearSpy = vi.spyOn(queryClient, 'clear');

    render(
      <AuthProvider authAdapter={mockAdapter}>
        <ConsumerComponent />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Authenticated: YES')).toBeInTheDocument();
    });

    await act(async () => {
      screen.getByText('Sign Out Button').click();
    });

    await waitFor(() => {
      expect(screen.getByText('Authenticated: NO')).toBeInTheDocument();
      expect(clearSpy).toHaveBeenCalled();
    });
  });

  it('updates state reactively when onAuthStateChange fires', async () => {
    let authCallback: ((user: AuthUser | null) => void) | null = null;

    const mockAdapter = createMockAdapter({
      onAuthStateChange: vi.fn().mockImplementation((cb) => {
        authCallback = cb;
        return () => {};
      })
    });

    render(
      <AuthProvider authAdapter={mockAdapter}>
        <ConsumerComponent />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Authenticated: NO')).toBeInTheDocument();
    });

    // Simulate remote login event
    act(() => {
      if (authCallback) {
        authCallback({
          id: 'usr-2',
          email: 'priya@laxmilens.app',
          displayName: 'Priya'
        });
      }
    });

    await waitFor(() => {
      expect(screen.getByText('Authenticated: YES')).toBeInTheDocument();
      expect(screen.getByText('Email: priya@laxmilens.app')).toBeInTheDocument();
    });
  });
});

import React, { createContext, useEffect, useState, useCallback, useRef } from 'react';
import { AuthPort, AuthUser, SignUpParams } from '@/application/ports/AuthPort';
import { defaultAuthAdapter } from '@/infrastructure/auth/SupabaseAuthAdapter';
import { queryClient } from '@/lib/queryClient';

export interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (params: SignUpParams) => Promise<void>;
  signInWithGoogle: (redirectTo?: string) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string, redirectTo?: string) => Promise<void>;
  updatePassword: (newPassword: string) => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export interface AuthProviderProps {
  children: React.ReactNode;
  authAdapter?: AuthPort;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({
  children,
  authAdapter = defaultAuthAdapter
}) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const previousUserIdRef = useRef<string | null>(null);

  // Sync state and handle cache invalidation on user change
  const handleUserChange = useCallback((nextUser: AuthUser | null) => {
    const nextId = nextUser?.id ?? null;
    const previousId = previousUserIdRef.current;

    // Clear TanStack in-memory query cache when switching users or signing out
    if (previousId !== null && previousId !== nextId) {
      queryClient.clear();
    }

    previousUserIdRef.current = nextId;
    setUser(nextUser);
    setIsLoading(false);
  }, []);

  // Initial session restoration & state listener
  useEffect(() => {
    let isMounted = true;

    // 1. Restore existing session on startup
    authAdapter
      .getCurrentUser()
      .then((initialUser) => {
        if (isMounted) {
          handleUserChange(initialUser);
        }
      })
      .catch(() => {
        if (isMounted) {
          handleUserChange(null);
        }
      });

    // 2. Subscribe to auth state changes (e.g. token refresh, sign-in, sign-out)
    const unsubscribe = authAdapter.onAuthStateChange((updatedUser) => {
      if (isMounted) {
        handleUserChange(updatedUser);
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [authAdapter, handleUserChange]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const authenticatedUser = await authAdapter.signInWithEmail(email, password);
      handleUserChange(authenticatedUser);
    },
    [authAdapter, handleUserChange]
  );

  const signUp = useCallback(
    async (params: SignUpParams) => {
      const registeredUser = await authAdapter.signUpWithEmail(params);
      handleUserChange(registeredUser);
    },
    [authAdapter, handleUserChange]
  );

  const signInWithGoogle = useCallback(
    async (redirectTo?: string) => {
      await authAdapter.signInWithOAuth('google', redirectTo);
    },
    [authAdapter]
  );

  const signOut = useCallback(async () => {
    try {
      await authAdapter.signOut();
    } finally {
      handleUserChange(null);
    }
  }, [authAdapter, handleUserChange]);

  const resetPassword = useCallback(
    async (email: string, redirectTo?: string) => {
      await authAdapter.resetPasswordForEmail(email, redirectTo);
    },
    [authAdapter]
  );

  const updatePassword = useCallback(
    async (newPassword: string) => {
      await authAdapter.updatePassword(newPassword);
    },
    [authAdapter]
  );

  const value: AuthContextType = {
    user,
    isLoading,
    isAuthenticated: !!user,
    signIn,
    signUp,
    signInWithGoogle,
    signOut,
    resetPassword,
    updatePassword
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

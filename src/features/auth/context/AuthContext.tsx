import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { AuthPort, AuthUser, SignUpParams } from '@/application/ports/AuthPort';
import { defaultAuthAdapter } from '@/infrastructure/auth/SupabaseAuthAdapter';
import { defaultDatabaseManager } from '@/infrastructure/database/local/DatabaseManager';
import { defaultLegacyMigrator } from '@/infrastructure/database/local/LegacyDatabaseMigrator';
import { isValidUuid } from '@/domain/value-objects/Identifiers';
import { queryClient } from '@/lib/queryClient';
import {
  resetNotificationEvaluationState,
  triggerAlertEvaluationSafely
} from '@/features/notifications/services/financialAlertEvaluator';

export interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  initError?: string | null;
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
  const [initError, setInitError] = useState<string | null>(null);
  const contextQueryClient = useContext(QueryClientContext);
  const activeQueryClient = contextQueryClient ?? queryClient;
  const previousUserIdRef = useRef<string | null>(null);
  const attemptedUserIdRef = useRef<string | null>(null);
  const transitionGenerationRef = useRef<number>(0);

  // Sync state, handle cache invalidation, and serialize session transitions
  const handleUserChange = useCallback(async (nextUser: AuthUser | null) => {
    const currentTransition = ++transitionGenerationRef.current;
    const nextId = nextUser?.id ?? null;
    const previousId = previousUserIdRef.current;
    const lastAttemptedId = attemptedUserIdRef.current;

    setIsLoading(true);

    // Cancel in-flight queries and clear TanStack in-memory cache + alert session marker on user switch or sign-out
    if (
      (previousId !== null && previousId !== nextId) ||
      (lastAttemptedId !== null && lastAttemptedId !== nextId)
    ) {
      void activeQueryClient.cancelQueries();
      activeQueryClient.clear();
      resetNotificationEvaluationState();
    }
    attemptedUserIdRef.current = nextId;

    if (nextUser && nextUser.id) {
      if (!isValidUuid(nextUser.id)) {
        if (transitionGenerationRef.current !== currentTransition) return;
        previousUserIdRef.current = nextId;
        setUser(nextUser);
        setInitError(null);
        setIsLoading(false);
        return;
      }

      // Fast-path: if exact same user is already active and verified, avoid duplicate re-init
      if (nextId && nextId === previousId && defaultDatabaseManager.isUserActive(nextId)) {
        if (transitionGenerationRef.current !== currentTransition) return;
        setUser(nextUser);
        setInitError(null);
        setIsLoading(false);
        defaultDatabaseManager.notifySessionReady?.(nextUser.id);
        return;
      }

      let databaseOpened = false;
      try {
        const targetDb = await defaultDatabaseManager.openForUser(nextUser.id);
        databaseOpened = true;
        if (transitionGenerationRef.current !== currentTransition) return;

        // Await legacy data migration before exposing application interface
        const migrationSummary = await defaultLegacyMigrator.migrate(nextUser.id, targetDb);
        if (transitionGenerationRef.current !== currentTransition) return;

        if (!migrationSummary.isComplete && migrationSummary.errors.length > 0) {
          throw new Error(`Migration incomplete: ${migrationSummary.errors.join('; ')}`);
        }

        previousUserIdRef.current = nextId;
        setUser(nextUser);
        setInitError(null);
        setIsLoading(false);
        defaultDatabaseManager.notifySessionReady?.(nextUser.id);
      } catch (err) {
        if (databaseOpened) {
          await defaultDatabaseManager.closeCurrentDatabase?.().catch(() => undefined);
        }
        if (transitionGenerationRef.current !== currentTransition) return;
        console.error('Failed to open database or complete legacy migration for user session:', err);
        // Do NOT expose normal authenticated application on DB/migration failure
        previousUserIdRef.current = null;
        void activeQueryClient.cancelQueries();
        activeQueryClient.clear();
        setUser(null);
        setInitError(err instanceof Error ? err.message : String(err));
        setIsLoading(false);
      }
    } else {
      try {
        await defaultDatabaseManager.closeCurrentDatabase();
      } catch (err) {
        console.error('Failed to close database on signout:', err);
      }

      if (transitionGenerationRef.current !== currentTransition) return;
      previousUserIdRef.current = null;
      setUser(null);
      setInitError(null);
      setIsLoading(false);
    }
  }, [activeQueryClient]);

  // Register centralized post-sync alert evaluation on the active DatabaseManager
  useEffect(() => {
    const unsubscribeSyncCompletion = defaultDatabaseManager.subscribeSyncCompletion?.(
      (syncedUserId, result) => {
        if (
          result.failedCount === 0 &&
          !result.authPaused &&
          result.syncedCount + result.pulledCount > 0
        ) {
          triggerAlertEvaluationSafely(syncedUserId, activeQueryClient);
        }
      }
    );

    return () => {
      unsubscribeSyncCompletion?.();
    };
  }, [activeQueryClient]);

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
    const unsubscribe = authAdapter.onAuthStateChange((updatedUser, event) => {
      if (isMounted) {
        handleUserChange(updatedUser);
        if (
          updatedUser?.id &&
          (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN' || event === 'USER_UPDATED')
        ) {
          defaultDatabaseManager.notifyAuthRefreshed?.(updatedUser.id);
        }
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
    initError,
    signIn,
    signUp,
    signInWithGoogle,
    signOut,
    resetPassword,
    updatePassword
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

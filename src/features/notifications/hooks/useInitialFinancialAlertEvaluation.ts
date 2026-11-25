import { useEffect, useRef } from 'react';
import { queryClient as globalQueryClient } from '@/lib/queryClient';
import { useAuth } from '@/features/auth/hooks/useAuth';
import {
  resetNotificationEvaluationState,
  runInitialSessionEvaluation
} from '../services/financialAlertEvaluator';

export function useInitialFinancialAlertEvaluation(client = globalQueryClient): void {
  let user: { id: string } | null = null;
  let isAuthenticated = false;
  let isLoading = false;
  try {
    const auth = useAuth();
    user = auth.user;
    isAuthenticated = auth.isAuthenticated;
    isLoading = auth.isLoading;
  } catch {
    user = null;
    isAuthenticated = false;
    isLoading = false;
  }

  const activeSessionUserRef = useRef<string | null>(null);

  useEffect(() => {
    if (isLoading) {
      return;
    }

    if (!isAuthenticated || !user?.id) {
      if (activeSessionUserRef.current) {
        resetNotificationEvaluationState(activeSessionUserRef.current);
        activeSessionUserRef.current = null;
      }
      return;
    }

    if (activeSessionUserRef.current && activeSessionUserRef.current !== user.id) {
      resetNotificationEvaluationState(activeSessionUserRef.current);
    }

    activeSessionUserRef.current = user.id;
    void runInitialSessionEvaluation(user.id, client).catch(() => null);
  }, [isLoading, isAuthenticated, user?.id, client]);
}

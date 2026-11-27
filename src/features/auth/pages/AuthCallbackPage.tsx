import React, { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AuthLoadingScreen } from '../components/AuthLoadingScreen';
import { useAuth } from '../hooks/useAuth';
import { getSafeRedirectUrl } from '../utils/redirects';
import { getRecoveryUrlError, hasRecoveryRedirectHint } from '../utils/recoveryUrl';
import { supabase } from '@/infrastructure/database/cloud/supabaseClient';

export const AuthCallbackPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isPasswordRecovery } = useAuth();
  const isPasswordRecoveryRef = useRef(Boolean(isPasswordRecovery));
  isPasswordRecoveryRef.current = Boolean(isPasswordRecovery);

  useEffect(() => {
    let isSubscribed = true;
    let authSubscription: { unsubscribe: () => void } | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let recoveryDetected =
      isPasswordRecoveryRef.current ||
      hasRecoveryRedirectHint(window.location.search, window.location.hash);

    const handleCallback = async () => {
      // 1. Check for provider error parameters in URL query or hash safely
      const recoveryError = getRecoveryUrlError(window.location.search, window.location.hash);
      const errorParam = searchParams.get('error') || searchParams.get('error_code');
      const errorDescription = searchParams.get('error_description');

      if (recoveryError && searchParams.get('type') === 'recovery') {
        toast.error(recoveryError);
        navigate('/reset-password', { replace: true });
        return;
      }

      if (errorParam || recoveryError) {
        const errorMsg =
          recoveryError ||
          (errorDescription
            ? decodeURIComponent(errorDescription.replace(/\+/g, ' '))
            : 'Authentication was cancelled or failed.');
        toast.error(errorMsg);
        navigate('/login', { replace: true });
        return;
      }

      // 2. Validate redirect destination
      const nextParam = searchParams.get('next');
      const safeRedirect = getSafeRedirectUrl(nextParam, '/dashboard');

      try {
        // Subscribe early so PKCE code exchange emitting PASSWORD_RECOVERY is captured
        const {
          data: { subscription }
        } = supabase.auth.onAuthStateChange((event, session) => {
          if (!isSubscribed) return;

          if (event === 'PASSWORD_RECOVERY') {
            recoveryDetected = true;
            subscription.unsubscribe();
            navigate('/reset-password', { replace: true });
            return;
          }

          if (event === 'SIGNED_IN' && session) {
            subscription.unsubscribe();
            if (recoveryDetected || isPasswordRecoveryRef.current) {
              navigate('/reset-password', { replace: true });
              return;
            }
            toast.success('Successfully signed in with Google');
            navigate(safeRedirect, { replace: true });
          }
        });
        authSubscription = subscription;

        // 3. If authorization code is present in URL (PKCE flow), exchange it for a session
        const code = searchParams.get('code');
        if (code) {
          try {
            await supabase.auth.exchangeCodeForSession(code);
          } catch {
            // If already exchanged by automatic client detection, getSession will retrieve it
          }
        }

        // 4. Retrieve session
        const { data, error } = await supabase.auth.getSession();

        if (error) {
          throw error;
        }

        if (data.session) {
          if (isSubscribed) {
            subscription.unsubscribe();
            if (recoveryDetected || isPasswordRecoveryRef.current) {
              navigate('/reset-password', { replace: true });
              return;
            }
            toast.success('Successfully signed in with Google');
            navigate(safeRedirect, { replace: true });
          }
          return;
        }

        // 5. Timeout fallback in case auth state never resolves (e.g., stale or invalid callback)
        timeoutId = setTimeout(() => {
          if (isSubscribed) {
            if (authSubscription) {
              authSubscription.unsubscribe();
            }
            toast.error('Sign-in session timed out. Please try again.');
            navigate('/login', { replace: true });
          }
        }, 8000);
      } catch (err) {
        if (!isSubscribed) return;
        const msg = err instanceof Error ? err.message : 'Authentication exchange failed.';
        toast.error(msg);
        navigate('/login', { replace: true });
      }
    };

    handleCallback();

    return () => {
      isSubscribed = false;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (authSubscription) {
        authSubscription.unsubscribe();
      }
    };
  }, [navigate, searchParams]);

  return <AuthLoadingScreen message="Completing secure sign-in..." />;
};

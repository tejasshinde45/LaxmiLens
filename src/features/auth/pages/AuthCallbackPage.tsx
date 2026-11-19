import React, { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AuthLoadingScreen } from '../components/AuthLoadingScreen';
import { getSafeRedirectUrl } from '../utils/redirects';
import { supabase } from '@/infrastructure/database/cloud/supabaseClient';

export const AuthCallbackPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    let isSubscribed = true;
    let authSubscription: { unsubscribe: () => void } | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const handleCallback = async () => {
      // 1. Check for provider error parameters in URL query
      const errorParam = searchParams.get('error') || searchParams.get('error_code');
      const errorDescription = searchParams.get('error_description');

      if (errorParam) {
        const errorMsg = errorDescription
          ? decodeURIComponent(errorDescription.replace(/\+/g, ' '))
          : 'Authentication was cancelled or failed.';
        toast.error(errorMsg);
        navigate('/login', { replace: true });
        return;
      }

      // 2. Validate redirect destination
      const nextParam = searchParams.get('next');
      const safeRedirect = getSafeRedirectUrl(nextParam, '/dashboard');

      try {
        // 3. Retrieve or exchange session (Supabase handles PKCE/hash token extraction automatically)
        const { data, error } = await supabase.auth.getSession();

        if (error) {
          throw error;
        }

        if (data.session) {
          if (isSubscribed) {
            toast.success('Successfully signed in with Google');
            navigate(safeRedirect, { replace: true });
          }
          return;
        }

        // 4. In case the code exchange is in flight, listen for the SIGNED_IN event
        const {
          data: { subscription }
        } = supabase.auth.onAuthStateChange((event, session) => {
          if (!isSubscribed) return;

          if (event === 'SIGNED_IN' && session) {
            subscription.unsubscribe();
            toast.success('Successfully signed in with Google');
            navigate(safeRedirect, { replace: true });
          }
        });
        authSubscription = subscription;

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

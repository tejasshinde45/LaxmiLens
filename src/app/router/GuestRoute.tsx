import React from 'react';
import { Navigate, Outlet, useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { AuthLoadingScreen } from '@/features/auth/components/AuthLoadingScreen';
import { getSafeRedirectUrl } from '@/features/auth/utils/redirects';

export const GuestRoute: React.FC = () => {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  if (isLoading) {
    return <AuthLoadingScreen message="Checking session..." />;
  }

  if (isAuthenticated) {
    // Determine destination from navigation state or URL search params
    const stateTarget = (location.state as { from?: { pathname?: string } })?.from?.pathname;
    const queryTarget = searchParams.get('redirect') || searchParams.get('next');
    const safeTarget = getSafeRedirectUrl(stateTarget || queryTarget, '/dashboard');

    return <Navigate to={safeTarget} replace />;
  }

  return <Outlet />;
};

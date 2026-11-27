import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { AuthLoadingScreen } from '@/features/auth/components/AuthLoadingScreen';

export const ProtectedRoute: React.FC = () => {
  const { isAuthenticated, isLoading, isPasswordRecovery } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <AuthLoadingScreen message="Restoring session..." />;
  }

  if (isPasswordRecovery) {
    return <Navigate to="/reset-password" replace />;
  }

  if (!isAuthenticated) {
    // Preserve intended destination in router state
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <Outlet />;
};

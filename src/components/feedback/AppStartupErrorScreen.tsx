import React, { useEffect } from 'react';
import { getSafeEnvErrorSummary } from '@/config/env';
import { logBoundaryDiagnostic } from '@/utils/errorDiagnostics';
import { ErrorFallback } from './ErrorFallback';

export interface AppStartupErrorScreenProps {
  error: unknown;
  onRetry?: () => void;
}

export const AppStartupErrorScreen: React.FC<AppStartupErrorScreenProps> = ({
  error,
  onRetry
}) => {
  const summary = getSafeEnvErrorSummary(error);

  useEffect(() => {
    logBoundaryDiagnostic(
      error,
      { boundaryName: 'StartupConfigurationGate' },
      'startup_config'
    );
  }, [error]);

  const handleRetry = () => {
    if (onRetry) {
      onRetry();
      return;
    }
    if (typeof window !== 'undefined' && window.location) {
      window.location.reload();
    }
  };

  return (
    <ErrorFallback
      title={summary.title}
      description={summary.message}
      referenceCode={summary.code}
      fullScreen
      onRetry={handleRetry}
      retryLabel="Retry Startup"
      showReload={Boolean(onRetry)}
      onReload={onRetry ? () => window.location?.reload() : undefined}
    />
  );
};

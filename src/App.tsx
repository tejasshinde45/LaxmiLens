import React from 'react';
import { RouterProvider } from 'react-router-dom';
import { EnvValidationResult, safeParseEnv } from './config/env';
import { AppStartupErrorScreen } from './components/feedback/AppStartupErrorScreen';
import { ErrorBoundary } from './components/feedback/ErrorBoundary';
import { AppProviders } from './app/providers/AppProviders';
import { router } from './app/router/routes';

export interface AppProps {
  envValidation?: EnvValidationResult;
  onRetryStartup?: () => void;
}

export const App: React.FC<AppProps> = ({ envValidation, onRetryStartup }) => {
  const startupEnv = envValidation ?? safeParseEnv();

  if (!startupEnv.ok) {
    return (
      <AppStartupErrorScreen
        error={startupEnv.error}
        onRetry={onRetryStartup}
      />
    );
  }

  return (
    <ErrorBoundary boundaryName="RootErrorBoundary">
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>
    </ErrorBoundary>
  );
};

export default App;

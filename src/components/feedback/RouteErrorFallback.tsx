import React, { useEffect } from 'react';
import {
  isRouteErrorResponse,
  useLocation,
  useNavigate,
  useRouteError
} from 'react-router-dom';
import { logBoundaryDiagnostic } from '@/utils/errorDiagnostics';
import { ErrorFallback } from './ErrorFallback';

export interface RouteErrorFallbackProps {
  embedded?: boolean;
  homePath?: string;
  homeLabel?: string;
  onReload?: () => void;
}

interface SafeRouteErrorCopy {
  title: string;
  description: string;
  referenceCode: string;
  statusCode?: number;
}

function getSafeRouteErrorCopy(error: unknown): SafeRouteErrorCopy {
  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      return {
        title: 'Page Not Found',
        description:
          'We could not find the view you requested. It may have moved or the link may be out of date.',
        referenceCode: 'ROUTE_NOT_FOUND_404',
        statusCode: 404
      };
    }

    if (error.status === 401 || error.status === 403) {
      return {
        title: 'Access Restricted',
        description:
          'This page could not be opened with your current session state. You can navigate back safely or retry.',
        referenceCode: `ROUTE_STATUS_${error.status}`,
        statusCode: error.status
      };
    }

    return {
      title: 'Unable to Load Page',
      description:
        'A route loading issue interrupted this page. Your local financial data and authentication state remain intact.',
      referenceCode: `ROUTE_STATUS_${error.status}`,
      statusCode: error.status
    };
  }

  return {
    title: 'Unable to Display Page',
    description:
      'An unexpected error occurred while displaying this route. You can retry this view or return safely without resetting your data.',
    referenceCode: 'ROUTE_RENDER_ERROR'
  };
}

export const RouteErrorFallback: React.FC<RouteErrorFallbackProps> = ({
  embedded = false,
  homePath = '/dashboard',
  homeLabel = 'Back to Dashboard',
  onReload
}) => {
  const error = useRouteError();
  const navigate = useNavigate();
  const location = useLocation();

  const copy = getSafeRouteErrorCopy(error);

  useEffect(() => {
    logBoundaryDiagnostic(
      error,
      {
        boundaryName: 'RouteErrorFallback',
        pathname: location.pathname,
        statusCode: copy.statusCode
      },
      'route_error'
    );
  }, [error, location.pathname, copy.statusCode]);

  const handleRetry = () => {
    // Replace current entry with a fresh state so React Router issues a new location.key,
    // resetting RenderErrorBoundary errors and re-running errored loaders cleanly.
    navigate(`${location.pathname}${location.search}${location.hash}`, {
      replace: true,
      state: { routeRetryAt: Date.now() }
    });
  };

  const handleNavigateHome = () => {
    navigate(homePath, { replace: true });
  };

  const handleReload = () => {
    if (onReload) {
      onReload();
      return;
    }
    if (typeof window !== 'undefined' && window.location) {
      window.location.reload();
    }
  };

  return (
    <ErrorFallback
      title={copy.title}
      description={copy.description}
      referenceCode={copy.referenceCode}
      fullScreen={!embedded}
      onRetry={handleRetry}
      retryLabel="Try Again"
      onNavigateHome={handleNavigateHome}
      homeLabel={homeLabel}
      showReload
      onReload={handleReload}
    />
  );
};

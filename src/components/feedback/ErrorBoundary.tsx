import { Component, ErrorInfo, ReactNode } from 'react';
import { logBoundaryDiagnostic, SafeErrorDiagnostic } from '@/utils/errorDiagnostics';
import { ErrorFallback } from './ErrorFallback';

export interface ErrorBoundaryFallbackRenderProps {
  resetErrorBoundary: () => void;
  reloadApp: () => void;
}

export interface ErrorBoundaryProps {
  children: ReactNode;
  boundaryName?: string;
  fallback?: ReactNode | ((props: ErrorBoundaryFallbackRenderProps) => ReactNode);
  resetKeys?: readonly unknown[];
  onRetry?: () => void;
  onReload?: () => void;
  onError?: (diagnostic: SafeErrorDiagnostic) => void;
  fullScreen?: boolean;
  referenceCode?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

function areResetKeysEqual(
  prevKeys?: readonly unknown[],
  nextKeys?: readonly unknown[]
): boolean {
  if (prevKeys === nextKeys) return true;
  if (!prevKeys || !nextKeys || prevKeys.length !== nextKeys.length) return false;
  for (let i = 0; i < prevKeys.length; i += 1) {
    if (!Object.is(prevKeys[i], nextKeys[i])) {
      return false;
    }
  }
  return true;
}

/**
 * Reusable React error boundary enforcing Obsidian Gold fallback presentation
 * and zero exposure of stack traces, credentials, or IndexedDB financial data.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public override state: ErrorBoundaryState = {
    hasError: false
  };

  public static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  public override componentDidCatch(error: Error, _errorInfo: ErrorInfo): void {
    const diagnostic = logBoundaryDiagnostic(
      error,
      { boundaryName: this.props.boundaryName ?? 'RootErrorBoundary' },
      'runtime_boundary'
    );
    this.props.onError?.(diagnostic);
  }

  public override componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (
      this.state.hasError &&
      this.props.resetKeys &&
      !areResetKeysEqual(prevProps.resetKeys, this.props.resetKeys)
    ) {
      this.setState({ hasError: false });
    }
  }

  private handleReset = (): void => {
    this.setState({ hasError: false });
    this.props.onRetry?.();
  };

  private handleReload = (): void => {
    if (this.props.onReload) {
      this.props.onReload();
      return;
    }
    if (typeof window !== 'undefined' && window.location) {
      window.location.reload();
    }
  };

  public override render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const { fallback, fullScreen = true, referenceCode = 'UI_RENDER_INTERRUPTED' } = this.props;

    if (typeof fallback === 'function') {
      return fallback({
        resetErrorBoundary: this.handleReset,
        reloadApp: this.handleReload
      });
    }

    if (fallback !== undefined) {
      return fallback;
    }

    return (
      <ErrorFallback
        title="Something went wrong"
        description="An unexpected rendering issue interrupted this screen. You can retry loading the view safely without losing any stored data."
        referenceCode={referenceCode}
        fullScreen={fullScreen}
        onRetry={this.handleReset}
        onReload={this.handleReload}
      />
    );
  }
}

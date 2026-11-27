import React from 'react';
import { AlertTriangle, ArrowLeft, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export interface ErrorFallbackProps {
  title: string;
  description: string;
  referenceCode?: string;
  fullScreen?: boolean;
  onRetry?: () => void;
  retryLabel?: string;
  onNavigateHome?: () => void;
  homeLabel?: string;
  onReload?: () => void;
  reloadLabel?: string;
  showReload?: boolean;
}

export const ErrorFallback: React.FC<ErrorFallbackProps> = ({
  title,
  description,
  referenceCode,
  fullScreen = true,
  onRetry,
  retryLabel = 'Try Again',
  onNavigateHome,
  homeLabel = 'Back to Dashboard',
  onReload,
  reloadLabel = 'Reload App',
  showReload = onReload !== undefined
}) => {
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
    <div
      role="alert"
      aria-live="assertive"
      className={
        fullScreen
          ? 'min-h-screen w-full flex flex-col items-center justify-center bg-[#101010] text-[#F5F1E8] px-4 py-8 relative overflow-hidden'
          : 'w-full flex flex-col items-center justify-center py-10 sm:py-16 px-4'
      }
    >
      {fullScreen && (
        <div
          aria-hidden="true"
          className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-[#D6AD60]/5 rounded-full blur-3xl pointer-events-none"
        />
      )}

      <div className="w-full max-w-lg relative z-10 space-y-6">
        {fullScreen && (
          <div className="flex flex-col items-center text-center space-y-2">
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-gradient-to-br from-[#D6AD60] to-[#B88E46] text-sm font-bold text-[#101010] shadow-md shadow-[#D6AD60]/20 font-display">
                LL
              </div>
              <span className="text-xl font-bold tracking-tight text-[#F5F1E8] font-display">
                LaxmiLens
              </span>
            </div>
            <p className="text-xs text-[#858078] tracking-wide font-medium">
              See Your Money Clearly
            </p>
          </div>
        )}

        <div className="rounded-xl border border-[#303030] bg-[#1B1B1B] p-6 sm:p-8 shadow-xl shadow-black/50 space-y-6">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#D6AD60]/30 bg-[#D6AD60]/10 text-[#D6AD60]">
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="space-y-1.5 min-w-0">
              <h1 className="text-lg font-semibold tracking-tight text-[#F5F1E8] font-display">
                {title}
              </h1>
              <p className="text-sm text-[#B9B4AA] leading-relaxed">
                {description}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-lg border border-[#303030] bg-[#242424] px-3.5 py-3 text-xs text-[#B9B4AA]">
            <ShieldCheck className="h-4 w-4 shrink-0 text-[#72B895] mt-0.5" aria-hidden="true" />
            <div className="space-y-1">
              <p className="text-[#F5F1E8] font-medium">
                Local Data Preserved
              </p>
              <p className="leading-relaxed">
                Your local financial records, sign-in session, and preferences were not cleared or modified.
              </p>
            </div>
          </div>

          {referenceCode && (
            <div className="flex items-center justify-between border-t border-[#303030] pt-4 text-xs text-[#858078]">
              <span>Reference Code</span>
              <code className="rounded bg-[#242424] px-2 py-0.5 font-mono text-[#B9B4AA] border border-[#303030]">
                {referenceCode}
              </code>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-1">
            {onRetry && (
              <Button
                type="button"
                variant="primary"
                size="md"
                onClick={onRetry}
                leftIcon={<RotateCcw className="h-4 w-4" aria-hidden="true" />}
              >
                {retryLabel}
              </Button>
            )}

            {onNavigateHome && (
              <Button
                type="button"
                variant="outline"
                size="md"
                onClick={onNavigateHome}
                leftIcon={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}
              >
                {homeLabel}
              </Button>
            )}

            {showReload && (
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={handleReload}
                leftIcon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
              >
                {reloadLabel}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

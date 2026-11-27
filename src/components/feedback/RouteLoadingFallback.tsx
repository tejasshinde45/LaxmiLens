import React from 'react';
import { Skeleton } from '@/components/ui/Skeleton';

export interface RouteLoadingFallbackProps {
  fullScreen?: boolean;
  label?: string;
}

/**
 * Branded Obsidian Gold loading fallback used for React.lazy route Suspense boundaries.
 * Embedded mode preserves AppLayout chrome (Sidebar, Header, BottomNavigation) without layout flash.
 */
export const RouteLoadingFallback: React.FC<RouteLoadingFallbackProps> = ({
  fullScreen = false,
  label = 'Loading view...'
}) => {
  if (fullScreen) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label={label}
        className="min-h-screen w-full flex flex-col items-center justify-center bg-[#101010] text-[#F5F1E8] px-4"
      >
        <div className="flex flex-col items-center space-y-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-[12px] bg-gradient-to-br from-[#D6AD60] to-[#B88E46] text-base font-bold text-[#101010] shadow-lg shadow-[#D6AD60]/20 font-display">
            LL
          </div>
          <div className="h-7 w-7 animate-spin rounded-full border-2 border-[#303030] border-t-[#D6AD60]" />
          <p className="text-xs font-medium tracking-wide text-[#858078] uppercase">
            {label}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className="space-y-6 py-2"
    >
      <span className="sr-only">{label}</span>

      <div className="space-y-2 pb-4 border-b border-[#303030]/60">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>

      <Skeleton className="h-64 w-full" />
    </div>
  );
};

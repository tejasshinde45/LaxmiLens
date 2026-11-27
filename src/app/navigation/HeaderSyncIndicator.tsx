import React, { useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  HardDrive,
  RefreshCw,
  WifiOff,
  X
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useAutoSyncState } from '@/hooks/useAutoSyncState';
import { defaultDatabaseManager } from '@/infrastructure/database/local/DatabaseManager';
import { AutoSyncStatus } from '@/infrastructure/sync/AutoSyncScheduler';
import {
  formatLastSyncedTime,
  formatSanitizedSyncFailure,
  getSyncStatusVisualMeta
} from '@/features/sync/utils/syncStatusPresentation';
import { cn } from '@/utils/cn';

function renderStatusIcon(status: AutoSyncStatus, className: string): React.ReactNode {
  switch (status) {
    case 'synchronizing':
      return (
        <RefreshCw
          className={cn(className, 'animate-spin motion-reduce:animate-none')}
          aria-hidden="true"
        />
      );
    case 'successfully_synchronized':
      return <CheckCircle2 className={className} aria-hidden="true" />;
    case 'waiting_for_internet':
      return <WifiOff className={className} aria-hidden="true" />;
    case 'synchronization_failed':
      return <AlertTriangle className={className} aria-hidden="true" />;
    case 'saved_locally':
    default:
      return <HardDrive className={className} aria-hidden="true" />;
  }
}

export const HeaderSyncIndicator: React.FC = () => {
  const syncState = useAutoSyncState();
  const navigate = useNavigate();

  const [isOpen, setIsOpen] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const visual = getSyncStatusVisualMeta(syncState.status);
  const formattedLastSynced = formatLastSyncedTime(syncState.lastSyncedAt);
  const failureInfo = formatSanitizedSyncFailure(syncState);

  const showPendingCount =
    syncState.pendingCount > 0 && syncState.status !== 'successfully_synchronized';

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleRetrySync = async () => {
    if (isRetrying || syncState.isSyncing) {
      return;
    }
    setIsRetrying(true);
    try {
      await defaultDatabaseManager.retryFailedSync();
    } catch {
      // Scheduler already transitions state safely on coordinator errors.
    } finally {
      setIsRetrying(false);
    }
  };

  const handleReauthenticate = () => {
    setIsOpen(false);
    navigate('/login');
  };

  const buttonAriaLabel = [
    `Sync status: ${visual.label}`,
    showPendingCount ? `${syncState.pendingCount} pending locally` : null,
    formattedLastSynced ? `Last synchronized ${formattedLastSynced}` : null,
    'Press to view details'
  ]
    .filter(Boolean)
    .join('. ');

  return (
    <div ref={containerRef} className="relative flex items-center">
      {/* Accessible status announcement region for state transitions */}
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {`Cloud status: ${visual.label}${showPendingCount ? ` (${syncState.pendingCount} pending)` : ''}${formattedLastSynced ? `. Last synchronized ${formattedLastSynced}` : ''}`}
      </span>

      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isOpen ? panelId : undefined}
        aria-label={buttonAriaLabel}
        title={buttonAriaLabel}
        data-testid="header-sync-indicator"
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D6AD60] focus-visible:ring-offset-2 focus-visible:ring-offset-[#101010]',
          'hover:border-[#D6AD60]/60',
          visual.borderClass,
          visual.bgClass,
          visual.textClass
        )}
      >
        {renderStatusIcon(syncState.status, cn('h-3 w-3 shrink-0', visual.iconColorClass))}
        <span className="max-w-[145px] sm:max-w-none truncate">{visual.label}</span>
        {showPendingCount && (
          <span
            data-testid="header-sync-pending-count"
            className="rounded-full bg-[#D6AD60]/15 px-1.5 py-0 text-[10px] font-semibold font-tabular text-[#D6AD60]"
          >
            {syncState.pendingCount}
          </span>
        )}
        {formattedLastSynced && (
          <span
            data-testid="header-sync-last-time"
            className="hidden lg:inline text-[10px] text-[#858078] font-tabular"
          >
            · {formattedLastSynced}
          </span>
        )}
        <ChevronDown
          className={cn(
            'h-3 w-3 shrink-0 text-[#858078] transition-transform',
            isOpen && 'rotate-180 text-[#D6AD60]'
          )}
          aria-hidden="true"
        />
      </button>

      {isOpen && (
        <div
          id={panelId}
          role="dialog"
          aria-modal="false"
          aria-label="Synchronization status details"
          data-testid="header-sync-popover"
          className="absolute right-0 top-full mt-2 z-50 w-72 sm:w-80 rounded-[12px] border border-[#303030] bg-[#1B1B1B] p-4 text-xs text-[#F5F1E8] shadow-xl shadow-black/60"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={cn('h-2 w-2 rounded-full shrink-0', visual.dotColorClass)}
                aria-hidden="true"
              />
              <span className="text-xs font-semibold text-[#F5F1E8] truncate">
                {visual.label}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                triggerRef.current?.focus();
              }}
              aria-label="Close synchronization details"
              className="rounded-[6px] p-1 text-[#858078] hover:bg-[#242424] hover:text-[#F5F1E8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D6AD60] cursor-pointer"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>

          <div className="mt-3 space-y-2.5 text-[11px]">
            <div className="flex items-center justify-between text-[#B9B4AA]">
              <span>Last synchronized</span>
              <span className="font-medium text-[#F5F1E8] font-tabular">
                {formattedLastSynced ?? 'Not yet synchronized'}
              </span>
            </div>

            {showPendingCount && (
              <div className="flex items-center justify-between text-[#B9B4AA]">
                <span>Pending local updates</span>
                <span className="font-semibold text-[#D6AD60] font-tabular">
                  {syncState.pendingCount}
                </span>
              </div>
            )}

            <div className="rounded-[8px] border border-[#303030] bg-[#141414] px-2.5 py-2 text-[#B9B4AA] leading-relaxed">
              Your financial entries are saved locally on this device and synchronize automatically
              in the background when connected.
            </div>

            {failureInfo && (
              <div
                role="alert"
                data-testid="header-sync-failure-detail"
                className={cn(
                  'rounded-[8px] border px-2.5 py-2.5 space-y-2',
                  failureInfo.kind === 'offline'
                    ? 'border-[#E4B66D]/30 bg-[#E4B66D]/10 text-[#E4B66D]'
                    : 'border-[#D9827C]/35 bg-[#D9827C]/10 text-[#D9827C]'
                )}
              >
                <p className="font-medium">{failureInfo.summary}</p>
                <p className="text-[11px] text-[#B9B4AA] leading-relaxed">{failureInfo.detail}</p>

                {failureInfo.canRetry && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => void handleRetrySync()}
                    isLoading={isRetrying || syncState.isSyncing}
                    disabled={isRetrying || syncState.isSyncing}
                    leftIcon={<RefreshCw className="h-3 w-3" aria-hidden="true" />}
                    className="w-full justify-center text-[11px]"
                  >
                    {isRetrying || syncState.isSyncing ? 'Retrying sync...' : 'Retry Sync'}
                  </Button>
                )}

                {failureInfo.kind === 'reauthenticate' && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={handleReauthenticate}
                    className="w-full justify-center text-[11px]"
                  >
                    Sign in again
                  </Button>
                )}
              </div>
            )}

            <div className="pt-1 border-t border-[#2A2A2A] flex items-center justify-end">
              <Link
                to="/settings"
                onClick={() => setIsOpen(false)}
                className="text-[11px] font-medium text-[#D6AD60] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D6AD60] rounded"
              >
                Backup & Settings
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

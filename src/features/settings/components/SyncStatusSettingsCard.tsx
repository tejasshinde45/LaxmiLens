import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Cloud, RefreshCw, AlertTriangle, CheckCircle2, WifiOff, HardDrive } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useAutoSyncState } from '@/hooks/useAutoSyncState';
import { defaultDatabaseManager } from '@/infrastructure/database/local/DatabaseManager';
import {
  formatLastSyncedTime,
  formatSanitizedSyncFailure,
  getSyncStatusVisualMeta
} from '@/features/sync/utils/syncStatusPresentation';
import { cn } from '@/utils/cn';

export const SyncStatusSettingsCard: React.FC = () => {
  const syncState = useAutoSyncState();
  const navigate = useNavigate();
  const [isRetrying, setIsRetrying] = useState(false);

  const visual = getSyncStatusVisualMeta(syncState.status);
  const formattedLastSynced = formatLastSyncedTime(syncState.lastSyncedAt);
  const failureInfo = formatSanitizedSyncFailure(syncState);

  const handleRetrySync = async () => {
    if (isRetrying || syncState.isSyncing) {
      return;
    }
    setIsRetrying(true);
    try {
      await defaultDatabaseManager.retryFailedSync();
    } catch {
      // Errors transition cleanly through AutoSyncScheduler state.
    } finally {
      setIsRetrying(false);
    }
  };

  const statusIcon =
    syncState.status === 'synchronization_failed' ? (
      <AlertTriangle className="h-4 w-4 text-[#D9827C]" aria-hidden="true" />
    ) : syncState.status === 'successfully_synchronized' ? (
      <CheckCircle2 className="h-4 w-4 text-[#72B895]" aria-hidden="true" />
    ) : syncState.status === 'waiting_for_internet' ? (
      <WifiOff className="h-4 w-4 text-[#E4B66D]" aria-hidden="true" />
    ) : syncState.status === 'synchronizing' ? (
      <RefreshCw
        className="h-4 w-4 text-[#D6AD60] animate-spin motion-reduce:animate-none"
        aria-hidden="true"
      />
    ) : (
      <HardDrive className="h-4 w-4 text-[#D6AD60]" aria-hidden="true" />
    );

  return (
    <Card variant="surface" className="space-y-4 p-5" data-testid="settings-sync-status-card">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2.5 text-sm font-semibold text-[#F5F1E8]">
          <Cloud className="h-4 w-4 text-[#D6AD60]" aria-hidden="true" />
          <span>Automatic Cloud Synchronization</span>
        </div>
        <Badge
          variant={
            syncState.status === 'synchronization_failed'
              ? 'expense'
              : syncState.status === 'successfully_synchronized'
                ? 'income'
                : 'gold'
          }
          size="sm"
          className="gap-1.5"
        >
          {statusIcon}
          <span>{visual.label}</span>
        </Badge>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs pt-1">
        <div className="space-y-1">
          <span className="text-[#858078]">Last Synchronized</span>
          <p className="text-[#F5F1E8] font-medium font-tabular">
            {formattedLastSynced ?? 'Not yet synchronized'}
          </p>
        </div>
        <div className="space-y-1">
          <span className="text-[#858078]">Pending Local Updates</span>
          <p className={cn('font-medium font-tabular', syncState.pendingCount > 0 ? 'text-[#D6AD60]' : 'text-[#F5F1E8]')}>
            {syncState.pendingCount} item{syncState.pendingCount === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      <p className="text-[11px] text-[#858078] leading-relaxed">
        Financial changes save immediately to your local IndexedDB database and synchronize
        automatically when connected.
      </p>

      {failureInfo && (
        <div
          role="alert"
          data-testid="settings-sync-failure-alert"
          className={cn(
            'rounded-[10px] border px-3 py-3 text-xs space-y-2',
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
              leftIcon={<RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
            >
              {isRetrying || syncState.isSyncing ? 'Retrying sync...' : 'Retry Sync'}
            </Button>
          )}

          {failureInfo.kind === 'reauthenticate' && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => navigate('/login')}
            >
              Sign in again
            </Button>
          )}
        </div>
      )}
    </Card>
  );
};

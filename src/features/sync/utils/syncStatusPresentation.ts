import { AutoSyncStateSnapshot, AutoSyncStatus } from '@/infrastructure/sync/AutoSyncScheduler';
import { classifySyncError } from '@/infrastructure/sync/SyncRetryPolicy';

export type SyncFailureRecoveryKind =
  | 'offline'
  | 'reauthenticate'
  | 'conflict'
  | 'permanent'
  | 'transient';

export interface SyncFailurePresentation {
  readonly kind: SyncFailureRecoveryKind;
  readonly summary: string;
  readonly detail: string;
  readonly canRetry: boolean;
  readonly actionLabel: string | null;
}

export interface AutoSyncVisualStyle {
  readonly label: string;
  readonly borderClass: string;
  readonly bgClass: string;
  readonly textClass: string;
  readonly iconColorClass: string;
  readonly dotColorClass: string;
}

const VISUAL_STYLES: Readonly<Record<AutoSyncStatus, AutoSyncVisualStyle>> = {
  saved_locally: {
    label: 'Saved locally',
    borderClass: 'border-[#D6AD60]/35',
    bgClass: 'bg-[#1B1B1B]',
    textClass: 'text-[#F5F1E8]',
    iconColorClass: 'text-[#D6AD60]',
    dotColorClass: 'bg-[#D6AD60]'
  },
  synchronizing: {
    label: 'Synchronizing',
    borderClass: 'border-[#D6AD60]/45',
    bgClass: 'bg-[#211E17]',
    textClass: 'text-[#F5F1E8]',
    iconColorClass: 'text-[#D6AD60]',
    dotColorClass: 'bg-[#D6AD60]'
  },
  successfully_synchronized: {
    label: 'Successfully synchronized',
    borderClass: 'border-[#72B895]/35',
    bgClass: 'bg-[#1B1B1B]',
    textClass: 'text-[#F5F1E8]',
    iconColorClass: 'text-[#72B895]',
    dotColorClass: 'bg-[#72B895]'
  },
  waiting_for_internet: {
    label: 'Waiting for internet',
    borderClass: 'border-[#E4B66D]/35',
    bgClass: 'bg-[#211D16]',
    textClass: 'text-[#F5F1E8]',
    iconColorClass: 'text-[#E4B66D]',
    dotColorClass: 'bg-[#E4B66D]'
  },
  synchronization_failed: {
    label: 'Synchronization failed',
    borderClass: 'border-[#D9827C]/45',
    bgClass: 'bg-[#241817]',
    textClass: 'text-[#F5F1E8]',
    iconColorClass: 'text-[#D9827C]',
    dotColorClass: 'bg-[#D9827C]'
  }
};

export function getSyncStatusVisualMeta(status: AutoSyncStatus): AutoSyncVisualStyle {
  return VISUAL_STYLES[status] ?? VISUAL_STYLES.saved_locally;
}

export function formatLastSyncedTime(lastSyncedAt: string | null): string | null {
  if (!lastSyncedAt) {
    return null;
  }
  const parsed = new Date(lastSyncedAt);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  const now = new Date();
  const isSameDay =
    parsed.getFullYear() === now.getFullYear() &&
    parsed.getMonth() === now.getMonth() &&
    parsed.getDate() === now.getDate();

  if (isSameDay) {
    return parsed.toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  return parsed.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

/**
 * Classifies a failed or paused AutoSyncStateSnapshot into strictly safe, non-technical
 * user guidance. Never interpolates raw database errors, SQL codes, tokens, UUIDs,
 * or financial details into UI text.
 */
export function formatSanitizedSyncFailure(
  snapshot: AutoSyncStateSnapshot
): SyncFailurePresentation | null {
  if (snapshot.status === 'waiting_for_internet' || !snapshot.isOnline) {
    return {
      kind: 'offline',
      summary: 'Waiting for an internet connection.',
      detail:
        'Your changes are safely stored on this device and will synchronize automatically once connectivity returns.',
      canRetry: false,
      actionLabel: null
    };
  }

  if (snapshot.status !== 'synchronization_failed') {
    return null;
  }

  const firstError = snapshot.lastResult?.errors?.[0];
  const category = firstError?.category;
  const rawMessage = firstError?.error ?? snapshot.lastError ?? '';
  const classification = rawMessage ? classifySyncError(new Error(rawMessage)) : null;

  if (
    snapshot.authPaused ||
    snapshot.lastResult?.authPaused ||
    snapshot.lastResult?.skippedAuthPaused ||
    category === 'auth' ||
    classification?.disposition === 'auth'
  ) {
    return {
      kind: 'reauthenticate',
      summary: 'Your session needs re-authentication to sync.',
      detail:
        'Your financial entries remain safely saved on this device. Please sign in again to resume cloud synchronization.',
      canRetry: false,
      actionLabel: 'Sign in again'
    };
  }

  if (category === 'conflict' || classification?.errorClass === 'conflict') {
    return {
      kind: 'conflict',
      summary: 'Cloud sync encountered a version mismatch.',
      detail:
        'Your local changes remain safely saved on this device. Retry synchronization to reconcile with the latest cloud state.',
      canRetry: true,
      actionLabel: 'Retry sync'
    };
  }

  if (
    category === 'category' ||
    category === 'dependency' ||
    category === 'validation' ||
    category === 'database' ||
    classification?.disposition === 'permanent'
  ) {
    return {
      kind: 'permanent',
      summary: 'Some updates need attention before they can synchronize.',
      detail:
        'Your entries remain safely stored locally and none of your data was discarded. Retry synchronization now or review recent edits before syncing again.',
      canRetry: true,
      actionLabel: 'Retry sync'
    };
  }

  return {
    kind: 'transient',
    summary: 'Temporary issue connecting to cloud sync.',
    detail:
      'Your entries remain safely stored locally on this device. Automatic retry will run shortly, or you can retry now.',
    canRetry: true,
    actionLabel: 'Retry sync'
  };
}

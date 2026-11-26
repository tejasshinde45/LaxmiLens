import { AuthPort, AuthUser } from '@/application/ports/AuthPort';
import {
  BackupExclusiveOperation,
  BackupSyncActivityGuard
} from '@/application/ports/BackupStoragePort';
import {
  BackupAuthenticationError,
  BackupOwnershipMismatchError,
  BackupSyncConflictError
} from '@/domain/errors/BackupErrors';
import { isValidUuid, UserId, validateUserId } from '@/domain/value-objects/Identifiers';

export interface VerifiedBackupActor {
  userId: UserId;
  email?: string;
}

export async function resolveVerifiedBackupActor(
  authPort: AuthPort,
  scopedUserId?: string
): Promise<VerifiedBackupActor> {
  const currentUser: AuthUser | null = await authPort.getCurrentUser();
  if (!currentUser || !currentUser.id || !isValidUuid(currentUser.id)) {
    throw new BackupAuthenticationError();
  }

  const userId = validateUserId(currentUser.id);
  if (scopedUserId !== undefined && validateUserId(scopedUserId) !== userId) {
    throw new BackupOwnershipMismatchError(
      'Authenticated user session changed and no longer owns the active database scope.'
    );
  }

  return {
    userId,
    ...(currentUser.email ? { email: currentUser.email } : {})
  };
}

export function assertNoManualSyncRunning(syncGuard?: BackupSyncActivityGuard): void {
  if (syncGuard?.isSyncRunning() || syncGuard?.isOperationInProgress?.()) {
    throw new BackupSyncConflictError();
  }
}

export async function runWithExclusiveBackupLock<T>(
  syncGuard: BackupSyncActivityGuard | undefined,
  operation: BackupExclusiveOperation,
  work: () => Promise<T>
): Promise<T> {
  if (!syncGuard) {
    return await work();
  }

  if (typeof syncGuard.runExclusive === 'function') {
    return await syncGuard.runExclusive(operation, work);
  }

  if (syncGuard.isSyncRunning() || syncGuard.isOperationInProgress?.()) {
    throw new BackupSyncConflictError();
  }

  return await work();
}

import { DomainError } from './DomainErrors';

export interface BackupValidationIssue {
  readonly code: string;
  readonly store: string;
  readonly recordId?: string;
  readonly message: string;
}

export const MAX_DISPLAYED_BACKUP_VALIDATION_ISSUES = 5;

/**
 * Formats backup validation issues into a bounded diagnostic summary preserving
 * total issue count while exposing up to the first five structural/reference errors.
 */
export function formatBackupValidationErrorMessage(
  issues: readonly BackupValidationIssue[],
  maxDisplayed: number = MAX_DISPLAYED_BACKUP_VALIDATION_ISSUES
): string {
  if (issues.length === 0) {
    return 'Backup archive failed financial schema or referential integrity validation.';
  }

  if (issues.length === 1) {
    return `Backup failed validation with 1 integrity issue(s): ${issues[0]!.message}`;
  }

  const limit = Math.max(1, maxDisplayed);
  const displayed = issues
    .slice(0, limit)
    .map((issue, index) => `[${index + 1}] [${issue.store}/${issue.code}] ${issue.message}`)
    .join('; ');
  const remaining = issues.length - limit;
  const overflowSuffix = remaining > 0 ? ` (+${remaining} more)` : '';

  return `Backup failed validation with ${issues.length} integrity issue(s): ${displayed}${overflowSuffix}`;
}

export class InvalidBackupFormatError extends DomainError {
  constructor(
    message = 'The selected file is not a valid LaxmiLens encrypted backup container.'
  ) {
    super(message, 'INVALID_BACKUP_FORMAT');
  }
}

export class BackupEncryptionError extends DomainError {
  constructor(message = 'Failed to encrypt the financial backup archive.') {
    super(message, 'BACKUP_ENCRYPTION_FAILED');
  }
}

export class BackupDecryptionError extends DomainError {
  constructor(
    message = 'Unable to decrypt backup. Verify your passphrase or ensure the backup file has not been altered.'
  ) {
    super(message, 'BACKUP_DECRYPTION_FAILED');
  }
}

export class BackupIntegrityError extends DomainError {
  constructor(
    message = 'Backup integrity verification failed. Checksum or manifest verification did not match.'
  ) {
    super(message, 'BACKUP_INTEGRITY_FAILED');
  }
}

export class BackupOwnershipMismatchError extends DomainError {
  constructor(
    message = 'This backup belongs to a different account and cannot be restored into the currently signed-in account.'
  ) {
    super(message, 'BACKUP_OWNERSHIP_MISMATCH');
  }
}

export class UnsupportedBackupVersionError extends DomainError {
  constructor(
    message = 'This backup was created with a newer or unsupported schema/container version.'
  ) {
    super(message, 'UNSUPPORTED_BACKUP_VERSION');
  }
}

export class BackupValidationError extends DomainError {
  public readonly issues: readonly BackupValidationIssue[];

  constructor(
    message = 'Backup archive failed financial schema or referential integrity validation.',
    issues: readonly BackupValidationIssue[] = []
  ) {
    super(message, 'BACKUP_VALIDATION_FAILED');
    this.issues = Object.freeze(issues.map((issue) => Object.freeze({ ...issue })));
  }
}

export class BackupAuthenticationError extends DomainError {
  constructor(
    message = 'An authenticated user session is required to perform backup or restore operations.'
  ) {
    super(message, 'BACKUP_AUTH_REQUIRED');
  }
}

export class BackupSyncConflictError extends DomainError {
  constructor(
    message = 'Backup and restore operations cannot run while manual synchronization is in progress.'
  ) {
    super(message, 'BACKUP_SYNC_IN_PROGRESS');
  }
}

export class BackupPersistenceError extends DomainError {
  constructor(
    message = 'Atomic backup restore failed during local database persistence and all changes were rolled back.'
  ) {
    super(message, 'BACKUP_PERSISTENCE_FAILED');
  }
}

export class SafetyBackupRequiredError extends BackupValidationError {
  constructor(
    message = 'A fresh, valid safety backup receipt for the current database state is required before replacing local data.'
  ) {
    super(message, [
      {
        code: 'SAFETY_BACKUP_RECEIPT_REQUIRED',
        store: 'backup',
        message
      }
    ]);
    this.name = this.constructor.name;
  }
}

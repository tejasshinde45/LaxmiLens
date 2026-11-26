import { BACKUP_MIN_PASSPHRASE_LENGTH } from '@/application/dto/BackupDTO';
import {
  BackupAuthenticationError,
  BackupDecryptionError,
  BackupEncryptionError,
  BackupIntegrityError,
  BackupOwnershipMismatchError,
  BackupPersistenceError,
  BackupSyncConflictError,
  BackupValidationError,
  InvalidBackupFormatError,
  SafetyBackupRequiredError,
  UnsupportedBackupVersionError
} from '@/domain/errors/BackupErrors';

export type PassphraseStrengthLevel = 'empty' | 'too_short' | 'fair' | 'strong' | 'excellent';

export interface PassphraseStrengthEvaluation {
  level: PassphraseStrengthLevel;
  score: number; // 0-4
  label: string;
  guidance: string;
  meetsMinimum: boolean;
}

export function evaluatePassphraseStrength(passphrase: string): PassphraseStrengthEvaluation {
  if (!passphrase || passphrase.trim().length === 0) {
    return {
      level: 'empty',
      score: 0,
      label: 'Not entered',
      guidance: `Use at least ${BACKUP_MIN_PASSPHRASE_LENGTH} characters. Combining words or mixed characters makes guessing impractical.`,
      meetsMinimum: false
    };
  }

  if (passphrase.length < BACKUP_MIN_PASSPHRASE_LENGTH) {
    return {
      level: 'too_short',
      score: 1,
      label: `Too short (${passphrase.length}/${BACKUP_MIN_PASSPHRASE_LENGTH})`,
      guidance: `Enter at least ${BACKUP_MIN_PASSPHRASE_LENGTH} characters. LaxmiLens uses AES-256-GCM encryption.`,
      meetsMinimum: false
    };
  }

  let charClasses = 0;
  if (/[a-z]/.test(passphrase)) charClasses += 1;
  if (/[A-Z]/.test(passphrase)) charClasses += 1;
  if (/[0-9]/.test(passphrase)) charClasses += 1;
  if (/[^a-zA-Z0-9\s]/.test(passphrase)) charClasses += 1;

  if (passphrase.length >= 20 && charClasses >= 3) {
    return {
      level: 'excellent',
      score: 4,
      label: 'Excellent strength',
      guidance: 'Strong passphrase. Save it in a trusted password manager—it cannot be reset.',
      meetsMinimum: true
    };
  }

  if ((passphrase.length >= 16 && charClasses >= 2) || (passphrase.length >= 12 && charClasses >= 3)) {
    return {
      level: 'strong',
      score: 3,
      label: 'Strong passphrase',
      guidance: 'Good protection. Remember: LaxmiLens never stores this passphrase.',
      meetsMinimum: true
    };
  }

  return {
    level: 'fair',
    score: 2,
    label: 'Fair (meets minimum)',
    guidance: 'Meets the 12-character minimum. Adding uppercase letters, numbers, or symbols increases security.',
    meetsMinimum: true
  };
}

export function formatBackupByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatBackupErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof BackupSyncConflictError) {
    return 'Cloud synchronization or another backup/restore task is currently running. Wait for it to finish and try again.';
  }
  if (error instanceof BackupAuthenticationError) {
    return 'Please sign in to create or restore an encrypted backup.';
  }
  if (error instanceof BackupDecryptionError) {
    return 'Could not unlock this backup. Check your passphrase carefully and make sure the file has not been altered.';
  }
  if (error instanceof InvalidBackupFormatError) {
    return error.message || 'This file is not a valid LaxmiLens encrypted backup (.laxmibak).';
  }
  if (error instanceof UnsupportedBackupVersionError) {
    return error.message;
  }
  if (error instanceof BackupOwnershipMismatchError) {
    return 'This backup belongs to a different LaxmiLens account. Sign in with the original account to restore it.';
  }
  if (error instanceof BackupIntegrityError) {
    return 'Backup integrity check failed. The decrypted data did not match its verification checksum.';
  }
  if (error instanceof SafetyBackupRequiredError) {
    return error.message;
  }
  if (error instanceof BackupPersistenceError) {
    return 'Restore failed while writing locally, so all changes were rolled back and your existing data remains untouched.';
  }
  if (error instanceof BackupValidationError) {
    return error.message;
  }
  if (error instanceof BackupEncryptionError) {
    return error.message;
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    if (error.message.includes('already in progress')) {
      return 'Synchronization is currently running. Wait for it to complete and try again.';
    }
    return error.message;
  }
  return fallbackMessage;
}

import { AccountType } from '@/domain/entities/Account';
import { CategoryType } from '@/domain/entities/Category';
import {
  NotificationCategory,
  NotificationSeverity
} from '@/domain/services/NotificationIdentityService';
import { NotificationEntityType, NotificationStatus } from '@/domain/entities/Notification';
import { BorrowingStatus } from '@/domain/entities/Borrowing';
import { RecurrenceFrequency } from '@/domain/services/RecurrenceScheduleService';
import {
  RecurringRuleStatus,
  RecurringTransactionType
} from '@/domain/entities/RecurringRule';
import { RecurringOccurrenceStatus } from '@/domain/entities/RecurringOccurrence';
import { TransactionType } from '@/domain/entities/Transaction';

export const BACKUP_CONTAINER_FORMAT = 'laxmilens-encrypted-backup' as const;
export const BACKUP_CONTAINER_FORMAT_VERSION = 1 as const;
export const BACKUP_MANIFEST_SCHEMA_VERSION = 1 as const;

/**
 * Authoritative Dexie schema version (`LaxmiLensDB` `.version(8)` in DexieDatabase.ts).
 * NOTE: Deliberately independent from legacy `APP_CONFIG.database.version`.
 */
export const CURRENT_DEXIE_SCHEMA_VERSION = 8 as const;

export const BACKUP_KDF_ALGORITHM = 'PBKDF2' as const;
export const BACKUP_KDF_HASH = 'SHA-256' as const;
export const BACKUP_DEFAULT_KDF_ITERATIONS = 600_000 as const;
export const BACKUP_MIN_KDF_ITERATIONS = 600_000 as const;
export const BACKUP_MAX_KDF_ITERATIONS = 1_000_000 as const;

export const BACKUP_CIPHER_ALGORITHM = 'AES-GCM' as const;
export const BACKUP_CIPHER_KEY_LENGTH_BITS = 256 as const;
export const BACKUP_CIPHER_TAG_LENGTH_BITS = 128 as const;

export const BACKUP_SALT_BYTE_LENGTH = 16 as const;
export const BACKUP_IV_BYTE_LENGTH = 12 as const;
export const BACKUP_GCM_TAG_BYTE_LENGTH = 16 as const;
export const BACKUP_MIN_PASSPHRASE_LENGTH = 12 as const;

export const BACKUP_MAX_ENVELOPE_BYTES = 50 * 1024 * 1024;
export const BACKUP_MAX_PLAINTEXT_BYTES = 35 * 1024 * 1024;

export const BACKUP_INTEGRITY_ALGORITHM = 'SHA-256' as const;
export const BACKUP_CANONICAL_SERIALIZATION = 'json-sorted-keys-v1' as const;

export const BACKUP_FILE_EXTENSION = '.laxmibak' as const;
export const BACKUP_MIME_TYPE = 'application/json' as const;
export const BACKUP_REPLACE_CONFIRMATION_TEXT = 'REPLACE' as const;

export const LEGACY_SYSTEM_NIL_UUID = '00000000-0000-0000-0000-000000000000' as const;
export const QUARANTINE_USER_ID_PREFIX = 'quarantine-' as const;
export const AMBIGUOUS_UNASSIGNED_USER_ID = 'ambiguous-unassigned' as const;

export const BACKUP_OUTBOX_ENTITIES = [
  'profiles',
  'accounts',
  'categories',
  'transactions',
  'budgets',
  'recurring_rules',
  'recurring_occurrences',
  'lenders',
  'borrowings',
  'borrowing_repayments',
  'notifications',
  'notification_preferences'
] as const;

export type BackupOutboxEntity = (typeof BACKUP_OUTBOX_ENTITIES)[number];
export type BackupOutboxOperation = 'INSERT' | 'UPDATE' | 'DELETE';

/**
 * Restore mode in Phase 11 is intentionally restricted to empty/fresh database
 * initialization or explicit confirmed replacement. Safe Merge is deferred.
 */
export type BackupRestoreMode = 'empty' | 'replace';

export interface BackupKdfHeader {
  algorithm: typeof BACKUP_KDF_ALGORITHM;
  hash: typeof BACKUP_KDF_HASH;
  iterations: number;
}

export interface BackupCipherHeader {
  algorithm: typeof BACKUP_CIPHER_ALGORITHM;
  keyLengthBits: typeof BACKUP_CIPHER_KEY_LENGTH_BITS;
  tagLengthBits: typeof BACKUP_CIPHER_TAG_LENGTH_BITS;
}

/**
 * Unencrypted outer container header + AES-GCM ciphertext.
 * Intentionally excludes all financial metadata, account names, balances,
 * record counts, notes, categories, and user identifiers.
 */
export interface EncryptedBackupEnvelope {
  format: typeof BACKUP_CONTAINER_FORMAT;
  formatVersion: typeof BACKUP_CONTAINER_FORMAT_VERSION;
  createdAt: string;
  kdf: BackupKdfHeader;
  cipher: BackupCipherHeader;
  saltBase64: string;
  ivBase64: string;
  ciphertextBase64: string;
}

export interface BackupEncryptionOptions {
  iterations?: number;
  createdAt?: string;
}

export interface BackupProfileRecord {
  id: string;
  email: string;
  displayName?: string;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

export interface BackupAccountRecord {
  id: string;
  userId: string;
  name: string;
  accountType: AccountType;
  openingBalancePaise: number;
  currency: string;
  institutionName?: string;
  color?: string;
  icon?: string;
  notes?: string;
  systemTag?: string | null;
  isArchived: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface BackupCategoryRecord {
  id: string;
  userId: string;
  name: string;
  type: CategoryType;
  icon?: string;
  color?: string;
  isDefault: boolean;
  isArchived: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface BackupTransactionRecord {
  id: string;
  userId: string;
  type: TransactionType;
  amountPaise: number;
  currency: string;
  accountId: string;
  destinationAccountId?: string;
  categoryId?: string;
  title: string;
  note?: string;
  transactionDate: string;
  deletedAt: string | null;
  version: number;
  deviceId?: string;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface BackupBudgetRecord {
  id: string;
  userId: string;
  categoryId: string;
  period: string;
  limitPaise: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface BackupRecurringRuleRecord {
  id: string;
  userId: string;
  title: string;
  description?: string;
  type: RecurringTransactionType;
  amountPaise: number;
  accountId: string;
  categoryId?: string;
  frequency: RecurrenceFrequency;
  interval: number;
  anchorDayOfMonth: number;
  startDate: string;
  endDate?: string | null;
  nextDueDate: string;
  lastGeneratedDate?: string | null;
  status: RecurringRuleStatus;
  requiresUserConfirmation: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface BackupRecurringOccurrenceRecord {
  id: string;
  userId: string;
  recurringRuleId: string;
  occurrenceDate: string;
  status: RecurringOccurrenceStatus;
  snoozedUntilDate?: string | null;
  transactionId?: string | null;
  idempotencyKey: string;
  confirmedAt?: string | null;
  skippedAt?: string | null;
  dismissedAt?: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface BackupLenderRecord {
  id: string;
  userId: string;
  name: string;
  phone?: string;
  email?: string;
  notes?: string;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BackupBorrowingRecord {
  id: string;
  userId: string;
  lenderId: string;
  amountPaise: number;
  borrowingDate: string;
  dueDate?: string | null;
  receivingAccountId: string;
  transactionId: string;
  status: BorrowingStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BackupBorrowingRepaymentRecord {
  id: string;
  userId: string;
  borrowingId: string;
  lenderId: string;
  amountPaise: number;
  repaymentDate: string;
  paymentAccountId: string;
  transactionId: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BackupNotificationRecord {
  id: string;
  userId: string;
  category: NotificationCategory;
  severity: NotificationSeverity;
  status: NotificationStatus;
  dedupeKey: string;
  title: string;
  message: string;
  entityType: NotificationEntityType;
  entityId: string;
  triggerDate: string;
  actionRoute: string;
  metadataJson: string;
  readAt?: string | null;
  dismissedAt?: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface BackupNotificationPreferenceRecord {
  userId: string;
  recurringPaymentEnabled: boolean;
  budgetWarningEnabled: boolean;
  budgetExceededEnabled: boolean;
  upcomingLeadDays: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface BackupCategoryMappingRecord {
  key: string;
  value: string;
  updatedAt: string;
}

/**
 * Sanitized pending outbox entry.
 * Omits transient local auto-increment `id`, `lastAttemptAt`, and `lastError`,
 * and resets `attempts` to 0 while preserving UUID identity, idempotencyKey,
 * payload, and FIFO enqueue order.
 */
export interface BackupPendingOutboxRecord {
  userId: string;
  entity: BackupOutboxEntity;
  entityId: string;
  operation: BackupOutboxOperation;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  attempts: number;
  createdAt: string;
}

export interface BackupDataPayload {
  profile: BackupProfileRecord | null;
  accounts: BackupAccountRecord[];
  categories: BackupCategoryRecord[];
  transactions: BackupTransactionRecord[];
  budgets: BackupBudgetRecord[];
  recurringRules: BackupRecurringRuleRecord[];
  recurringOccurrences: BackupRecurringOccurrenceRecord[];
  lenders: BackupLenderRecord[];
  borrowings: BackupBorrowingRecord[];
  borrowingRepayments: BackupBorrowingRepaymentRecord[];
  notifications: BackupNotificationRecord[];
  notificationPreferences: BackupNotificationPreferenceRecord | null;
  categoryMappings: BackupCategoryMappingRecord[];
  pendingOutbox: BackupPendingOutboxRecord[];
}

export interface BackupRecordCounts {
  profile: number;
  accounts: number;
  categories: number;
  transactions: number;
  budgets: number;
  recurringRules: number;
  recurringOccurrences: number;
  lenders: number;
  borrowings: number;
  borrowingRepayments: number;
  notifications: number;
  notificationPreferences: number;
  categoryMappings: number;
  pendingOutbox: number;
}

export interface BackupExcludedRecordCounts {
  accounts: number;
  categories: number;
  transactions: number;
  budgets: number;
  recurringRules: number;
  recurringOccurrences: number;
  lenders: number;
  borrowings: number;
  borrowingRepayments: number;
  notifications: number;
  notificationPreferences: number;
  pendingOutbox: number;
  total: number;
}

export interface BackupManifest {
  manifestVersion: typeof BACKUP_MANIFEST_SCHEMA_VERSION;
  appName: string;
  appVersion: string;
  dexieSchemaVersion: number;
  exportedAt: string;
  owner: {
    userId: string;
    email?: string;
    currency: string;
  };
  integrity: {
    algorithm: typeof BACKUP_INTEGRITY_ALGORITHM;
    canonicalSerialization: typeof BACKUP_CANONICAL_SERIALIZATION;
    payloadSha256Hex: string;
  };
  counts: BackupRecordCounts;
  excludedQuarantinedCounts: BackupExcludedRecordCounts;
}

export interface BackupArchiveDocument {
  manifest: BackupManifest;
  data: BackupDataPayload;
}

export interface RawBackupStoreInput {
  profile?: Record<string, unknown> | null;
  accounts?: readonly Record<string, unknown>[];
  categories?: readonly Record<string, unknown>[];
  transactions?: readonly Record<string, unknown>[];
  budgets?: readonly Record<string, unknown>[];
  recurringRules?: readonly Record<string, unknown>[];
  recurringOccurrences?: readonly Record<string, unknown>[];
  lenders?: readonly Record<string, unknown>[];
  borrowings?: readonly Record<string, unknown>[];
  borrowingRepayments?: readonly Record<string, unknown>[];
  notifications?: readonly Record<string, unknown>[];
  notificationPreferences?: readonly Record<string, unknown>[];
  syncMetadata?: readonly Record<string, unknown>[];
  pendingOutbox?: readonly Record<string, unknown>[];
}

export interface BuildBackupArchiveInput {
  userId: string;
  email?: string;
  currency?: string;
  appName?: string;
  appVersion?: string;
  dexieSchemaVersion?: number;
  exportedAt?: string;
  rawStoreData: RawBackupStoreInput;
  preExcludedQuarantinedCounts?: Partial<Omit<BackupExcludedRecordCounts, 'total'>>;
}

export interface BackupTargetSummary {
  authenticatedUserId: string;
  currentDexieSchemaVersion: number;
  existingCounts: BackupRecordCounts;
  existingCategories?: readonly BackupCategoryRecord[];
  referencedCategoryIds?: readonly string[];
}

export interface RestoreValidationOptions {
  authenticatedUserId: string;
  currentDexieSchemaVersion?: number;
  mode?: BackupRestoreMode;
  restorePendingOutbox?: boolean;
  confirmationText?: string;
  safetyBackupConfirmed?: boolean;
  targetSummary?: BackupTargetSummary;
}

/**
 * Explicit Stage 1 -> Stage 2 default category identity contract.
 * Documents the existing schema limitation: locally and server-seeded default
 * categories use random UUIDs and lack an immutable template/seed key, so display
 * names cannot be used alone to equate or merge categories across installations.
 */
export interface BackupCategoryIdentityContract {
  matchingStrategy: 'uuid-and-sync-mapping-only';
  nameOnlyMatchingPermitted: false;
  preservesBackupCategoryUuids: true;
  limitationNote: string;
  targetDefaultReconciliationAction:
    | 'none'
    | 'preserve_identical_uuids'
    | 'replace_unused_seeded_defaults';
  unresolvedSeededDefaultCategoryIds: string[];
}

export interface RestorePreviewSummaryDTO {
  valid: boolean;
  ownerMatchesAuthenticatedUser: boolean;
  restorePendingOutboxEnabled: boolean;
  manifestSummary: {
    appName: string;
    appVersion: string;
    dexieSchemaVersion: number;
    exportedAt: string;
    ownerUserId: string;
    ownerEmail?: string;
    currency: string;
  };
  modeCompatibility: {
    canRestoreIntoEmpty: boolean;
    requiresReplaceConfirmation: boolean;
    targetHasUserData: boolean;
    targetHasOnlyDefaultCategories: boolean;
  };
  backupCounts: BackupRecordCounts;
  excludedQuarantinedCounts: BackupExcludedRecordCounts;
  existingLocalCounts?: BackupRecordCounts;
  pendingOutboxToRestoreCount: number;
  defaultCategorySummary: {
    backupDefaultCount: number;
    targetDefaultCount: number;
    matchedDefaultIdsCount: number;
    conflictingDefaultIdsCount: number;
  };
  categoryIdentityContract: BackupCategoryIdentityContract;
  warnings: string[];
}

export interface ExportEncryptedBackupInputDTO {
  passphrase: string;
  downloadFile?: boolean;
  filename?: string;
}

export interface SafetyBackupReceipt {
  readonly receiptId: string;
  readonly userId: string;
  readonly databaseIdentity: string;
  readonly stateDigestSha256Hex: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export interface ExportEncryptedBackupResultDTO {
  filename: string;
  byteLength: number;
  downloaded: boolean;
  safetyBackupCreated: boolean;
  safetyBackupReceipt: SafetyBackupReceipt;
  envelope: EncryptedBackupEnvelope;
  manifest: BackupManifest;
}

export interface DecryptBackupFileInputDTO {
  file?: File | Blob;
  rawContent?: unknown;
  passphrase: string;
}

export interface DecryptedBackupResultDTO {
  archive: BackupArchiveDocument;
  envelope: EncryptedBackupEnvelope;
}

export interface GenerateRestorePreviewInputDTO {
  archive?: BackupArchiveDocument;
  file?: File | Blob;
  rawContent?: unknown;
  passphrase?: string;
  mode?: BackupRestoreMode;
  restorePendingOutbox?: boolean;
  confirmationText?: string;
  safetyBackupConfirmed?: boolean;
}

export interface ExecuteBackupRestoreInputDTO {
  archive: BackupArchiveDocument;
  mode: BackupRestoreMode;
  restorePendingOutbox?: boolean;
  confirmationText?: string;
  safetyBackupReceipt?: SafetyBackupReceipt;
}

export interface ExecuteBackupRestoreResultDTO {
  restoredAt: string;
  mode: BackupRestoreMode;
  restoredCounts: BackupRecordCounts;
  restoredOutboxCount: number;
  replacedSeededDefaultCategoryIds: string[];
  cachesInvalidated: boolean;
  autoSyncTriggered: false;
}

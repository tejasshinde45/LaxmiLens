import { AccountType } from '@/domain/entities/Account';
import { BUDGET_PERIOD_REGEX } from '@/domain/entities/Budget';
import { BorrowingStatus } from '@/domain/entities/Borrowing';
import { CategoryType } from '@/domain/entities/Category';
import {
  MAX_UPCOMING_LEAD_DAYS,
  MIN_UPCOMING_LEAD_DAYS
} from '@/domain/entities/NotificationPreference';
import {
  NotificationEntityType,
  NotificationStatus
} from '@/domain/entities/Notification';
import {
  RecurringRuleStatus,
  RecurringTransactionType
} from '@/domain/entities/RecurringRule';
import { RecurringOccurrenceStatus } from '@/domain/entities/RecurringOccurrence';
import { TransactionType } from '@/domain/entities/Transaction';
import {
  NotificationCategory,
  NotificationSeverity
} from '@/domain/services/NotificationIdentityService';
import {
  RECURRENCE_FREQUENCIES,
  RecurrenceFrequency,
  isValidLocalCalendarDate
} from '@/domain/services/RecurrenceScheduleService';
import {
  AMBIGUOUS_UNASSIGNED_USER_ID,
  BACKUP_CANONICAL_SERIALIZATION,
  BACKUP_INTEGRITY_ALGORITHM,
  BACKUP_MANIFEST_SCHEMA_VERSION,
  BACKUP_OUTBOX_ENTITIES,
  BACKUP_REPLACE_CONFIRMATION_TEXT,
  BackupAccountRecord,
  BackupArchiveDocument,
  BackupBorrowingRecord,
  BackupBorrowingRepaymentRecord,
  BackupBudgetRecord,
  BackupCategoryIdentityContract,
  BackupCategoryMappingRecord,
  BackupCategoryRecord,
  BackupDataPayload,
  BackupExcludedRecordCounts,
  BackupLenderRecord,
  BackupManifest,
  BackupNotificationPreferenceRecord,
  BackupNotificationRecord,
  BackupOutboxEntity,
  BackupOutboxOperation,
  BackupPendingOutboxRecord,
  BackupProfileRecord,
  BackupRecordCounts,
  BackupRecurringOccurrenceRecord,
  BackupRecurringRuleRecord,
  BackupTargetSummary,
  BackupTransactionRecord,
  BuildBackupArchiveInput,
  CURRENT_DEXIE_SCHEMA_VERSION,
  LEGACY_SYSTEM_NIL_UUID,
  QUARANTINE_USER_ID_PREFIX,
  RestorePreviewSummaryDTO,
  RestoreValidationOptions
} from '@/application/dto/BackupDTO';
import {
  BackupIntegrityError,
  BackupOwnershipMismatchError,
  BackupValidationError,
  BackupValidationIssue,
  UnsupportedBackupVersionError
} from '@/domain/errors/BackupErrors';
import { isValidUuid, validateUserId } from '@/domain/value-objects/Identifiers';
import { APP_CONFIG } from '@/config/constants';
import { computeCanonicalSha256Hex } from './BackupEncryptionService';

const VALID_ACCOUNT_TYPES = new Set<AccountType>([
  'cash',
  'bank',
  'savings',
  'credit_card',
  'wallet',
  'other'
]);
const VALID_CATEGORY_TYPES = new Set<CategoryType>(['income', 'expense']);
const VALID_TRANSACTION_TYPES = new Set<TransactionType>(['income', 'expense', 'transfer']);
const VALID_RECURRING_TYPES = new Set<RecurringTransactionType>(['income', 'expense']);
const VALID_RECURRING_FREQUENCIES = new Set<RecurrenceFrequency>(RECURRENCE_FREQUENCIES);
const VALID_RECURRING_STATUSES = new Set<RecurringRuleStatus>(['active', 'paused', 'completed']);
const VALID_OCCURRENCE_STATUSES = new Set<RecurringOccurrenceStatus>([
  'pending',
  'confirmed',
  'skipped',
  'snoozed',
  'dismissed'
]);
const VALID_BORROWING_STATUSES = new Set<BorrowingStatus>(['active', 'repaid']);
const VALID_NOTIFICATION_CATEGORIES = new Set<NotificationCategory>([
  'recurring_payment',
  'budget_warning',
  'budget_exceeded'
]);
const VALID_NOTIFICATION_SEVERITIES = new Set<NotificationSeverity>(['info', 'warning', 'critical']);
const VALID_NOTIFICATION_STATUSES = new Set<NotificationStatus>(['unread', 'read', 'dismissed']);
const VALID_NOTIFICATION_ENTITY_TYPES = new Set<NotificationEntityType>([
  'recurring_occurrence',
  'recurring_rule',
  'budget'
]);
const VALID_OUTBOX_ENTITIES = new Set<BackupOutboxEntity>(BACKUP_OUTBOX_ENTITIES);
const VALID_OUTBOX_OPERATIONS = new Set<BackupOutboxOperation>(['INSERT', 'UPDATE', 'DELETE']);
const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/;

type ExcludedStoreKey = keyof Omit<BackupExcludedRecordCounts, 'total'>;

export function isQuarantinedOrAmbiguousUserId(userId: unknown): boolean {
  if (typeof userId !== 'string') {
    return false;
  }
  const normalized = userId.trim();
  return (
    normalized.startsWith(QUARANTINE_USER_ID_PREFIX) ||
    normalized === AMBIGUOUS_UNASSIGNED_USER_ID
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype || proto?.constructor?.name === 'Object';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function isSafePositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isValidIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return false;
  }
  return !Number.isNaN(Date.parse(value));
}

function isValidIsoOrCalendarDate(value: unknown): value is string {
  return isValidLocalCalendarDate(value) || isValidIsoTimestamp(value);
}

function clonePlainJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createEmptyExcludedCounts(
  seed?: Partial<Omit<BackupExcludedRecordCounts, 'total'>>
): BackupExcludedRecordCounts {
  const counts: BackupExcludedRecordCounts = {
    accounts: seed?.accounts ?? 0,
    categories: seed?.categories ?? 0,
    transactions: seed?.transactions ?? 0,
    budgets: seed?.budgets ?? 0,
    recurringRules: seed?.recurringRules ?? 0,
    recurringOccurrences: seed?.recurringOccurrences ?? 0,
    lenders: seed?.lenders ?? 0,
    borrowings: seed?.borrowings ?? 0,
    borrowingRepayments: seed?.borrowingRepayments ?? 0,
    notifications: seed?.notifications ?? 0,
    notificationPreferences: seed?.notificationPreferences ?? 0,
    pendingOutbox: seed?.pendingOutbox ?? 0,
    total: 0
  };
  counts.total = sumExcludedCounts(counts);
  return counts;
}

function sumExcludedCounts(counts: Omit<BackupExcludedRecordCounts, 'total'>): number {
  return (
    counts.accounts +
    counts.categories +
    counts.transactions +
    counts.budgets +
    counts.recurringRules +
    counts.recurringOccurrences +
    counts.lenders +
    counts.borrowings +
    counts.borrowingRepayments +
    counts.notifications +
    counts.notificationPreferences +
    counts.pendingOutbox
  );
}

function computeDataCounts(data: BackupDataPayload): BackupRecordCounts {
  return {
    profile: data.profile ? 1 : 0,
    accounts: data.accounts.length,
    categories: data.categories.length,
    transactions: data.transactions.length,
    budgets: data.budgets.length,
    recurringRules: data.recurringRules.length,
    recurringOccurrences: data.recurringOccurrences.length,
    lenders: data.lenders.length,
    borrowings: data.borrowings.length,
    borrowingRepayments: data.borrowingRepayments.length,
    notifications: data.notifications.length,
    notificationPreferences: data.notificationPreferences ? 1 : 0,
    categoryMappings: data.categoryMappings.length,
    pendingOutbox: data.pendingOutbox.length
  };
}

function partitionOwnedRecords(
  records: readonly Record<string, unknown>[] | undefined,
  ownerUserId: string,
  storeKey: ExcludedStoreKey,
  excludedCounts: BackupExcludedRecordCounts
): Record<string, unknown>[] {
  if (!records || records.length === 0) {
    return [];
  }

  const owned: Record<string, unknown>[] = [];
  for (const record of records) {
    if (!isPlainRecord(record)) continue;
    const rawUserId = record.userId;
    if (isQuarantinedOrAmbiguousUserId(rawUserId)) {
      excludedCounts[storeKey] += 1;
      continue;
    }
    if (rawUserId === ownerUserId) {
      owned.push(clonePlainJsonValue(record));
    }
  }
  return owned;
}

function partitionCategoryRecords(
  records: readonly Record<string, unknown>[] | undefined,
  ownerUserId: string,
  excludedCounts: BackupExcludedRecordCounts
): BackupCategoryRecord[] {
  if (!records || records.length === 0) {
    return [];
  }

  const sanitized: BackupCategoryRecord[] = [];
  for (const record of records) {
    if (!isPlainRecord(record)) continue;
    const rawUserId = record.userId;

    if (isQuarantinedOrAmbiguousUserId(rawUserId)) {
      excludedCounts.categories += 1;
      continue;
    }

    const isDefault = Boolean(record.isDefault ?? record.isSystem);
    const isOwnerMatch = rawUserId === ownerUserId;
    const isLegacySystemDefault =
      isDefault &&
      (rawUserId === undefined ||
        rawUserId === null ||
        rawUserId === '' ||
        rawUserId === LEGACY_SYSTEM_NIL_UUID);

    if (!isOwnerMatch && !isLegacySystemDefault) {
      continue;
    }

    sanitized.push({
      id: String(record.id ?? ''),
      userId: isOwnerMatch ? ownerUserId : LEGACY_SYSTEM_NIL_UUID,
      name: String(record.name ?? ''),
      type: record.type as CategoryType,
      ...(record.icon !== undefined ? { icon: record.icon as string } : {}),
      ...(record.color !== undefined ? { color: record.color as string } : {}),
      isDefault,
      isArchived: Boolean(record.isArchived),
      version: typeof record.version === 'number' ? record.version : 1,
      createdAt: String(record.createdAt ?? ''),
      updatedAt: String(record.updatedAt ?? '')
    });
  }

  return sanitized;
}

function sanitizeBudgetRecords(rawBudgets: Record<string, unknown>[]): BackupBudgetRecord[] {
  return rawBudgets.map((raw) => {
    const resolvedLimit = raw.limitPaise ?? raw.limitInPaise;
    const sanitized: BackupBudgetRecord = {
      id: String(raw.id ?? ''),
      userId: String(raw.userId ?? ''),
      categoryId: String(raw.categoryId ?? ''),
      period: String(raw.period ?? ''),
      limitPaise: resolvedLimit as number,
      version: typeof raw.version === 'number' ? raw.version : 1,
      createdAt: String(raw.createdAt ?? ''),
      updatedAt: String(raw.updatedAt ?? '')
    };
    if (raw.deletedAt !== undefined) {
      sanitized.deletedAt = (raw.deletedAt as string | null) ?? null;
    }
    return sanitized;
  });
}

function sanitizeCategoryMappings(
  rawMetadata: readonly Record<string, unknown>[] | undefined,
  ownerUserId: string
): BackupCategoryMappingRecord[] {
  if (!rawMetadata || rawMetadata.length === 0) {
    return [];
  }

  const forwardPrefix = `cat_map:${ownerUserId}:`;
  const reversePrefix = `cat_rev:${ownerUserId}:`;
  const result: BackupCategoryMappingRecord[] = [];

  for (const row of rawMetadata) {
    if (!isPlainRecord(row) || typeof row.key !== 'string') continue;
    if (!row.key.startsWith(forwardPrefix) && !row.key.startsWith(reversePrefix)) {
      continue;
    }
    result.push({
      key: row.key,
      value: String(row.value ?? ''),
      updatedAt: String(row.updatedAt ?? '')
    });
  }

  return result;
}

function sanitizePendingOutbox(
  rawOutbox: readonly Record<string, unknown>[] | undefined,
  ownerUserId: string,
  excludedCounts: BackupExcludedRecordCounts
): BackupPendingOutboxRecord[] {
  const owned = partitionOwnedRecords(rawOutbox, ownerUserId, 'pendingOutbox', excludedCounts);
  return owned.map((entry) => ({
    userId: ownerUserId,
    entity: entry.entity as BackupOutboxEntity,
    entityId: String(entry.entityId ?? ''),
    operation: entry.operation as BackupOutboxOperation,
    payload: isPlainRecord(entry.payload) ? clonePlainJsonValue(entry.payload) : {},
    idempotencyKey: String(entry.idempotencyKey ?? ''),
    attempts: 0,
    createdAt: String(entry.createdAt ?? '')
  }));
}

function assertCategoryOrOwnerUserId(
  userId: unknown,
  authenticatedUserId: string,
  allowLegacySystemNil: boolean,
  store: string,
  recordId: string,
  issues: BackupValidationIssue[]
): void {
  if (isQuarantinedOrAmbiguousUserId(userId)) {
    throw new BackupIntegrityError(
      `Restorable backup store '${store}' illegally contains quarantined record '${recordId}'.`
    );
  }
  if (!isValidUuid(userId)) {
    issues.push({
      code: 'INVALID_USER_ID',
      store,
      recordId,
      message: `Record '${recordId}' in '${store}' is missing a valid user UUID.`
    });
    return;
  }
  const normalized = userId.trim();
  if (normalized === authenticatedUserId) {
    return;
  }
  if (allowLegacySystemNil && normalized === LEGACY_SYSTEM_NIL_UUID) {
    return;
  }
  throw new BackupOwnershipMismatchError(
    `Backup contains a '${store}' record belonging to another account and cannot be restored.`
  );
}

/**
 * Pure application service responsible for snapshot extraction/sanitization and
 * strict cryptographic checksum + domain + referential integrity validation.
 */
export class BackupValidationService {
  /**
   * Filters foreign-user and quarantined/ambiguous records, strips transient outbox state,
   * scopes sync metadata strictly to category mappings, and stamps manifest counts & canonical SHA-256.
   */
  public async buildSanitizedArchive(input: BuildBackupArchiveInput): Promise<BackupArchiveDocument> {
    const ownerUserId = validateUserId(input.userId);
    const dexieSchemaVersion = input.dexieSchemaVersion ?? CURRENT_DEXIE_SCHEMA_VERSION;
    if (
      !isSafePositiveInteger(dexieSchemaVersion) ||
      dexieSchemaVersion > CURRENT_DEXIE_SCHEMA_VERSION
    ) {
      throw new UnsupportedBackupVersionError(
        `Invalid local schema version ${String(dexieSchemaVersion)}.`
      );
    }

    const exportedAt = input.exportedAt ?? new Date().toISOString();
    if (!isValidIsoTimestamp(exportedAt)) {
      throw new BackupValidationError('Export timestamp must be a valid ISO-8601 date.');
    }

    const excludedCounts = createEmptyExcludedCounts(input.preExcludedQuarantinedCounts);
    const raw = input.rawStoreData ?? {};

    let sanitizedProfile: BackupProfileRecord | null = null;
    if (isPlainRecord(raw.profile) && raw.profile.id === ownerUserId) {
      sanitizedProfile = clonePlainJsonValue(raw.profile) as unknown as BackupProfileRecord;
    }

    const sanitizedPreferencesList = partitionOwnedRecords(
      raw.notificationPreferences,
      ownerUserId,
      'notificationPreferences',
      excludedCounts
    );
    const sanitizedPreferences =
      sanitizedPreferencesList.length > 0
        ? (sanitizedPreferencesList[0] as unknown as BackupNotificationPreferenceRecord)
        : null;

    const accounts = partitionOwnedRecords(
      raw.accounts,
      ownerUserId,
      'accounts',
      excludedCounts
    ) as unknown as BackupAccountRecord[];
    const categories = partitionCategoryRecords(raw.categories, ownerUserId, excludedCounts);
    const transactions = partitionOwnedRecords(
      raw.transactions,
      ownerUserId,
      'transactions',
      excludedCounts
    ) as unknown as BackupTransactionRecord[];
    const budgets = sanitizeBudgetRecords(
      partitionOwnedRecords(raw.budgets, ownerUserId, 'budgets', excludedCounts)
    );
    const recurringRules = partitionOwnedRecords(
      raw.recurringRules,
      ownerUserId,
      'recurringRules',
      excludedCounts
    ) as unknown as BackupRecurringRuleRecord[];
    const recurringOccurrences = partitionOwnedRecords(
      raw.recurringOccurrences,
      ownerUserId,
      'recurringOccurrences',
      excludedCounts
    ) as unknown as BackupRecurringOccurrenceRecord[];
    const lenders = partitionOwnedRecords(
      raw.lenders,
      ownerUserId,
      'lenders',
      excludedCounts
    ) as unknown as BackupLenderRecord[];
    const borrowings = partitionOwnedRecords(
      raw.borrowings,
      ownerUserId,
      'borrowings',
      excludedCounts
    ) as unknown as BackupBorrowingRecord[];
    const borrowingRepayments = partitionOwnedRecords(
      raw.borrowingRepayments,
      ownerUserId,
      'borrowingRepayments',
      excludedCounts
    ) as unknown as BackupBorrowingRepaymentRecord[];
    const notifications = partitionOwnedRecords(
      raw.notifications,
      ownerUserId,
      'notifications',
      excludedCounts
    ) as unknown as BackupNotificationRecord[];
    const categoryMappings = sanitizeCategoryMappings(raw.syncMetadata, ownerUserId);
    const pendingOutbox = sanitizePendingOutbox(raw.pendingOutbox, ownerUserId, excludedCounts);

    excludedCounts.total = sumExcludedCounts(excludedCounts);

    const data: BackupDataPayload = {
      profile: sanitizedProfile,
      accounts,
      categories,
      transactions,
      budgets,
      recurringRules,
      recurringOccurrences,
      lenders,
      borrowings,
      borrowingRepayments,
      notifications,
      notificationPreferences: sanitizedPreferences,
      categoryMappings,
      pendingOutbox
    };

    const payloadSha256Hex = await computeCanonicalSha256Hex(data);
    const resolvedEmail = isNonEmptyString(input.email)
      ? input.email.trim()
      : sanitizedProfile?.email;
    const resolvedCurrency = isNonEmptyString(input.currency)
      ? input.currency.trim()
      : sanitizedProfile?.currency || 'INR';

    const manifest: BackupManifest = {
      manifestVersion: BACKUP_MANIFEST_SCHEMA_VERSION,
      appName: input.appName ?? APP_CONFIG.name,
      appVersion: input.appVersion ?? APP_CONFIG.version,
      dexieSchemaVersion,
      exportedAt,
      owner: {
        userId: ownerUserId,
        ...(resolvedEmail ? { email: resolvedEmail } : {}),
        currency: resolvedCurrency
      },
      integrity: {
        algorithm: BACKUP_INTEGRITY_ALGORITHM,
        canonicalSerialization: BACKUP_CANONICAL_SERIALIZATION,
        payloadSha256Hex
      },
      counts: computeDataCounts(data),
      excludedQuarantinedCounts: excludedCounts
    };

    return { manifest, data };
  }

  /**
   * Validates a decrypted backup archive end-to-end: manifest version, schema bounds,
   * authenticated user ownership, canonical SHA-256 integrity, record counts, schema/integer
   * money invariants, complete referential integrity graph, outbox sanitization, and restore mode safety.
   */
  public async validateForRestore(
    archiveInput: unknown,
    options: RestoreValidationOptions
  ): Promise<RestorePreviewSummaryDTO> {
    const authenticatedUserId = validateUserId(options.authenticatedUserId);
    const currentSchemaVersion = options.currentDexieSchemaVersion ?? CURRENT_DEXIE_SCHEMA_VERSION;
    if (!isSafePositiveInteger(currentSchemaVersion)) {
      throw new BackupValidationError('Current application Dexie schema version must be positive.');
    }

    if (options.mode !== undefined && options.mode !== 'empty' && options.mode !== 'replace') {
      throw new BackupValidationError(
        `Unsupported restore mode '${String(options.mode)}'. Supported modes are 'empty' and 'replace'.`
      );
    }

    const archive = this.validateEnvelopeStructureAndChecksumHeader(
      archiveInput,
      authenticatedUserId,
      currentSchemaVersion
    );

    const actualSha256Hex = await computeCanonicalSha256Hex(archive.data);
    if (actualSha256Hex !== archive.manifest.integrity.payloadSha256Hex) {
      throw new BackupIntegrityError(
        'Backup SHA-256 payload checksum verification failed. Data may be corrupted or modified.'
      );
    }

    this.validateManifestCountsAndExclusions(archive.manifest, archive.data);

    const issues: BackupValidationIssue[] = [];
    const data = archive.data;

    this.validateProfileAndPreferences(data, authenticatedUserId, issues);
    const accountMap = this.validateAccounts(data.accounts, authenticatedUserId, issues);
    const categoryMap = this.validateCategories(data.categories, authenticatedUserId, issues);
    const transactionMap = this.validateTransactions(
      data.transactions,
      authenticatedUserId,
      accountMap,
      categoryMap,
      issues
    );
    this.validateBudgets(data.budgets, authenticatedUserId, categoryMap, issues);
    const lenderMap = this.validateLenders(data.lenders, authenticatedUserId, issues);
    const borrowingMap = this.validateBorrowings(
      data.borrowings,
      authenticatedUserId,
      lenderMap,
      accountMap,
      transactionMap,
      issues
    );
    this.validateBorrowingRepayments(
      data.borrowingRepayments,
      authenticatedUserId,
      borrowingMap,
      lenderMap,
      accountMap,
      transactionMap,
      issues
    );
    const recurringRuleMap = this.validateRecurringRules(
      data.recurringRules,
      authenticatedUserId,
      accountMap,
      categoryMap,
      issues
    );
    this.validateRecurringOccurrences(
      data.recurringOccurrences,
      authenticatedUserId,
      recurringRuleMap,
      transactionMap,
      issues
    );
    this.validateNotifications(data.notifications, authenticatedUserId, issues);
    this.validateCategoryMappings(data.categoryMappings, authenticatedUserId, categoryMap, issues);
    this.validatePendingOutbox(data.pendingOutbox, authenticatedUserId, issues);

    if (issues.length > 0) {
      throw new BackupValidationError(
        `Backup failed validation with ${issues.length} integrity issue(s): ${issues[0]!.message}`,
        issues
      );
    }

    return this.buildRestorePreviewAndCheckModeCompatibility(archive, categoryMap, options);
  }

  private validateEnvelopeStructureAndChecksumHeader(
    archiveInput: unknown,
    authenticatedUserId: string,
    currentSchemaVersion: number
  ): BackupArchiveDocument {
    if (!isPlainRecord(archiveInput)) {
      throw new BackupIntegrityError('Decrypted backup archive must be a valid JSON object.');
    }

    const { manifest, data } = archiveInput;
    if (!isPlainRecord(manifest) || !isPlainRecord(data)) {
      throw new BackupIntegrityError('Backup archive must contain manifest and data objects.');
    }

    if (!isSafePositiveInteger(manifest.manifestVersion)) {
      throw new BackupIntegrityError('Backup manifestVersion must be a positive safe integer.');
    }
    if (manifest.manifestVersion !== BACKUP_MANIFEST_SCHEMA_VERSION) {
      throw new UnsupportedBackupVersionError(
        `Unsupported backup manifest version ${manifest.manifestVersion}. Expected version ${BACKUP_MANIFEST_SCHEMA_VERSION}.`
      );
    }

    if (!isSafePositiveInteger(manifest.dexieSchemaVersion)) {
      throw new BackupIntegrityError('Backup dexieSchemaVersion must be a positive safe integer.');
    }
    if (manifest.dexieSchemaVersion > currentSchemaVersion) {
      throw new UnsupportedBackupVersionError(
        `Backup schema version (${manifest.dexieSchemaVersion}) is newer than this app supports (${currentSchemaVersion}). Please update LaxmiLens before restoring.`
      );
    }

    if (manifest.appName !== APP_CONFIG.name || !isNonEmptyString(manifest.appVersion)) {
      throw new BackupIntegrityError('Backup manifest app metadata is invalid.');
    }

    if (!isValidIsoTimestamp(manifest.exportedAt)) {
      throw new BackupIntegrityError('Backup manifest exportedAt timestamp is invalid.');
    }

    if (!isPlainRecord(manifest.owner) || !isValidUuid(manifest.owner.userId)) {
      throw new BackupIntegrityError('Backup manifest owner metadata is invalid.');
    }

    const backupOwnerId = manifest.owner.userId.trim();
    if (backupOwnerId !== authenticatedUserId) {
      throw new BackupOwnershipMismatchError();
    }

    if (!isNonEmptyString(manifest.owner.currency)) {
      throw new BackupIntegrityError('Backup manifest owner currency is required.');
    }

    if (!isPlainRecord(manifest.integrity)) {
      throw new BackupIntegrityError('Backup manifest integrity block is missing.');
    }

    if (
      manifest.integrity.algorithm !== BACKUP_INTEGRITY_ALGORITHM ||
      manifest.integrity.canonicalSerialization !== BACKUP_CANONICAL_SERIALIZATION ||
      typeof manifest.integrity.payloadSha256Hex !== 'string' ||
      !SHA256_HEX_REGEX.test(manifest.integrity.payloadSha256Hex)
    ) {
      throw new BackupIntegrityError('Backup manifest integrity descriptor is invalid.');
    }

    this.assertPayloadArraysExist(data);
    return archiveInput as unknown as BackupArchiveDocument;
  }

  private assertPayloadArraysExist(data: Record<string, unknown>): void {
    const requiredArrayKeys: (keyof BackupDataPayload)[] = [
      'accounts',
      'categories',
      'transactions',
      'budgets',
      'recurringRules',
      'recurringOccurrences',
      'lenders',
      'borrowings',
      'borrowingRepayments',
      'notifications',
      'categoryMappings',
      'pendingOutbox'
    ];

    for (const key of requiredArrayKeys) {
      if (!Array.isArray(data[key])) {
        throw new BackupIntegrityError(`Backup payload field '${key}' must be an array.`);
      }
    }

    if (data.profile !== null && !isPlainRecord(data.profile)) {
      throw new BackupIntegrityError("Backup payload field 'profile' must be null or an object.");
    }

    if (data.notificationPreferences !== null && !isPlainRecord(data.notificationPreferences)) {
      throw new BackupIntegrityError(
        "Backup payload field 'notificationPreferences' must be null or an object."
      );
    }
  }

  private validateManifestCountsAndExclusions(
    manifest: BackupManifest,
    data: BackupDataPayload
  ): void {
    if (!isPlainRecord(manifest.counts) || !isPlainRecord(manifest.excludedQuarantinedCounts)) {
      throw new BackupIntegrityError(
        'Backup manifest must declare counts and excludedQuarantinedCounts.'
      );
    }

    const expectedCounts = computeDataCounts(data);
    for (const key of Object.keys(expectedCounts) as (keyof BackupRecordCounts)[]) {
      const declared = manifest.counts[key];
      if (!isSafeNonNegativeInteger(declared) || declared !== expectedCounts[key]) {
        throw new BackupIntegrityError(
          `Backup manifest count mismatch for '${key}': declared ${String(declared)}, actual ${expectedCounts[key]}.`
        );
      }
    }

    const excluded = manifest.excludedQuarantinedCounts;
    const excludedStoreKeys: ExcludedStoreKey[] = [
      'accounts',
      'categories',
      'transactions',
      'budgets',
      'recurringRules',
      'recurringOccurrences',
      'lenders',
      'borrowings',
      'borrowingRepayments',
      'notifications',
      'notificationPreferences',
      'pendingOutbox'
    ];

    for (const key of excludedStoreKeys) {
      if (!isSafeNonNegativeInteger(excluded[key])) {
        throw new BackupIntegrityError(
          `Backup manifest excluded count for '${key}' must be a non-negative integer.`
        );
      }
    }

    const expectedExcludedTotal = sumExcludedCounts(excluded);
    if (!isSafeNonNegativeInteger(excluded.total) || excluded.total !== expectedExcludedTotal) {
      throw new BackupIntegrityError(
        'Backup manifest excludedQuarantinedCounts.total does not match the sum of store counts.'
      );
    }
  }

  private validateProfileAndPreferences(
    data: BackupDataPayload,
    authenticatedUserId: string,
    issues: BackupValidationIssue[]
  ): void {
    if (data.profile !== null) {
      const profile = data.profile as unknown as Record<string, unknown>;
      assertCategoryOrOwnerUserId(
        profile.id,
        authenticatedUserId,
        false,
        'profile',
        String(profile.id ?? 'profile'),
        issues
      );
      if (
        !isNonEmptyString(profile.email) ||
        !isNonEmptyString(profile.currency) ||
        !isValidIsoTimestamp(profile.createdAt) ||
        !isValidIsoTimestamp(profile.updatedAt)
      ) {
        issues.push({
          code: 'INVALID_PROFILE',
          store: 'profile',
          recordId: String(profile.id ?? ''),
          message: 'Profile record is missing required email, currency, or timestamps.'
        });
      }
    }

    if (data.notificationPreferences !== null) {
      const pref = data.notificationPreferences as unknown as Record<string, unknown>;
      assertCategoryOrOwnerUserId(
        pref.userId,
        authenticatedUserId,
        false,
        'notificationPreferences',
        String(pref.userId ?? 'preferences'),
        issues
      );
      if (
        typeof pref.recurringPaymentEnabled !== 'boolean' ||
        typeof pref.budgetWarningEnabled !== 'boolean' ||
        typeof pref.budgetExceededEnabled !== 'boolean' ||
        !isSafeNonNegativeInteger(pref.upcomingLeadDays) ||
        pref.upcomingLeadDays < MIN_UPCOMING_LEAD_DAYS ||
        pref.upcomingLeadDays > MAX_UPCOMING_LEAD_DAYS ||
        !isSafePositiveInteger(pref.version) ||
        !isValidIsoTimestamp(pref.createdAt) ||
        !isValidIsoTimestamp(pref.updatedAt)
      ) {
        issues.push({
          code: 'INVALID_NOTIFICATION_PREFERENCES',
          store: 'notificationPreferences',
          recordId: String(pref.userId ?? ''),
          message: 'Notification preference toggles, lead days, version, or timestamps are invalid.'
        });
      }
    }
  }

  private validateAccounts(
    accounts: readonly BackupAccountRecord[],
    authenticatedUserId: string,
    issues: BackupValidationIssue[]
  ): Map<string, BackupAccountRecord> {
    const map = new Map<string, BackupAccountRecord>();
    let personalBorrowingsActiveCount = 0;

    for (const raw of accounts) {
      const record = raw as unknown as Record<string, unknown>;
      const id = String(record.id ?? '');
      assertCategoryOrOwnerUserId(record.userId, authenticatedUserId, false, 'accounts', id, issues);

      if (!isValidUuid(id)) {
        issues.push({
          code: 'INVALID_ACCOUNT_ID',
          store: 'accounts',
          recordId: id,
          message: `Account ID '${id}' is not a valid UUID.`
        });
        continue;
      }

      if (map.has(id)) {
        issues.push({
          code: 'DUPLICATE_ACCOUNT_ID',
          store: 'accounts',
          recordId: id,
          message: `Duplicate account ID '${id}' in backup.`
        });
        continue;
      }

      if (
        !isNonEmptyString(record.name) ||
        !VALID_ACCOUNT_TYPES.has(record.accountType as AccountType) ||
        !isSafeInteger(record.openingBalancePaise) ||
        !isNonEmptyString(record.currency) ||
        typeof record.isArchived !== 'boolean' ||
        !isSafePositiveInteger(record.version) ||
        !isValidIsoTimestamp(record.createdAt) ||
        !isValidIsoTimestamp(record.updatedAt)
      ) {
        issues.push({
          code: 'INVALID_ACCOUNT_RECORD',
          store: 'accounts',
          recordId: id,
          message: `Account '${id}' has invalid fields or non-integer opening balance paise.`
        });
        continue;
      }

      if (record.systemTag === 'personal_borrowings' && record.isArchived === false) {
        personalBorrowingsActiveCount += 1;
        if (personalBorrowingsActiveCount > 1) {
          issues.push({
            code: 'DUPLICATE_SYSTEM_ACCOUNT',
            store: 'accounts',
            recordId: id,
            message: 'Backup contains multiple active Personal Borrowings system accounts.'
          });
        }
      }

      map.set(id, raw);
    }

    return map;
  }

  private validateCategories(
    categories: readonly BackupCategoryRecord[],
    authenticatedUserId: string,
    issues: BackupValidationIssue[]
  ): Map<string, BackupCategoryRecord> {
    const map = new Map<string, BackupCategoryRecord>();

    for (const raw of categories) {
      const record = raw as unknown as Record<string, unknown>;
      const id = String(record.id ?? '');
      const isDefault = Boolean(record.isDefault);
      assertCategoryOrOwnerUserId(
        record.userId,
        authenticatedUserId,
        isDefault,
        'categories',
        id,
        issues
      );

      if (!isValidUuid(id)) {
        issues.push({
          code: 'INVALID_CATEGORY_ID',
          store: 'categories',
          recordId: id,
          message: `Category ID '${id}' is not a valid UUID.`
        });
        continue;
      }

      if (map.has(id)) {
        issues.push({
          code: 'DUPLICATE_CATEGORY_ID',
          store: 'categories',
          recordId: id,
          message: `Duplicate category ID '${id}' in backup.`
        });
        continue;
      }

      if (
        !isNonEmptyString(record.name) ||
        !VALID_CATEGORY_TYPES.has(record.type as CategoryType) ||
        typeof record.isDefault !== 'boolean' ||
        typeof record.isArchived !== 'boolean' ||
        !isSafePositiveInteger(record.version) ||
        !isValidIsoTimestamp(record.createdAt) ||
        !isValidIsoTimestamp(record.updatedAt)
      ) {
        issues.push({
          code: 'INVALID_CATEGORY_RECORD',
          store: 'categories',
          recordId: id,
          message: `Category '${id}' has invalid metadata, type, or timestamps.`
        });
        continue;
      }

      map.set(id, raw);
    }

    return map;
  }

  private validateTransactions(
    transactions: readonly BackupTransactionRecord[],
    authenticatedUserId: string,
    accountMap: ReadonlyMap<string, BackupAccountRecord>,
    categoryMap: ReadonlyMap<string, BackupCategoryRecord>,
    issues: BackupValidationIssue[]
  ): Map<string, BackupTransactionRecord> {
    const map = new Map<string, BackupTransactionRecord>();
    const seenIdempotencyKeys = new Set<string>();

    for (const raw of transactions) {
      const record = raw as unknown as Record<string, unknown>;
      const id = String(record.id ?? '');
      assertCategoryOrOwnerUserId(
        record.userId,
        authenticatedUserId,
        false,
        'transactions',
        id,
        issues
      );

      if (!isValidUuid(id)) {
        issues.push({
          code: 'INVALID_TRANSACTION_ID',
          store: 'transactions',
          recordId: id,
          message: `Transaction ID '${id}' is not a valid UUID.`
        });
        continue;
      }

      if (map.has(id)) {
        issues.push({
          code: 'DUPLICATE_TRANSACTION_ID',
          store: 'transactions',
          recordId: id,
          message: `Duplicate transaction ID '${id}' in backup.`
        });
        continue;
      }

      const deletedAtValid = record.deletedAt === null || isValidIsoTimestamp(record.deletedAt);
      if (
        !VALID_TRANSACTION_TYPES.has(record.type as TransactionType) ||
        !isSafePositiveInteger(record.amountPaise) ||
        !isNonEmptyString(record.currency) ||
        !isNonEmptyString(record.title) ||
        !isValidIsoOrCalendarDate(record.transactionDate) ||
        !deletedAtValid ||
        !isNonEmptyString(record.idempotencyKey) ||
        !isSafePositiveInteger(record.version) ||
        !isValidIsoTimestamp(record.createdAt) ||
        !isValidIsoTimestamp(record.updatedAt)
      ) {
        issues.push({
          code: 'INVALID_TRANSACTION_RECORD',
          store: 'transactions',
          recordId: id,
          message: `Transaction '${id}' has invalid amountPaise, type, idempotencyKey, or timestamps.`
        });
        continue;
      }

      const idempotencyKey = record.idempotencyKey.trim();
      if (seenIdempotencyKeys.has(idempotencyKey)) {
        issues.push({
          code: 'DUPLICATE_TRANSACTION_IDEMPOTENCY_KEY',
          store: 'transactions',
          recordId: id,
          message: `Duplicate transaction idempotencyKey detected for '${id}'.`
        });
      }
      seenIdempotencyKeys.add(idempotencyKey);

      const accountId = String(record.accountId ?? '');
      if (!isValidUuid(accountId) || !accountMap.has(accountId)) {
        issues.push({
          code: 'MISSING_TRANSACTION_ACCOUNT',
          store: 'transactions',
          recordId: id,
          message: `Transaction '${id}' references missing account '${accountId}'.`
        });
      }

      this.validateTransactionTypeReferences(raw, accountMap, categoryMap, issues);
      map.set(id, raw);
    }

    return map;
  }

  private validateTransactionTypeReferences(
    tx: BackupTransactionRecord,
    accountMap: ReadonlyMap<string, BackupAccountRecord>,
    categoryMap: ReadonlyMap<string, BackupCategoryRecord>,
    issues: BackupValidationIssue[]
  ): void {
    const hasDestination = tx.destinationAccountId !== undefined && tx.destinationAccountId !== null;
    const hasCategory = tx.categoryId !== undefined && tx.categoryId !== null;

    if (tx.type === 'transfer') {
      if (!hasDestination || !isValidUuid(tx.destinationAccountId)) {
        issues.push({
          code: 'MISSING_TRANSFER_DESTINATION',
          store: 'transactions',
          recordId: tx.id,
          message: `Transfer '${tx.id}' must specify a valid destinationAccountId.`
        });
      } else if (tx.destinationAccountId === tx.accountId) {
        issues.push({
          code: 'TRANSFER_SAME_ACCOUNT',
          store: 'transactions',
          recordId: tx.id,
          message: `Transfer '${tx.id}' cannot use the same source and destination account.`
        });
      } else if (!accountMap.has(tx.destinationAccountId)) {
        issues.push({
          code: 'MISSING_TRANSFER_DESTINATION_ACCOUNT',
          store: 'transactions',
          recordId: tx.id,
          message: `Transfer '${tx.id}' references missing destination account '${tx.destinationAccountId}'.`
        });
      }

      if (hasCategory) {
        issues.push({
          code: 'TRANSFER_WITH_CATEGORY',
          store: 'transactions',
          recordId: tx.id,
          message: `Transfer '${tx.id}' cannot reference a category.`
        });
      }
      return;
    }

    if (hasDestination) {
      issues.push({
        code: 'NON_TRANSFER_WITH_DESTINATION',
        store: 'transactions',
        recordId: tx.id,
        message: `Non-transfer transaction '${tx.id}' cannot specify destinationAccountId.`
      });
    }

    if (hasCategory) {
      if (!isValidUuid(tx.categoryId) || !categoryMap.has(tx.categoryId)) {
        issues.push({
          code: 'MISSING_TRANSACTION_CATEGORY',
          store: 'transactions',
          recordId: tx.id,
          message: `Transaction '${tx.id}' references missing category '${String(tx.categoryId)}'.`
        });
      } else {
        const category = categoryMap.get(tx.categoryId)!;
        if (category.type !== tx.type) {
          issues.push({
            code: 'CATEGORY_TYPE_MISMATCH',
            store: 'transactions',
            recordId: tx.id,
            message: `Transaction '${tx.id}' (${tx.type}) references a '${category.type}' category.`
          });
        }
      }
    }
  }

  private validateBudgets(
    budgets: readonly BackupBudgetRecord[],
    authenticatedUserId: string,
    categoryMap: ReadonlyMap<string, BackupCategoryRecord>,
    issues: BackupValidationIssue[]
  ): void {
    const seenIds = new Set<string>();
    const activePeriodCategoryKeys = new Set<string>();

    for (const raw of budgets) {
      const record = raw as unknown as Record<string, unknown>;
      const id = String(record.id ?? '');
      assertCategoryOrOwnerUserId(record.userId, authenticatedUserId, false, 'budgets', id, issues);

      if (!isValidUuid(id)) {
        issues.push({
          code: 'INVALID_BUDGET_ID',
          store: 'budgets',
          recordId: id,
          message: `Budget ID '${id}' is not a valid UUID.`
        });
        continue;
      }

      if (seenIds.has(id)) {
        issues.push({
          code: 'DUPLICATE_BUDGET_ID',
          store: 'budgets',
          recordId: id,
          message: `Duplicate budget ID '${id}' in backup.`
        });
        continue;
      }
      seenIds.add(id);

      const deletedAtValid =
        record.deletedAt === undefined ||
        record.deletedAt === null ||
        isValidIsoTimestamp(record.deletedAt);

      if (
        typeof record.period !== 'string' ||
        !BUDGET_PERIOD_REGEX.test(record.period) ||
        !isSafePositiveInteger(record.limitPaise) ||
        !isSafePositiveInteger(record.version) ||
        !deletedAtValid ||
        !isValidIsoTimestamp(record.createdAt) ||
        !isValidIsoTimestamp(record.updatedAt)
      ) {
        issues.push({
          code: 'INVALID_BUDGET_RECORD',
          store: 'budgets',
          recordId: id,
          message: `Budget '${id}' has invalid limitPaise, period, or timestamps.`
        });
        continue;
      }

      const categoryId = String(record.categoryId ?? '');
      const category = isValidUuid(categoryId) ? categoryMap.get(categoryId) : undefined;
      if (!category) {
        issues.push({
          code: 'MISSING_BUDGET_CATEGORY',
          store: 'budgets',
          recordId: id,
          message: `Budget '${id}' references missing category '${categoryId}'.`
        });
      } else if (category.type !== 'expense') {
        issues.push({
          code: 'BUDGET_NON_EXPENSE_CATEGORY',
          store: 'budgets',
          recordId: id,
          message: `Budget '${id}' must reference an expense category.`
        });
      }

      const isActive = record.deletedAt === undefined || record.deletedAt === null;
      if (isActive) {
        const key = `${categoryId}:${record.period}`;
        if (activePeriodCategoryKeys.has(key)) {
          issues.push({
            code: 'DUPLICATE_ACTIVE_BUDGET',
            store: 'budgets',
            recordId: id,
            message: `Duplicate active budget for category '${categoryId}' in period '${record.period}'.`
          });
        }
        activePeriodCategoryKeys.add(key);
      }
    }
  }

  private validateLenders(
    lenders: readonly BackupLenderRecord[],
    authenticatedUserId: string,
    issues: BackupValidationIssue[]
  ): Map<string, BackupLenderRecord> {
    const map = new Map<string, BackupLenderRecord>();

    for (const raw of lenders) {
      const record = raw as unknown as Record<string, unknown>;
      const id = String(record.id ?? '');
      assertCategoryOrOwnerUserId(record.userId, authenticatedUserId, false, 'lenders', id, issues);

      if (!isValidUuid(id)) {
        issues.push({
          code: 'INVALID_LENDER_ID',
          store: 'lenders',
          recordId: id,
          message: `Lender ID '${id}' is not a valid UUID.`
        });
        continue;
      }

      if (map.has(id)) {
        issues.push({
          code: 'DUPLICATE_LENDER_ID',
          store: 'lenders',
          recordId: id,
          message: `Duplicate lender ID '${id}' in backup.`
        });
        continue;
      }

      if (
        !isNonEmptyString(record.name) ||
        typeof record.isArchived !== 'boolean' ||
        !isValidIsoTimestamp(record.createdAt) ||
        !isValidIsoTimestamp(record.updatedAt)
      ) {
        issues.push({
          code: 'INVALID_LENDER_RECORD',
          store: 'lenders',
          recordId: id,
          message: `Lender '${id}' has invalid name, archive flag, or timestamps.`
        });
        continue;
      }

      map.set(id, raw);
    }

    return map;
  }

  private validateBorrowings(
    borrowings: readonly BackupBorrowingRecord[],
    authenticatedUserId: string,
    lenderMap: ReadonlyMap<string, BackupLenderRecord>,
    accountMap: ReadonlyMap<string, BackupAccountRecord>,
    transactionMap: ReadonlyMap<string, BackupTransactionRecord>,
    issues: BackupValidationIssue[]
  ): Map<string, BackupBorrowingRecord> {
    const map = new Map<string, BackupBorrowingRecord>();

    for (const raw of borrowings) {
      const record = raw as unknown as Record<string, unknown>;
      const id = String(record.id ?? '');
      assertCategoryOrOwnerUserId(
        record.userId,
        authenticatedUserId,
        false,
        'borrowings',
        id,
        issues
      );

      if (!isValidUuid(id)) {
        issues.push({
          code: 'INVALID_BORROWING_ID',
          store: 'borrowings',
          recordId: id,
          message: `Borrowing ID '${id}' is not a valid UUID.`
        });
        continue;
      }

      if (map.has(id)) {
        issues.push({
          code: 'DUPLICATE_BORROWING_ID',
          store: 'borrowings',
          recordId: id,
          message: `Duplicate borrowing ID '${id}' in backup.`
        });
        continue;
      }

      const dueDateValid = record.dueDate === undefined || isValidIsoOrCalendarDate(record.dueDate);
      if (
        !isSafePositiveInteger(record.amountPaise) ||
        !isValidIsoOrCalendarDate(record.borrowingDate) ||
        !dueDateValid ||
        !VALID_BORROWING_STATUSES.has(record.status as BorrowingStatus) ||
        !isValidIsoTimestamp(record.createdAt) ||
        !isValidIsoTimestamp(record.updatedAt)
      ) {
        issues.push({
          code: 'INVALID_BORROWING_RECORD',
          store: 'borrowings',
          recordId: id,
          message: `Borrowing '${id}' has invalid amountPaise, status, or dates.`
        });
        continue;
      }

      if (!isValidUuid(record.lenderId) || !lenderMap.has(record.lenderId)) {
        issues.push({
          code: 'MISSING_BORROWING_LENDER',
          store: 'borrowings',
          recordId: id,
          message: `Borrowing '${id}' references missing lender '${String(record.lenderId)}'.`
        });
      }

      if (!isValidUuid(record.receivingAccountId) || !accountMap.has(record.receivingAccountId)) {
        issues.push({
          code: 'MISSING_BORROWING_ACCOUNT',
          store: 'borrowings',
          recordId: id,
          message: `Borrowing '${id}' references missing receiving account '${String(record.receivingAccountId)}'.`
        });
      }

      if (!isValidUuid(record.transactionId) || !transactionMap.has(record.transactionId)) {
        issues.push({
          code: 'MISSING_BORROWING_TRANSACTION',
          store: 'borrowings',
          recordId: id,
          message: `Borrowing '${id}' references missing transaction '${String(record.transactionId)}'.`
        });
      }

      map.set(id, raw);
    }

    return map;
  }

  private validateBorrowingRepayments(
    repayments: readonly BackupBorrowingRepaymentRecord[],
    authenticatedUserId: string,
    borrowingMap: ReadonlyMap<string, BackupBorrowingRecord>,
    lenderMap: ReadonlyMap<string, BackupLenderRecord>,
    accountMap: ReadonlyMap<string, BackupAccountRecord>,
    transactionMap: ReadonlyMap<string, BackupTransactionRecord>,
    issues: BackupValidationIssue[]
  ): void {
    const seenIds = new Set<string>();

    for (const raw of repayments) {
      const record = raw as unknown as Record<string, unknown>;
      const id = String(record.id ?? '');
      assertCategoryOrOwnerUserId(
        record.userId,
        authenticatedUserId,
        false,
        'borrowingRepayments',
        id,
        issues
      );

      if (!isValidUuid(id)) {
        issues.push({
          code: 'INVALID_REPAYMENT_ID',
          store: 'borrowingRepayments',
          recordId: id,
          message: `Repayment ID '${id}' is not a valid UUID.`
        });
        continue;
      }

      if (seenIds.has(id)) {
        issues.push({
          code: 'DUPLICATE_REPAYMENT_ID',
          store: 'borrowingRepayments',
          recordId: id,
          message: `Duplicate repayment ID '${id}' in backup.`
        });
        continue;
      }
      seenIds.add(id);

      if (
        !isSafePositiveInteger(record.amountPaise) ||
        !isValidIsoOrCalendarDate(record.repaymentDate) ||
        !isValidIsoTimestamp(record.createdAt) ||
        !isValidIsoTimestamp(record.updatedAt)
      ) {
        issues.push({
          code: 'INVALID_REPAYMENT_RECORD',
          store: 'borrowingRepayments',
          recordId: id,
          message: `Repayment '${id}' has invalid amountPaise or dates.`
        });
        continue;
      }

      const borrowing = isValidUuid(record.borrowingId)
        ? borrowingMap.get(record.borrowingId)
        : undefined;
      if (!borrowing) {
        issues.push({
          code: 'MISSING_REPAYMENT_BORROWING',
          store: 'borrowingRepayments',
          recordId: id,
          message: `Repayment '${id}' references missing borrowing '${String(record.borrowingId)}'.`
        });
      } else if (borrowing.lenderId !== record.lenderId) {
        issues.push({
          code: 'REPAYMENT_LENDER_MISMATCH',
          store: 'borrowingRepayments',
          recordId: id,
          message: `Repayment '${id}' lenderId does not match parent borrowing lenderId.`
        });
      }

      if (!isValidUuid(record.lenderId) || !lenderMap.has(record.lenderId)) {
        issues.push({
          code: 'MISSING_REPAYMENT_LENDER',
          store: 'borrowingRepayments',
          recordId: id,
          message: `Repayment '${id}' references missing lender '${String(record.lenderId)}'.`
        });
      }

      if (!isValidUuid(record.paymentAccountId) || !accountMap.has(record.paymentAccountId)) {
        issues.push({
          code: 'MISSING_REPAYMENT_ACCOUNT',
          store: 'borrowingRepayments',
          recordId: id,
          message: `Repayment '${id}' references missing payment account '${String(record.paymentAccountId)}'.`
        });
      }

      if (!isValidUuid(record.transactionId) || !transactionMap.has(record.transactionId)) {
        issues.push({
          code: 'MISSING_REPAYMENT_TRANSACTION',
          store: 'borrowingRepayments',
          recordId: id,
          message: `Repayment '${id}' references missing transaction '${String(record.transactionId)}'.`
        });
      }
    }
  }

  private validateRecurringRules(
    rules: readonly BackupRecurringRuleRecord[],
    authenticatedUserId: string,
    accountMap: ReadonlyMap<string, BackupAccountRecord>,
    categoryMap: ReadonlyMap<string, BackupCategoryRecord>,
    issues: BackupValidationIssue[]
  ): Map<string, BackupRecurringRuleRecord> {
    const map = new Map<string, BackupRecurringRuleRecord>();

    for (const raw of rules) {
      const record = raw as unknown as Record<string, unknown>;
      const id = String(record.id ?? '');
      assertCategoryOrOwnerUserId(
        record.userId,
        authenticatedUserId,
        false,
        'recurringRules',
        id,
        issues
      );

      if (!isValidUuid(id)) {
        issues.push({
          code: 'INVALID_RECURRING_RULE_ID',
          store: 'recurringRules',
          recordId: id,
          message: `Recurring rule ID '${id}' is not a valid UUID.`
        });
        continue;
      }

      if (map.has(id)) {
        issues.push({
          code: 'DUPLICATE_RECURRING_RULE_ID',
          store: 'recurringRules',
          recordId: id,
          message: `Duplicate recurring rule ID '${id}' in backup.`
        });
        continue;
      }

      const endDateValid =
        record.endDate === undefined ||
        record.endDate === null ||
        isValidLocalCalendarDate(record.endDate);
      const lastGeneratedValid =
        record.lastGeneratedDate === undefined ||
        record.lastGeneratedDate === null ||
        isValidLocalCalendarDate(record.lastGeneratedDate);
      const deletedAtValid =
        record.deletedAt === undefined ||
        record.deletedAt === null ||
        isValidIsoTimestamp(record.deletedAt);

      if (
        !isNonEmptyString(record.title) ||
        !VALID_RECURRING_TYPES.has(record.type as RecurringTransactionType) ||
        !isSafePositiveInteger(record.amountPaise) ||
        !VALID_RECURRING_FREQUENCIES.has(record.frequency as RecurrenceFrequency) ||
        !isSafePositiveInteger(record.interval) ||
        !isSafePositiveInteger(record.anchorDayOfMonth) ||
        record.anchorDayOfMonth > 31 ||
        !isValidLocalCalendarDate(record.startDate) ||
        !endDateValid ||
        !isValidLocalCalendarDate(record.nextDueDate) ||
        !lastGeneratedValid ||
        !VALID_RECURRING_STATUSES.has(record.status as RecurringRuleStatus) ||
        typeof record.requiresUserConfirmation !== 'boolean' ||
        !isSafePositiveInteger(record.version) ||
        !deletedAtValid ||
        !isValidIsoTimestamp(record.createdAt) ||
        !isValidIsoTimestamp(record.updatedAt)
      ) {
        issues.push({
          code: 'INVALID_RECURRING_RULE_RECORD',
          store: 'recurringRules',
          recordId: id,
          message: `Recurring rule '${id}' has invalid schedule, amountPaise, or timestamps.`
        });
        continue;
      }

      if (!isValidUuid(record.accountId) || !accountMap.has(record.accountId)) {
        issues.push({
          code: 'MISSING_RECURRING_RULE_ACCOUNT',
          store: 'recurringRules',
          recordId: id,
          message: `Recurring rule '${id}' references missing account '${String(record.accountId)}'.`
        });
      }

      if (record.categoryId !== undefined && record.categoryId !== null) {
        const category = isValidUuid(record.categoryId)
          ? categoryMap.get(record.categoryId)
          : undefined;
        if (!category) {
          issues.push({
            code: 'MISSING_RECURRING_RULE_CATEGORY',
            store: 'recurringRules',
            recordId: id,
            message: `Recurring rule '${id}' references missing category '${String(record.categoryId)}'.`
          });
        } else if (category.type !== record.type) {
          issues.push({
            code: 'RECURRING_RULE_CATEGORY_TYPE_MISMATCH',
            store: 'recurringRules',
            recordId: id,
            message: `Recurring rule '${id}' (${String(record.type)}) cannot reference a '${category.type}' category.`
          });
        }
      }

      map.set(id, raw);
    }

    return map;
  }

  private validateRecurringOccurrences(
    occurrences: readonly BackupRecurringOccurrenceRecord[],
    authenticatedUserId: string,
    recurringRuleMap: ReadonlyMap<string, BackupRecurringRuleRecord>,
    transactionMap: ReadonlyMap<string, BackupTransactionRecord>,
    issues: BackupValidationIssue[]
  ): void {
    const seenIds = new Set<string>();
    const ruleDatePairs = new Set<string>();

    for (const raw of occurrences) {
      const record = raw as unknown as Record<string, unknown>;
      const id = String(record.id ?? '');
      assertCategoryOrOwnerUserId(
        record.userId,
        authenticatedUserId,
        false,
        'recurringOccurrences',
        id,
        issues
      );

      if (!isValidUuid(id)) {
        issues.push({
          code: 'INVALID_RECURRING_OCCURRENCE_ID',
          store: 'recurringOccurrences',
          recordId: id,
          message: `Recurring occurrence ID '${id}' is not a valid UUID.`
        });
        continue;
      }

      if (seenIds.has(id)) {
        issues.push({
          code: 'DUPLICATE_RECURRING_OCCURRENCE_ID',
          store: 'recurringOccurrences',
          recordId: id,
          message: `Duplicate recurring occurrence ID '${id}' in backup.`
        });
        continue;
      }
      seenIds.add(id);

      const snoozeValid =
        record.snoozedUntilDate === undefined ||
        record.snoozedUntilDate === null ||
        isValidLocalCalendarDate(record.snoozedUntilDate);
      const confirmedAtValid =
        record.confirmedAt === undefined ||
        record.confirmedAt === null ||
        isValidIsoTimestamp(record.confirmedAt);
      const skippedAtValid =
        record.skippedAt === undefined ||
        record.skippedAt === null ||
        isValidIsoTimestamp(record.skippedAt);
      const dismissedAtValid =
        record.dismissedAt === undefined ||
        record.dismissedAt === null ||
        isValidIsoTimestamp(record.dismissedAt);
      const deletedAtValid =
        record.deletedAt === undefined ||
        record.deletedAt === null ||
        isValidIsoTimestamp(record.deletedAt);

      if (
        !isValidLocalCalendarDate(record.occurrenceDate) ||
        !VALID_OCCURRENCE_STATUSES.has(record.status as RecurringOccurrenceStatus) ||
        !snoozeValid ||
        !confirmedAtValid ||
        !skippedAtValid ||
        !dismissedAtValid ||
        !isNonEmptyString(record.idempotencyKey) ||
        !isSafePositiveInteger(record.version) ||
        !deletedAtValid ||
        !isValidIsoTimestamp(record.createdAt) ||
        !isValidIsoTimestamp(record.updatedAt)
      ) {
        issues.push({
          code: 'INVALID_RECURRING_OCCURRENCE_RECORD',
          store: 'recurringOccurrences',
          recordId: id,
          message: `Recurring occurrence '${id}' has invalid status, date, idempotencyKey, or timestamps.`
        });
        continue;
      }

      if (!isValidUuid(record.recurringRuleId) || !recurringRuleMap.has(record.recurringRuleId)) {
        issues.push({
          code: 'MISSING_OCCURRENCE_RULE',
          store: 'recurringOccurrences',
          recordId: id,
          message: `Recurring occurrence '${id}' references missing recurring rule '${String(record.recurringRuleId)}'.`
        });
      }

      if (record.transactionId !== undefined && record.transactionId !== null) {
        if (!isValidUuid(record.transactionId) || !transactionMap.has(record.transactionId)) {
          issues.push({
            code: 'MISSING_OCCURRENCE_TRANSACTION',
            store: 'recurringOccurrences',
            recordId: id,
            message: `Recurring occurrence '${id}' references missing transaction '${String(record.transactionId)}'.`
          });
        }
      }

      const ruleDateKey = `${String(record.recurringRuleId)}:${record.occurrenceDate}`;
      if (ruleDatePairs.has(ruleDateKey)) {
        issues.push({
          code: 'DUPLICATE_RECURRING_OCCURRENCE_SLOT',
          store: 'recurringOccurrences',
          recordId: id,
          message: `Duplicate occurrence for rule '${String(record.recurringRuleId)}' on '${record.occurrenceDate}'.`
        });
      }
      ruleDatePairs.add(ruleDateKey);
    }
  }

  private validateNotifications(
    notifications: readonly BackupNotificationRecord[],
    authenticatedUserId: string,
    issues: BackupValidationIssue[]
  ): void {
    const seenIds = new Set<string>();
    const seenDedupeKeys = new Set<string>();

    for (const raw of notifications) {
      const record = raw as unknown as Record<string, unknown>;
      const id = String(record.id ?? '');
      assertCategoryOrOwnerUserId(
        record.userId,
        authenticatedUserId,
        false,
        'notifications',
        id,
        issues
      );

      if (!isValidUuid(id)) {
        issues.push({
          code: 'INVALID_NOTIFICATION_ID',
          store: 'notifications',
          recordId: id,
          message: `Notification ID '${id}' is not a valid UUID.`
        });
        continue;
      }

      if (seenIds.has(id)) {
        issues.push({
          code: 'DUPLICATE_NOTIFICATION_ID',
          store: 'notifications',
          recordId: id,
          message: `Duplicate notification ID '${id}' in backup.`
        });
        continue;
      }
      seenIds.add(id);

      let validMetadataJson = false;
      if (typeof record.metadataJson === 'string') {
        try {
          const parsed = JSON.parse(record.metadataJson);
          validMetadataJson = isPlainRecord(parsed);
        } catch {
          validMetadataJson = false;
        }
      }

      const readAtValid =
        record.readAt === undefined || record.readAt === null || isValidIsoTimestamp(record.readAt);
      const dismissedAtValid =
        record.dismissedAt === undefined ||
        record.dismissedAt === null ||
        isValidIsoTimestamp(record.dismissedAt);
      const deletedAtValid =
        record.deletedAt === undefined ||
        record.deletedAt === null ||
        isValidIsoTimestamp(record.deletedAt);

      if (
        !VALID_NOTIFICATION_CATEGORIES.has(record.category as NotificationCategory) ||
        !VALID_NOTIFICATION_SEVERITIES.has(record.severity as NotificationSeverity) ||
        !VALID_NOTIFICATION_STATUSES.has(record.status as NotificationStatus) ||
        !VALID_NOTIFICATION_ENTITY_TYPES.has(record.entityType as NotificationEntityType) ||
        !isNonEmptyString(record.dedupeKey) ||
        !isNonEmptyString(record.title) ||
        !isNonEmptyString(record.message) ||
        !isValidUuid(record.entityId) ||
        !isValidLocalCalendarDate(record.triggerDate) ||
        !isNonEmptyString(record.actionRoute) ||
        !validMetadataJson ||
        !readAtValid ||
        !dismissedAtValid ||
        !deletedAtValid ||
        !isSafePositiveInteger(record.version) ||
        !isValidIsoTimestamp(record.createdAt) ||
        !isValidIsoTimestamp(record.updatedAt)
      ) {
        issues.push({
          code: 'INVALID_NOTIFICATION_RECORD',
          store: 'notifications',
          recordId: id,
          message: `Notification '${id}' has invalid enums, metadataJson, triggerDate, or timestamps.`
        });
        continue;
      }

      const dedupeKey = record.dedupeKey.trim();
      if (seenDedupeKeys.has(dedupeKey)) {
        issues.push({
          code: 'DUPLICATE_NOTIFICATION_DEDUPE_KEY',
          store: 'notifications',
          recordId: id,
          message: `Duplicate notification dedupeKey in backup for '${id}'.`
        });
      }
      seenDedupeKeys.add(dedupeKey);
    }
  }

  private validateCategoryMappings(
    mappings: readonly BackupCategoryMappingRecord[],
    authenticatedUserId: string,
    categoryMap: ReadonlyMap<string, BackupCategoryRecord>,
    issues: BackupValidationIssue[]
  ): void {
    const forwardPrefix = `cat_map:${authenticatedUserId}:`;
    const reversePrefix = `cat_rev:${authenticatedUserId}:`;
    const seenKeys = new Set<string>();
    const forwardLocalToCloud = new Map<string, string>();
    const cloudToLocalClaimedByForward = new Map<string, string>();
    const reverseEntries: Array<{ key: string; cloudId: string; localId: string }> = [];

    for (const raw of mappings) {
      const record = raw as unknown as Record<string, unknown>;
      const key = String(record.key ?? '');

      if (key.startsWith('cat_map:') || key.startsWith('cat_rev:')) {
        if (!key.startsWith(forwardPrefix) && !key.startsWith(reversePrefix)) {
          throw new BackupOwnershipMismatchError(
            'Backup contains category sync mappings belonging to another account.'
          );
        }
      } else {
        issues.push({
          code: 'INVALID_CATEGORY_MAPPING_KEY',
          store: 'categoryMappings',
          recordId: key,
          message: `Unexpected syncMetadata key '${key}' in backup categoryMappings.`
        });
        continue;
      }

      if (seenKeys.has(key)) {
        issues.push({
          code: 'DUPLICATE_CATEGORY_MAPPING_KEY',
          store: 'categoryMappings',
          recordId: key,
          message: `Duplicate category mapping key '${key}' in backup.`
        });
        continue;
      }
      seenKeys.add(key);

      if (!isNonEmptyString(record.value) || !isValidIsoTimestamp(record.updatedAt)) {
        issues.push({
          code: 'INVALID_CATEGORY_MAPPING_RECORD',
          store: 'categoryMappings',
          recordId: key,
          message: `Category mapping '${key}' is missing a valid mapped value or timestamp.`
        });
        continue;
      }

      if (key.startsWith(forwardPrefix)) {
        const localId = key.slice(forwardPrefix.length).trim();
        const cloudUuid = record.value.trim();

        if (!isNonEmptyString(localId) || !isValidUuid(cloudUuid)) {
          issues.push({
            code: 'INVALID_CATEGORY_MAPPING_UUID',
            store: 'categoryMappings',
            recordId: key,
            message: `Forward category mapping '${key}' must map to a valid cloud UUID.`
          });
          continue;
        }

        if (!categoryMap.has(localId)) {
          issues.push({
            code: 'DANGLING_CATEGORY_MAPPING',
            store: 'categoryMappings',
            recordId: key,
            message: `Category mapping '${key}' references unknown local category '${localId}'.`
          });
          continue;
        }

        const existingLocalClaim = cloudToLocalClaimedByForward.get(cloudUuid);
        if (existingLocalClaim && existingLocalClaim !== localId) {
          issues.push({
            code: 'AMBIGUOUS_CATEGORY_MAPPING',
            store: 'categoryMappings',
            recordId: key,
            message: `Cloud category '${cloudUuid}' is ambiguously claimed by multiple local categories.`
          });
          continue;
        }

        forwardLocalToCloud.set(localId, cloudUuid);
        cloudToLocalClaimedByForward.set(cloudUuid, localId);
      } else {
        const cloudUuid = key.slice(reversePrefix.length).trim();
        const localId = record.value.trim();

        if (!isValidUuid(cloudUuid) || !isNonEmptyString(localId)) {
          issues.push({
            code: 'INVALID_CATEGORY_MAPPING_UUID',
            store: 'categoryMappings',
            recordId: key,
            message: `Reverse category mapping '${key}' must use a valid cloud UUID key and local category value.`
          });
          continue;
        }

        if (!categoryMap.has(localId)) {
          issues.push({
            code: 'DANGLING_CATEGORY_MAPPING',
            store: 'categoryMappings',
            recordId: key,
            message: `Reverse category mapping '${key}' references unknown local category '${localId}'.`
          });
          continue;
        }

        reverseEntries.push({ key, cloudId: cloudUuid, localId });
      }
    }

    for (const rev of reverseEntries) {
      const forwardCloud = forwardLocalToCloud.get(rev.localId);
      if (forwardCloud && forwardCloud !== rev.cloudId) {
        issues.push({
          code: 'CATEGORY_MAPPING_ASYMMETRY',
          store: 'categoryMappings',
          recordId: rev.key,
          message: `Reverse category mapping conflicts with forward mapping for local category '${rev.localId}'.`
        });
      }

      const forwardOwner = cloudToLocalClaimedByForward.get(rev.cloudId);
      if (forwardOwner && forwardOwner !== rev.localId) {
        issues.push({
          code: 'AMBIGUOUS_CATEGORY_MAPPING',
          store: 'categoryMappings',
          recordId: rev.key,
          message: `Reverse mapping conflicts on cloud category UUID '${rev.cloudId}'.`
        });
      }
    }
  }

  private validatePendingOutbox(
    outbox: readonly BackupPendingOutboxRecord[],
    authenticatedUserId: string,
    issues: BackupValidationIssue[]
  ): void {
    for (let index = 0; index < outbox.length; index += 1) {
      const record = outbox[index] as unknown as Record<string, unknown>;
      const entityId = String(record.entityId ?? `outbox-${index}`);

      assertCategoryOrOwnerUserId(
        record.userId,
        authenticatedUserId,
        false,
        'pendingOutbox',
        entityId,
        issues
      );

      if (record.id !== undefined) {
        issues.push({
          code: 'UNSANITIZED_OUTBOX_ID',
          store: 'pendingOutbox',
          recordId: entityId,
          message: 'Backup pendingOutbox entries must not contain transient local numeric IDs.'
        });
      }

      if (record.lastAttemptAt !== undefined || record.lastError !== undefined || record.attempts !== 0) {
        issues.push({
          code: 'UNSANITIZED_OUTBOX_RETRY_STATE',
          store: 'pendingOutbox',
          recordId: entityId,
          message: 'Backup pendingOutbox retry counters and errors must be reset.'
        });
      }

      if (
        !VALID_OUTBOX_ENTITIES.has(record.entity as BackupOutboxEntity) ||
        !VALID_OUTBOX_OPERATIONS.has(record.operation as BackupOutboxOperation) ||
        !isNonEmptyString(record.entityId) ||
        !isPlainRecord(record.payload) ||
        !isNonEmptyString(record.idempotencyKey) ||
        !isValidIsoTimestamp(record.createdAt)
      ) {
        issues.push({
          code: 'INVALID_OUTBOX_ENTRY',
          store: 'pendingOutbox',
          recordId: entityId,
          message: `Pending outbox entry '${entityId}' has invalid entity, operation, payload, or timestamps.`
        });
      }
    }
  }

  private evaluateTargetCategories(
    target: BackupTargetSummary,
    authenticatedUserId: string,
    backupCategoryMap: ReadonlyMap<string, BackupCategoryRecord>
  ): {
    targetDefaultCategories: BackupCategoryRecord[];
    targetCustomCategories: BackupCategoryRecord[];
    matchedDefaultIdsCount: number;
    conflictingDefaultIdsCount: number;
    unresolvedSeededDefaultCategoryIds: string[];
  } {
    const targetCategories = target.existingCategories ?? [];
    if (
      target.existingCategories !== undefined &&
      targetCategories.length !== target.existingCounts.categories
    ) {
      throw new BackupValidationError(
        'Target category summary count does not match the supplied target categories list.',
        [
          {
            code: 'TARGET_CATEGORY_COUNT_MISMATCH',
            store: 'categories',
            message: 'Target category summary count mismatch.'
          }
        ]
      );
    }

    const seenTargetIds = new Set<string>();
    const targetDefaultCategories: BackupCategoryRecord[] = [];
    const targetCustomCategories: BackupCategoryRecord[] = [];
    const unresolvedSeededDefaultCategoryIds: string[] = [];
    let matchedDefaultIdsCount = 0;

    for (const rawTarget of targetCategories) {
      const record = rawTarget as unknown as Record<string, unknown>;
      const id = String(record.id ?? '');
      const targetIsDefault = Boolean(record.isDefault);
      const targetIssues: BackupValidationIssue[] = [];

      assertCategoryOrOwnerUserId(
        record.userId,
        authenticatedUserId,
        targetIsDefault,
        'categories',
        id,
        targetIssues
      );

      if (targetIssues.length > 0) {
        throw new BackupValidationError(targetIssues[0]!.message, targetIssues);
      }

      if (
        !isValidUuid(id) ||
        seenTargetIds.has(id) ||
        !isNonEmptyString(record.name) ||
        !VALID_CATEGORY_TYPES.has(record.type as CategoryType) ||
        typeof record.isDefault !== 'boolean'
      ) {
        throw new BackupValidationError(
          `Target database contains invalid or duplicate category '${id}'.`,
          [
            {
              code: 'INVALID_TARGET_CATEGORY',
              store: 'categories',
              recordId: id,
              message: `Target category '${id}' is invalid or duplicated.`
            }
          ]
        );
      }
      seenTargetIds.add(id);

      const backupMatch = backupCategoryMap.get(id);
      if (backupMatch) {
        if (
          backupMatch.type !== record.type ||
          backupMatch.isDefault !== targetIsDefault
        ) {
          throw new BackupValidationError(
            `Ambiguous category identity conflict on UUID '${id}': target and backup disagree on type or default status.`,
            [
              {
                code: 'AMBIGUOUS_CATEGORY_IDENTITY_CONFLICT',
                store: 'categories',
                recordId: id,
                message: `Category UUID '${id}' has conflicting type or default classification between target and backup.`
              }
            ]
          );
        }
      }

      if (targetIsDefault) {
        targetDefaultCategories.push(rawTarget);
        // Never treat display names alone as identity; require exact UUID match.
        if (backupMatch && backupMatch.isDefault) {
          matchedDefaultIdsCount += 1;
        } else {
          unresolvedSeededDefaultCategoryIds.push(id);
        }
      } else {
        targetCustomCategories.push(rawTarget);
      }
    }

    return {
      targetDefaultCategories,
      targetCustomCategories,
      matchedDefaultIdsCount,
      conflictingDefaultIdsCount: targetDefaultCategories.length - matchedDefaultIdsCount,
      unresolvedSeededDefaultCategoryIds
    };
  }

  private buildRestorePreviewAndCheckModeCompatibility(
    archive: BackupArchiveDocument,
    backupCategoryMap: ReadonlyMap<string, BackupCategoryRecord>,
    options: RestoreValidationOptions
  ): RestorePreviewSummaryDTO {
    const warnings: string[] = [];
    const target = options.targetSummary;
    const restoreOutbox = options.restorePendingOutbox ?? true;
    const backupDefaultCategories = archive.data.categories.filter((c) => c.isDefault);

    let targetHasUserData = false;
    let targetHasOnlyDefaultCategories = false;
    let targetDefaultCategories: BackupCategoryRecord[] = [];
    let matchedDefaultIdsCount = 0;
    let conflictingDefaultIdsCount = 0;
    let unresolvedSeededDefaultCategoryIds: string[] = [];

    if (target) {
      const targetUserId = validateUserId(target.authenticatedUserId);
      if (targetUserId !== options.authenticatedUserId.trim()) {
        throw new BackupOwnershipMismatchError(
          'Local target summary belongs to a different user account.'
        );
      }

      const evaluatedCategories = this.evaluateTargetCategories(
        target,
        targetUserId,
        backupCategoryMap
      );
      targetDefaultCategories = evaluatedCategories.targetDefaultCategories;
      matchedDefaultIdsCount = evaluatedCategories.matchedDefaultIdsCount;
      conflictingDefaultIdsCount = evaluatedCategories.conflictingDefaultIdsCount;
      unresolvedSeededDefaultCategoryIds = evaluatedCategories.unresolvedSeededDefaultCategoryIds;

      const targetCategoriesSupplied = target.existingCategories !== undefined;
      const c = target.existingCounts;
      const nonCategoryFinancialCount =
        c.accounts +
        c.transactions +
        c.budgets +
        c.recurringRules +
        c.recurringOccurrences +
        c.lenders +
        c.borrowings +
        c.borrowingRepayments +
        c.notifications +
        c.pendingOutbox;

      const hasCustomCategories = evaluatedCategories.targetCustomCategories.length > 0;

      targetHasUserData =
        nonCategoryFinancialCount > 0 ||
        hasCustomCategories ||
        (!targetCategoriesSupplied && c.categories > 0);

      targetHasOnlyDefaultCategories =
        !targetHasUserData && targetDefaultCategories.length > 0;
    }

    const canRestoreIntoEmpty = !targetHasUserData;
    const requiresReplaceConfirmation = targetHasUserData;

    if (options.mode === 'empty' && targetHasUserData) {
      throw new BackupValidationError(
        'Local database already contains financial data. Use explicit replace mode to overwrite existing local data.'
      );
    }

    if (options.mode === 'replace' && targetHasUserData) {
      if (options.confirmationText?.trim() !== BACKUP_REPLACE_CONFIRMATION_TEXT) {
        throw new BackupValidationError(
          `Replace restore requires typing '${BACKUP_REPLACE_CONFIRMATION_TEXT}' to confirm overwriting existing local data.`
        );
      }
      if (!options.safetyBackupConfirmed) {
        throw new BackupValidationError(
          'A safety backup of existing local data must be downloaded or confirmed before replacing local data.'
        );
      }
    }

    if (archive.manifest.excludedQuarantinedCounts.total > 0) {
      warnings.push(
        `${archive.manifest.excludedQuarantinedCounts.total} quarantined or ambiguous local record(s) were excluded when creating this backup.`
      );
    }

    if (targetHasOnlyDefaultCategories && conflictingDefaultIdsCount > 0) {
      warnings.push(
        `This device holds ${targetDefaultCategories.length} freshly seeded default categories with different UUIDs; restoring will replace them with the backup's category IDs to keep financial references intact.`
      );
    }

    const outboxCount = archive.data.pendingOutbox.length;
    if (outboxCount > 0 && !restoreOutbox) {
      warnings.push(
        `${outboxCount} pending offline sync operation(s) in this backup will not be restored.`
      );
    } else if (outboxCount > 0) {
      warnings.push(
        `${outboxCount} pending offline sync operation(s) will be restored into the sync outbox with reset retry counters.`
      );
    }

    let targetDefaultReconciliationAction: BackupCategoryIdentityContract['targetDefaultReconciliationAction'] =
      'none';
    if (targetHasOnlyDefaultCategories) {
      targetDefaultReconciliationAction =
        unresolvedSeededDefaultCategoryIds.length > 0
          ? 'replace_unused_seeded_defaults'
          : 'preserve_identical_uuids';
    }

    const categoryIdentityContract: BackupCategoryIdentityContract = {
      matchingStrategy: 'uuid-and-sync-mapping-only',
      nameOnlyMatchingPermitted: false,
      preservesBackupCategoryUuids: true,
      limitationNote:
        'Existing Dexie and Postgres schemas seed default categories with random UUIDs and no immutable template seed key; editable display names cannot be used alone to equate categories across devices. Stage 2 must preserve backup category UUIDs and categoryMappings verbatim.',
      targetDefaultReconciliationAction,
      unresolvedSeededDefaultCategoryIds
    };

    return {
      valid: true,
      manifestSummary: {
        appName: archive.manifest.appName,
        appVersion: archive.manifest.appVersion,
        dexieSchemaVersion: archive.manifest.dexieSchemaVersion,
        exportedAt: archive.manifest.exportedAt,
        ownerUserId: archive.manifest.owner.userId,
        ...(archive.manifest.owner.email ? { ownerEmail: archive.manifest.owner.email } : {}),
        currency: archive.manifest.owner.currency
      },
      modeCompatibility: {
        canRestoreIntoEmpty,
        requiresReplaceConfirmation,
        targetHasUserData,
        targetHasOnlyDefaultCategories
      },
      backupCounts: archive.manifest.counts,
      excludedQuarantinedCounts: archive.manifest.excludedQuarantinedCounts,
      ...(target ? { existingLocalCounts: target.existingCounts } : {}),
      pendingOutboxToRestoreCount: restoreOutbox ? outboxCount : 0,
      defaultCategorySummary: {
        backupDefaultCount: backupDefaultCategories.length,
        targetDefaultCount: targetDefaultCategories.length,
        matchedDefaultIdsCount,
        conflictingDefaultIdsCount
      },
      categoryIdentityContract,
      warnings
    };
  }
}

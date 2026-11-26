import { Table } from 'dexie';
import {
  BackupCategoryRecord,
  BackupExcludedRecordCounts,
  BackupOutboxEntity,
  BackupRecordCounts,
  BackupTargetSummary,
  LEGACY_SYSTEM_NIL_UUID,
  RawBackupStoreInput
} from '@/application/dto/BackupDTO';
import {
  AtomicRestoreExecutionInput,
  AtomicRestoreExecutionResult,
  BackupStoragePort,
  CapturedLocalSnapshot
} from '@/application/ports/BackupStoragePort';
import {
  isQuarantinedOrAmbiguousUserId,
  isUntouchedKnownSeededDefaultCategory
} from '@/application/services/BackupValidationService';
import {
  BackupPersistenceError,
  BackupValidationError
} from '@/domain/errors/BackupErrors';
import { validateUserId } from '@/domain/value-objects/Identifiers';
import { LaxmiLensDB } from '../DexieDatabase';
import {
  LocalAccountRecord,
  LocalBorrowingRecord,
  LocalBorrowingRepaymentRecord,
  LocalBudgetRecord,
  LocalCategoryRecord,
  LocalLenderRecord,
  LocalNotificationPreferenceRecord,
  LocalNotificationRecord,
  LocalOutboxRecord,
  LocalProfileRecord,
  LocalRecurringOccurrenceRecord,
  LocalRecurringRuleRecord,
  LocalSyncMetadataRecord,
  LocalTransactionRecord
} from '../schema';

const OUTBOX_DEPENDENCY_ORDER: Readonly<Record<BackupOutboxEntity, number>> = {
  profiles: 0,
  accounts: 1,
  categories: 2,
  budgets: 3,
  transactions: 4,
  lenders: 5,
  borrowings: 6,
  borrowing_repayments: 7,
  recurring_rules: 8,
  recurring_occurrences: 9,
  notifications: 10,
  notification_preferences: 11
};

type ExcludedStoreKey = keyof Omit<BackupExcludedRecordCounts, 'total'>;

interface PartitionResult<T extends { userId?: string }> {
  owned: T[];
  quarantinedCount: number;
}

interface ScopedStoreSnapshot {
  dexieSchemaVersion: number;
  profile: LocalProfileRecord | null;
  accounts: LocalAccountRecord[];
  categories: LocalCategoryRecord[];
  normalizedCategories: BackupCategoryRecord[];
  categoryDeleteIdsForReplace: string[];
  transactions: LocalTransactionRecord[];
  budgets: LocalBudgetRecord[];
  lenders: LocalLenderRecord[];
  borrowings: LocalBorrowingRecord[];
  borrowingRepayments: LocalBorrowingRepaymentRecord[];
  recurringRules: LocalRecurringRuleRecord[];
  recurringOccurrences: LocalRecurringOccurrenceRecord[];
  notifications: LocalNotificationRecord[];
  notificationPreferences: LocalNotificationPreferenceRecord[];
  categoryMappings: LocalSyncMetadataRecord[];
  categoryMappingDeleteKeys: string[];
  pendingOutbox: LocalOutboxRecord[];
  pendingOutboxDeleteIds: number[];
  excludedCounts: Partial<Record<ExcludedStoreKey, number>>;
  referencedCategoryIds: string[];
}

function clonePlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function partitionOwnedRows<T extends { userId?: string }>(
  rows: readonly T[],
  userId: string
): PartitionResult<T> {
  const owned: T[] = [];
  let quarantinedCount = 0;

  for (const row of rows) {
    if (isQuarantinedOrAmbiguousUserId(row.userId)) {
      quarantinedCount += 1;
      continue;
    }
    if (row.userId === userId) {
      owned.push(clonePlain(row));
    }
  }

  return { owned, quarantinedCount };
}

function isLegacySystemDefaultCategory(record: LocalCategoryRecord): boolean {
  const isDefault = Boolean(record.isDefault ?? record.isSystem);
  return (
    isDefault &&
    (record.userId === undefined ||
      record.userId === null ||
      record.userId === '' ||
      record.userId === LEGACY_SYSTEM_NIL_UUID)
  );
}

function toNormalizedBackupCategory(
  record: LocalCategoryRecord,
  ownerUserId: string
): BackupCategoryRecord {
  const isDefault = Boolean(record.isDefault ?? record.isSystem);
  const resolvedUserId =
    record.userId === ownerUserId ? ownerUserId : LEGACY_SYSTEM_NIL_UUID;

  return {
    id: record.id,
    userId: resolvedUserId,
    name: record.name,
    type: record.type,
    ...(record.icon !== undefined ? { icon: record.icon } : {}),
    ...(record.color !== undefined ? { color: record.color } : {}),
    isDefault,
    isArchived: Boolean(record.isArchived),
    version: record.version ?? 1,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function computeSnapshotCounts(snapshot: ScopedStoreSnapshot): BackupRecordCounts {
  return {
    profile: snapshot.profile ? 1 : 0,
    accounts: snapshot.accounts.length,
    categories: snapshot.normalizedCategories.length,
    transactions: snapshot.transactions.length,
    budgets: snapshot.budgets.length,
    recurringRules: snapshot.recurringRules.length,
    recurringOccurrences: snapshot.recurringOccurrences.length,
    lenders: snapshot.lenders.length,
    borrowings: snapshot.borrowings.length,
    borrowingRepayments: snapshot.borrowingRepayments.length,
    notifications: snapshot.notifications.length,
    notificationPreferences: snapshot.notificationPreferences.length > 0 ? 1 : 0,
    categoryMappings: snapshot.categoryMappings.length,
    pendingOutbox: snapshot.pendingOutbox.length
  };
}

function collectReferencedCategoryIds(
  transactions: readonly LocalTransactionRecord[],
  budgets: readonly LocalBudgetRecord[],
  recurringRules: readonly LocalRecurringRuleRecord[]
): string[] {
  const referenced = new Set<string>();
  for (const tx of transactions) {
    if (typeof tx.categoryId === 'string' && tx.categoryId.trim().length > 0) {
      referenced.add(tx.categoryId);
    }
  }
  for (const budget of budgets) {
    if (typeof budget.categoryId === 'string' && budget.categoryId.trim().length > 0) {
      referenced.add(budget.categoryId);
    }
  }
  for (const rule of recurringRules) {
    if (typeof rule.categoryId === 'string' && rule.categoryId.trim().length > 0) {
      referenced.add(rule.categoryId);
    }
  }
  return Array.from(referenced);
}

const databaseInstanceIdentityMap = new WeakMap<object, string>();

function getOrCreateDatabaseInstanceId(database: object): string {
  let instanceId = databaseInstanceIdentityMap.get(database);
  if (!instanceId) {
    instanceId = globalThis.crypto.randomUUID();
    databaseInstanceIdentityMap.set(database, instanceId);
  }
  return instanceId;
}

/**
 * Dexie IndexedDB persistence adapter for Phase 11 local backup snapshots and
 * atomic 14-store transactional restores.
 */
export class DexieBackupRepository implements BackupStoragePort {
  private readonly databaseIdentity: string;

  constructor(
    private readonly database: LaxmiLensDB,
    databaseIdentityOverride?: string
  ) {
    const dbName = typeof database.name === 'string' && database.name.trim().length > 0
      ? database.name.trim()
      : 'LaxmiLensDB';
    this.databaseIdentity =
      databaseIdentityOverride ?? `${dbName}#${getOrCreateDatabaseInstanceId(database)}`;
  }

  public getDatabaseIdentity(): string {
    return this.databaseIdentity;
  }

  public getDexieSchemaVersion(): number {
    const version = this.database.verno;
    if (typeof version !== 'number' || !Number.isSafeInteger(version) || version <= 0) {
      throw new BackupPersistenceError(
        `Invalid local Dexie schema version '${String(version)}'.`
      );
    }
    return version;
  }

  public async captureUserSnapshot(userId: string): Promise<CapturedLocalSnapshot> {
    const validatedUserId = validateUserId(userId);
    const stores = this.getAll14Tables();

    return this.database.transaction('r', stores, async () => {
      const snapshot = await this.readUserScopedSnapshot(validatedUserId);

      const rawStoreData: RawBackupStoreInput = {
        profile: snapshot.profile as unknown as Record<string, unknown> | null,
        accounts: snapshot.accounts as unknown as Record<string, unknown>[],
        categories: snapshot.normalizedCategories as unknown as Record<string, unknown>[],
        transactions: snapshot.transactions as unknown as Record<string, unknown>[],
        budgets: snapshot.budgets as unknown as Record<string, unknown>[],
        recurringRules: snapshot.recurringRules as unknown as Record<string, unknown>[],
        recurringOccurrences:
          snapshot.recurringOccurrences as unknown as Record<string, unknown>[],
        lenders: snapshot.lenders as unknown as Record<string, unknown>[],
        borrowings: snapshot.borrowings as unknown as Record<string, unknown>[],
        borrowingRepayments:
          snapshot.borrowingRepayments as unknown as Record<string, unknown>[],
        notifications: snapshot.notifications as unknown as Record<string, unknown>[],
        notificationPreferences:
          snapshot.notificationPreferences as unknown as Record<string, unknown>[],
        syncMetadata: snapshot.categoryMappings as unknown as Record<string, unknown>[],
        pendingOutbox: snapshot.pendingOutbox as unknown as Record<string, unknown>[]
      };

      return {
        dexieSchemaVersion: snapshot.dexieSchemaVersion,
        rawStoreData,
        preExcludedQuarantinedCounts: snapshot.excludedCounts
      };
    });
  }

  public async getTargetRestoreSummary(userId: string): Promise<BackupTargetSummary> {
    const validatedUserId = validateUserId(userId);
    const stores = this.getAll14Tables();

    return this.database.transaction('r', stores, async () => {
      const snapshot = await this.readUserScopedSnapshot(validatedUserId);
      return {
        authenticatedUserId: validatedUserId,
        currentDexieSchemaVersion: snapshot.dexieSchemaVersion,
        existingCounts: computeSnapshotCounts(snapshot),
        existingCategories: snapshot.normalizedCategories,
        referencedCategoryIds: snapshot.referencedCategoryIds
      };
    });
  }

  public async executeAtomicRestore(
    input: AtomicRestoreExecutionInput
  ): Promise<AtomicRestoreExecutionResult> {
    const validatedUserId = validateUserId(input.userId);
    const stores = this.getAll14Tables();
    const dexieVersion = this.getDexieSchemaVersion();

    try {
      return await this.database.transaction('rw', stores, async () => {
        const preSnapshot = await this.readUserScopedSnapshot(validatedUserId);
        let replacedSeededDefaultCategoryIds: string[] = [];

        if (input.mode === 'empty') {
          replacedSeededDefaultCategoryIds = await this.prepareEmptyModeTarget(
            preSnapshot,
            input.unusedSeededDefaultCategoryIdsToDelete
          );
        } else {
          await this.clearUserStoresForReplace(validatedUserId, preSnapshot);
        }

        const restoredOutboxCount = await this.writeRestoredArchiveStores(
          validatedUserId,
          input
        );

        await this.verifyPostCommitStateInTransaction(
          validatedUserId,
          dexieVersion,
          input,
          replacedSeededDefaultCategoryIds
        );

        return {
          restoredCounts: {
            ...input.archive.manifest.counts,
            pendingOutbox: restoredOutboxCount
          },
          restoredOutboxCount,
          replacedSeededDefaultCategoryIds
        };
      });
    } catch (error) {
      if (error instanceof BackupValidationError || error instanceof BackupPersistenceError) {
        throw error;
      }
      throw new BackupPersistenceError(
        error instanceof Error
          ? `Atomic restore aborted and rolled back: ${error.message}`
          : 'Atomic restore aborted and rolled back due to a local database write failure.'
      );
    }
  }

  private getAll14Tables(): Table<unknown, unknown>[] {
    const tables: Array<[string, Table<unknown, unknown> | undefined]> = [
      ['profiles', this.database.profiles as Table<unknown, unknown>],
      ['accounts', this.database.accounts as Table<unknown, unknown>],
      ['categories', this.database.categories as Table<unknown, unknown>],
      ['transactions', this.database.transactions as Table<unknown, unknown>],
      ['budgets', this.database.budgets as Table<unknown, unknown>],
      ['lenders', this.database.lenders as Table<unknown, unknown>],
      ['borrowings', this.database.borrowings as Table<unknown, unknown>],
      ['borrowingRepayments', this.database.borrowingRepayments as Table<unknown, unknown>],
      ['recurringRules', this.database.recurringRules as Table<unknown, unknown>],
      ['recurringOccurrences', this.database.recurringOccurrences as Table<unknown, unknown>],
      ['notifications', this.database.notifications as Table<unknown, unknown>],
      [
        'notificationPreferences',
        this.database.notificationPreferences as Table<unknown, unknown>
      ],
      ['syncOutbox', this.database.syncOutbox as Table<unknown, unknown>],
      ['syncMetadata', this.database.syncMetadata as Table<unknown, unknown>]
    ];

    const resolved: Table<unknown, unknown>[] = [];
    for (const [name, table] of tables) {
      if (!table) {
        throw new BackupPersistenceError(
          `Required local IndexedDB store '${name}' is unavailable.`
        );
      }
      resolved.push(table);
    }
    return resolved;
  }

  private async readUserScopedSnapshot(userId: string): Promise<ScopedStoreSnapshot> {
    const dexieSchemaVersion = this.getDexieSchemaVersion();

    const [
      profileRow,
      allAccounts,
      allCategories,
      allTransactions,
      allBudgets,
      allLenders,
      allBorrowings,
      allRepayments,
      allRules,
      allOccurrences,
      allNotifications,
      allPreferences,
      allMetadata,
      allOutbox
    ] = await Promise.all([
      this.database.profiles.get(userId),
      this.database.accounts.toArray(),
      this.database.categories.toArray(),
      this.database.transactions.toArray(),
      this.database.budgets.toArray(),
      this.database.lenders.toArray(),
      this.database.borrowings.toArray(),
      this.database.borrowingRepayments.toArray(),
      this.database.recurringRules.toArray(),
      this.database.recurringOccurrences.toArray(),
      this.database.notifications.toArray(),
      this.database.notificationPreferences.toArray(),
      this.database.syncMetadata.toArray(),
      this.database.syncOutbox.toArray()
    ]);

    const accounts = partitionOwnedRows(allAccounts, userId);
    const transactions = partitionOwnedRows(allTransactions, userId);
    const budgets = partitionOwnedRows(allBudgets, userId);
    const lenders = partitionOwnedRows(allLenders, userId);
    const borrowings = partitionOwnedRows(allBorrowings, userId);
    const borrowingRepayments = partitionOwnedRows(allRepayments, userId);
    const recurringRules = partitionOwnedRows(allRules, userId);
    const recurringOccurrences = partitionOwnedRows(allOccurrences, userId);
    const notifications = partitionOwnedRows(allNotifications, userId);
    const notificationPreferences = partitionOwnedRows(allPreferences, userId);

    const sortedOutbox = [...allOutbox].sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
    const pendingOutbox = partitionOwnedRows(sortedOutbox, userId);
    const pendingOutboxDeleteIds = pendingOutbox.owned
      .map((entry) => entry.id)
      .filter((id): id is number => typeof id === 'number');

    const rawCategories: LocalCategoryRecord[] = [];
    const normalizedCategories: BackupCategoryRecord[] = [];
    const categoryDeleteIdsForReplace: string[] = [];
    let categoryQuarantinedCount = 0;

    for (const cat of allCategories) {
      if (isQuarantinedOrAmbiguousUserId(cat.userId)) {
        categoryQuarantinedCount += 1;
        continue;
      }
      if (cat.userId === userId || isLegacySystemDefaultCategory(cat)) {
        const cloned = clonePlain(cat);
        rawCategories.push(cloned);
        normalizedCategories.push(toNormalizedBackupCategory(cloned, userId));
        categoryDeleteIdsForReplace.push(cloned.id);
      }
    }

    const forwardPrefix = `cat_map:${userId}:`;
    const reversePrefix = `cat_rev:${userId}:`;
    const categoryMappings = allMetadata
      .filter(
        (m) =>
          typeof m.key === 'string' &&
          (m.key.startsWith(forwardPrefix) || m.key.startsWith(reversePrefix))
      )
      .map((m) => clonePlain(m));

    const referencedCategoryIds = collectReferencedCategoryIds(
      transactions.owned,
      budgets.owned,
      recurringRules.owned
    );

    const excludedCounts: Partial<Record<ExcludedStoreKey, number>> = {};
    const pairs: Array<[ExcludedStoreKey, number]> = [
      ['accounts', accounts.quarantinedCount],
      ['categories', categoryQuarantinedCount],
      ['transactions', transactions.quarantinedCount],
      ['budgets', budgets.quarantinedCount],
      ['lenders', lenders.quarantinedCount],
      ['borrowings', borrowings.quarantinedCount],
      ['borrowingRepayments', borrowingRepayments.quarantinedCount],
      ['recurringRules', recurringRules.quarantinedCount],
      ['recurringOccurrences', recurringOccurrences.quarantinedCount],
      ['notifications', notifications.quarantinedCount],
      ['notificationPreferences', notificationPreferences.quarantinedCount],
      ['pendingOutbox', pendingOutbox.quarantinedCount]
    ];
    for (const [key, count] of pairs) {
      if (count > 0) {
        excludedCounts[key] = count;
      }
    }

    return {
      dexieSchemaVersion,
      profile: profileRow && profileRow.id === userId ? clonePlain(profileRow) : null,
      accounts: accounts.owned,
      categories: rawCategories,
      normalizedCategories,
      categoryDeleteIdsForReplace,
      transactions: transactions.owned,
      budgets: budgets.owned,
      lenders: lenders.owned,
      borrowings: borrowings.owned,
      borrowingRepayments: borrowingRepayments.owned,
      recurringRules: recurringRules.owned,
      recurringOccurrences: recurringOccurrences.owned,
      notifications: notifications.owned,
      notificationPreferences: notificationPreferences.owned,
      categoryMappings,
      categoryMappingDeleteKeys: categoryMappings.map((m) => m.key),
      pendingOutbox: pendingOutbox.owned,
      pendingOutboxDeleteIds,
      excludedCounts,
      referencedCategoryIds
    };
  }

  private async prepareEmptyModeTarget(
    preSnapshot: ScopedStoreSnapshot,
    unusedSeededDefaultCategoryIdsToDelete: readonly string[]
  ): Promise<string[]> {
    const counts = computeSnapshotCounts(preSnapshot);
    const nonCategoryCount =
      counts.profile +
      counts.accounts +
      counts.transactions +
      counts.budgets +
      counts.recurringRules +
      counts.recurringOccurrences +
      counts.lenders +
      counts.borrowings +
      counts.borrowingRepayments +
      counts.notifications +
      counts.notificationPreferences +
      counts.pendingOutbox;

    if (nonCategoryCount > 0) {
      throw new BackupValidationError(
        'Cannot execute empty restore because the local database contains user financial records.'
      );
    }

    const referencedSet = new Set(preSnapshot.referencedCategoryIds);
    const existingCategoryMap = new Map(
      preSnapshot.normalizedCategories.map((c) => [c.id, c])
    );

    const customCategories = preSnapshot.normalizedCategories.filter((c) => !c.isDefault);
    if (customCategories.length > 0) {
      throw new BackupValidationError(
        'Cannot execute empty restore because custom local categories already exist.'
      );
    }

    const idsToDelete: string[] = [];
    for (const candidateId of unusedSeededDefaultCategoryIdsToDelete) {
      if (referencedSet.has(candidateId)) {
        throw new BackupValidationError(
          `Cannot delete seeded default category '${candidateId}' because financial records reference it.`
        );
      }

      const category = existingCategoryMap.get(candidateId);
      if (!category) {
        continue;
      }

      if (!isUntouchedKnownSeededDefaultCategory(category)) {
        throw new BackupValidationError(
          `Cannot remove category '${candidateId}' during empty restore because it is not an unmodified system-seeded default.`
        );
      }

      idsToDelete.push(candidateId);
    }

    if (idsToDelete.length > 0) {
      await this.database.categories.bulkDelete(idsToDelete);
    }

    return idsToDelete;
  }

  private async clearUserStoresForReplace(
    userId: string,
    preSnapshot: ScopedStoreSnapshot
  ): Promise<void> {
    if (preSnapshot.profile) {
      await this.database.profiles.delete(userId);
    }

    if (preSnapshot.accounts.length > 0) {
      await this.database.accounts.bulkDelete(preSnapshot.accounts.map((r) => r.id));
    }

    if (preSnapshot.categoryDeleteIdsForReplace.length > 0) {
      await this.database.categories.bulkDelete(preSnapshot.categoryDeleteIdsForReplace);
    }

    if (preSnapshot.transactions.length > 0) {
      await this.database.transactions.bulkDelete(preSnapshot.transactions.map((r) => r.id));
    }

    if (preSnapshot.budgets.length > 0) {
      await this.database.budgets.bulkDelete(preSnapshot.budgets.map((r) => r.id));
    }

    if (preSnapshot.lenders.length > 0) {
      await this.database.lenders.bulkDelete(preSnapshot.lenders.map((r) => r.id));
    }

    if (preSnapshot.borrowings.length > 0) {
      await this.database.borrowings.bulkDelete(preSnapshot.borrowings.map((r) => r.id));
    }

    if (preSnapshot.borrowingRepayments.length > 0) {
      await this.database.borrowingRepayments.bulkDelete(
        preSnapshot.borrowingRepayments.map((r) => r.id)
      );
    }

    if (preSnapshot.recurringRules.length > 0) {
      await this.database.recurringRules.bulkDelete(preSnapshot.recurringRules.map((r) => r.id));
    }

    if (preSnapshot.recurringOccurrences.length > 0) {
      await this.database.recurringOccurrences.bulkDelete(
        preSnapshot.recurringOccurrences.map((r) => r.id)
      );
    }

    if (preSnapshot.notifications.length > 0) {
      await this.database.notifications.bulkDelete(preSnapshot.notifications.map((r) => r.id));
    }

    if (preSnapshot.notificationPreferences.length > 0) {
      await this.database.notificationPreferences.delete(userId);
    }

    if (preSnapshot.categoryMappingDeleteKeys.length > 0) {
      await this.database.syncMetadata.bulkDelete(preSnapshot.categoryMappingDeleteKeys);
    }

    if (preSnapshot.pendingOutboxDeleteIds.length > 0) {
      await this.database.syncOutbox.bulkDelete(preSnapshot.pendingOutboxDeleteIds);
    }
  }

  private async writeRestoredArchiveStores(
    _userId: string,
    input: AtomicRestoreExecutionInput
  ): Promise<number> {
    const { data } = input.archive;

    if (data.profile) {
      await this.database.profiles.put(clonePlain(data.profile));
    }

    if (data.categories.length > 0) {
      await this.database.categories.bulkPut(
        data.categories.map((cat) => clonePlain(cat) as unknown as LocalCategoryRecord)
      );
    }

    if (data.accounts.length > 0) {
      await this.database.accounts.bulkPut(
        data.accounts.map((acc) => clonePlain(acc) as unknown as LocalAccountRecord)
      );
    }

    if (data.lenders.length > 0) {
      await this.database.lenders.bulkPut(
        data.lenders.map((lender) => clonePlain(lender) as unknown as LocalLenderRecord)
      );
    }

    if (data.transactions.length > 0) {
      await this.database.transactions.bulkPut(
        data.transactions.map((tx) => clonePlain(tx) as unknown as LocalTransactionRecord)
      );
    }

    if (data.budgets.length > 0) {
      await this.database.budgets.bulkPut(
        data.budgets.map((budget) => clonePlain(budget) as unknown as LocalBudgetRecord)
      );
    }

    if (data.borrowings.length > 0) {
      await this.database.borrowings.bulkPut(
        data.borrowings.map((borrowing) => clonePlain(borrowing) as unknown as LocalBorrowingRecord)
      );
    }

    if (data.borrowingRepayments.length > 0) {
      await this.database.borrowingRepayments.bulkPut(
        data.borrowingRepayments.map(
          (repayment) => clonePlain(repayment) as unknown as LocalBorrowingRepaymentRecord
        )
      );
    }

    if (data.recurringRules.length > 0) {
      await this.database.recurringRules.bulkPut(
        data.recurringRules.map(
          (rule) => clonePlain(rule) as unknown as LocalRecurringRuleRecord
        )
      );
    }

    if (data.recurringOccurrences.length > 0) {
      await this.database.recurringOccurrences.bulkPut(
        data.recurringOccurrences.map(
          (occ) => clonePlain(occ) as unknown as LocalRecurringOccurrenceRecord
        )
      );
    }

    if (data.notifications.length > 0) {
      await this.database.notifications.bulkPut(
        data.notifications.map(
          (notif) => clonePlain(notif) as unknown as LocalNotificationRecord
        )
      );
    }

    if (data.notificationPreferences) {
      await this.database.notificationPreferences.put(
        clonePlain(data.notificationPreferences) as unknown as LocalNotificationPreferenceRecord
      );
    }

    if (data.categoryMappings.length > 0) {
      await this.database.syncMetadata.bulkPut(
        data.categoryMappings.map((m) => clonePlain(m) as unknown as LocalSyncMetadataRecord)
      );
    }

    if (input.restorePendingOutbox && data.pendingOutbox.length > 0) {
      const orderedOutbox = [...data.pendingOutbox].sort((a, b) => {
        const rankA = OUTBOX_DEPENDENCY_ORDER[a.entity] ?? 999;
        const rankB = OUTBOX_DEPENDENCY_ORDER[b.entity] ?? 999;
        return rankA - rankB;
      });

      const outboxToInsert: LocalOutboxRecord[] = orderedOutbox.map((entry) => ({
        userId: entry.userId,
        entity: entry.entity,
        entityId: entry.entityId,
        operation: entry.operation,
        payload: clonePlain(entry.payload),
        idempotencyKey: entry.idempotencyKey,
        attempts: 0,
        createdAt: entry.createdAt
      }));

      await this.database.syncOutbox.bulkAdd(outboxToInsert);
      return outboxToInsert.length;
    }

    return 0;
  }

  private async verifyPostCommitStateInTransaction(
    userId: string,
    dexieVersion: number,
    input: AtomicRestoreExecutionInput,
    deletedCategoryIds: readonly string[]
  ): Promise<void> {
    const postSnapshot = await this.readUserScopedSnapshot(userId);
    const postCounts = computeSnapshotCounts(postSnapshot);
    const expected = input.archive.manifest.counts;
    const expectedOutboxCount = input.restorePendingOutbox ? expected.pendingOutbox : 0;

    const countKeys: Array<[keyof BackupRecordCounts, number]> = [
      ['profile', expected.profile],
      ['accounts', expected.accounts],
      ['categories', expected.categories],
      ['transactions', expected.transactions],
      ['budgets', expected.budgets],
      ['recurringRules', expected.recurringRules],
      ['recurringOccurrences', expected.recurringOccurrences],
      ['lenders', expected.lenders],
      ['borrowings', expected.borrowings],
      ['borrowingRepayments', expected.borrowingRepayments],
      ['notifications', expected.notifications],
      ['notificationPreferences', expected.notificationPreferences],
      ['categoryMappings', expected.categoryMappings],
      ['pendingOutbox', expectedOutboxCount]
    ];

    for (const [key, expectedValue] of countKeys) {
      if (postCounts[key] !== expectedValue) {
        throw new BackupPersistenceError(
          `Post-write consistency check failed for '${key}': expected ${expectedValue}, found ${postCounts[key]}.`
        );
      }
    }

    if (deletedCategoryIds.length > 0) {
      const remainingCategoryIds = new Set(postSnapshot.normalizedCategories.map((c) => c.id));
      const backupCategoryIds = new Set(input.archive.data.categories.map((c) => c.id));
      for (const deletedId of deletedCategoryIds) {
        if (!backupCategoryIds.has(deletedId) && remainingCategoryIds.has(deletedId)) {
          throw new BackupPersistenceError(
            `Unused seeded default category '${deletedId}' was not cleanly removed before commit.`
          );
        }
      }
    }

    for (const outboxEntry of postSnapshot.pendingOutbox) {
      if (
        typeof outboxEntry.id !== 'number' ||
        !Number.isSafeInteger(outboxEntry.id) ||
        outboxEntry.id <= 0 ||
        outboxEntry.attempts !== 0 ||
        outboxEntry.lastAttemptAt !== undefined ||
        outboxEntry.lastError !== undefined
      ) {
        throw new BackupPersistenceError(
          'Restored sync outbox entry failed regenerated ID or reset retry verification.'
        );
      }
    }

    // Re-validate complete post-write dataset via Stage 1 validation before transaction commits
    const postArchive = await input.validator.buildSanitizedArchive({
      userId,
      ...(input.archive.manifest.owner.email ? { email: input.archive.manifest.owner.email } : {}),
      currency: input.archive.manifest.owner.currency,
      dexieSchemaVersion: dexieVersion,
      exportedAt: input.archive.manifest.exportedAt,
      rawStoreData: {
        profile: postSnapshot.profile as unknown as Record<string, unknown> | null,
        accounts: postSnapshot.accounts as unknown as Record<string, unknown>[],
        categories: postSnapshot.normalizedCategories as unknown as Record<string, unknown>[],
        transactions: postSnapshot.transactions as unknown as Record<string, unknown>[],
        budgets: postSnapshot.budgets as unknown as Record<string, unknown>[],
        recurringRules: postSnapshot.recurringRules as unknown as Record<string, unknown>[],
        recurringOccurrences:
          postSnapshot.recurringOccurrences as unknown as Record<string, unknown>[],
        lenders: postSnapshot.lenders as unknown as Record<string, unknown>[],
        borrowings: postSnapshot.borrowings as unknown as Record<string, unknown>[],
        borrowingRepayments:
          postSnapshot.borrowingRepayments as unknown as Record<string, unknown>[],
        notifications: postSnapshot.notifications as unknown as Record<string, unknown>[],
        notificationPreferences:
          postSnapshot.notificationPreferences as unknown as Record<string, unknown>[],
        syncMetadata: postSnapshot.categoryMappings as unknown as Record<string, unknown>[],
        pendingOutbox: postSnapshot.pendingOutbox as unknown as Record<string, unknown>[]
      }
    });

    await input.validator.validateForRestore(postArchive, {
      authenticatedUserId: userId,
      currentDexieSchemaVersion: dexieVersion
    });
  }
}

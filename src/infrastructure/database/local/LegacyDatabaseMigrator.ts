import Dexie, { type Table } from 'dexie';
import { LaxmiLensDB } from './DexieDatabase';
import {
  LocalAccountRecord,
  LocalTransactionRecord,
  LocalCategoryRecord,
  LocalProfileRecord,
  LocalOutboxRecord,
  LocalSyncMetadataRecord
} from './schema';
import { validateUserId, isValidUuid } from '@/domain/value-objects/Identifiers';
import {
  MigrationConflictError,
  DiagnosticIntegrityError
} from './errors/DatabaseErrors';

export { DiagnosticIntegrityError };

export const LEGACY_DATABASE_NAME = 'LaxmiLens_LocalDB';
export const FORMER_EXCLUDED_USER_ID = 'd94ba0c6-c43a-4fb6-9e49-218f499e6695';
export const NIL_UUID = '00000000-0000-0000-0000-000000000000';
export const SENTINEL_LOCAL_USER = 'local-user';

export interface MigrationConflictRecord {
  entity: 'categories' | 'transactions' | 'accounts' | 'syncOutbox';
  entityId: string;
  name?: string;
  ownerValue?: string;
  reason: string;
  referencingTransactionIds?: string[];
}

export interface UnresolvedCategoryReference {
  transactionId: string;
  categoryId: string;
}

export interface MigrationSummary {
  userId: string;
  accountsMigrated: number;
  transactionsMigrated: number;
  categoriesMigrated: number;
  profilesMigrated: number;
  outboxEntriesMigrated: number;
  skippedForeignRecords: number;
  skippedAmbiguousRecords: number;
  alreadyMigratedRecords: number;
  isComplete: boolean;
  errors: string[];
  conflicts: MigrationConflictRecord[];
  unresolvedCategoryReferences: UnresolvedCategoryReference[];
}

export interface LegacyInspectionDb {
  isOpen(): boolean;
  open(): Promise<any>;
  close(): void | Promise<void>;
  tables?: Table<any, any>[];
  table?<T = any, Key = any>(tableName: string): Table<T, Key>;
  transaction?<T>(mode: string, tables: any[], fn: () => Promise<T>): Promise<T>;
  [key: string]: any;
}

export class LegacyDatabaseMigrator {
  private inFlightMigrations = new Map<string, Promise<MigrationSummary>>();

  constructor(
    private readonly legacyDbFactory: () => LegacyInspectionDb = () => new Dexie(LEGACY_DATABASE_NAME),
    private readonly existenceChecker: (name: string) => Promise<boolean> = (name) => Dexie.exists(name)
  ) {}

  public getMigrationMarkerKey(userId: string): string {
    const validated = validateUserId(userId);
    return `legacy_migration_${validated}`;
  }

  public getMigrationDiagnosticsKey(userId: string): string {
    const validated = validateUserId(userId);
    return `legacy_migration_diagnostics_${validated}`;
  }

  public async hasMigrated(userId: string, targetDb: LaxmiLensDB): Promise<boolean> {
    const key = this.getMigrationMarkerKey(userId);
    try {
      const record = await targetDb.syncMetadata.get(key);
      if (!record || typeof record.value !== 'string') return false;
      return (
        record.value === 'completed' ||
        record.value === 'completed_with_quarantined_conflicts' ||
        record.value === 'completed_no_legacy_db'
      );
    } catch {
      return false;
    }
  }

  public async getPersistedDiagnostics(
    userId: string,
    targetDb: LaxmiLensDB
  ): Promise<{
    conflicts: MigrationConflictRecord[];
    unresolvedCategoryReferences: UnresolvedCategoryReference[];
  } | null> {
    const validatedUserId = validateUserId(userId);
    const key = this.getMigrationDiagnosticsKey(validatedUserId);
    const expectedMarkerKey = this.getMigrationMarkerKey(validatedUserId);

    let record: LocalSyncMetadataRecord | null | undefined;
    try {
      record = await targetDb.syncMetadata.get(key);
    } catch (readErr) {
      throw new DiagnosticIntegrityError(
        `Failed to read diagnostic record from store for user '${validatedUserId}': ${readErr instanceof Error ? readErr.message : String(readErr)}`
      );
    }

    // 1. Genuinely missing diagnostics record returns null
    if (!record || record.value === undefined || record.value === null) {
      return null;
    }

    // 2. Parse JSON; malformed JSON produces an explicit retrieval error
    let parsed: any;
    try {
      parsed = JSON.parse(record.value);
    } catch (jsonErr) {
      throw new DiagnosticIntegrityError(
        `Malformed diagnostics JSON in store '${key}': ${jsonErr instanceof Error ? jsonErr.message : String(jsonErr)}`
      );
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new DiagnosticIntegrityError(
        `Invalid diagnostics record payload in store '${key}': expected object, received ${typeof parsed}`
      );
    }

    // 3. Validate user ID match
    if (!parsed.userId || typeof parsed.userId !== 'string') {
      throw new DiagnosticIntegrityError(
        `Missing or invalid userId in diagnostics record for store '${key}'`
      );
    }
    if (parsed.userId.trim().toLowerCase() !== validatedUserId.toLowerCase()) {
      throw new DiagnosticIntegrityError(
        `Mismatched userId in diagnostics record: expected '${validatedUserId}', found '${parsed.userId}'`
      );
    }

    // 4. Validate migration marker reference match
    if (!parsed.migrationMarker || typeof parsed.migrationMarker !== 'string') {
      throw new DiagnosticIntegrityError(
        `Missing or invalid migrationMarker reference in diagnostics record for store '${key}'`
      );
    }
    if (parsed.migrationMarker !== expectedMarkerKey) {
      throw new DiagnosticIntegrityError(
        `Mismatched migrationMarker reference in diagnostics record: expected '${expectedMarkerKey}', found '${parsed.migrationMarker}'`
      );
    }

    // 5. Validate conflicts and unresolvedCategoryReferences arrays
    if (!Array.isArray(parsed.conflicts)) {
      throw new DiagnosticIntegrityError(
        `Invalid conflicts in diagnostics record for store '${key}': expected array, received ${typeof parsed.conflicts}`
      );
    }
    if (!Array.isArray(parsed.unresolvedCategoryReferences)) {
      throw new DiagnosticIntegrityError(
        `Invalid unresolvedCategoryReferences in diagnostics record for store '${key}': expected array, received ${typeof parsed.unresolvedCategoryReferences}`
      );
    }

    return {
      conflicts: parsed.conflicts,
      unresolvedCategoryReferences: parsed.unresolvedCategoryReferences
    };
  }

  /**
   * Safely migrates historical records belonging to the authenticated user from the legacy
   * shared database into the user's isolated database.
   *
   * Absolute safety rules:
   * 1. The legacy shared database is inspected strictly without schema-upgrade callbacks.
   * 2. If the legacy database does not exist, migration completes cleanly without creating it.
   * 3. Only records whose stored owner positively matches validatedUserId (or legacy system defaults) are copied.
   * 4. Records of former user d94ba0c6-c43a-4fb6-9e49-218f499e6695 or any other tenant are never copied.
   * 5. Repeatable and idempotent: identical destination records are verified without duplicating.
   * 6. Conflicting destination records halt migration and throw MigrationConflictError.
   * 7. Concurrent migrations for the same user are serialized via an in-flight promise mutex.
   * 8. Ambiguous custom categories and unresolved references are quarantined with explicit conflict records.
   */
  public migrate(
    userId: string,
    targetDb: LaxmiLensDB,
    customLegacyDb?: LegacyInspectionDb
  ): Promise<MigrationSummary> {
    const validatedUserId = validateUserId(userId);

    // Concurrency mutex: return existing in-flight promise if migration is already running for this user
    const inFlight = this.inFlightMigrations.get(validatedUserId);
    if (inFlight) {
      return inFlight;
    }

    const migrationPromise = (async () => {
      try {
        return await this.executeMigration(validatedUserId, targetDb, customLegacyDb);
      } finally {
        this.inFlightMigrations.delete(validatedUserId);
      }
    })();

    this.inFlightMigrations.set(validatedUserId, migrationPromise);
    return migrationPromise;
  }

  private async executeMigration(
    validatedUserId: string,
    targetDb: LaxmiLensDB,
    customLegacyDb?: LegacyInspectionDb
  ): Promise<MigrationSummary> {
    const summary: MigrationSummary = {
      userId: validatedUserId,
      accountsMigrated: 0,
      transactionsMigrated: 0,
      categoriesMigrated: 0,
      profilesMigrated: 0,
      outboxEntriesMigrated: 0,
      skippedForeignRecords: 0,
      skippedAmbiguousRecords: 0,
      alreadyMigratedRecords: 0,
      isComplete: false,
      errors: [],
      conflicts: [],
      unresolvedCategoryReferences: []
    };

    // Check if migration was already recorded as complete
    const markerKey = this.getMigrationMarkerKey(validatedUserId);
    let markerRecord: LocalSyncMetadataRecord | null | undefined;
    try {
      markerRecord = await targetDb.syncMetadata.get(markerKey);
    } catch (readErr) {
      const errorMsg = readErr instanceof Error ? readErr.message : String(readErr);
      summary.errors.push(`Failed to read migration marker for user '${validatedUserId}': ${errorMsg}`);
      summary.isComplete = false;
      return summary;
    }

    if (markerRecord !== undefined && markerRecord !== null) {
      // Malformed marker record check: value must be a non-empty string
      if (
        typeof markerRecord.value !== 'string' ||
        markerRecord.value.trim() === ''
      ) {
        const valueDesc =
          typeof markerRecord.value === 'string'
            ? 'empty string'
            : typeof markerRecord.value;
        const err = new DiagnosticIntegrityError(
          `Malformed migration marker record for user '${validatedUserId}': expected non-empty string value, received ${valueDesc}`
        );
        summary.errors.push(err.message);
        summary.isComplete = false;
        return summary;
      }

      const markerValue = markerRecord.value;

      // 1. If marker is completed_no_legacy_db, preserve existing no-legacy-database behavior
      if (markerValue === 'completed_no_legacy_db') {
        summary.isComplete = true;
        return summary;
      }

      // 2. If marker is completed_with_quarantined_conflicts, diagnostics record MUST exist
      if (markerValue === 'completed_with_quarantined_conflicts') {
        try {
          const persisted = await this.getPersistedDiagnostics(validatedUserId, targetDb);
          if (!persisted) {
            throw new DiagnosticIntegrityError(
              `Migration marker indicates '${markerValue}' for user '${validatedUserId}', but diagnostics record is missing`
            );
          }
          summary.conflicts = persisted.conflicts;
          summary.unresolvedCategoryReferences = persisted.unresolvedCategoryReferences;
          summary.skippedAmbiguousRecords = persisted.conflicts.length;
          summary.isComplete = true;
          return summary;
        } catch (diagErr) {
          // Diagnostic integrity failure: do NOT overwrite or convert into empty arrays
          const errorMsg = diagErr instanceof Error ? diagErr.message : String(diagErr);
          summary.errors.push(errorMsg);
          summary.isComplete = false;
          return summary;
        }
      }

      // 3. If marker is completed, an absent diagnostics record is acceptable
      if (markerValue === 'completed') {
        try {
          const persisted = await this.getPersistedDiagnostics(validatedUserId, targetDb);
          if (persisted) {
            summary.conflicts = persisted.conflicts;
            summary.unresolvedCategoryReferences = persisted.unresolvedCategoryReferences;
            summary.skippedAmbiguousRecords = persisted.conflicts.length;
          }
          summary.isComplete = true;
          return summary;
        } catch (diagErr) {
          const errorMsg = diagErr instanceof Error ? diagErr.message : String(diagErr);
          summary.errors.push(errorMsg);
          summary.isComplete = false;
          return summary;
        }
      }

      // 4. Any other non-empty marker value is unknown and must fail closed
      const unknownErr = new DiagnosticIntegrityError(
        `Unexpected migration marker value '${markerValue}' for user '${validatedUserId}'`
      );
      summary.errors.push(unknownErr.message);
      summary.isComplete = false;
      return summary;
    }

    // Step 1: Check existence of legacy database before opening unless customLegacyDb is provided
    if (!customLegacyDb) {
      let legacyExists: boolean;
      try {
        const checkResult = await this.existenceChecker(LEGACY_DATABASE_NAME);
        if (typeof checkResult !== 'boolean') {
          throw new Error(
            `Invalid existence check result: expected boolean, received ${typeof checkResult}`
          );
        }
        legacyExists = checkResult;
      } catch (checkErr) {
        // Fail-closed: abort legacy inspection immediately without opening or creating database
        const errorMsg = checkErr instanceof Error ? checkErr.message : String(checkErr);
        summary.errors.push(`Legacy database inspection failed (existence check error): ${errorMsg}`);
        summary.isComplete = false;
        return summary;
      }

      if (!legacyExists) {
        // Legacy database is confirmed absent on disk.
        // Safely complete without opening or creating the database.
        await targetDb.syncMetadata.put({
          key: this.getMigrationMarkerKey(validatedUserId),
          value: 'completed_no_legacy_db',
          updatedAt: new Date().toISOString()
        });
        summary.isComplete = true;
        return summary;
      }
    }

    const legacyDb = customLegacyDb ?? this.legacyDbFactory();

    let legacyAccounts: LocalAccountRecord[] = [];
    let legacyTransactions: LocalTransactionRecord[] = [];
    let legacyCategories: LocalCategoryRecord[] = [];
    let legacyProfiles: LocalProfileRecord[] = [];
    let legacyOutbox: LocalOutboxRecord[] = [];

    try {
      // Step 2: Open legacy database in schema-less inspection mode
      if (!legacyDb.isOpen()) {
        await legacyDb.open();
      }

      // Dynamic table accessor that works with bare Dexie and mock databases
      const getTable = (tableName: string): any => {
        if (typeof legacyDb.table === 'function') {
          try {
            return legacyDb.table(tableName);
          } catch {
            return (legacyDb as any)[tableName];
          }
        }
        return (legacyDb as any)[tableName];
      };

      const hasStore = (tableName: string): boolean => {
        const backend = (legacyDb as any).backendDB ? (legacyDb as any).backendDB() : null;
        if (backend && backend.objectStoreNames) {
          return backend.objectStoreNames.contains(tableName);
        }
        if (Array.isArray(legacyDb.tables)) {
          return legacyDb.tables.some((t: any) => t.name === tableName);
        }
        return Boolean((legacyDb as any)[tableName]);
      };

      const accountsTable = hasStore('accounts') ? getTable('accounts') : null;
      const transactionsTable = hasStore('transactions') ? getTable('transactions') : null;
      const categoriesTable = hasStore('categories') ? getTable('categories') : null;
      const profilesTable = hasStore('profiles') ? getTable('profiles') : null;
      const outboxTable = hasStore('syncOutbox') ? getTable('syncOutbox') : null;

      const availableStores = [
        accountsTable,
        transactionsTable,
        categoriesTable,
        profilesTable,
        outboxTable
      ].filter(Boolean);

      // Step 3: Explicit read-only transaction covering all available stores
      if (typeof legacyDb.transaction === 'function' && availableStores.length > 0) {
        await legacyDb.transaction('r', availableStores, async () => {
          legacyAccounts = accountsTable ? await accountsTable.toArray() : [];
          legacyTransactions = transactionsTable ? await transactionsTable.toArray() : [];
          legacyCategories = categoriesTable ? await categoriesTable.toArray() : [];
          legacyProfiles = profilesTable ? await profilesTable.toArray() : [];
          legacyOutbox = outboxTable ? await outboxTable.toArray() : [];
        });
      } else {
        legacyAccounts = accountsTable ? await accountsTable.toArray() : [];
        legacyTransactions = transactionsTable ? await transactionsTable.toArray() : [];
        legacyCategories = categoriesTable ? await categoriesTable.toArray() : [];
        legacyProfiles = profilesTable ? await profilesTable.toArray() : [];
        legacyOutbox = outboxTable ? await outboxTable.toArray() : [];
      }
    } catch (readError) {
      // Fail-closed: If legacy database inspection fails, abort and do NOT write completed marker
      const errorMsg = readError instanceof Error ? readError.message : String(readError);
      summary.errors.push(`Legacy database inspection failed (read error): ${errorMsg}`);
      summary.isComplete = false;
      return summary;
    } finally {
      // Step 4: Always close legacy inspection connection in finally block
      try {
        if (legacyDb && typeof legacyDb.close === 'function') {
          await legacyDb.close();
        }
      } catch (closeErr) {
        console.warn('Failed to close legacy inspection database connection:', closeErr);
      }
    }

    // Sort outbox deterministically by id for FIFO ordering
    legacyOutbox.sort((a, b) => {
      const idA = typeof a.id === 'number' ? a.id : 0;
      const idB = typeof b.id === 'number' ? b.id : 0;
      return idA - idB;
    });

    // Execute target database copy in a single atomic transaction
    await targetDb.transaction(
      'rw',
      [
        targetDb.accounts,
        targetDb.transactions,
        targetDb.categories,
        targetDb.profiles,
        targetDb.syncOutbox,
        targetDb.syncMetadata
      ],
      async () => {
        // 1. Migrate Accounts
        for (const acc of legacyAccounts) {
          if (!acc.userId || acc.userId !== validatedUserId) {
            summary.skippedForeignRecords++;
            continue;
          }

          const existing = await targetDb.accounts.get(acc.id);
          if (existing) {
            if (
              existing.userId === acc.userId &&
              existing.version === acc.version &&
              existing.name === acc.name
            ) {
              summary.alreadyMigratedRecords++;
              continue;
            } else {
              throw new MigrationConflictError(
                'accounts',
                acc.id,
                `Conflicting record exists in target database (target version: ${existing.version}, legacy version: ${acc.version}).`
              );
            }
          }

          await targetDb.accounts.put({ ...acc });
          summary.accountsMigrated++;
        }

        // Index existing target categories to track availability for transaction references
        const targetCategoryIds = new Set<string>();
        const existingTargetCategories = await targetDb.categories.toArray();
        for (const tc of existingTargetCategories) {
          targetCategoryIds.add(tc.id);
        }

        // 2. Migrate Categories (Strict legacy ownership classification & preservation)
        for (const cat of legacyCategories) {
          const rawUserId = cat.userId ? String(cat.userId).trim() : '';
          const isDefault = Boolean(cat.isDefault ?? cat.isSystem);

          // Classify sentinel ownership values
          const isSentinelMissing = !rawUserId;
          const isSentinelNil = rawUserId === NIL_UUID;
          const isSentinelLocalUser = rawUserId === SENTINEL_LOCAL_USER;
          const isSentinelOwner = isSentinelMissing || isSentinelNil || isSentinelLocalUser;

          // Check if owned by current user
          const isCurrentUserId = rawUserId.toLowerCase() === validatedUserId.toLowerCase();

          // Check if valid foreign UUID (excluding current user and nil)
          const isOtherValidUuid = isValidUuid(rawUserId) && !isCurrentUserId && !isSentinelNil;

          // Case 1: Current user's category (custom or default)
          if (isCurrentUserId) {
            const existing = await targetDb.categories.get(cat.id);
            if (existing) {
              if (existing.name === cat.name && existing.type === cat.type) {
                summary.alreadyMigratedRecords++;
                targetCategoryIds.add(cat.id);
                continue;
              } else {
                throw new MigrationConflictError(
                  'categories',
                  cat.id,
                  `Conflicting category in target database (target name: '${existing.name}', legacy name: '${cat.name}').`
                );
              }
            }

            const categoryToSave: LocalCategoryRecord = {
              ...cat,
              userId: validatedUserId,
              isDefault,
              isSystem: isDefault
            };

            await targetDb.categories.put(categoryToSave);
            summary.categoriesMigrated++;
            targetCategoryIds.add(cat.id);
            continue;
          }

          // Case 2: Positively identified system default with sentinel ownership
          // (nil-UUID, missing owner, or 'local-user')
          if (isSentinelOwner && isDefault) {
            const existing = await targetDb.categories.get(cat.id);
            if (existing) {
              if (existing.name === cat.name && existing.type === cat.type) {
                summary.alreadyMigratedRecords++;
                targetCategoryIds.add(cat.id);
                continue;
              } else {
                throw new MigrationConflictError(
                  'categories',
                  cat.id,
                  `Conflicting category in target database (target name: '${existing.name}', legacy name: '${cat.name}').`
                );
              }
            }

            // Normalize sentinel ownership to NIL_UUID according to target repository contract
            const categoryToSave: LocalCategoryRecord = {
              ...cat,
              userId: NIL_UUID,
              isDefault: true,
              isSystem: true
            };

            await targetDb.categories.put(categoryToSave);
            summary.categoriesMigrated++;
            targetCategoryIds.add(cat.id);
            continue;
          }

          // Case 3: Another user's custom category (valid foreign UUID, including FORMER_EXCLUDED_USER_ID)
          if (isOtherValidUuid) {
            summary.skippedForeignRecords++;
            continue;
          }

          // Case 4: Sentinel or malformed custom category (missing positive default evidence)
          // Includes:
          // - Nil-UUID custom category
          // - Missing-owner custom category
          // - 'local-user' custom category
          // - Malformed non-UUID owner that is not a recognized sentinel
          summary.skippedAmbiguousRecords++;
          let reason: string;
          if (isSentinelNil) {
            reason = 'Nil-UUID custom category lacks positive system default flag.';
          } else if (isSentinelMissing) {
            reason = 'Missing-owner custom category lacks positive system default flag.';
          } else if (isSentinelLocalUser) {
            reason = "'local-user' custom category lacks positive system default flag.";
          } else {
            reason = `Category has malformed non-UUID owner '${rawUserId}' and lacks system default flag.`;
          }

          const conflict: MigrationConflictRecord = {
            entity: 'categories',
            entityId: cat.id,
            name: cat.name,
            ownerValue: rawUserId || undefined,
            reason
          };
          summary.conflicts.push(conflict);
          summary.errors.push(`Quarantined category conflict [${cat.id}] '${cat.name}': ${reason}`);
        }

        // 3. Migrate Transactions (Preserving exact original categoryId)
        for (const tx of legacyTransactions) {
          if (!tx.userId || tx.userId !== validatedUserId) {
            summary.skippedForeignRecords++;
            continue;
          }

          const existing = await targetDb.transactions.get(tx.id);
          if (existing) {
            const destPaise = existing.amountPaise ?? existing.amountInPaise;
            const srcPaise = tx.amountPaise ?? tx.amountInPaise;
            if (existing.userId === tx.userId && existing.version === tx.version && destPaise === srcPaise) {
              summary.alreadyMigratedRecords++;
              if (tx.categoryId && !targetCategoryIds.has(tx.categoryId)) {
                summary.unresolvedCategoryReferences.push({
                  transactionId: tx.id,
                  categoryId: tx.categoryId
                });
              }
              continue;
            } else {
              throw new MigrationConflictError(
                'transactions',
                tx.id,
                `Conflicting transaction in target database (target version: ${existing.version}, legacy version: ${tx.version}).`
              );
            }
          }

          // Exact original categoryId preserved on transaction
          await targetDb.transactions.put({ ...tx });
          summary.transactionsMigrated++;

          // Verify whether referenced category was migrated or exists in target database
          if (tx.categoryId && !targetCategoryIds.has(tx.categoryId)) {
            summary.unresolvedCategoryReferences.push({
              transactionId: tx.id,
              categoryId: tx.categoryId
            });

            // Associate referencing transaction ID with quarantined category conflict if applicable
            const matchedConflict = summary.conflicts.find(
              (c) => c.entity === 'categories' && c.entityId === tx.categoryId
            );
            if (matchedConflict) {
              matchedConflict.referencingTransactionIds = matchedConflict.referencingTransactionIds || [];
              matchedConflict.referencingTransactionIds.push(tx.id);
            }

            summary.errors.push(
              `Unresolved category reference: Transaction '${tx.id}' references unmigrated category '${tx.categoryId}'.`
            );
          }
        }

        // 4. Migrate Profiles
        for (const prof of legacyProfiles) {
          if (prof.id !== validatedUserId) {
            summary.skippedForeignRecords++;
            continue;
          }

          const existing = await targetDb.profiles.get(prof.id);
          if (existing) {
            summary.alreadyMigratedRecords++;
            continue;
          }

          await targetDb.profiles.put({ ...prof });
          summary.profilesMigrated++;
        }

        // 5. Migrate Outbox (strictly FIFO)
        for (const entry of legacyOutbox) {
          const payload = (entry.payload || {}) as Record<string, unknown>;
          const payloadUserIdRaw = payload.user_id ?? payload.userId;

          // Check top-level ownership
          if (!entry.userId || entry.userId !== validatedUserId) {
            summary.skippedForeignRecords++;
            continue;
          }

          // Check payload ownership consistency
          if (payloadUserIdRaw !== undefined && payloadUserIdRaw !== null) {
            if (!isValidUuid(String(payloadUserIdRaw)) || String(payloadUserIdRaw).toLowerCase() !== validatedUserId) {
              summary.skippedAmbiguousRecords++;
              continue;
            }
          }

          // Check if already in target outbox by idempotencyKey or matching payload entityId
          const existingEntries = await targetDb.syncOutbox
            .where('userId')
            .equals(validatedUserId)
            .toArray();

          const isDuplicate = existingEntries.some(
            (e) =>
              e.entity === entry.entity &&
              e.entityId === entry.entityId &&
              e.operation === entry.operation &&
              (e.idempotencyKey === entry.idempotencyKey ||
                JSON.stringify(e.payload) === JSON.stringify(entry.payload))
          );

          if (isDuplicate) {
            summary.alreadyMigratedRecords++;
            continue;
          }

          // Add to target outbox with fresh auto-increment id, preserving payload and metadata
          const { id: _ignoredId, ...entryWithoutId } = entry;
          await targetDb.syncOutbox.add(entryWithoutId as LocalOutboxRecord);
          summary.outboxEntriesMigrated++;
        }

        // 6. Persist structured conflict records and unresolved category references durably
        const hasConflicts =
          summary.conflicts.length > 0 || summary.unresolvedCategoryReferences.length > 0;

        if (hasConflicts) {
          const diagKey = this.getMigrationDiagnosticsKey(validatedUserId);
          const diagPayload = JSON.stringify({
            userId: validatedUserId,
            migrationMarker: this.getMigrationMarkerKey(validatedUserId),
            conflicts: summary.conflicts,
            unresolvedCategoryReferences: summary.unresolvedCategoryReferences,
            recordedAt: new Date().toISOString()
          });

          await targetDb.syncMetadata.put({
            key: diagKey,
            value: diagPayload,
            updatedAt: new Date().toISOString()
          });

          // Verification: ensure diagnostics record was durably written and uncorrupted
          const storedRecord = await targetDb.syncMetadata.get(diagKey);
          if (!storedRecord || storedRecord.value !== diagPayload) {
            throw new DiagnosticIntegrityError(
              `Diagnostic persistence verification failed for key '${diagKey}'`
            );
          }
        }

        // 7. Write migration completion marker into syncMetadata ONLY AFTER successful diagnostic persistence
        const markerValue = hasConflicts
          ? 'completed_with_quarantined_conflicts'
          : 'completed';

        await targetDb.syncMetadata.put({
          key: this.getMigrationMarkerKey(validatedUserId),
          value: markerValue,
          updatedAt: new Date().toISOString()
        });
      }
    );

    summary.isComplete = true;
    return summary;
  }
}

export const defaultLegacyMigrator = new LegacyDatabaseMigrator();

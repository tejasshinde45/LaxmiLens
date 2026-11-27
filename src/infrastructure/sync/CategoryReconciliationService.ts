import { AuthPort } from '@/application/ports/AuthPort';
import { validateUserId } from '@/domain/value-objects/Identifiers';
import { LaxmiLensDB } from '@/infrastructure/database/local/DexieDatabase';
import {
  LocalCategoryRecord,
  LocalOutboxRecord,
  LocalSyncMetadataRecord
} from '@/infrastructure/database/local/schema';
import {
  CategoryMapper,
  CloudCategoryRow
} from '@/infrastructure/database/cloud/mappers/CategoryMapper';
import { ISupabaseCategoryRepository } from '@/infrastructure/database/cloud/repositories/SupabaseCategoryRepository';
import { normalizeOptionalText } from '@/utils/textNormalization';
import { CategoryMappingService } from './CategoryMappingService';
import { SyncAuthError } from './errors/SyncErrors';

export interface CategoryPullConflict {
  categoryId: string;
  reason: string;
}

export interface CategoryReconciliationResult {
  pulledCount: number;
  insertedCount: number;
  updatedCount: number;
  mappedCount: number;
  skippedPendingCount: number;
  conflictCount: number;
  conflicts: CategoryPullConflict[];
}

function normalizeCategoryKey(type: 'income' | 'expense', name: string): string {
  return `${type}:${name.trim().toLowerCase()}`;
}

function areCategoryRecordsEquivalent(
  local: LocalCategoryRecord,
  cloud: CloudCategoryRow
): boolean {
  const localIsDefault = Boolean(local.isDefault ?? local.isSystem);
  const namesMatch =
    Boolean(cloud.is_default) && localIsDefault
      ? local.name.trim().toLowerCase() === cloud.name.trim().toLowerCase()
      : local.name.trim() === cloud.name.trim();

  return (
    namesMatch &&
    local.type === cloud.type &&
    normalizeOptionalText(local.icon) === normalizeOptionalText(cloud.icon) &&
    normalizeOptionalText(local.color) === normalizeOptionalText(cloud.color) &&
    localIsDefault === Boolean(cloud.is_default) &&
    Boolean(local.isArchived) === Boolean(cloud.is_archived)
  );
}

/**
 * CategoryReconciliationService
 *
 * Reconciles cloud categories into the authenticated user's isolated local Dexie database
 * and resolves cross-device default category UUID differences via `cat_map:` / `cat_rev:`.
 *
 * Guarantees:
 * 1. Matches ONLY default categories (`is_default === true`) by `(type, normalizedName)`.
 * 2. Preserves custom category identity strictly by cloud UUID (never merges custom categories by display name).
 * 3. Protects pending local category mutations (`syncOutbox`) from cloud overwrites.
 * 4. Preserves higher/divergent local versions without silent overwrites.
 */
export class CategoryReconciliationService {
  constructor(
    private readonly database: LaxmiLensDB,
    private readonly cloudCategoryRepo: ISupabaseCategoryRepository,
    private readonly authPort: AuthPort,
    private readonly categoryMappingService?: CategoryMappingService
  ) {}

  /**
   * Resolves default category identity mappings (`cat_map:` / `cat_rev:`) before pushing
   * category-dependent transactions, budgets, or recurring rules.
   */
  public async resolveDefaultCategoryIdentities(
    userId?: string
  ): Promise<CategoryReconciliationResult> {
    return this.reconcileInternal(userId, { applyPullWrites: false });
  }

  /**
   * Reconciles default category identities and pulls cloud categories (defaults & custom)
   * into the user's local Dexie database.
   */
  public async pullAndReconcile(userId?: string): Promise<CategoryReconciliationResult> {
    return this.reconcileInternal(userId, { applyPullWrites: true });
  }

  private async reconcileInternal(
    userId: string | undefined,
    options: { applyPullWrites: boolean }
  ): Promise<CategoryReconciliationResult> {
    const currentUser = await this.authPort.getCurrentUser();
    if (!currentUser || !currentUser.id) {
      throw new SyncAuthError('Category reconciliation aborted: User is not authenticated.');
    }

    const authenticatedUserId = validateUserId(currentUser.id);
    if (userId && validateUserId(userId) !== authenticatedUserId) {
      throw new SyncAuthError(
        `Category reconciliation aborted: Requested user '${userId}' does not match authenticated user '${authenticatedUserId}'.`
      );
    }

    const cloudRows = await this.cloudCategoryRepo.findAll(authenticatedUserId);
    for (const row of cloudRows) {
      CategoryMapper.validateCloudRow(row);
      if (row.user_id !== authenticatedUserId) {
        throw new SyncAuthError(
          `Category reconciliation aborted: Cloud category '${row.id}' belongs to another user.`
        );
      }
    }

    const result: CategoryReconciliationResult = {
      pulledCount: 0,
      insertedCount: 0,
      updatedCount: 0,
      mappedCount: 0,
      skippedPendingCount: 0,
      conflictCount: 0,
      conflicts: []
    };

    const forwardPrefix = `cat_map:${authenticatedUserId}:`;
    const reversePrefix = `cat_rev:${authenticatedUserId}:`;

    await this.database.transaction(
      'rw',
      [
        this.database.categories,
        this.database.syncMetadata,
        this.database.syncOutbox
      ],
      async () => {
        const outbox = (await this.database.syncOutbox
          .where('userId')
          .equals(authenticatedUserId)
          .toArray()) as LocalOutboxRecord[];

        const pendingCategoryIds = new Set<string>(
          outbox.filter((e) => e.entity === 'categories').map((e) => e.entityId)
        );

        const localRecords = (await this.database.categories
          .where('userId')
          .equals(authenticatedUserId)
          .toArray()) as LocalCategoryRecord[];

        const localById = new Map<string, LocalCategoryRecord>(
          localRecords.map((c) => [c.id, c])
        );

        const localDefaultsByKey = new Map<string, LocalCategoryRecord>();
        for (const rec of localRecords) {
          if (Boolean(rec.isDefault ?? rec.isSystem)) {
            const k = normalizeCategoryKey(rec.type, rec.name);
            if (!localDefaultsByKey.has(k)) {
              localDefaultsByKey.set(k, rec);
            }
          }
        }

        const allMeta = (await this.database.syncMetadata.toArray()) as LocalSyncMetadataRecord[];
        const forwardMap = new Map<string, string>();
        const reverseMap = new Map<string, string>();
        for (const meta of allMeta) {
          if (meta.key.startsWith(forwardPrefix) && meta.value) {
            forwardMap.set(meta.key.slice(forwardPrefix.length), meta.value);
          } else if (meta.key.startsWith(reversePrefix) && meta.value) {
            reverseMap.set(meta.key.slice(reversePrefix.length), meta.value);
          }
        }

        const persistMappingPair = async (localId: string, cloudId: string): Promise<void> => {
          const nowIso = new Date().toISOString();
          await this.database.syncMetadata.put({
            key: `${forwardPrefix}${localId}`,
            value: cloudId,
            updatedAt: nowIso
          });
          await this.database.syncMetadata.put({
            key: `${reversePrefix}${cloudId}`,
            value: localId,
            updatedAt: nowIso
          });
          forwardMap.set(localId, cloudId);
          reverseMap.set(cloudId, localId);
          this.categoryMappingService?.cacheMappingInMemory(
            localId,
            cloudId,
            authenticatedUserId
          );
        };

        // Pass 1: Resolve default category identities strictly by (is_default, type, normalizedName)
        for (const cloudRow of cloudRows) {
          if (!cloudRow.is_default) {
            continue;
          }

          const existingRevLocalId = reverseMap.get(cloudRow.id);
          if (existingRevLocalId && localById.has(existingRevLocalId)) {
            const existingLocal = localById.get(existingRevLocalId)!;
            if (
              Boolean(existingLocal.isDefault ?? existingLocal.isSystem) &&
              existingLocal.type === cloudRow.type
            ) {
              if (forwardMap.get(existingRevLocalId) !== cloudRow.id) {
                await persistMappingPair(existingRevLocalId, cloudRow.id);
                result.mappedCount++;
              } else {
                this.categoryMappingService?.cacheMappingInMemory(
                  existingRevLocalId,
                  cloudRow.id,
                  authenticatedUserId
                );
              }
              continue;
            }
          }

          // Check direct canonical UUID match locally
          const directLocal = localById.get(cloudRow.id);
          if (directLocal) {
            const directIsDefault = Boolean(directLocal.isDefault ?? directLocal.isSystem);
            if (!directIsDefault || directLocal.type !== cloudRow.type) {
              result.conflictCount++;
              result.conflicts.push({
                categoryId: cloudRow.id,
                reason: `Cloud default category '${cloudRow.id}' collides with incompatible local category (${directLocal.type}, isDefault=${directIsDefault}).`
              });
              continue;
            }
            if (
              forwardMap.get(directLocal.id) !== cloudRow.id ||
              reverseMap.get(cloudRow.id) !== directLocal.id
            ) {
              await persistMappingPair(directLocal.id, cloudRow.id);
              result.mappedCount++;
            } else {
              this.categoryMappingService?.cacheMappingInMemory(
                directLocal.id,
                cloudRow.id,
                authenticatedUserId
              );
            }
            continue;
          }

          // Match existing local default by (isDefault, type, normalizedName)
          const defaultKey = normalizeCategoryKey(cloudRow.type, cloudRow.name);
          const matchedLocal = localDefaultsByKey.get(defaultKey);
          if (matchedLocal) {
            const alreadyMappedToCloud = forwardMap.get(matchedLocal.id);
            if (alreadyMappedToCloud && alreadyMappedToCloud !== cloudRow.id) {
              result.conflictCount++;
              result.conflicts.push({
                categoryId: cloudRow.id,
                reason: `Local default category '${matchedLocal.id}' (${matchedLocal.name}) is already mapped to cloud category '${alreadyMappedToCloud}', cannot map to duplicate cloud default '${cloudRow.id}'.`
              });
              continue;
            }
            await persistMappingPair(matchedLocal.id, cloudRow.id);
            result.mappedCount++;
          }
        }

        if (!options.applyPullWrites) {
          return;
        }

        // Pass 2: Pull remote default and custom categories into Dexie
        for (const cloudRow of cloudRows) {
          const targetLocalId = cloudRow.is_default
            ? (reverseMap.get(cloudRow.id) ?? cloudRow.id)
            : cloudRow.id;

          if (
            pendingCategoryIds.has(cloudRow.id) ||
            pendingCategoryIds.has(targetLocalId)
          ) {
            result.skippedPendingCount++;
            continue;
          }

          const localExisting = localById.get(targetLocalId);

          if (!localExisting) {
            // Custom categories ALWAYS use cloud UUID; defaults use canonical cloud UUID when absent locally
            const localRec = CategoryMapper.toLocalRecord(cloudRow, targetLocalId);
            await this.database.categories.put(localRec);
            localById.set(localRec.id, localRec);
            if (cloudRow.is_default) {
              await persistMappingPair(localRec.id, cloudRow.id);
            }
            result.insertedCount++;
            result.pulledCount++;
            continue;
          }

          const localIsDefault = Boolean(localExisting.isDefault ?? localExisting.isSystem);
          if (
            localExisting.type !== cloudRow.type ||
            localIsDefault !== Boolean(cloudRow.is_default)
          ) {
            result.conflictCount++;
            result.conflicts.push({
              categoryId: cloudRow.id,
              reason: `Cloud category '${cloudRow.id}' has immutable classification mismatch against local category '${localExisting.id}'. Local record preserved.`
            });
            continue;
          }

          const localVersion = localExisting.version ?? 1;
          if (cloudRow.version > localVersion) {
            const updatedRec = CategoryMapper.toLocalRecord(cloudRow, localExisting.id);
            await this.database.categories.put(updatedRec);
            localById.set(updatedRec.id, updatedRec);
            result.updatedCount++;
            result.pulledCount++;
          } else if (cloudRow.version === localVersion) {
            if (!areCategoryRecordsEquivalent(localExisting, cloudRow)) {
              result.conflictCount++;
              result.conflicts.push({
                categoryId: cloudRow.id,
                reason: `Conflict on category '${cloudRow.id}' at version ${cloudRow.version}: cloud metadata differs from local '${localExisting.id}'. Local record preserved.`
              });
            }
          } else {
            result.conflictCount++;
            result.conflicts.push({
              categoryId: cloudRow.id,
              reason: `Remote category '${cloudRow.id}' has older version (${cloudRow.version}) than local '${localExisting.id}' (${localVersion}). Local record preserved.`
            });
          }
        }
      }
    );

    return result;
  }
}

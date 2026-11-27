import { LaxmiLensDB, db } from '@/infrastructure/database/local/DexieDatabase';
import { ISupabaseCategoryRepository } from '@/infrastructure/database/cloud/repositories/SupabaseCategoryRepository';
import { CloudCategoryRow } from '@/infrastructure/database/cloud/mappers/CategoryMapper';
import { CategoryRepository } from '@/domain/repositories/CategoryRepository';
import { Category } from '@/domain/entities/Category';
import {
  createCategoryId,
  createUserId,
  isValidUuid,
  validateUserId
} from '@/domain/value-objects/Identifiers';

export interface ICategoryResolver {
  resolveCategory(localId: string, userId: string): Promise<string | null>;
  getMapping(localId: string, userId: string): Promise<string | null>;
  setMapping(localId: string, cloudUuid: string, userId: string): Promise<void>;
  resolveLocalCategory?(cloudUuid: string, userId: string): Promise<string | null>;
}

export class CategoryMappingService implements ICategoryResolver {
  private inMemoryFallback = new Map<string, string>();

  constructor(
    private readonly database?: LaxmiLensDB,
    private readonly cloudCategoryRepo?: ISupabaseCategoryRepository,
    private readonly localCategoryRepo?: CategoryRepository
  ) {}

  /**
   * Retrieves durable mapping from Dexie syncMetadata table.
   */
  public async getMapping(localId: string, userId: string): Promise<string | null> {
    if (!localId || !userId) return null;
    const validatedUserId = validateUserId(userId);
    const key = `cat_map:${validatedUserId}:${localId}`;

    const activeDb = this.database ?? db;
    if (activeDb?.isOpen()) {
      try {
        const record = await activeDb.syncMetadata.get(key);
        if (record && record.value) {
          return record.value;
        }
      } catch (err) {
        console.warn('Failed to read category mapping from syncMetadata:', err);
      }
    }

    return this.inMemoryFallback.get(key) ?? null;
  }

  /**
   * Updates only the in-memory mapping fallback cache (used after durable atomic syncMetadata writes).
   */
  public cacheMappingInMemory(localId: string, cloudUuid: string, userId: string): void {
    if (!localId || !cloudUuid || !userId) return;
    const validatedUserId = validateUserId(userId);
    const key = `cat_map:${validatedUserId}:${localId}`;
    const reverseKey = `cat_rev:${validatedUserId}:${cloudUuid}`;
    this.inMemoryFallback.set(key, cloudUuid);
    this.inMemoryFallback.set(reverseKey, localId);
  }

  /**
   * Durably persists local category ID to cloud category UUID mapping in Dexie syncMetadata.
   */
  public async setMapping(localId: string, cloudUuid: string, userId: string): Promise<void> {
    if (!localId || !cloudUuid || !userId) return;
    const validatedUserId = validateUserId(userId);
    const key = `cat_map:${validatedUserId}:${localId}`;
    const reverseKey = `cat_rev:${validatedUserId}:${cloudUuid}`;

    this.cacheMappingInMemory(localId, cloudUuid, validatedUserId);

    const activeDb = this.database ?? db;
    if (activeDb?.isOpen()) {
      try {
        const nowIso = new Date().toISOString();
        await activeDb.syncMetadata.put({
          key,
          value: cloudUuid,
          updatedAt: nowIso
        });
        await activeDb.syncMetadata.put({
          key: reverseKey,
          value: localId,
          updatedAt: nowIso
        });
      } catch (err) {
        console.warn('Failed to persist category mapping to syncMetadata:', err);
      }
    }
  }

  /**
   * Resolves a cloud category UUID back to a local Dexie category ID when mapped
   * (e.g. reconciled default categories across devices), or returns null if unmapped.
   */
  public async resolveLocalCategory(cloudUuid: string, userId: string): Promise<string | null> {
    if (!cloudUuid || !userId) return null;
    const validatedUserId = validateUserId(userId);
    const reverseKey = `cat_rev:${validatedUserId}:${cloudUuid}`;

    const activeDb = this.database ?? db;
    if (activeDb?.isOpen()) {
      try {
        const record = await activeDb.syncMetadata.get(reverseKey);
        if (record && record.value) {
          return record.value;
        }
      } catch (err) {
        console.warn('Failed to read reverse category mapping from syncMetadata:', err);
      }
    }

    const memMapped = this.inMemoryFallback.get(reverseKey);
    if (memMapped) {
      return memMapped;
    }

    if (this.localCategoryRepo && isValidUuid(cloudUuid)) {
      try {
        const localCat = await this.localCategoryRepo.findById(
          createCategoryId(cloudUuid),
          createUserId(validatedUserId)
        );
        if (localCat && localCat.userId === validatedUserId) {
          return localCat.id;
        }
      } catch {
        // Ignore cross-tenant/missing errors during reverse lookup
      }
    }

    return null;
  }

  /**
   * Resolves a local category ID to a verified cloud category UUID.
   * Guarantees:
   * 1. Preserves historical category references without matching by display name alone.
   * 2. Checks durable mapping first for instant resolution.
   * 3. Checks direct cloud UUID existence.
   * 4. Reconciles default categories with cloud default categories idempotently without duplicates.
   * 5. Persists custom categories to cloud before returning verified UUID.
   * 6. Returns null if category cannot be resolved locally or in cloud.
   */
  public async resolveCategory(localId: string, userId: string): Promise<string | null> {
    if (!localId || !userId) return null;
    const validatedUserId = validateUserId(userId);

    // 1. Check existing durable mapping
    const existingMapped = await this.getMapping(localId, validatedUserId);
    if (existingMapped) {
      return existingMapped;
    }

    if (!this.cloudCategoryRepo) {
      return null;
    }

    // 2. If localId is already a valid UUID, check if it already exists in cloud
    if (isValidUuid(localId)) {
      try {
        const cloudCat = await this.cloudCategoryRepo.findById(localId, validatedUserId);
        if (cloudCat && cloudCat.user_id === validatedUserId) {
          await this.setMapping(localId, localId, validatedUserId);
          return localId;
        }
      } catch {
        // Continue to local resolution
      }
    }

    // 3. Lookup local category in Dexie repository
    if (!this.localCategoryRepo) {
      return null;
    }

    let localCat: Category | null = null;
    try {
      localCat = await this.localCategoryRepo.findById(
        createCategoryId(localId),
        createUserId(validatedUserId)
      );
    } catch {
      localCat = null;
    }

    if (!localCat) {
      return null;
    }

    // 4. If it is a default category, check if cloud already has a matching default category
    if (localCat.isDefault) {
      try {
        const cloudCats = await this.cloudCategoryRepo.findAll(validatedUserId);
        const matchingDefault = cloudCats.find(
          (c) =>
            c.is_default &&
            c.type === localCat!.type &&
            c.name.trim().toLowerCase() === localCat!.name.trim().toLowerCase()
        );
        if (matchingDefault) {
          await this.setMapping(localId, matchingDefault.id, validatedUserId);
          return matchingDefault.id;
        }
      } catch (err) {
        console.warn('Failed to query cloud categories during default category reconciliation:', err);
      }
    }

    // 5. If not found in cloud, insert into cloud idempotently
    const targetId = isValidUuid(localId) ? localId : crypto.randomUUID();
    const cloudRow: CloudCategoryRow = {
      id: targetId,
      user_id: validatedUserId,
      name: localCat.name,
      type: localCat.type,
      icon: localCat.icon ?? null,
      color: localCat.color ?? null,
      is_default: localCat.isDefault,
      is_archived: localCat.isArchived,
      version: localCat.version ?? 1
    };

    const persisted = await this.cloudCategoryRepo.insert(cloudRow);
    await this.setMapping(localId, persisted.id, validatedUserId);
    return persisted.id;
  }
}

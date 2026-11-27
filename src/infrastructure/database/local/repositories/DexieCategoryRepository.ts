import Dexie from 'dexie';
import { CategoryRepository } from '@/domain/repositories/CategoryRepository';
import { Category, DEFAULT_CATEGORY_SEEDS } from '@/domain/entities/Category';
import {
  CategoryId,
  UserId,
  createCategoryId,
  createUserId,
  validateUserId
} from '@/domain/value-objects/Identifiers';
import {
  InvalidUserIdError,
  CategoryNotFoundError,
  UnauthorizedEntityAccessError
} from '@/domain/errors/DomainErrors';
import { db, LaxmiLensDB } from '../DexieDatabase';
import { LocalCategoryRecord } from '../schema';

const NIL_SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

interface CategoryUserWhereClause {
  equals?: (val: string) => { toArray: () => Promise<LocalCategoryRecord[]> };
  anyOf?: (vals: string[]) => { toArray: () => Promise<LocalCategoryRecord[]> };
}

export class DexieCategoryRepository implements CategoryRepository {
  private readonly inFlightUserCategoryReads = new Map<string, Promise<LocalCategoryRecord[]>>();

  constructor(private readonly database: LaxmiLensDB = db) {}

  private async loadUserCategoriesCoalesced(
    validatedUserId: string
  ): Promise<LocalCategoryRecord[]> {
    const loader = async (): Promise<LocalCategoryRecord[]> => {
      const userIndex =
        typeof this.database.categories.where === 'function'
          ? (this.database.categories.where('userId') as CategoryUserWhereClause)
          : undefined;

      let candidates: LocalCategoryRecord[];
      if (typeof userIndex?.anyOf === 'function') {
        const ownerKeys =
          validatedUserId === NIL_SYSTEM_USER_ID
            ? [validatedUserId, '']
            : [validatedUserId, NIL_SYSTEM_USER_ID, ''];
        candidates = await userIndex.anyOf(ownerKeys).toArray();
      } else if (typeof userIndex?.equals === 'function') {
        const queries: Promise<LocalCategoryRecord[]>[] = [
          userIndex.equals(validatedUserId).toArray()
        ];
        if (validatedUserId !== NIL_SYSTEM_USER_ID) {
          queries.push(userIndex.equals(NIL_SYSTEM_USER_ID).toArray());
        }
        queries.push(userIndex.equals('').toArray());
        candidates = (await Promise.all(queries)).flat();
      } else {
        candidates = await this.database.categories.toArray();
      }

      const map = new Map<string, LocalCategoryRecord>();
      for (const c of candidates) {
        const isDefault = Boolean(c.isDefault ?? c.isSystem);
        const isOwnedByUser = c.userId === validatedUserId;
        const isUnassignedDefault =
          isDefault && (!c.userId || c.userId === NIL_SYSTEM_USER_ID);
        if (isOwnedByUser || isUnassignedDefault) {
          map.set(c.id, c);
        }
      }

      return Array.from(map.values());
    };

    if (Dexie.currentTransaction) {
      return loader();
    }

    const existing = this.inFlightUserCategoryReads.get(validatedUserId);
    if (existing) {
      return (await existing).slice();
    }

    const pending = loader();
    this.inFlightUserCategoryReads.set(validatedUserId, pending);
    try {
      return (await pending).slice();
    } finally {
      if (this.inFlightUserCategoryReads.get(validatedUserId) === pending) {
        this.inFlightUserCategoryReads.delete(validatedUserId);
      }
    }
  }

  public async findById(id: CategoryId, userId: UserId): Promise<Category | null> {
    const validatedUserId = validateUserId(userId);
    const record = await this.database.categories.get(id);
    if (!record) return null;

    const isDefault = Boolean(record.isDefault ?? record.isSystem);
    const isSystemNil =
      isDefault &&
      (!record.userId || record.userId === '00000000-0000-0000-0000-000000000000');
    // User can access if they own the category OR if it is an unassigned legacy system category
    if (record.userId === validatedUserId || isSystemNil) {
      return this.toDomain(record);
    }

    // Belongs to another tenant
    throw new UnauthorizedEntityAccessError('Category', id);
  }

  public async findByUserId(userId: UserId): Promise<Category[]> {
    const validatedUserId = validateUserId(userId);
    const records = await this.loadUserCategoriesCoalesced(validatedUserId);
    return records.map((r) => this.toDomain(r));
  }

  public async findAll(userId: UserId): Promise<Category[]> {
    return this.findByUserId(userId);
  }

  public async save(category: Category): Promise<void> {
    this.inFlightUserCategoryReads.clear();
    const validatedUserId = validateUserId(category.userId);
    const existing = await this.database.categories.get(category.id);
    if (existing) {
      if (existing.userId && existing.userId !== validatedUserId) {
        throw new UnauthorizedEntityAccessError('Category', category.id);
      }
      const existingIsDefault = Boolean(existing.isDefault ?? existing.isSystem);
      if (!existingIsDefault && category.isDefault) {
        throw new Error('Converting a custom category into a default category is not permitted.');
      }
    }
    const record = this.toRecord(category);
    await this.database.categories.put(record);
    this.inFlightUserCategoryReads.clear();
  }

  public async saveBatch(categories: Category[]): Promise<void> {
    this.inFlightUserCategoryReads.clear();
    for (const c of categories) {
      const validatedUserId = validateUserId(c.userId);
      const existing = await this.database.categories.get(c.id);
      if (existing) {
        if (existing.userId && existing.userId !== validatedUserId) {
          throw new UnauthorizedEntityAccessError('Category', c.id);
        }
        const existingIsDefault = Boolean(existing.isDefault ?? existing.isSystem);
        if (!existingIsDefault && c.isDefault) {
          throw new Error('Converting a custom category into a default category is not permitted.');
        }
      }
    }
    const records = categories.map((c) => this.toRecord(c));
    await this.database.categories.bulkPut(records);
    this.inFlightUserCategoryReads.clear();
  }

  public async archive(id: CategoryId, userId: UserId): Promise<void> {
    this.inFlightUserCategoryReads.clear();
    const validatedUserId = validateUserId(userId);
    const existing = await this.database.categories.get(id);
    if (!existing) {
      throw new CategoryNotFoundError(id);
    }
    const isDefault = Boolean(existing.isDefault ?? existing.isSystem);
    if (isDefault) {
      throw new Error('Default system categories cannot be archived.');
    }
    if (existing.userId !== validatedUserId) {
      throw new UnauthorizedEntityAccessError('Category', id);
    }
    await this.database.categories.update(id, {
      isArchived: true,
      updatedAt: new Date().toISOString()
    });
    this.inFlightUserCategoryReads.clear();
  }

  public async seedDefaults(userId: UserId): Promise<Category[]> {
    const validatedUserId = validateUserId(userId);
    const existing = await this.database.categories
      .where('userId')
      .equals(validatedUserId)
      .toArray();

    if (existing.length > 0) {
      return existing.map((r) => this.toDomain(r));
    }

    const seeded: Category[] = DEFAULT_CATEGORY_SEEDS.map((seed) => {
      const id = createCategoryId(crypto.randomUUID());
      return new Category({
        id,
        userId: validatedUserId,
        name: seed.name,
        type: seed.type,
        icon: seed.icon,
        color: seed.color,
        isDefault: true,
        isArchived: false,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      });
    });

    await this.saveBatch(seeded);
    return seeded;
  }

  private toDomain(record: LocalCategoryRecord): Category {
    const isDefault = Boolean(record.isDefault ?? record.isSystem);
    let resolvedUserId: UserId;
    if (record.userId) {
      resolvedUserId = validateUserId(record.userId);
    } else if (isDefault) {
      resolvedUserId = createUserId('00000000-0000-0000-0000-000000000000');
    } else {
      throw new InvalidUserIdError(`Category record '${record.id}' is missing a valid userId.`);
    }

    return new Category({
      id: createCategoryId(record.id),
      userId: resolvedUserId,
      name: record.name,
      type: record.type,
      icon: record.icon,
      color: record.color,
      isDefault,
      isArchived: record.isArchived ?? false,
      version: record.version ?? 1,
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt)
    });
  }

  private toRecord(category: Category): LocalCategoryRecord {
    const validatedUserId = validateUserId(category.userId);
    return {
      id: category.id,
      userId: validatedUserId,
      name: category.name,
      type: category.type,
      icon: category.icon,
      color: category.color,
      isDefault: category.isDefault,
      isArchived: category.isArchived,
      version: category.version,
      createdAt: category.createdAt.toISOString(),
      updatedAt: category.updatedAt.toISOString(),

      // Compatibility
      isSystem: category.isDefault
    };
  }
}

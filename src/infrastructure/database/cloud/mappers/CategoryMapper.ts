import { Category, CategoryType } from '@/domain/entities/Category';
import {
  createCategoryId,
  validateUserId,
  isValidUuid
} from '@/domain/value-objects/Identifiers';
import { InvalidUserIdError } from '@/domain/errors/DomainErrors';

export interface CloudCategoryRow {
  id: string; // UUID
  user_id: string; // UUID
  name: string;
  type: CategoryType;
  icon: string | null;
  color: string | null;
  is_default: boolean;
  is_archived: boolean;
  version: number;
  created_at?: string;
  updated_at?: string;
}

const VALID_CATEGORY_TYPES: ReadonlySet<string> = new Set(['income', 'expense']);

export class CategoryMapper {
  /**
   * Converts a raw PostgreSQL cloud category row to the domain Category entity.
   */
  public static toDomain(row: CloudCategoryRow): Category {
    if (!VALID_CATEGORY_TYPES.has(row.type)) {
      throw new Error(`Invalid category type '${row.type}' from cloud row.`);
    }

    return new Category({
      id: createCategoryId(row.id),
      userId: validateUserId(row.user_id),
      name: row.name,
      type: row.type as CategoryType,
      icon: row.icon ?? undefined,
      color: row.color ?? undefined,
      isDefault: Boolean(row.is_default),
      isArchived: Boolean(row.is_archived),
      version: row.version,
      createdAt: row.created_at ? new Date(row.created_at) : undefined,
      updatedAt: row.updated_at ? new Date(row.updated_at) : undefined
    });
  }

  /**
   * Converts a domain Category entity to a complete CloudCategoryRow.
   */
  public static toCloud(category: Category): CloudCategoryRow {
    return {
      id: category.id,
      user_id: category.userId,
      name: category.name,
      type: category.type,
      icon: category.icon ?? null,
      color: category.color ?? null,
      is_default: category.isDefault,
      is_archived: category.isArchived,
      version: category.version,
      created_at: category.createdAt.toISOString(),
      updated_at: category.updatedAt.toISOString()
    };
  }

  /**
   * Maps an outbox INSERT payload to a complete CloudCategoryRow.
   * Strictly validates UUIDs, non-empty name, and category type.
   */
  public static mapCreatePayload(payload: Record<string, unknown>): CloudCategoryRow {
    const id = payload.id;
    if (typeof id !== 'string' || !isValidUuid(id)) {
      throw new Error(`Invalid category ID '${id}': must be a valid UUID.`);
    }

    const userId = payload.user_id ?? payload.userId;
    if (typeof userId !== 'string' || !isValidUuid(userId)) {
      throw new InvalidUserIdError(`Invalid user ID '${userId}': must be a valid UUID.`);
    }

    const name = payload.name;
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new Error('Category name must not be empty.');
    }
    if (name.trim().length > 100) {
      throw new Error('Category name exceeds maximum length of 100 characters.');
    }

    const type = payload.type as string;
    if (!VALID_CATEGORY_TYPES.has(type)) {
      throw new Error(`Invalid category type '${type}'. Must be income or expense.`);
    }

    const version =
      typeof payload.version === 'number' && Number.isSafeInteger(payload.version) && payload.version >= 1
        ? payload.version
        : 1;

    const icon =
      typeof payload.icon === 'string' && payload.icon.trim().length > 0
        ? payload.icon.trim()
        : null;

    const color =
      typeof payload.color === 'string' && payload.color.trim().length > 0
        ? payload.color.trim()
        : null;

    const isDefault = Boolean(payload.is_default ?? payload.isDefault);
    const isArchived = Boolean(payload.is_archived ?? payload.isArchived);

    return {
      id,
      user_id: userId,
      name: name.trim(),
      type: type as CategoryType,
      icon,
      color,
      is_default: isDefault,
      is_archived: isArchived,
      version
    };
  }

  /**
   * Maps an outbox UPDATE payload to a partial CloudCategoryRow.
   * Strips immutable fields: id, user_id, created_at.
   * Strips legacy Dexie fields: parentId, isSystem.
   */
  public static mapUpdatePayload(payload: Record<string, unknown>): Partial<CloudCategoryRow> {
    const patch: Partial<CloudCategoryRow> = {};

    if (payload.version !== undefined) {
      if (typeof payload.version !== 'number' || !Number.isSafeInteger(payload.version) || payload.version < 1) {
        throw new Error(`Invalid target version '${payload.version}' in category update payload.`);
      }
      patch.version = payload.version;
    }

    if (payload.name !== undefined) {
      if (typeof payload.name !== 'string' || payload.name.trim().length === 0) {
        throw new Error('Category name must not be empty.');
      }
      if (payload.name.trim().length > 100) {
        throw new Error('Category name exceeds maximum length of 100 characters.');
      }
      patch.name = payload.name.trim();
    }

    if (payload.type !== undefined) {
      const type = payload.type as string;
      if (!VALID_CATEGORY_TYPES.has(type)) {
        throw new Error(`Invalid category type '${type}'. Must be income or expense.`);
      }
      patch.type = type as CategoryType;
    }

    if (payload.icon !== undefined) {
      patch.icon =
        typeof payload.icon === 'string' && payload.icon.trim().length > 0
          ? payload.icon.trim()
          : null;
    }

    if (payload.color !== undefined) {
      patch.color =
        typeof payload.color === 'string' && payload.color.trim().length > 0
          ? payload.color.trim()
          : null;
    }

    if (payload.is_default !== undefined || payload.isDefault !== undefined) {
      patch.is_default = Boolean(payload.is_default ?? payload.isDefault);
    }

    if (payload.is_archived !== undefined || payload.isArchived !== undefined) {
      patch.is_archived = Boolean(payload.is_archived ?? payload.isArchived);
    }

    // Explicit updated_at timestamp
    patch.updated_at = new Date().toISOString();

    // Strip immutable fields
    delete (patch as Record<string, unknown>).id;
    delete (patch as Record<string, unknown>).user_id;
    delete (patch as Record<string, unknown>).created_at;

    // Strip legacy Dexie fields
    delete (patch as Record<string, unknown>).parentId;
    delete (patch as Record<string, unknown>).isSystem;

    return patch;
  }
}

import { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../supabaseClient';
import { CloudCategoryRow } from '../mappers/CategoryMapper';
import {
  DEFAULT_CLOUD_PAGE_SIZE,
  fetchAllOrderedPages,
  hasRangeMethod,
  RangeCapableQuery
} from './cloudPagination';
import {
  SyncAuthError,
  SyncConflictError,
  SyncDatabaseError
} from '@/infrastructure/sync/errors/SyncErrors';
import { isValidUuid } from '@/domain/value-objects/Identifiers';

export interface ISupabaseCategoryRepository {
  insert(category: CloudCategoryRow): Promise<CloudCategoryRow>;
  updatePartial(
    id: string,
    userId: string,
    patch: Partial<CloudCategoryRow>,
    expectedVersion: number
  ): Promise<CloudCategoryRow>;
  findById(id: string, userId?: string): Promise<CloudCategoryRow | null>;
  findAll(userId: string): Promise<CloudCategoryRow[]>;
  findPage?(
    userId: string,
    options?: { offset?: number; limit?: number }
  ): Promise<{ rows: CloudCategoryRow[]; hasMore: boolean; nextOffset: number }>;
  findByNameAndType(
    userId: string,
    name: string,
    type: 'income' | 'expense'
  ): Promise<CloudCategoryRow | null>;
}

export class SupabaseCategoryRepository implements ISupabaseCategoryRepository {
  constructor(private readonly client: SupabaseClient = supabase) {}

  /**
   * Inserts a canonical category row into Supabase PostgreSQL.
   * Guarantees:
   * 1. Preserves local category UUID when valid.
   * 2. Reconciles PostgreSQL error 23505 (duplicate key on ID) idempotently.
   * 3. Enforces tenant ownership and RLS boundaries.
   * 4. Never uses unconditional upsert.
   */
  public async insert(category: CloudCategoryRow): Promise<CloudCategoryRow> {
    if (!category.user_id || category.user_id.trim().length === 0) {
      throw new SyncAuthError('Cannot insert category: user_id is missing or unauthenticated.');
    }

    if (!isValidUuid(category.id)) {
      throw new Error(`Cannot insert category: invalid category ID '${category.id}' (must be a valid UUID).`);
    }

    const { data, error } = await this.client
      .from('categories')
      .insert(category)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        // Reconcile duplicate key error on ID
        const existing = await this.findById(category.id, category.user_id);

        if (!existing || existing.user_id !== category.user_id) {
          throw new SyncConflictError(
            `Category ID '${category.id}' already exists and belongs to another user or is inaccessible under current RLS.`
          );
        }

        // Compare creation fields for idempotency
        const isIdentical =
          existing.name.trim().toLowerCase() === category.name.trim().toLowerCase() &&
          existing.type === category.type &&
          existing.version === category.version &&
          existing.is_default === category.is_default &&
          existing.is_archived === category.is_archived &&
          (existing.icon ?? null) === (category.icon ?? null) &&
          (existing.color ?? null) === (category.color ?? null);

        if (isIdentical) {
          return existing;
        }

        throw new SyncConflictError(
          `Category ID '${category.id}' already exists in cloud with conflicting data.`,
          existing
        );
      }

      if (error.code === '42501') {
        throw new SyncDatabaseError(
          'RLS permission denied: Cannot insert category for this user context.',
          '42501',
          error
        );
      }

      throw new SyncDatabaseError(error.message, error.code, error);
    }

    if (!data) {
      throw new SyncDatabaseError('Insert succeeded but no data returned from Supabase.');
    }

    const verified = data as CloudCategoryRow;
    this.verifyPersistedRow(verified, category.id, category.user_id, category.version);
    return verified;
  }

  /**
   * Safely updates mutable fields of a category using optimistic concurrency control.
   */
  public async updatePartial(
    id: string,
    userId: string,
    patch: Partial<CloudCategoryRow>,
    expectedVersion: number
  ): Promise<CloudCategoryRow> {
    if (!userId || userId.trim().length === 0) {
      throw new SyncAuthError('Cannot update category: user ID is missing or unauthenticated.');
    }

    const current = await this.findById(id, userId);

    if (!current) {
      throw new SyncConflictError(
        `Category '${id}' was not found in cloud or is hidden by RLS policies.`
      );
    }

    if (current.user_id !== userId) {
      throw new SyncConflictError(`Category '${id}' belongs to a different user.`);
    }

    const targetVersion = patch.version ?? expectedVersion + 1;

    // Check for idempotent replay if current version is already at targetVersion
    if (current.version === targetVersion) {
      const isMatch =
        (patch.name === undefined || current.name === patch.name) &&
        (patch.type === undefined || current.type === patch.type) &&
        (patch.icon === undefined || current.icon === patch.icon) &&
        (patch.color === undefined || current.color === patch.color) &&
        (patch.is_default === undefined || current.is_default === patch.is_default) &&
        (patch.is_archived === undefined || current.is_archived === patch.is_archived);

      if (isMatch) {
        return current;
      }

      throw new SyncConflictError(
        `Category '${id}' is already at target version ${targetVersion}, but cloud data differs from update payload.`,
        current
      );
    }

    // Version conflict
    if (current.version !== expectedVersion) {
      throw new SyncConflictError(
        `Version conflict on category '${id}': cloud version is ${current.version}, expected previous version was ${expectedVersion}.`,
        current
      );
    }

    // Sanitize patch
    const sanitizedPatch: Record<string, unknown> = { ...patch };
    delete sanitizedPatch.id;
    delete sanitizedPatch.user_id;
    delete sanitizedPatch.created_at;

    if (!sanitizedPatch.updated_at) {
      sanitizedPatch.updated_at = new Date().toISOString();
    }

    const { data, error } = await this.client
      .from('categories')
      .update(sanitizedPatch)
      .eq('id', id)
      .eq('user_id', userId)
      .eq('version', expectedVersion)
      .select()
      .maybeSingle();

    if (error) {
      if (error.code === '42501') {
        throw new SyncDatabaseError(
          'RLS permission denied: Cannot update category for this user context.',
          '42501',
          error
        );
      }
      throw new SyncDatabaseError(error.message, error.code, error);
    }

    if (!data) {
      const recheck = await this.findById(id, userId);
      if (recheck && recheck.version === targetVersion) {
        return recheck;
      }
      throw new SyncConflictError(
        `Optimistic concurrency update failed for category '${id}': expected version ${expectedVersion} no longer matches.`
      );
    }

    const verified = data as CloudCategoryRow;
    this.verifyPersistedRow(verified, id, userId, targetVersion);
    return verified;
  }

  public async findById(id: string, userId?: string): Promise<CloudCategoryRow | null> {
    if (!id || !isValidUuid(id)) {
      return null;
    }

    let query = this.client
      .from('categories')
      .select('*')
      .eq('id', id);

    if (userId) {
      query = query.eq('user_id', userId);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new SyncDatabaseError(error.message, error.code, error);
    }

    return (data as CloudCategoryRow) || null;
  }

  public async findPage(
    userId: string,
    options: { offset?: number; limit?: number } = {}
  ): Promise<{ rows: CloudCategoryRow[]; hasMore: boolean; nextOffset: number }> {
    if (!userId || userId.trim().length === 0) {
      return { rows: [], hasMore: false, nextOffset: 0 };
    }

    const safeOffset = Math.max(0, Math.floor(options.offset ?? 0));
    const safeLimit = Math.max(
      1,
      Math.min(1000, Math.floor(options.limit ?? DEFAULT_CLOUD_PAGE_SIZE))
    );

    const eqQuery = this.client
      .from('categories')
      .select('*')
      .eq('user_id', userId);

    const orderedQuery =
      typeof (eqQuery as { order?: unknown }).order === 'function'
        ? eqQuery.order('created_at', { ascending: true }).order('id', { ascending: true })
        : eqQuery;

    const { data, error } = hasRangeMethod<CloudCategoryRow>(orderedQuery)
      ? await orderedQuery.range(safeOffset, safeOffset + safeLimit)
      : await orderedQuery;

    if (error) {
      throw new SyncDatabaseError(error.message, error.code, error);
    }

    const batch = (data as CloudCategoryRow[]) || [];
    const hasMore = hasRangeMethod<CloudCategoryRow>(orderedQuery)
      ? batch.length > safeLimit
      : false;
    const rows = hasMore ? batch.slice(0, safeLimit) : batch;

    for (const row of rows) {
      if (row.user_id !== userId) {
        throw new SyncAuthError(`Retrieved category '${row.id}' belongs to another user.`);
      }
    }

    return {
      rows,
      hasMore,
      nextOffset: safeOffset + rows.length
    };
  }

  public async findAll(userId: string): Promise<CloudCategoryRow[]> {
    if (!userId || userId.trim().length === 0) {
      return [];
    }

    const eqQuery = this.client
      .from('categories')
      .select('*')
      .eq('user_id', userId);

    let rows: CloudCategoryRow[];
    if (!hasRangeMethod<CloudCategoryRow>(eqQuery)) {
      const { data, error } = await eqQuery;
      if (error) {
        throw new SyncDatabaseError(error.message, error.code, error);
      }
      rows = (data as CloudCategoryRow[]) || [];
    } else {
      rows = await fetchAllOrderedPages<CloudCategoryRow>(
        () =>
          this.client
            .from('categories')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: true })
            .order('id', { ascending: true }) as unknown as RangeCapableQuery<CloudCategoryRow>,
        DEFAULT_CLOUD_PAGE_SIZE,
        (err) => new SyncDatabaseError(err.message, err.code, err)
      );
    }

    for (const row of rows) {
      if (row.user_id !== userId) {
        throw new SyncAuthError(`Retrieved category '${row.id}' belongs to another user.`);
      }
    }

    return rows;
  }

  public async findByNameAndType(
    userId: string,
    name: string,
    type: 'income' | 'expense'
  ): Promise<CloudCategoryRow | null> {
    if (!userId || !name || !type) {
      return null;
    }

    const { data, error } = await this.client
      .from('categories')
      .select('*')
      .eq('user_id', userId)
      .eq('name', name.trim())
      .eq('type', type)
      .maybeSingle();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new SyncDatabaseError(error.message, error.code, error);
    }

    return (data as CloudCategoryRow) || null;
  }

  private verifyPersistedRow(
    row: CloudCategoryRow,
    expectedId: string,
    expectedUserId: string,
    expectedVersion: number
  ): void {
    if (row.id !== expectedId) {
      throw new Error(`Persisted category ID mismatch: expected '${expectedId}', got '${row.id}'.`);
    }
    if (row.user_id !== expectedUserId) {
      throw new Error(`Persisted category owner mismatch: expected '${expectedUserId}', got '${row.user_id}'.`);
    }
    if (row.version !== expectedVersion) {
      throw new Error(`Persisted category version mismatch: expected '${expectedVersion}', got '${row.version}'.`);
    }
  }
}

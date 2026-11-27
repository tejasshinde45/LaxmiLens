import { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../supabaseClient';
import { CloudLenderRow } from '../mappers/LenderMapper';
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

export interface ISupabaseLenderRepository {
  insert(lender: CloudLenderRow): Promise<CloudLenderRow>;
  updatePartial(
    id: string,
    userId: string,
    patch: Partial<CloudLenderRow>
  ): Promise<CloudLenderRow>;
  findById(id: string, userId: string): Promise<CloudLenderRow | null>;
  findByName(name: string, userId: string): Promise<CloudLenderRow | null>;
  findAll(userId: string): Promise<CloudLenderRow[]>;
  findPage?(
    userId: string,
    options?: { offset?: number; limit?: number }
  ): Promise<{ rows: CloudLenderRow[]; hasMore: boolean; nextOffset: number }>;
}

export class SupabaseLenderRepository implements ISupabaseLenderRepository {
  constructor(private readonly client: SupabaseClient = supabase) {}

  /**
   * Inserts a lender row into PostgreSQL.
   * If error 23505 (unique violation on ID) occurs:
   * - Performs an idempotent reconciliation check under current user context.
   * - If already persisted with identical fields, returns the existing record.
   * - If differing data or owned by another tenant, raises SyncConflictError.
   */
  public async insert(lender: CloudLenderRow): Promise<CloudLenderRow> {
    if (!lender.user_id || lender.user_id.trim().length === 0) {
      throw new SyncAuthError('Cannot insert lender: user_id is missing or unauthenticated.');
    }

    const { data, error } = await this.client
      .from('lenders')
      .insert(lender)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        const existing = await this.findById(lender.id, lender.user_id);

        if (!existing || existing.user_id !== lender.user_id) {
          throw new SyncConflictError(
            `Lender ID '${lender.id}' already exists and belongs to another user or is inaccessible under current RLS.`
          );
        }

        const isIdentical =
          existing.name === lender.name &&
          (existing.phone ?? null) === (lender.phone ?? null) &&
          (existing.email ?? null) === (lender.email ?? null) &&
          (existing.notes ?? null) === (lender.notes ?? null) &&
          existing.is_archived === lender.is_archived;

        if (isIdentical) {
          return existing;
        }

        throw new SyncConflictError(
          `Lender ID '${lender.id}' already exists in cloud with conflicting data.`,
          existing
        );
      }

      if (error.code === '42501') {
        throw new SyncDatabaseError(
          'RLS permission denied: Cannot insert lender for this user context.',
          '42501',
          error
        );
      }

      throw new SyncDatabaseError(error.message, error.code, error);
    }

    if (!data) {
      throw new SyncDatabaseError('Insert succeeded but no data returned from Supabase.');
    }

    const verified = data as CloudLenderRow;
    this.verifyPersistedRow(verified, lender.id, lender.user_id);
    return verified;
  }

  /**
   * Updates mutable fields of a lender.
   * Filtered by primary key and user_id.
   */
  public async updatePartial(
    id: string,
    userId: string,
    patch: Partial<CloudLenderRow>
  ): Promise<CloudLenderRow> {
    if (!userId || userId.trim().length === 0) {
      throw new SyncAuthError('Cannot update lender: user ID is missing or unauthenticated.');
    }

    const sanitizedPatch: Record<string, unknown> = { ...patch };
    delete sanitizedPatch.id;
    delete sanitizedPatch.user_id;
    delete sanitizedPatch.created_at;

    if (!sanitizedPatch.updated_at) {
      sanitizedPatch.updated_at = new Date().toISOString();
    }

    const { data, error } = await this.client
      .from('lenders')
      .update(sanitizedPatch)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .maybeSingle();

    if (error) {
      if (error.code === '42501') {
        throw new SyncDatabaseError(
          'RLS permission denied: Cannot update lender for this user context.',
          '42501',
          error
        );
      }
      throw new SyncDatabaseError(error.message, error.code, error);
    }

    if (data) {
      const verified = data as CloudLenderRow;
      this.verifyPersistedRow(verified, id, userId);
      return verified;
    }

    // 0 rows updated: check if already committed or missing
    const current = await this.findById(id, userId);

    if (!current) {
      throw new SyncConflictError(
        `Lender '${id}' was not found in cloud or is hidden by RLS policies.`
      );
    }

    if (current.user_id !== userId) {
      throw new SyncConflictError(`Lender '${id}' belongs to a different user.`);
    }

    // Check if patch is already reflected (idempotent replay)
    let fieldsMatch = true;
    for (const [key, value] of Object.entries(sanitizedPatch)) {
      if (key === 'updated_at') continue;
      const currentVal = current[key as keyof CloudLenderRow] ?? null;
      const patchVal = (value as unknown) ?? null;
      if (currentVal !== patchVal) {
        fieldsMatch = false;
        break;
      }
    }

    if (fieldsMatch) {
      return current;
    }

    throw new SyncConflictError(
      `Lender '${id}' update failed: cloud data differs from update patch.`,
      current
    );
  }

  /**
   * Retrieves a lender by ID scoped to current user.
   */
  public async findById(id: string, userId: string): Promise<CloudLenderRow | null> {
    if (!userId || userId.trim().length === 0) {
      throw new SyncAuthError('Cannot query lender: userId is required for tenant isolation.');
    }
    if (!isValidUuid(id)) {
      return null;
    }

    const { data, error } = await this.client
      .from('lenders')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      throw new SyncDatabaseError(error.message, error.code, error);
    }

    return (data as CloudLenderRow) || null;
  }

  /**
   * Retrieves a lender by name scoped to current user.
   */
  public async findByName(name: string, userId: string): Promise<CloudLenderRow | null> {
    if (!userId || userId.trim().length === 0) {
      throw new SyncAuthError('Cannot query lender: userId is required for tenant isolation.');
    }

    const { data, error } = await this.client
      .from('lenders')
      .select('*')
      .eq('name', name.trim())
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      throw new SyncDatabaseError(error.message, error.code, error);
    }

    return (data as CloudLenderRow) || null;
  }

  /**
   * Retrieves a deterministic page of lenders belonging to the specified user.
   */
  public async findPage(
    userId: string,
    options: { offset?: number; limit?: number } = {}
  ): Promise<{ rows: CloudLenderRow[]; hasMore: boolean; nextOffset: number }> {
    if (!userId || userId.trim().length === 0) {
      throw new SyncAuthError('Cannot query lenders: userId is required for tenant isolation.');
    }

    const safeOffset = Math.max(0, Math.floor(options.offset ?? 0));
    const safeLimit = Math.max(
      1,
      Math.min(1000, Math.floor(options.limit ?? DEFAULT_CLOUD_PAGE_SIZE))
    );

    const orderedQuery = this.client
      .from('lenders')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });

    const { data, error } = hasRangeMethod<CloudLenderRow>(orderedQuery)
      ? await orderedQuery.range(safeOffset, safeOffset + safeLimit)
      : await orderedQuery;

    if (error) {
      throw new SyncDatabaseError(error.message, error.code, error);
    }

    const batch = (data || []) as CloudLenderRow[];
    const hasMore = hasRangeMethod<CloudLenderRow>(orderedQuery)
      ? batch.length > safeLimit
      : false;
    const rows = hasMore ? batch.slice(0, safeLimit) : batch;

    for (const row of rows) {
      if (row.user_id !== userId) {
        throw new SyncAuthError(`Retrieved lender '${row.id}' belongs to another user.`);
      }
    }

    return {
      rows,
      hasMore,
      nextOffset: safeOffset + rows.length
    };
  }

  /**
   * Retrieves all lenders belonging to the specified user without silent truncation.
   */
  public async findAll(userId: string): Promise<CloudLenderRow[]> {
    if (!userId || userId.trim().length === 0) {
      throw new SyncAuthError('Cannot query lenders: userId is required for tenant isolation.');
    }

    const baseQuery = this.client
      .from('lenders')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    let rows: CloudLenderRow[];
    if (!hasRangeMethod<CloudLenderRow>(baseQuery)) {
      const { data, error } = await baseQuery;
      if (error) {
        throw new SyncDatabaseError(error.message, error.code, error);
      }
      rows = (data || []) as CloudLenderRow[];
    } else {
      rows = await fetchAllOrderedPages<CloudLenderRow>(
        () =>
          this.client
            .from('lenders')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: true })
            .order('id', { ascending: true }) as unknown as RangeCapableQuery<CloudLenderRow>,
        DEFAULT_CLOUD_PAGE_SIZE,
        (err) => new SyncDatabaseError(err.message, err.code, err)
      );
    }

    for (const row of rows) {
      if (row.user_id !== userId) {
        throw new SyncAuthError(`Retrieved lender '${row.id}' belongs to another user.`);
      }
    }

    return rows;
  }

  private verifyPersistedRow(
    row: CloudLenderRow,
    expectedId: string,
    expectedUserId: string
  ): void {
    if (row.id !== expectedId) {
      throw new Error(`Persisted lender ID '${row.id}' does not match expected ID '${expectedId}'.`);
    }
    if (row.user_id !== expectedUserId) {
      throw new Error(`Persisted lender user_id '${row.user_id}' does not match expected owner '${expectedUserId}'.`);
    }
  }
}

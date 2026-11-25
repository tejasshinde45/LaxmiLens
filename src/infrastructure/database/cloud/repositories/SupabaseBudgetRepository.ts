import { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../supabaseClient';
import { BudgetMapper, CloudBudgetRow } from '../mappers/BudgetMapper';
import { ISupabaseCategoryRepository } from './SupabaseCategoryRepository';
import { isValidUuid } from '@/domain/value-objects/Identifiers';
import { BUDGET_PERIOD_REGEX } from '@/domain/entities/Budget';
import {
  SyncAuthError,
  SyncConflictError,
  SyncDatabaseError,
  SyncUnresolvedCategoryError
} from '@/infrastructure/sync/errors/SyncErrors';

export interface BudgetQueryOptions {
  includeDeleted?: boolean;
}

export interface ISupabaseBudgetRepository {
  insert(budget: CloudBudgetRow): Promise<CloudBudgetRow>;
  updatePartial(
    id: string,
    userId: string,
    patch: Partial<CloudBudgetRow>,
    expectedVersion: number
  ): Promise<CloudBudgetRow>;
  softDelete(
    id: string,
    userId: string,
    deletedAt: string,
    expectedVersion: number,
    targetVersion?: number
  ): Promise<CloudBudgetRow>;
  findById(
    id: string,
    userId: string,
    options?: BudgetQueryOptions
  ): Promise<CloudBudgetRow | null>;
  findAll(userId: string, options?: BudgetQueryOptions): Promise<CloudBudgetRow[]>;
  findActiveByCategoryAndPeriod(
    userId: string,
    categoryId: string,
    period: string
  ): Promise<CloudBudgetRow | null>;
}

export class SupabaseBudgetRepository implements ISupabaseBudgetRepository {
  constructor(
    private readonly client: SupabaseClient = supabase,
    private readonly categoryRepo?: ISupabaseCategoryRepository
  ) {}

  /**
   * Inserts a canonical budget row into Supabase PostgreSQL.
   * Guarantees:
   * 1. Preserves local budget UUID and integer paise limits.
   * 2. Validates category existence, user ownership, and expense classification.
   * 3. Never creates already-tombstoned rows or reactivates tombstoned IDs.
   * 4. Reconciles PostgreSQL error 23505 (idempotent retry vs active slot or tombstone conflict).
   * 5. Never uses unconditional upsert.
   */
  public async insert(budget: CloudBudgetRow): Promise<CloudBudgetRow> {
    if (!budget.user_id || budget.user_id.trim().length === 0) {
      throw new SyncAuthError('Cannot insert budget: user_id is missing or unauthenticated.');
    }

    BudgetMapper.validateCloudRow(budget);
    if (budget.deleted_at !== null && budget.deleted_at !== undefined) {
      throw new Error('Cannot insert a budget with deleted_at already set.');
    }

    // 1. Validate category dependency ownership & expense type
    await this.verifyExpenseCategoryExists(budget.category_id, budget.user_id);

    // 2. Insert into Supabase
    const { data, error } = await this.client
      .from('budgets')
      .insert(budget)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return await this.reconcileDuplicateInsert(budget);
      }

      if (error.code === '23503') {
        throw new SyncUnresolvedCategoryError(
          `Cannot persist budget '${budget.id}': Category reference '${budget.category_id}' does not exist in cloud.`,
          budget.category_id
        );
      }

      if (error.code === '42501') {
        throw new SyncDatabaseError(
          'RLS permission denied: Cannot insert budget for this user context.',
          '42501',
          error
        );
      }

      throw new SyncDatabaseError(error.message, error.code, error);
    }

    if (!data) {
      throw new SyncDatabaseError('Insert succeeded but no data returned from Supabase.');
    }

    const verified = data as CloudBudgetRow;
    BudgetMapper.validateCloudRow(verified);
    this.verifyPersistedRow(verified, budget.id, budget.user_id, budget.version);
    return verified;
  }

  /**
   * Updates mutable fields (limit_paise, version, updated_at) on an active cloud budget
   * using optimistic concurrency control. Rejects stale versions and tombstoned budgets.
   */
  public async updatePartial(
    id: string,
    userId: string,
    patch: Partial<CloudBudgetRow>,
    expectedVersion: number
  ): Promise<CloudBudgetRow> {
    if (!userId || userId.trim().length === 0) {
      throw new SyncAuthError('Cannot update budget: user ID is missing or unauthenticated.');
    }
    if (!isValidUuid(id)) {
      throw new Error(`Invalid budget ID '${id}': must be a valid UUID.`);
    }
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw new Error(`Invalid expectedVersion '${expectedVersion}' for budget update.`);
    }

    const targetVersion = patch.version ?? expectedVersion + 1;
    if (!Number.isSafeInteger(targetVersion) || targetVersion !== expectedVersion + 1) {
      throw new Error(
        `Invalid target version '${targetVersion}' for expectedVersion '${expectedVersion}'.`
      );
    }

    // Sanitize patch: never allow mutating identity, ownership, category, period, created_at, or deleted_at
    const sanitizedPatch: Record<string, unknown> = { ...patch };
    delete sanitizedPatch.id;
    delete sanitizedPatch.user_id;
    delete sanitizedPatch.category_id;
    delete sanitizedPatch.period;
    delete sanitizedPatch.created_at;
    delete sanitizedPatch.deleted_at;

    sanitizedPatch.version = targetVersion;
    if (!sanitizedPatch.updated_at) {
      sanitizedPatch.updated_at = new Date().toISOString();
    }

    const { data, error } = await this.client
      .from('budgets')
      .update(sanitizedPatch)
      .eq('id', id)
      .eq('user_id', userId)
      .eq('version', expectedVersion)
      .is('deleted_at', null)
      .select()
      .maybeSingle();

    if (error) {
      if (error.code === '42501') {
        throw new SyncDatabaseError(
          'RLS permission denied: Cannot update budget for this user context.',
          '42501',
          error
        );
      }
      throw new SyncDatabaseError(error.message, error.code, error);
    }

    if (data) {
      const verified = data as CloudBudgetRow;
      BudgetMapper.validateCloudRow(verified);
      this.verifyPersistedRow(verified, id, userId, targetVersion);
      return verified;
    }

    // 0 rows matched: inspect current cloud row (including tombstones) to distinguish retry vs conflict
    const current = await this.findById(id, userId, { includeDeleted: true });
    if (!current) {
      throw new SyncConflictError(
        `Budget '${id}' was not found in cloud or is hidden by RLS policies.`
      );
    }
    if (current.user_id !== userId) {
      throw new SyncConflictError(`Budget '${id}' belongs to a different user.`);
    }
    if (current.deleted_at !== null && current.deleted_at !== undefined) {
      throw new SyncConflictError(
        `Budget '${id}' has already been deleted (tombstoned) in cloud and cannot be updated or reactivated.`,
        current
      );
    }

    if (
      current.version === targetVersion &&
      (patch.limit_paise === undefined || current.limit_paise === patch.limit_paise)
    ) {
      // Idempotent retry: update was already committed at targetVersion
      return current;
    }

    throw new SyncConflictError(
      `Version conflict on budget '${id}': cloud version is ${current.version}, expected previous version was ${expectedVersion}.`,
      current
    );
  }

  /**
   * Marks an active budget as tombstoned by setting deleted_at and incrementing version.
   * Never executes a physical SQL DELETE.
   */
  public async softDelete(
    id: string,
    userId: string,
    deletedAt: string,
    expectedVersion: number,
    targetVersion?: number
  ): Promise<CloudBudgetRow> {
    if (!userId || userId.trim().length === 0) {
      throw new SyncAuthError('Cannot delete budget: user ID is missing or unauthenticated.');
    }
    if (!isValidUuid(id)) {
      throw new Error(`Invalid budget ID '${id}': must be a valid UUID.`);
    }
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw new Error(`Invalid expectedVersion '${expectedVersion}' for budget softDelete.`);
    }

    const parsedDeleted = new Date(deletedAt);
    if (isNaN(parsedDeleted.getTime())) {
      throw new Error(`Invalid deletedAt '${deletedAt}' for budget softDelete.`);
    }
    const resolvedDeletedAt = parsedDeleted.toISOString();

    const resolvedTargetVersion = targetVersion ?? expectedVersion + 1;
    if (
      !Number.isSafeInteger(resolvedTargetVersion) ||
      resolvedTargetVersion !== expectedVersion + 1
    ) {
      throw new Error(
        `Invalid targetVersion '${resolvedTargetVersion}' for expectedVersion '${expectedVersion}'.`
      );
    }

    const { data, error } = await this.client
      .from('budgets')
      .update({
        deleted_at: resolvedDeletedAt,
        version: resolvedTargetVersion,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .eq('user_id', userId)
      .eq('version', expectedVersion)
      .is('deleted_at', null)
      .select()
      .maybeSingle();

    if (error) {
      if (error.code === '42501') {
        throw new SyncDatabaseError(
          'RLS permission denied: Cannot delete budget for this user context.',
          '42501',
          error
        );
      }
      throw new SyncDatabaseError(error.message, error.code, error);
    }

    if (data) {
      const verified = data as CloudBudgetRow;
      BudgetMapper.validateCloudRow(verified);
      this.verifyPersistedRow(verified, id, userId, resolvedTargetVersion);
      if (!verified.deleted_at) {
        throw new Error(`Budget tombstone confirmation failed for ID '${id}': deleted_at is null.`);
      }
      return verified;
    }

    // 0 rows matched: inspect current state (including tombstones)
    const current = await this.findById(id, userId, { includeDeleted: true });
    if (!current) {
      throw new SyncConflictError(
        `Budget '${id}' was not found in cloud or is hidden by RLS policies.`
      );
    }
    if (current.user_id !== userId) {
      throw new SyncConflictError(`Budget '${id}' belongs to a different user.`);
    }

    if (
      current.deleted_at !== null &&
      current.deleted_at !== undefined &&
      current.version === resolvedTargetVersion
    ) {
      // Idempotent retry: tombstone already applied at targetVersion
      return current;
    }

    if (current.deleted_at !== null && current.deleted_at !== undefined) {
      throw new SyncConflictError(
        `Budget '${id}' was already tombstoned at version ${current.version} (expected version before delete was ${expectedVersion}).`,
        current
      );
    }

    throw new SyncConflictError(
      `Version conflict during delete of budget '${id}': cloud version is ${current.version}, expected ${expectedVersion}.`,
      current
    );
  }

  /**
   * Retrieves a budget by ID scoped to authenticated user.
   * Excludes tombstoned rows by default unless options.includeDeleted is true.
   */
  public async findById(
    id: string,
    userId: string,
    options: BudgetQueryOptions = {}
  ): Promise<CloudBudgetRow | null> {
    if (!userId || userId.trim().length === 0) {
      throw new SyncAuthError('Cannot query budget: userId is required for tenant isolation.');
    }
    if (!isValidUuid(id)) {
      return null;
    }

    let query = this.client
      .from('budgets')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId);

    if (!options.includeDeleted) {
      query = query.is('deleted_at', null);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      throw new SyncDatabaseError(error.message, error.code, error);
    }

    if (!data) {
      return null;
    }

    const row = data as CloudBudgetRow;
    BudgetMapper.validateCloudRow(row);
    if (row.user_id !== userId) {
      throw new SyncAuthError(`Retrieved budget '${row.id}' belongs to another user.`);
    }
    if (!options.includeDeleted && row.deleted_at !== null && row.deleted_at !== undefined) {
      return null;
    }

    return row;
  }

  /**
   * Retrieves budgets belonging to the specified user.
   * Excludes tombstoned rows by default unless options.includeDeleted is true.
   */
  public async findAll(
    userId: string,
    options: BudgetQueryOptions = {}
  ): Promise<CloudBudgetRow[]> {
    if (!userId || userId.trim().length === 0) {
      throw new SyncAuthError('Cannot query budgets: userId is required for tenant isolation.');
    }

    let query = this.client
      .from('budgets')
      .select('*')
      .eq('user_id', userId);

    if (!options.includeDeleted) {
      query = query.is('deleted_at', null);
    }

    const { data, error } = await query.order('period', { ascending: false });

    if (error) {
      throw new SyncDatabaseError(error.message, error.code, error);
    }

    const rows = (data || []) as CloudBudgetRow[];
    for (const row of rows) {
      BudgetMapper.validateCloudRow(row);
      if (row.user_id !== userId) {
        throw new SyncAuthError(`Retrieved budget '${row.id}' belongs to another user.`);
      }
    }

    return options.includeDeleted
      ? rows
      : rows.filter((r) => r.deleted_at === null || r.deleted_at === undefined);
  }

  /**
   * Retrieves the active (non-deleted) budget for (user_id, category_id, period).
   */
  public async findActiveByCategoryAndPeriod(
    userId: string,
    categoryId: string,
    period: string
  ): Promise<CloudBudgetRow | null> {
    if (!userId || userId.trim().length === 0) {
      throw new SyncAuthError('Cannot query budget: userId is required for tenant isolation.');
    }
    if (!isValidUuid(categoryId) || !BUDGET_PERIOD_REGEX.test(period.trim())) {
      return null;
    }

    const { data, error } = await this.client
      .from('budgets')
      .select('*')
      .eq('user_id', userId)
      .eq('category_id', categoryId)
      .eq('period', period.trim())
      .is('deleted_at', null)
      .maybeSingle();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      throw new SyncDatabaseError(error.message, error.code, error);
    }

    if (!data) {
      return null;
    }

    const row = data as CloudBudgetRow;
    BudgetMapper.validateCloudRow(row);
    if (row.user_id !== userId) {
      throw new SyncAuthError(`Retrieved budget '${row.id}' belongs to another user.`);
    }
    if (row.deleted_at !== null && row.deleted_at !== undefined) {
      return null;
    }

    return row;
  }

  private async reconcileDuplicateInsert(attempted: CloudBudgetRow): Promise<CloudBudgetRow> {
    // 1. Check same primary key ID (including tombstones so deleted IDs cannot reactivate)
    const existingById = await this.findById(attempted.id, attempted.user_id, {
      includeDeleted: true
    });

    if (existingById) {
      if (existingById.user_id !== attempted.user_id) {
        throw new SyncConflictError(
          `Budget ID '${attempted.id}' already exists and belongs to another user.`
        );
      }

      if (existingById.deleted_at !== null && existingById.deleted_at !== undefined) {
        throw new SyncConflictError(
          `Budget ID '${attempted.id}' was already deleted (tombstoned) in cloud and cannot be recreated or reactivated.`,
          existingById
        );
      }

      const isIdentical =
        existingById.category_id === attempted.category_id &&
        existingById.period === attempted.period &&
        existingById.limit_paise === attempted.limit_paise &&
        existingById.version === attempted.version;

      if (isIdentical) {
        return existingById;
      }

      throw new SyncConflictError(
        `Budget ID '${attempted.id}' already exists in cloud with conflicting data.`,
        existingById
      );
    }

    // 2. Check active composite key (user_id, category_id, period)
    const existingBySlot = await this.findActiveByCategoryAndPeriod(
      attempted.user_id,
      attempted.category_id,
      attempted.period
    );
    if (existingBySlot) {
      throw new SyncConflictError(
        `An active budget ('${existingBySlot.id}') already exists in cloud for category '${attempted.category_id}' and period '${attempted.period}'.`,
        existingBySlot
      );
    }

    throw new SyncConflictError(
      `Budget ID '${attempted.id}' already exists and is inaccessible under current RLS.`
    );
  }

  private async verifyExpenseCategoryExists(categoryId: string, userId: string): Promise<void> {
    if (!isValidUuid(categoryId)) {
      throw new SyncUnresolvedCategoryError(
        `Invalid category ID '${categoryId}': must be a valid UUID.`,
        categoryId
      );
    }

    let categoryRow: { id: string; user_id: string; type: string } | null = null;

    if (this.categoryRepo) {
      categoryRow = await this.categoryRepo.findById(categoryId, userId);
    } else {
      const { data, error } = await this.client
        .from('categories')
        .select('id, user_id, type')
        .eq('id', categoryId)
        .eq('user_id', userId)
        .maybeSingle();

      if (error) {
        throw new SyncDatabaseError(error.message, error.code, error);
      }
      categoryRow = data as { id: string; user_id: string; type: string } | null;
    }

    if (!categoryRow || categoryRow.user_id !== userId) {
      throw new SyncUnresolvedCategoryError(
        `Cannot sync budget: Referenced category '${categoryId}' was not found in cloud or does not belong to user '${userId}'.`,
        categoryId
      );
    }

    if (categoryRow.type !== 'expense') {
      throw new Error(
        `Category type mismatch: Budget category '${categoryId}' must be of type expense, got '${categoryRow.type}'.`
      );
    }
  }

  private verifyPersistedRow(
    row: CloudBudgetRow,
    expectedId: string,
    expectedUserId: string,
    expectedVersion: number
  ): void {
    if (row.id !== expectedId) {
      throw new Error(`Persisted budget ID '${row.id}' does not match expected ID '${expectedId}'.`);
    }
    if (row.user_id !== expectedUserId) {
      throw new Error(
        `Persisted budget user_id '${row.user_id}' does not match expected owner '${expectedUserId}'.`
      );
    }
    if (row.version !== expectedVersion) {
      throw new Error(
        `Persisted budget version '${row.version}' does not match expected version '${expectedVersion}'.`
      );
    }
  }
}

import { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../supabaseClient';
import { CloudAccountRow } from '../mappers/AccountMapper';
import {
  DEFAULT_CLOUD_PAGE_SIZE,
  fetchAllOrderedPages,
  hasRangeMethod,
  RangeCapableQuery
} from './cloudPagination';
import {
  SyncAccountDependencyError,
  SyncAuthError,
  SyncConflictError,
  SyncDatabaseError
} from '@/infrastructure/sync/errors/SyncErrors';

export interface ISupabaseAccountRepository {
  insert(account: CloudAccountRow): Promise<CloudAccountRow>;
  updatePartial(
    id: string,
    userId: string,
    patch: Partial<CloudAccountRow>,
    expectedVersion: number
  ): Promise<CloudAccountRow>;
  safeDelete?(
    id: string,
    userId: string,
    expectedVersion: number,
    deletedAt?: string
  ): Promise<void>;
  findById(id: string): Promise<CloudAccountRow | null>;
  findAll(userId: string, options?: { includeDeleted?: boolean }): Promise<CloudAccountRow[]>;
  findPage?(
    userId: string,
    options?: { offset?: number; limit?: number; includeDeleted?: boolean }
  ): Promise<{ rows: CloudAccountRow[]; hasMore: boolean; nextOffset: number }>;
}

function isAccountDeleted(row: CloudAccountRow): boolean {
  return row.deleted_at !== undefined && row.deleted_at !== null;
}

export class SupabaseAccountRepository implements ISupabaseAccountRepository {
  constructor(private readonly client: SupabaseClient = supabase) {}

  /**
   * Inserts a new account row into PostgreSQL.
   * If error 23505 (unique violation on ID) occurs:
   * - Performs an idempotent reconciliation check under current user context.
   * - Rejects recreation of tombstoned (permanently deleted) accounts.
   * - If already persisted with identical fields, returns the existing record.
   * - If differing data or owned by another tenant, raises SyncConflictError.
   */
  public async insert(account: CloudAccountRow): Promise<CloudAccountRow> {
    if (isAccountDeleted(account)) {
      throw new SyncConflictError(
        `Cannot insert account '${account.id}' with deleted_at already set.`
      );
    }

    // 1. If this is the designated Personal Borrowings system account, provision via authorized SECURITY DEFINER RPC
    if (account.system_tag === 'personal_borrowings') {
      const { data, error } = await this.client.rpc('provision_personal_borrowings_account', {
        p_account_id: account.id,
        p_name: account.name,
        p_currency: account.currency,
        p_color: account.color ?? undefined,
        p_icon: account.icon ?? undefined,
        p_notes: account.notes ?? undefined
      });

      if (error) {
        if (error.code === '42501') {
          throw new SyncDatabaseError(
            'RLS permission denied: Cannot provision personal borrowings system account.',
            '42501',
            error
          );
        }
        throw new SyncDatabaseError(
          `Failed to provision personal borrowings system account: ${error.message}`,
          error.code || 'UNKNOWN',
          error
        );
      }

      if (!data) {
        throw new SyncDatabaseError('Provisioning succeeded but no data returned from Supabase.');
      }

      const verified = data as CloudAccountRow;
      if (verified.id !== account.id) {
        throw new Error(`Persisted row ID '${verified.id}' does not match expected ID '${account.id}'.`);
      }
      if (verified.user_id !== account.user_id) {
        throw new Error(
          `Persisted row user_id '${verified.user_id}' does not match expected owner '${account.user_id}'.`
        );
      }
      if (verified.version < account.version) {
        throw new Error(
          `Persisted row version '${verified.version}' is lower than expected version '${account.version}'.`
        );
      }
      return verified;
    }

    // 2. Standard user accounts proceed via PostgREST table insert (omitting system_tag)
    const { data, error } = await this.client
      .from('accounts')
      .insert(account)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        // Retrieve the conflicting row to determine idempotency vs genuine conflict
        const existing = await this.findById(account.id);

        if (!existing || existing.user_id !== account.user_id) {
          throw new SyncConflictError(
            `Account ID '${account.id}' already exists and belongs to another user or is inaccessible under current RLS.`
          );
        }

        if (isAccountDeleted(existing)) {
          throw new SyncConflictError(
            `Account ID '${account.id}' was permanently deleted in cloud and cannot be recreated.`,
            existing
          );
        }

        // Compare creation fields
        const isIdentical =
          existing.name === account.name &&
          existing.account_type === account.account_type &&
          existing.opening_balance_paise === account.opening_balance_paise &&
          existing.currency === account.currency &&
          existing.version === account.version &&
          existing.is_archived === account.is_archived &&
          (existing.institution_name ?? null) === (account.institution_name ?? null) &&
          (existing.color ?? null) === (account.color ?? null) &&
          (existing.icon ?? null) === (account.icon ?? null) &&
          (existing.notes ?? null) === (account.notes ?? null) &&
          (existing.system_tag ?? null) === (account.system_tag ?? null);

        if (isIdentical) {
          // Idempotent retry: verified matching account already committed in cloud
          return existing;
        }

        throw new SyncConflictError(
          `Account ID '${account.id}' already exists in cloud with conflicting data.`,
          existing
        );
      }

      if (error.code === '42501') {
        throw new SyncDatabaseError(
          'RLS permission denied: Cannot insert account for this user context.',
          '42501',
          error
        );
      }

      if (
        error.code === '40001' ||
        (typeof error.message === 'string' && error.message.toLowerCase().includes('permanently deleted'))
      ) {
        throw new SyncConflictError(error.message);
      }

      throw new SyncDatabaseError(error.message, error.code, error);
    }

    if (!data) {
      throw new SyncDatabaseError('Insert succeeded but no data returned from Supabase.');
    }

    const verified = data as CloudAccountRow;
    if (isAccountDeleted(verified)) {
      throw new SyncConflictError(
        `Account ID '${account.id}' was permanently deleted in cloud.`,
        verified
      );
    }
    this.verifyPersistedRow(verified, account.id, account.user_id, account.version);
    return verified;
  }

  /**
   * Safely updates mutable fields of an account.
   * Filtered by primary key, user_id, and optimistic previous version.
   * If update affects 0 rows, inspects cloud state to resolve idempotent retry vs genuine conflict.
   */
  public async updatePartial(
    id: string,
    userId: string,
    patch: Partial<CloudAccountRow>,
    expectedVersion: number
  ): Promise<CloudAccountRow> {
    // Strip immutable and non-table fields
    const sanitizedPatch: Record<string, unknown> = { ...patch };
    delete sanitizedPatch.id;
    delete sanitizedPatch.user_id;
    delete sanitizedPatch.created_at;
    delete sanitizedPatch.currency;
    delete sanitizedPatch.system_tag;
    delete sanitizedPatch.deleted_at;

    // Ensure updated_at is populated
    if (!sanitizedPatch.updated_at) {
      sanitizedPatch.updated_at = new Date().toISOString();
    }

    const { data, error } = await this.client
      .from('accounts')
      .update(sanitizedPatch)
      .eq('id', id)
      .eq('user_id', userId)
      .eq('version', expectedVersion)
      .select()
      .maybeSingle();

    if (error) {
      if (error.code === '42501') {
        throw new SyncDatabaseError(
          'RLS permission denied: Cannot update account for this user context.',
          '42501',
          error
        );
      }
      if (
        error.code === '40001' ||
        (typeof error.message === 'string' && error.message.toLowerCase().includes('deleted'))
      ) {
        throw new SyncConflictError(error.message);
      }
      throw new SyncDatabaseError(error.message, error.code, error);
    }

    if (data) {
      const verified = data as CloudAccountRow;
      if (isAccountDeleted(verified)) {
        throw new SyncConflictError(
          `Cannot update account '${id}': account is marked deleted in cloud.`,
          verified
        );
      }
      const targetVersion = patch.version ?? expectedVersion + 1;
      this.verifyPersistedRow(verified, id, userId, targetVersion);
      return verified;
    }

    // 0 rows updated: examine current cloud record to distinguish idempotent retry from version conflict
    const current = await this.findById(id);

    if (!current) {
      throw new SyncConflictError(
        `Account '${id}' was not found in cloud or is hidden by RLS policies.`
      );
    }

    if (current.user_id !== userId) {
      throw new SyncConflictError(
        `Account '${id}' belongs to a different user.`
      );
    }

    if (isAccountDeleted(current)) {
      throw new SyncConflictError(
        `Cannot update account '${id}': account was permanently deleted in cloud.`,
        current
      );
    }

    const targetVersion = patch.version ?? expectedVersion + 1;

    // If version is already target version, check if the update was already committed (e.g. network dropped on response)
    if (current.version === targetVersion) {
      let fieldsMatch = true;
      for (const [key, value] of Object.entries(sanitizedPatch)) {
        if (key === 'updated_at') continue;
        if (current[key as keyof CloudAccountRow] !== value) {
          fieldsMatch = false;
          break;
        }
      }

      if (fieldsMatch) {
        // Idempotent retry: operation already applied in cloud
        return current;
      }

      throw new SyncConflictError(
        `Account '${id}' is already at target version ${targetVersion}, but cloud data differs from update payload.`,
        current
      );
    }

    if (current.version > expectedVersion) {
      throw new SyncConflictError(
        `Version conflict on account '${id}': cloud version is ${current.version}, expected previous version was ${expectedVersion}.`,
        current
      );
    }

    throw new SyncConflictError(
      `Version mismatch on account '${id}': cloud version is ${current.version}, expected previous version was ${expectedVersion}.`,
      current
    );
  }

  /**
   * Safely deletes an empty, non-system user account in Supabase Postgres using
   * optimistic concurrency control, cloud dependency verification, and tombstone
   * propagation so other devices remove stale local copies on sync.
   * Never cascade-deletes transactions or financial dependencies.
   */
  public async safeDelete(
    id: string,
    userId: string,
    expectedVersion: number,
    deletedAt?: string
  ): Promise<void> {
    if (!userId || userId.trim().length === 0) {
      throw new SyncAuthError('Cannot delete account: userId is required for tenant isolation.');
    }

    let normalizedDeletedAt: string | undefined;
    if (deletedAt !== undefined) {
      const parsed = Date.parse(deletedAt);
      if (Number.isNaN(parsed)) {
        throw new Error(`Invalid deletedAt timestamp '${deletedAt}' supplied to safeDelete.`);
      }
      normalizedDeletedAt = new Date(parsed).toISOString();
    }

    // 1. Prefer server-side transactional RPC when present
    if (typeof this.client.rpc === 'function') {
      const rpcArgs: Record<string, unknown> = {
        p_account_id: id,
        p_expected_version: expectedVersion
      };
      if (normalizedDeletedAt !== undefined) {
        rpcArgs.p_deleted_at = normalizedDeletedAt;
      }

      const { error: rpcError } = await this.client.rpc('safe_delete_account', rpcArgs);

      if (!rpcError) {
        return;
      }

      const isMissingRpc =
        rpcError.code === 'PGRST202' ||
        rpcError.code === '42883' ||
        (typeof rpcError.message === 'string' &&
          rpcError.message.toLowerCase().includes('could not find the function'));

      if (!isMissingRpc) {
        if (rpcError.code === '23503') {
          throw new SyncAccountDependencyError(
            rpcError.message || `Account '${id}' still has dependent records in cloud.`,
            id
          );
        }
        if (
          rpcError.code === '40001' ||
          (typeof rpcError.message === 'string' &&
            rpcError.message.toLowerCase().includes('version'))
        ) {
          throw new SyncConflictError(
            rpcError.message || `Version conflict deleting cloud account '${id}'.`
          );
        }
        if (rpcError.code === '42501') {
          throw new SyncDatabaseError(
            rpcError.message || `Permission denied deleting account '${id}'.`,
            '42501',
            rpcError
          );
        }
        throw new SyncDatabaseError(rpcError.message, rpcError.code, rpcError);
      }
    }

    // 2. Fallback when RPC is not installed: explicit ownership, version, and dependency verification
    const current = await this.findById(id);
    if (!current) {
      // Idempotent delete retry: account already absent under current RLS context
      return;
    }

    if (current.user_id !== userId) {
      throw new SyncConflictError(`Account '${id}' belongs to a different user.`);
    }

    if (isAccountDeleted(current)) {
      // Idempotent delete retry: account already tombstoned in cloud
      return;
    }

    if (
      (current.system_tag !== null && current.system_tag !== undefined) ||
      current.name.trim().toLowerCase() === 'personal borrowings'
    ) {
      throw new SyncDatabaseError(
        'RLS/system protection: System-managed accounts cannot be deleted.',
        '42501'
      );
    }

    if (current.version !== expectedVersion) {
      throw new SyncConflictError(
        `Version conflict on account '${id}': cloud version is ${current.version}, expected ${expectedVersion}.`,
        current
      );
    }

    // Verify zero cloud dependencies across transactions (including tombstones), recurring rules, borrowings, and repayments
    const [txRes, ruleRes, borrowingRes, repaymentRes] = await Promise.all([
      this.client
        .from('transactions')
        .select('id')
        .eq('user_id', userId)
        .or(`account_id.eq.${id},destination_account_id.eq.${id}`)
        .limit(1),
      this.client
        .from('recurring_rules')
        .select('id')
        .eq('user_id', userId)
        .eq('account_id', id)
        .limit(1),
      this.client
        .from('borrowings')
        .select('id')
        .eq('user_id', userId)
        .eq('receiving_account_id', id)
        .limit(1),
      this.client
        .from('borrowing_repayments')
        .select('id')
        .eq('user_id', userId)
        .eq('payment_account_id', id)
        .limit(1)
    ]);

    for (const depCheck of [txRes, ruleRes, borrowingRes, repaymentRes]) {
      if (depCheck.error) {
        throw new SyncDatabaseError(depCheck.error.message, depCheck.error.code, depCheck.error);
      }
      if (Array.isArray(depCheck.data) && depCheck.data.length > 0) {
        throw new SyncAccountDependencyError(
          `Cannot delete cloud account '${id}': referencing financial or schedule records still exist in cloud.`,
          id
        );
      }
    }

    if ('deleted_at' in current) {
      const tombstoneAt = normalizedDeletedAt ?? new Date().toISOString();
      const { data, error } = await this.client
        .from('accounts')
        .update({
          deleted_at: tombstoneAt,
          updated_at: tombstoneAt,
          version: expectedVersion + 1
        })
        .eq('id', id)
        .eq('user_id', userId)
        .eq('version', expectedVersion)
        .is('deleted_at', null)
        .select()
        .maybeSingle();

      if (error) {
        if (error.code === '23503') {
          throw new SyncAccountDependencyError(
            error.message || `Cloud foreign key restriction blocked deletion of account '${id}'.`,
            id
          );
        }
        if (error.code === '42501') {
          throw new SyncDatabaseError(
            'RLS permission denied: Cannot delete account for this user context.',
            '42501',
            error
          );
        }
        throw new SyncDatabaseError(error.message, error.code, error);
      }

      if (!data) {
        const remaining = await this.findById(id);
        if (remaining && remaining.user_id === userId && isAccountDeleted(remaining)) {
          // Concurrent delete tombstone already succeeded
          return;
        }
        if (remaining) {
          throw new SyncConflictError(
            `Version conflict deleting account '${id}': cloud version changed to ${remaining.version} (expected ${expectedVersion}).`,
            remaining
          );
        }
      }
      return;
    }

    const { data, error } = await this.client
      .from('accounts')
      .delete()
      .eq('id', id)
      .eq('user_id', userId)
      .eq('version', expectedVersion)
      .select()
      .maybeSingle();

    if (error) {
      if (error.code === '23503') {
        throw new SyncAccountDependencyError(
          error.message || `Cloud foreign key restriction blocked deletion of account '${id}'.`,
          id
        );
      }
      if (error.code === '42501') {
        throw new SyncDatabaseError(
          'RLS permission denied: Cannot delete account for this user context.',
          '42501',
          error
        );
      }
      throw new SyncDatabaseError(error.message, error.code, error);
    }

    if (!data) {
      const remaining = await this.findById(id);
      if (remaining && remaining.user_id === userId && isAccountDeleted(remaining)) {
        return;
      }
      if (remaining) {
        throw new SyncConflictError(
          `Version conflict deleting account '${id}': cloud version changed to ${remaining.version} (expected ${expectedVersion}).`,
          remaining
        );
      }
    }
  }

  /**
   * Retrieves an account by ID under current RLS session.
   */
  public async findById(id: string): Promise<CloudAccountRow | null> {
    const { data, error } = await this.client
      .from('accounts')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      throw new SyncDatabaseError(error.message, error.code, error);
    }

    return (data as CloudAccountRow) || null;
  }

  /**
   * Retrieves a deterministic page of accounts belonging to the specified user.
   */
  public async findPage(
    userId: string,
    options: { offset?: number; limit?: number; includeDeleted?: boolean } = {}
  ): Promise<{ rows: CloudAccountRow[]; hasMore: boolean; nextOffset: number }> {
    if (!userId || userId.trim().length === 0) {
      throw new SyncAuthError('Cannot query accounts: userId is required for tenant isolation.');
    }

    const safeOffset = Math.max(0, Math.floor(options.offset ?? 0));
    const safeLimit = Math.max(
      1,
      Math.min(1000, Math.floor(options.limit ?? DEFAULT_CLOUD_PAGE_SIZE))
    );

    const orderedQuery = this.client
      .from('accounts')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });

    const { data, error } = hasRangeMethod<CloudAccountRow>(orderedQuery)
      ? await orderedQuery.range(safeOffset, safeOffset + safeLimit)
      : await orderedQuery;

    if (error) {
      throw new SyncDatabaseError(error.message, error.code, error);
    }

    const batch = (data || []) as CloudAccountRow[];
    const hasMore = hasRangeMethod<CloudAccountRow>(orderedQuery)
      ? batch.length > safeLimit
      : false;
    const pageRows = hasMore ? batch.slice(0, safeLimit) : batch;

    for (const row of pageRows) {
      if (row.user_id !== userId) {
        throw new SyncAuthError(`Retrieved account '${row.id}' belongs to another user.`);
      }
    }

    const rows = options.includeDeleted
      ? pageRows
      : pageRows.filter((row) => !isAccountDeleted(row));

    return {
      rows,
      hasMore,
      nextOffset: safeOffset + pageRows.length
    };
  }

  /**
   * Retrieves all accounts belonging to the specified user without silent truncation.
   */
  public async findAll(
    userId: string,
    options: { includeDeleted?: boolean } = {}
  ): Promise<CloudAccountRow[]> {
    if (!userId || userId.trim().length === 0) {
      throw new SyncAuthError('Cannot query accounts: userId is required for tenant isolation.');
    }

    const baseQuery = this.client
      .from('accounts')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    let rows: CloudAccountRow[];
    if (!hasRangeMethod<CloudAccountRow>(baseQuery)) {
      const { data, error } = await baseQuery;
      if (error) {
        throw new SyncDatabaseError(error.message, error.code, error);
      }
      rows = (data || []) as CloudAccountRow[];
    } else {
      rows = await fetchAllOrderedPages<CloudAccountRow>(
        () =>
          this.client
            .from('accounts')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: true })
            .order('id', { ascending: true }) as unknown as RangeCapableQuery<CloudAccountRow>,
        DEFAULT_CLOUD_PAGE_SIZE,
        (err) => new SyncDatabaseError(err.message, err.code, err)
      );
    }

    for (const row of rows) {
      if (row.user_id !== userId) {
        throw new SyncAuthError(`Retrieved account '${row.id}' belongs to another user.`);
      }
    }

    return options.includeDeleted
      ? rows
      : rows.filter((row) => !isAccountDeleted(row));
  }

  private verifyPersistedRow(
    row: CloudAccountRow,
    expectedId: string,
    expectedUserId: string,
    expectedVersion: number
  ): void {
    if (row.id !== expectedId) {
      throw new Error(`Persisted row ID '${row.id}' does not match expected ID '${expectedId}'.`);
    }
    if (row.user_id !== expectedUserId) {
      throw new Error(`Persisted row user_id '${row.user_id}' does not match expected owner '${expectedUserId}'.`);
    }
    if (row.version !== expectedVersion) {
      throw new Error(`Persisted row version '${row.version}' does not match expected version '${expectedVersion}'.`);
    }
  }
}

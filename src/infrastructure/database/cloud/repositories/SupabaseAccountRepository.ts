import { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../supabaseClient';
import { CloudAccountRow } from '../mappers/AccountMapper';
import {
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
  findById(id: string): Promise<CloudAccountRow | null>;
  findAll(userId: string): Promise<CloudAccountRow[]>;
}

export class SupabaseAccountRepository implements ISupabaseAccountRepository {
  constructor(private readonly client: SupabaseClient = supabase) {}

  /**
   * Inserts a new account row into PostgreSQL.
   * If error 23505 (unique violation on ID) occurs:
   * - Performs an idempotent reconciliation check under current user context.
   * - If already persisted with identical fields, returns the existing record.
   * - If differing data or owned by another tenant, raises SyncConflictError.
   */
  public async insert(account: CloudAccountRow): Promise<CloudAccountRow> {
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
      this.verifyPersistedRow(verified, account.id, account.user_id, account.version);
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

      throw new SyncDatabaseError(error.message, error.code, error);
    }

    if (!data) {
      throw new SyncDatabaseError('Insert succeeded but no data returned from Supabase.');
    }

    const verified = data as CloudAccountRow;
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
      throw new SyncDatabaseError(error.message, error.code, error);
    }

    if (data) {
      const verified = data as CloudAccountRow;
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
   * Retrieves all accounts belonging to the specified user.
   */
  public async findAll(userId: string): Promise<CloudAccountRow[]> {
    const { data, error } = await this.client
      .from('accounts')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new SyncDatabaseError(error.message, error.code, error);
    }

    return (data || []) as CloudAccountRow[];
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

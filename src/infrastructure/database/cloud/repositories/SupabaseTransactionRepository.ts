import { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../supabaseClient';
import { CloudTransactionRow } from '../mappers/TransactionMapper';
import { ISupabaseAccountRepository } from './SupabaseAccountRepository';
import { isValidUuid } from '@/domain/value-objects/Identifiers';
import { TransferAccountMismatchError } from '@/domain/errors/DomainErrors';
import {
  SyncAuthError,
  SyncConflictError,
  SyncDatabaseError,
  SyncUnresolvedCategoryError,
  SyncAccountDependencyError
} from '@/infrastructure/sync/errors/SyncErrors';

export interface ISupabaseTransactionRepository {
  insert(transaction: CloudTransactionRow): Promise<CloudTransactionRow>;
  updatePartial(
    id: string,
    userId: string,
    patch: Partial<CloudTransactionRow>,
    expectedVersion: number
  ): Promise<CloudTransactionRow>;
  softDelete(
    id: string,
    userId: string,
    deletedAt: string,
    expectedVersion: number,
    targetVersion?: number
  ): Promise<CloudTransactionRow>;
  findById(id: string, userId: string): Promise<CloudTransactionRow | null>;
  findByIdempotencyKey(key: string, userId: string): Promise<CloudTransactionRow | null>;
}

export class SupabaseTransactionRepository implements ISupabaseTransactionRepository {
  constructor(
    private readonly client: SupabaseClient = supabase,
    private readonly accountRepo?: ISupabaseAccountRepository
  ) {}

  /**
   * Inserts a canonical transaction row into Supabase PostgreSQL.
   * Guarantees:
   * 1. Preserves local transaction UUID.
   * 2. Enforces Category Identity Safety (rejects non-null category_id).
   * 3. Validates account existence & tenant ownership for source and destination accounts.
   * 4. Reconciles PostgreSQL error 23505 (duplicate key) on ID or (user_id, idempotency_key).
   * 5. Never uses unconditional upsert.
   */
  public async insert(transaction: CloudTransactionRow): Promise<CloudTransactionRow> {
    // 1. Guard authentication
    if (!transaction.user_id || transaction.user_id.trim().length === 0) {
      throw new SyncAuthError('Cannot insert transaction: user_id is missing or unauthenticated.');
    }

    // 2. Category Identity Safety Guard
    // Block any transaction with a non-null category ID until category identity reconciliation is implemented.
    if (transaction.category_id !== null && transaction.category_id !== undefined) {
      throw new SyncUnresolvedCategoryError(
        `Cannot persist transaction '${transaction.id}': Category reference '${transaction.category_id}' cannot be resolved to cloud identity. Categorized transaction synchronization is blocked until category synchronization is implemented.`,
        transaction.category_id
      );
    }

    // 3. Account Dependency Validation
    await this.verifyAccountExists(transaction.account_id, transaction.user_id, 'source');

    if (transaction.type === 'transfer') {
      if (!transaction.destination_account_id) {
        throw new TransferAccountMismatchError('A transfer transaction must specify a destination account.');
      }
      if (transaction.destination_account_id === transaction.account_id) {
        throw new TransferAccountMismatchError('Source and destination accounts must be distinct.');
      }
      await this.verifyAccountExists(transaction.destination_account_id, transaction.user_id, 'destination');
    }

    // 4. Execute Insert
    const { data, error } = await this.client
      .from('transactions')
      .insert(transaction)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        // Unique violation: reconcile duplicate ID or (user_id, idempotency_key)
        return await this.reconcileDuplicateInsert(transaction);
      }

      if (error.code === '42501') {
        throw new SyncDatabaseError(
          'RLS permission denied: Cannot insert transaction for this user context.',
          '42501',
          error
        );
      }

      throw new SyncDatabaseError(error.message, error.code, error);
    }

    if (!data) {
      throw new SyncDatabaseError('Insert succeeded but no data returned from Supabase.');
    }

    const verified = data as CloudTransactionRow;
    this.verifyPersistedRow(verified, transaction.id, transaction.user_id, transaction.version);
    return verified;
  }

  /**
   * Safely updates mutable fields of a transaction using optimistic concurrency control.
   * Filtered strictly by primary key, user_id, and optimistic expected version.
   * Guarantees:
   * 1. Rejects updates on transactions that have already been soft-deleted.
   * 2. Category Identity Safety: rejects any update on a categorized transaction
   *    and any update attempting to introduce an unresolved category reference.
   * 3. Validates account dependencies and enforces distinct accounts for transfers.
   * 4. Accurately identifies idempotent replays vs version conflicts.
   */
  public async updatePartial(
    id: string,
    userId: string,
    patch: Partial<CloudTransactionRow>,
    expectedVersion: number
  ): Promise<CloudTransactionRow> {
    if (!userId || userId.trim().length === 0) {
      throw new SyncAuthError('Cannot update transaction: user ID is missing or unauthenticated.');
    }

    // 1. Fetch current cloud state to verify tenant ownership, category status, and deletion status
    const current = await this.findById(id, userId);

    if (!current) {
      throw new SyncConflictError(
        `Transaction '${id}' was not found in cloud or is hidden by RLS policies.`
      );
    }

    if (current.user_id !== userId) {
      throw new SyncConflictError(`Transaction '${id}' belongs to a different user.`);
    }

    // Guard: soft-deleted transactions cannot be updated
    if (current.deleted_at !== null) {
      throw new SyncConflictError(
        `Cannot update transaction '${id}': record is already soft-deleted in cloud.`
      );
    }

    // Guard: Category Identity Safety
    // If the transaction in cloud has a non-null category_id, all updates are blocked
    // until category identity reconciliation is implemented.
    if (current.category_id !== null && current.category_id !== undefined) {
      throw new SyncUnresolvedCategoryError(
        `Cannot update transaction '${id}': Cloud transaction has category reference '${current.category_id}'. Categorized transaction synchronization is blocked until category synchronization is implemented.`,
        current.category_id
      );
    }

    // Guard: If patch attempts to set a non-null category_id, reject immediately
    if (patch.category_id !== null && patch.category_id !== undefined) {
      throw new SyncUnresolvedCategoryError(
        `Cannot update transaction '${id}': Category reference '${patch.category_id}' cannot be resolved to cloud identity. Categorized transaction synchronization is blocked until category synchronization is implemented.`,
        patch.category_id
      );
    }

    const targetVersion = patch.version ?? expectedVersion + 1;

    // Check for idempotent replay if current version is already at targetVersion
    if (current.version === targetVersion) {
      if (this.areUpdateFieldsMatching(current, patch)) {
        return current;
      }

      throw new SyncConflictError(
        `Transaction '${id}' is already at target version ${targetVersion}, but cloud data differs from update payload.`,
        current
      );
    }

    // Guard: optimistic concurrency version check
    if (current.version !== expectedVersion) {
      throw new SyncConflictError(
        `Version conflict on transaction '${id}': cloud version is ${current.version}, expected previous version was ${expectedVersion}.`,
        current
      );
    }

    // Account dependency check if account_id is changed
    if (patch.account_id) {
      await this.verifyAccountExists(patch.account_id, userId, 'source');
    }
    if (patch.destination_account_id) {
      await this.verifyAccountExists(patch.destination_account_id, userId, 'destination');
    }

    // Validate transfer account distinctness
    const effectiveSource = patch.account_id ?? current.account_id;
    const effectiveDest =
      patch.destination_account_id !== undefined
        ? patch.destination_account_id
        : current.destination_account_id;
    if (current.type === 'transfer' && effectiveDest && effectiveDest === effectiveSource) {
      throw new TransferAccountMismatchError('Source and destination accounts must be distinct.');
    }

    // Sanitize patch (strip immutable & non-schema fields)
    const sanitizedPatch: Record<string, unknown> = { ...patch };
    delete sanitizedPatch.id;
    delete sanitizedPatch.user_id;
    delete sanitizedPatch.created_at;
    delete sanitizedPatch.currency;
    delete sanitizedPatch.idempotency_key;
    delete sanitizedPatch.type;

    if (!sanitizedPatch.updated_at) {
      sanitizedPatch.updated_at = new Date().toISOString();
    }
    if (sanitizedPatch.version === undefined) {
      sanitizedPatch.version = targetVersion;
    }

    const { data, error } = await this.client
      .from('transactions')
      .update(sanitizedPatch)
      .eq('id', id)
      .eq('user_id', userId)
      .eq('version', expectedVersion)
      .select()
      .maybeSingle();

    if (error) {
      if (error.code === '42501') {
        throw new SyncDatabaseError(
          'RLS permission denied: Cannot update transaction for this user context.',
          '42501',
          error
        );
      }
      throw new SyncDatabaseError(error.message, error.code, error);
    }

    if (data) {
      const verified = data as CloudTransactionRow;
      this.verifyPersistedRow(verified, id, userId, targetVersion);
      return verified;
    }

    // If 0 rows updated due to a concurrent modification, re-fetch to diagnose
    const racedCurrent = await this.findById(id, userId);
    if (
      racedCurrent &&
      racedCurrent.version === targetVersion &&
      this.areUpdateFieldsMatching(racedCurrent, patch)
    ) {
      return racedCurrent;
    }

    throw new SyncConflictError(
      `Optimistic concurrency failure on transaction '${id}': record was modified concurrently.`,
      racedCurrent
    );
  }

  /**
   * Soft-deletes a transaction using an optimistic UPDATE.
   * NEVER calls .delete() in SQL.
   */
  public async softDelete(
    id: string,
    userId: string,
    deletedAt: string,
    expectedVersion: number,
    targetVersion?: number
  ): Promise<CloudTransactionRow> {
    if (!userId || userId.trim().length === 0) {
      throw new SyncAuthError('Cannot delete transaction: user ID is missing or unauthenticated.');
    }

    const newVersion = targetVersion ?? expectedVersion + 1;
    const updatedAt = new Date().toISOString();

    const { data, error } = await this.client
      .from('transactions')
      .update({
        deleted_at: deletedAt,
        version: newVersion,
        updated_at: updatedAt
      })
      .eq('id', id)
      .eq('user_id', userId)
      .eq('version', expectedVersion)
      .select()
      .maybeSingle();

    if (error) {
      if (error.code === '42501') {
        throw new SyncDatabaseError(
          'RLS permission denied: Cannot soft-delete transaction for this user context.',
          '42501',
          error
        );
      }
      throw new SyncDatabaseError(error.message, error.code, error);
    }

    if (data) {
      const verified = data as CloudTransactionRow;
      this.verifyPersistedRow(verified, id, userId, newVersion);
      return verified;
    }

    // 0 rows updated: examine cloud state
    const current = await this.findById(id, userId);

    if (!current) {
      throw new SyncConflictError(
        `Transaction '${id}' was not found in cloud or is hidden by RLS policies.`
      );
    }

    if (current.user_id !== userId) {
      throw new SyncConflictError(`Transaction '${id}' belongs to a different user.`);
    }

    // Idempotent retry: already soft-deleted at target version
    if (current.version === newVersion && current.deleted_at !== null) {
      return current;
    }

    if (current.version > expectedVersion) {
      throw new SyncConflictError(
        `Version conflict on soft-delete for transaction '${id}': cloud version is ${current.version}, expected previous version was ${expectedVersion}.`,
        current
      );
    }

    throw new SyncConflictError(
      `Version mismatch on soft-delete for transaction '${id}': cloud version is ${current.version}, expected previous version was ${expectedVersion}.`,
      current
    );
  }

  /**
   * Retrieves a transaction by ID scoped strictly to current user.
   */
  public async findById(id: string, userId: string): Promise<CloudTransactionRow | null> {
    if (!userId || userId.trim().length === 0) {
      throw new SyncAuthError('Cannot query transaction: userId is required for tenant isolation.');
    }

    const { data, error } = await this.client
      .from('transactions')
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

    return (data as CloudTransactionRow) || null;
  }

  /**
   * Retrieves a transaction by user_id and idempotency_key.
   */
  public async findByIdempotencyKey(key: string, userId: string): Promise<CloudTransactionRow | null> {
    if (!userId || userId.trim().length === 0) {
      throw new SyncAuthError('Cannot query transaction: userId is required for tenant isolation.');
    }

    const { data, error } = await this.client
      .from('transactions')
      .select('*')
      .eq('idempotency_key', key)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      throw new SyncDatabaseError(error.message, error.code, error);
    }

    return (data as CloudTransactionRow) || null;
  }

  private async reconcileDuplicateInsert(attempted: CloudTransactionRow): Promise<CloudTransactionRow> {
    // 1. Check by ID first
    const existingById = await this.findById(attempted.id, attempted.user_id);

    if (existingById) {
      if (existingById.user_id !== attempted.user_id) {
        throw new SyncConflictError(
          `Transaction ID '${attempted.id}' already exists and belongs to another user or is inaccessible under current RLS.`
        );
      }

      // Explicitly reject if cloud record has already been soft-deleted
      if (existingById.deleted_at !== null) {
        throw new SyncConflictError(
          `Transaction ID '${attempted.id}' already exists in cloud but has been soft-deleted. Cannot insert duplicate of a deleted transaction.`,
          existingById
        );
      }

      // Compare all relevant persisted creation fields
      const isIdentical =
        existingById.id === attempted.id &&
        existingById.user_id === attempted.user_id &&
        existingById.type === attempted.type &&
        existingById.amount_paise === attempted.amount_paise &&
        existingById.currency === attempted.currency &&
        existingById.account_id === attempted.account_id &&
        (existingById.destination_account_id ?? null) === (attempted.destination_account_id ?? null) &&
        (existingById.category_id ?? null) === (attempted.category_id ?? null) &&
        existingById.title === attempted.title &&
        (existingById.note ?? null) === (attempted.note ?? null) &&
        new Date(existingById.transaction_date).getTime() === new Date(attempted.transaction_date).getTime() &&
        existingById.version === attempted.version &&
        (existingById.device_id ?? null) === (attempted.device_id ?? null) &&
        existingById.idempotency_key === attempted.idempotency_key;

      if (isIdentical) {
        // Idempotent retry: matching record already committed in cloud
        return existingById;
      }

      throw new SyncConflictError(
        `Transaction ID '${attempted.id}' already exists in cloud with conflicting data.`,
        existingById
      );
    }

    // 2. Check by idempotency key
    const existingByKey = await this.findByIdempotencyKey(attempted.idempotency_key, attempted.user_id);

    if (existingByKey) {
      if (existingByKey.id !== attempted.id) {
        throw new SyncConflictError(
          `Idempotency key '${attempted.idempotency_key}' was already used for transaction '${existingByKey.id}'.`,
          existingByKey
        );
      }

      // Explicitly reject if cloud record has already been soft-deleted
      if (existingByKey.deleted_at !== null) {
        throw new SyncConflictError(
          `Transaction with idempotency key '${attempted.idempotency_key}' already exists in cloud but has been soft-deleted.`,
          existingByKey
        );
      }

      // Same ID and key, compare all fields
      const isIdentical =
        existingByKey.type === attempted.type &&
        existingByKey.amount_paise === attempted.amount_paise &&
        existingByKey.currency === attempted.currency &&
        existingByKey.account_id === attempted.account_id &&
        (existingByKey.destination_account_id ?? null) === (attempted.destination_account_id ?? null) &&
        (existingByKey.category_id ?? null) === (attempted.category_id ?? null) &&
        existingByKey.title === attempted.title &&
        (existingByKey.note ?? null) === (attempted.note ?? null) &&
        new Date(existingByKey.transaction_date).getTime() === new Date(attempted.transaction_date).getTime() &&
        existingByKey.version === attempted.version &&
        (existingByKey.device_id ?? null) === (attempted.device_id ?? null) &&
        existingByKey.idempotency_key === attempted.idempotency_key;

      if (isIdentical) {
        return existingByKey;
      }

      throw new SyncConflictError(
        `Transaction ID '${attempted.id}' with idempotency key '${attempted.idempotency_key}' already exists in cloud with conflicting data.`,
        existingByKey
      );
    }

    // 3. Neither found by ID nor key under current user
    throw new SyncConflictError(
      `Unique constraint violation (23505) occurred on transaction '${attempted.id}' but record cannot be retrieved under authenticated user.`
    );
  }

  private areUpdateFieldsMatching(
    current: CloudTransactionRow,
    patch: Partial<CloudTransactionRow>
  ): boolean {
    for (const [key, value] of Object.entries(patch)) {
      if (
        key === 'updated_at' ||
        key === 'created_at' ||
        key === 'id' ||
        key === 'user_id' ||
        key === 'currency' ||
        key === 'type' ||
        key === 'idempotency_key'
      ) {
        continue;
      }

      if (key === 'transaction_date') {
        if (value && current.transaction_date) {
          if (new Date(current.transaction_date).getTime() !== new Date(value as string).getTime()) {
            return false;
          }
        } else if (current.transaction_date !== value) {
          return false;
        }
        continue;
      }

      const currentValue = current[key as keyof CloudTransactionRow] ?? null;
      const patchValue = (value as unknown) ?? null;
      if (currentValue !== patchValue) {
        return false;
      }
    }
    return true;
  }

  private async verifyAccountExists(accountId: string, userId: string, label: string): Promise<void> {
    if (!isValidUuid(accountId)) {
      throw new SyncAccountDependencyError(
        `Invalid ${label} account ID '${accountId}': must be a valid UUID.`,
        accountId
      );
    }

    if (this.accountRepo) {
      const acc = await this.accountRepo.findById(accountId);
      if (!acc || acc.user_id !== userId) {
        throw new SyncAccountDependencyError(
          `Referenced ${label} account '${accountId}' was not found in cloud or does not belong to user '${userId}'.`,
          accountId
        );
      }
      return;
    }

    const { data, error } = await this.client
      .from('accounts')
      .select('id, user_id')
      .eq('id', accountId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      throw new SyncDatabaseError(error.message, error.code, error);
    }

    if (!data) {
      throw new SyncAccountDependencyError(
        `Referenced ${label} account '${accountId}' was not found in cloud or does not belong to user '${userId}'.`,
        accountId
      );
    }
  }

  private verifyPersistedRow(
    row: CloudTransactionRow,
    expectedId: string,
    expectedUserId: string,
    expectedVersion: number
  ): void {
    if (row.id !== expectedId) {
      throw new Error(`Persisted transaction ID '${row.id}' does not match expected ID '${expectedId}'.`);
    }
    if (row.user_id !== expectedUserId) {
      throw new Error(`Persisted transaction user_id '${row.user_id}' does not match expected owner '${expectedUserId}'.`);
    }
    if (row.version !== expectedVersion) {
      throw new Error(`Persisted transaction version '${row.version}' does not match expected version '${expectedVersion}'.`);
    }
  }
}

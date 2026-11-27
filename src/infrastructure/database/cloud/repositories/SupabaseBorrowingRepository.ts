import { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../supabaseClient';
import { CloudBorrowingRow } from '../mappers/BorrowingMapper';
import { ISupabaseLenderRepository } from './SupabaseLenderRepository';
import { ISupabaseAccountRepository } from './SupabaseAccountRepository';
import { ISupabaseTransactionRepository } from './SupabaseTransactionRepository';
import {
  DEFAULT_CLOUD_PAGE_SIZE,
  fetchAllOrderedPages,
  hasRangeMethod,
  RangeCapableQuery
} from './cloudPagination';
import {
  SyncAuthError,
  SyncConflictError,
  SyncDatabaseError,
  SyncAccountDependencyError,
  SyncTransactionDependencyError,
  SyncLenderDependencyError
} from '@/infrastructure/sync/errors/SyncErrors';
import { isValidUuid } from '@/domain/value-objects/Identifiers';

export interface ISupabaseBorrowingRepository {
  insert(borrowing: CloudBorrowingRow): Promise<CloudBorrowingRow>;
  updatePartial(
    id: string,
    userId: string,
    patch: Partial<CloudBorrowingRow>
  ): Promise<CloudBorrowingRow>;
  findById(id: string, userId: string): Promise<CloudBorrowingRow | null>;
  findByLenderId(lenderId: string, userId: string): Promise<CloudBorrowingRow[]>;
  findAll(userId: string): Promise<CloudBorrowingRow[]>;
  findPage?(
    userId: string,
    options?: { offset?: number; limit?: number }
  ): Promise<{ rows: CloudBorrowingRow[]; hasMore: boolean; nextOffset: number }>;
}

export class SupabaseBorrowingRepository implements ISupabaseBorrowingRepository {
  constructor(
    private readonly client: SupabaseClient = supabase,
    private readonly lenderRepo?: ISupabaseLenderRepository,
    private readonly accountRepo?: ISupabaseAccountRepository,
    private readonly transactionRepo?: ISupabaseTransactionRepository
  ) {}

  /**
   * Inserts a borrowing row into PostgreSQL.
   * Guarantees:
   * 1. Preserves local borrowing UUID.
   * 2. Validates lender dependency existence in cloud for authenticated user.
   * 3. Validates receiving account dependency existence in cloud for authenticated user.
   * 4. Validates transfer transaction dependency existence in cloud for authenticated user.
   * 5. Reconciles error 23505 (duplicate key) on primary key ID.
   */
  public async insert(borrowing: CloudBorrowingRow): Promise<CloudBorrowingRow> {
    if (!borrowing.user_id || borrowing.user_id.trim().length === 0) {
      throw new SyncAuthError('Cannot insert borrowing: user_id is missing or unauthenticated.');
    }

    // 1. Dependency Validations
    await this.verifyLenderExists(borrowing.lender_id, borrowing.user_id);
    await this.verifyAccountExists(borrowing.receiving_account_id, borrowing.user_id, 'receiving');
    await this.verifyTransactionExists(borrowing.transaction_id, borrowing.user_id);

    // 2. Execute Insert
    const { data, error } = await this.client
      .from('borrowings')
      .insert(borrowing)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return await this.reconcileDuplicateInsert(borrowing);
      }

      if (error.code === '23503') {
        const errorText = `${error.message || ''} ${error.details || ''}`.toLowerCase();
        if (errorText.includes('lender')) {
          throw new SyncLenderDependencyError(
            `Cannot persist borrowing '${borrowing.id}': Lender reference '${borrowing.lender_id}' violates cloud foreign key constraint.`,
            borrowing.lender_id
          );
        }
        if (errorText.includes('account')) {
          throw new SyncAccountDependencyError(
            `Cannot persist borrowing '${borrowing.id}': Receiving account reference '${borrowing.receiving_account_id}' violates cloud foreign key constraint.`,
            borrowing.receiving_account_id
          );
        }
        if (errorText.includes('transaction')) {
          throw new SyncTransactionDependencyError(
            `Cannot persist borrowing '${borrowing.id}': Transaction reference '${borrowing.transaction_id}' violates cloud foreign key constraint.`,
            borrowing.transaction_id
          );
        }
      }

      if (error.code === '42501') {
        throw new SyncDatabaseError(
          'RLS permission denied: Cannot insert borrowing for this user context.',
          '42501',
          error
        );
      }

      throw new SyncDatabaseError(error.message, error.code, error);
    }

    if (!data) {
      throw new SyncDatabaseError('Insert succeeded but no data returned from Supabase.');
    }

    const verified = data as CloudBorrowingRow;
    this.verifyPersistedRow(verified, borrowing.id, borrowing.user_id);
    return verified;
  }

  /**
   * Updates mutable fields of a borrowing (e.g. status transition to 'repaid').
   * Filtered by primary key and user_id.
   */
  public async updatePartial(
    id: string,
    userId: string,
    patch: Partial<CloudBorrowingRow>
  ): Promise<CloudBorrowingRow> {
    if (!userId || userId.trim().length === 0) {
      throw new SyncAuthError('Cannot update borrowing: user ID is missing or unauthenticated.');
    }

    const sanitizedPatch: Record<string, unknown> = { ...patch };
    delete sanitizedPatch.id;
    delete sanitizedPatch.user_id;
    delete sanitizedPatch.lender_id;
    delete sanitizedPatch.amount_paise;
    delete sanitizedPatch.borrowing_date;
    delete sanitizedPatch.receiving_account_id;
    delete sanitizedPatch.transaction_id;
    delete sanitizedPatch.created_at;

    if (!sanitizedPatch.updated_at) {
      sanitizedPatch.updated_at = new Date().toISOString();
    }

    const { data, error } = await this.client
      .from('borrowings')
      .update(sanitizedPatch)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .maybeSingle();

    if (error) {
      if (error.code === '42501') {
        throw new SyncDatabaseError(
          'RLS permission denied: Cannot update borrowing for this user context.',
          '42501',
          error
        );
      }
      throw new SyncDatabaseError(error.message, error.code, error);
    }

    if (data) {
      const verified = data as CloudBorrowingRow;
      this.verifyPersistedRow(verified, id, userId);
      return verified;
    }

    // 0 rows updated: examine current cloud record
    const current = await this.findById(id, userId);

    if (!current) {
      throw new SyncConflictError(
        `Borrowing '${id}' was not found in cloud or is hidden by RLS policies.`
      );
    }

    if (current.user_id !== userId) {
      throw new SyncConflictError(`Borrowing '${id}' belongs to a different user.`);
    }

    // Idempotent retry: check if status / patch matches
    let fieldsMatch = true;
    for (const [key, value] of Object.entries(sanitizedPatch)) {
      if (key === 'updated_at') continue;
      const currentVal = current[key as keyof CloudBorrowingRow] ?? null;
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
      `Borrowing '${id}' update failed: cloud data differs from update patch.`,
      current
    );
  }

  /**
   * Retrieves a borrowing by ID scoped to current user.
   */
  public async findById(id: string, userId: string): Promise<CloudBorrowingRow | null> {
    if (!userId || userId.trim().length === 0) {
      throw new SyncAuthError('Cannot query borrowing: userId is required for tenant isolation.');
    }
    if (!isValidUuid(id)) {
      return null;
    }

    const { data, error } = await this.client
      .from('borrowings')
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

    return (data as CloudBorrowingRow) || null;
  }

  /**
   * Retrieves all borrowings for a given lender scoped to current user.
   */
  public async findByLenderId(lenderId: string, userId: string): Promise<CloudBorrowingRow[]> {
    if (!userId || userId.trim().length === 0) {
      throw new SyncAuthError('Cannot query borrowings: userId is required for tenant isolation.');
    }

    const { data, error } = await this.client
      .from('borrowings')
      .select('*')
      .eq('lender_id', lenderId)
      .eq('user_id', userId)
      .order('borrowing_date', { ascending: true });

    if (error) {
      throw new SyncDatabaseError(error.message, error.code, error);
    }

    return (data || []) as CloudBorrowingRow[];
  }

  /**
   * Retrieves a deterministic page of borrowings belonging to the specified user.
   */
  public async findPage(
    userId: string,
    options: { offset?: number; limit?: number } = {}
  ): Promise<{ rows: CloudBorrowingRow[]; hasMore: boolean; nextOffset: number }> {
    if (!userId || userId.trim().length === 0) {
      throw new SyncAuthError('Cannot query borrowings: userId is required for tenant isolation.');
    }

    const safeOffset = Math.max(0, Math.floor(options.offset ?? 0));
    const safeLimit = Math.max(
      1,
      Math.min(1000, Math.floor(options.limit ?? DEFAULT_CLOUD_PAGE_SIZE))
    );

    const orderedQuery = this.client
      .from('borrowings')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });

    const { data, error } = hasRangeMethod<CloudBorrowingRow>(orderedQuery)
      ? await orderedQuery.range(safeOffset, safeOffset + safeLimit)
      : await orderedQuery;

    if (error) {
      throw new SyncDatabaseError(error.message, error.code, error);
    }

    const batch = (data || []) as CloudBorrowingRow[];
    const hasMore = hasRangeMethod<CloudBorrowingRow>(orderedQuery)
      ? batch.length > safeLimit
      : false;
    const rows = hasMore ? batch.slice(0, safeLimit) : batch;

    for (const row of rows) {
      if (row.user_id !== userId) {
        throw new SyncAuthError(`Retrieved borrowing '${row.id}' belongs to another user.`);
      }
    }

    return {
      rows,
      hasMore,
      nextOffset: safeOffset + rows.length
    };
  }

  /**
   * Retrieves all borrowings belonging to the specified user without silent truncation.
   */
  public async findAll(userId: string): Promise<CloudBorrowingRow[]> {
    if (!userId || userId.trim().length === 0) {
      throw new SyncAuthError('Cannot query borrowings: userId is required for tenant isolation.');
    }

    const baseQuery = this.client
      .from('borrowings')
      .select('*')
      .eq('user_id', userId)
      .order('borrowing_date', { ascending: false });

    let rows: CloudBorrowingRow[];
    if (!hasRangeMethod<CloudBorrowingRow>(baseQuery)) {
      const { data, error } = await baseQuery;
      if (error) {
        throw new SyncDatabaseError(error.message, error.code, error);
      }
      rows = (data || []) as CloudBorrowingRow[];
    } else {
      rows = await fetchAllOrderedPages<CloudBorrowingRow>(
        () =>
          this.client
            .from('borrowings')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: true })
            .order('id', { ascending: true }) as unknown as RangeCapableQuery<CloudBorrowingRow>,
        DEFAULT_CLOUD_PAGE_SIZE,
        (err) => new SyncDatabaseError(err.message, err.code, err)
      );
    }

    for (const row of rows) {
      if (row.user_id !== userId) {
        throw new SyncAuthError(`Retrieved borrowing '${row.id}' belongs to another user.`);
      }
    }

    return rows;
  }

  private async reconcileDuplicateInsert(attempted: CloudBorrowingRow): Promise<CloudBorrowingRow> {
    const existing = await this.findById(attempted.id, attempted.user_id);

    if (!existing || existing.user_id !== attempted.user_id) {
      throw new SyncConflictError(
        `Borrowing ID '${attempted.id}' already exists and belongs to another user or is inaccessible under current RLS.`
      );
    }

    const isIdentical =
      existing.lender_id === attempted.lender_id &&
      existing.amount_paise === attempted.amount_paise &&
      new Date(existing.borrowing_date).getTime() === new Date(attempted.borrowing_date).getTime() &&
      existing.receiving_account_id === attempted.receiving_account_id &&
      existing.transaction_id === attempted.transaction_id &&
      existing.status === attempted.status &&
      (existing.notes ?? null) === (attempted.notes ?? null);

    if (isIdentical) {
      return existing;
    }

    throw new SyncConflictError(
      `Borrowing ID '${attempted.id}' already exists in cloud with conflicting data.`,
      existing
    );
  }

  private async verifyLenderExists(lenderId: string, userId: string): Promise<void> {
    if (!isValidUuid(lenderId)) {
      throw new SyncLenderDependencyError(
        `Invalid lender ID '${lenderId}': must be a valid UUID.`,
        lenderId
      );
    }

    if (this.lenderRepo) {
      const lender = await this.lenderRepo.findById(lenderId, userId);
      if (!lender || lender.user_id !== userId) {
        throw new SyncLenderDependencyError(
          `Referenced lender '${lenderId}' was not found in cloud or does not belong to user '${userId}'.`,
          lenderId
        );
      }
      return;
    }

    const { data, error } = await this.client
      .from('lenders')
      .select('id, user_id')
      .eq('id', lenderId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      throw new SyncDatabaseError(error.message, error.code, error);
    }

    if (!data) {
      throw new SyncLenderDependencyError(
        `Referenced lender '${lenderId}' was not found in cloud or does not belong to user '${userId}'.`,
        lenderId
      );
    }
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
      if (!acc || acc.user_id !== userId || (acc.deleted_at !== undefined && acc.deleted_at !== null)) {
        throw new SyncAccountDependencyError(
          `Referenced ${label} account '${accountId}' was not found in cloud, was deleted, or does not belong to user '${userId}'.`,
          accountId
        );
      }
      return;
    }

    const { data, error } = await this.client
      .from('accounts')
      .select('*')
      .eq('id', accountId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      throw new SyncDatabaseError(error.message, error.code, error);
    }

    const rawAccount = data as { deleted_at?: string | null } | null;
    if (!rawAccount || (rawAccount.deleted_at !== undefined && rawAccount.deleted_at !== null)) {
      throw new SyncAccountDependencyError(
        `Referenced ${label} account '${accountId}' was not found in cloud, was deleted, or does not belong to user '${userId}'.`,
        accountId
      );
    }
  }

  private async verifyTransactionExists(transactionId: string, userId: string): Promise<void> {
    if (!isValidUuid(transactionId)) {
      throw new SyncTransactionDependencyError(
        `Invalid transaction ID '${transactionId}': must be a valid UUID.`,
        transactionId
      );
    }

    if (this.transactionRepo) {
      const tx = await this.transactionRepo.findById(transactionId, userId);
      if (!tx || tx.user_id !== userId) {
        throw new SyncTransactionDependencyError(
          `Referenced transfer transaction '${transactionId}' was not found in cloud or does not belong to user '${userId}'.`,
          transactionId
        );
      }
      return;
    }

    const { data, error } = await this.client
      .from('transactions')
      .select('id, user_id')
      .eq('id', transactionId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      throw new SyncDatabaseError(error.message, error.code, error);
    }

    if (!data) {
      throw new SyncTransactionDependencyError(
        `Referenced transfer transaction '${transactionId}' was not found in cloud or does not belong to user '${userId}'.`,
        transactionId
      );
    }
  }

  private verifyPersistedRow(
    row: CloudBorrowingRow,
    expectedId: string,
    expectedUserId: string
  ): void {
    if (row.id !== expectedId) {
      throw new Error(`Persisted borrowing ID '${row.id}' does not match expected ID '${expectedId}'.`);
    }
    if (row.user_id !== expectedUserId) {
      throw new Error(`Persisted borrowing user_id '${row.user_id}' does not match expected owner '${expectedUserId}'.`);
    }
  }
}

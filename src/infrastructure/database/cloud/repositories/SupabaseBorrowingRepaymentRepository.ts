import { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../supabaseClient';
import { CloudBorrowingRepaymentRow } from '../mappers/BorrowingRepaymentMapper';
import { ISupabaseBorrowingRepository } from './SupabaseBorrowingRepository';
import { ISupabaseLenderRepository } from './SupabaseLenderRepository';
import { ISupabaseAccountRepository } from './SupabaseAccountRepository';
import { ISupabaseTransactionRepository } from './SupabaseTransactionRepository';
import {
  SyncAuthError,
  SyncConflictError,
  SyncDatabaseError,
  SyncAccountDependencyError,
  SyncTransactionDependencyError,
  SyncLenderDependencyError,
  SyncBorrowingDependencyError
} from '@/infrastructure/sync/errors/SyncErrors';
import { isValidUuid } from '@/domain/value-objects/Identifiers';

export interface ISupabaseBorrowingRepaymentRepository {
  insert(repayment: CloudBorrowingRepaymentRow): Promise<CloudBorrowingRepaymentRow>;
  findById(id: string, userId: string): Promise<CloudBorrowingRepaymentRow | null>;
  findByBorrowingId(borrowingId: string, userId: string): Promise<CloudBorrowingRepaymentRow[]>;
  findAll(userId: string): Promise<CloudBorrowingRepaymentRow[]>;
}

export class SupabaseBorrowingRepaymentRepository implements ISupabaseBorrowingRepaymentRepository {
  constructor(
    private readonly client: SupabaseClient = supabase,
    private readonly borrowingRepo?: ISupabaseBorrowingRepository,
    private readonly lenderRepo?: ISupabaseLenderRepository,
    private readonly accountRepo?: ISupabaseAccountRepository,
    private readonly transactionRepo?: ISupabaseTransactionRepository
  ) {}

  /**
   * Inserts a borrowing repayment row into PostgreSQL.
   * Guarantees:
   * 1. Preserves local repayment UUID.
   * 2. Validates borrowing existence in cloud for authenticated user.
   * 3. Validates lender existence in cloud for authenticated user.
   * 4. Validates payment account existence in cloud for authenticated user.
   * 5. Validates transfer transaction existence in cloud for authenticated user.
   * 6. Reconciles error 23505 (duplicate key) on primary key ID.
   */
  public async insert(repayment: CloudBorrowingRepaymentRow): Promise<CloudBorrowingRepaymentRow> {
    if (!repayment.user_id || repayment.user_id.trim().length === 0) {
      throw new SyncAuthError('Cannot insert borrowing repayment: user_id is missing or unauthenticated.');
    }

    // 1. Dependency Validations
    await this.verifyBorrowingExists(repayment.borrowing_id, repayment.user_id);
    await this.verifyLenderExists(repayment.lender_id, repayment.user_id);
    await this.verifyAccountExists(repayment.payment_account_id, repayment.user_id);
    await this.verifyTransactionExists(repayment.transaction_id, repayment.user_id);

    // 2. Execute Insert
    const { data, error } = await this.client
      .from('borrowing_repayments')
      .insert(repayment)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return await this.reconcileDuplicateInsert(repayment);
      }

      if (error.code === '23503') {
        const errorText = `${error.message || ''} ${error.details || ''}`.toLowerCase();
        if (errorText.includes('borrowing')) {
          throw new SyncBorrowingDependencyError(
            `Cannot persist repayment '${repayment.id}': Borrowing reference '${repayment.borrowing_id}' violates cloud foreign key constraint.`,
            repayment.borrowing_id
          );
        }
        if (errorText.includes('lender')) {
          throw new SyncLenderDependencyError(
            `Cannot persist repayment '${repayment.id}': Lender reference '${repayment.lender_id}' violates cloud foreign key constraint.`,
            repayment.lender_id
          );
        }
        if (errorText.includes('account')) {
          throw new SyncAccountDependencyError(
            `Cannot persist repayment '${repayment.id}': Payment account reference '${repayment.payment_account_id}' violates cloud foreign key constraint.`,
            repayment.payment_account_id
          );
        }
        if (errorText.includes('transaction')) {
          throw new SyncTransactionDependencyError(
            `Cannot persist repayment '${repayment.id}': Transaction reference '${repayment.transaction_id}' violates cloud foreign key constraint.`,
            repayment.transaction_id
          );
        }
      }

      if (error.code === '42501') {
        throw new SyncDatabaseError(
          'RLS permission denied: Cannot insert borrowing repayment for this user context.',
          '42501',
          error
        );
      }

      throw new SyncDatabaseError(error.message, error.code, error);
    }

    if (!data) {
      throw new SyncDatabaseError('Insert succeeded but no data returned from Supabase.');
    }

    const verified = data as CloudBorrowingRepaymentRow;
    this.verifyPersistedRow(verified, repayment.id, repayment.user_id);
    return verified;
  }

  /**
   * Retrieves a repayment by ID scoped to current user.
   */
  public async findById(id: string, userId: string): Promise<CloudBorrowingRepaymentRow | null> {
    if (!userId || userId.trim().length === 0) {
      throw new SyncAuthError('Cannot query repayment: userId is required for tenant isolation.');
    }
    if (!isValidUuid(id)) {
      return null;
    }

    const { data, error } = await this.client
      .from('borrowing_repayments')
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

    return (data as CloudBorrowingRepaymentRow) || null;
  }

  /**
   * Retrieves all repayments for a given borrowing scoped to current user.
   */
  public async findByBorrowingId(borrowingId: string, userId: string): Promise<CloudBorrowingRepaymentRow[]> {
    if (!userId || userId.trim().length === 0) {
      throw new SyncAuthError('Cannot query repayments: userId is required for tenant isolation.');
    }

    const { data, error } = await this.client
      .from('borrowing_repayments')
      .select('*')
      .eq('borrowing_id', borrowingId)
      .eq('user_id', userId)
      .order('repayment_date', { ascending: true });

    if (error) {
      throw new SyncDatabaseError(error.message, error.code, error);
    }

    return (data || []) as CloudBorrowingRepaymentRow[];
  }

  /**
   * Retrieves all borrowing repayments belonging to the specified user.
   */
  public async findAll(userId: string): Promise<CloudBorrowingRepaymentRow[]> {
    if (!userId || userId.trim().length === 0) {
      throw new SyncAuthError('Cannot query repayments: userId is required for tenant isolation.');
    }

    const { data, error } = await this.client
      .from('borrowing_repayments')
      .select('*')
      .eq('user_id', userId)
      .order('repayment_date', { ascending: false });

    if (error) {
      throw new SyncDatabaseError(error.message, error.code, error);
    }

    return (data || []) as CloudBorrowingRepaymentRow[];
  }

  private async reconcileDuplicateInsert(attempted: CloudBorrowingRepaymentRow): Promise<CloudBorrowingRepaymentRow> {
    const existing = await this.findById(attempted.id, attempted.user_id);

    if (!existing || existing.user_id !== attempted.user_id) {
      throw new SyncConflictError(
        `Repayment ID '${attempted.id}' already exists and belongs to another user or is inaccessible under current RLS.`
      );
    }

    const isIdentical =
      existing.borrowing_id === attempted.borrowing_id &&
      existing.lender_id === attempted.lender_id &&
      existing.amount_paise === attempted.amount_paise &&
      new Date(existing.repayment_date).getTime() === new Date(attempted.repayment_date).getTime() &&
      existing.payment_account_id === attempted.payment_account_id &&
      existing.transaction_id === attempted.transaction_id &&
      (existing.notes ?? null) === (attempted.notes ?? null);

    if (isIdentical) {
      return existing;
    }

    throw new SyncConflictError(
      `Repayment ID '${attempted.id}' already exists in cloud with conflicting data.`,
      existing
    );
  }

  private async verifyBorrowingExists(borrowingId: string, userId: string): Promise<void> {
    if (!isValidUuid(borrowingId)) {
      throw new SyncBorrowingDependencyError(
        `Invalid borrowing ID '${borrowingId}': must be a valid UUID.`,
        borrowingId
      );
    }

    if (this.borrowingRepo) {
      const borrowing = await this.borrowingRepo.findById(borrowingId, userId);
      if (!borrowing || borrowing.user_id !== userId) {
        throw new SyncBorrowingDependencyError(
          `Referenced borrowing '${borrowingId}' was not found in cloud or does not belong to user '${userId}'.`,
          borrowingId
        );
      }
      return;
    }

    const { data, error } = await this.client
      .from('borrowings')
      .select('id, user_id')
      .eq('id', borrowingId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      throw new SyncDatabaseError(error.message, error.code, error);
    }

    if (!data) {
      throw new SyncBorrowingDependencyError(
        `Referenced borrowing '${borrowingId}' was not found in cloud or does not belong to user '${userId}'.`,
        borrowingId
      );
    }
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

  private async verifyAccountExists(accountId: string, userId: string): Promise<void> {
    if (!isValidUuid(accountId)) {
      throw new SyncAccountDependencyError(
        `Invalid payment account ID '${accountId}': must be a valid UUID.`,
        accountId
      );
    }

    if (this.accountRepo) {
      const acc = await this.accountRepo.findById(accountId);
      if (!acc || acc.user_id !== userId) {
        throw new SyncAccountDependencyError(
          `Referenced payment account '${accountId}' was not found in cloud or does not belong to user '${userId}'.`,
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
        `Referenced payment account '${accountId}' was not found in cloud or does not belong to user '${userId}'.`,
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
    row: CloudBorrowingRepaymentRow,
    expectedId: string,
    expectedUserId: string
  ): void {
    if (row.id !== expectedId) {
      throw new Error(`Persisted repayment ID '${row.id}' does not match expected ID '${expectedId}'.`);
    }
    if (row.user_id !== expectedUserId) {
      throw new Error(`Persisted repayment user_id '${row.user_id}' does not match expected owner '${expectedUserId}'.`);
    }
  }
}

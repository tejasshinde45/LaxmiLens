import { LocalOutboxRecord } from '@/infrastructure/database/local/schema';
import { ISupabaseTransactionRepository } from '@/infrastructure/database/cloud/repositories/SupabaseTransactionRepository';
import { AuthPort } from '@/application/ports/AuthPort';
import { OutboxManager } from '@/infrastructure/sync/OutboxManager';
import {
  TransactionMapper,
  CloudTransactionRow
} from '@/infrastructure/database/cloud/mappers/TransactionMapper';
import {
  SyncAuthError,
  SyncInProgressError,
  SyncUnresolvedCategoryError
} from '@/infrastructure/sync/errors/SyncErrors';
import { ICategoryResolver } from '@/infrastructure/sync/CategoryMappingService';

/**
 * TransactionSyncDispatcher
 *
 * Dedicated outbox dispatcher for transaction synchronization.
 * Routes outbox mutations (INSERT, UPDATE, DELETE) to SupabaseTransactionRepository.
 *
 * Guarantees:
 * 1. Strict Tenant Isolation: Requires authenticated user; validates tenant ownership.
 * 2. Strict Entity & Operation Filtering: Only processes entity 'transactions' and operations
 *    INSERT, UPDATE, and DELETE.
 * 3. Idempotent & Verified Remote Persistence: Only acknowledges outbox entries via markSuccess
 *    after verified persistence returned from SupabaseTransactionRepository.
 * 4. Error Retention: Never deletes outbox entries upon failure; records failure metadata via markFailure.
 * 5. Category Identity Safety: Rejects categorized transactions (INSERT and UPDATE) with SyncUnresolvedCategoryError
 *    while category identity reconciliation is unresolved.
 * 6. Account Dependency Preservation: Propagates account validation errors directly.
 * 7. Soft Deletion: Outbox operation DELETE routes strictly to repository.softDelete(); never executes SQL hard DELETE.
 * 8. Concurrency Safety: Prevents concurrent processing of events for the same transaction ID.
 */
export class TransactionSyncDispatcher {
  private readonly inFlightTransactions: Set<string> = new Set();

  constructor(
    private readonly transactionRepo: ISupabaseTransactionRepository,
    private readonly authPort: AuthPort,
    private readonly outboxManager?: OutboxManager,
    private readonly categoryResolver?: ICategoryResolver
  ) {}

  /**
   * Dispatches a single transactions outbox entry to Supabase.
   * If an OutboxManager is provided and entry has a valid local ID,
   * automatically acknowledges success via markSuccess only after cloud verification,
   * or records failure metadata via markFailure on error.
   */
  public async dispatch(entry: LocalOutboxRecord): Promise<void> {
    // Concurrency guard: reject concurrent dispatch for the same transaction entityId
    if (this.inFlightTransactions.has(entry.entityId)) {
      throw new SyncInProgressError(
        `Cannot dispatch outbox entry for transaction '${entry.entityId}': An operation for this transaction is already in progress.`
      );
    }

    this.inFlightTransactions.add(entry.entityId);

    try {
      await this.executeDispatch(entry);

      // Acknowledge outbox entry ONLY after confirmed remote persistence
      if (this.outboxManager && typeof entry.id === 'number') {
        await this.outboxManager.markSuccess(entry.id);
      }
    } catch (error) {
      if (this.outboxManager && typeof entry.id === 'number') {
        const errorMsg = error instanceof Error ? error.message : String(error);
        await this.outboxManager.markFailure(entry.id, errorMsg);
      }
      throw error;
    } finally {
      this.inFlightTransactions.delete(entry.entityId);
    }
  }

  private async executeDispatch(entry: LocalOutboxRecord): Promise<CloudTransactionRow> {
    // 1. Guard supported entity
    if (entry.entity !== 'transactions') {
      throw new Error(
        `TransactionSyncDispatcher only processes 'transactions' entities. Received '${entry.entity}'.`
      );
    }

    // 2. Guard supported operations
    if (
      entry.operation !== 'INSERT' &&
      entry.operation !== 'UPDATE' &&
      entry.operation !== 'DELETE'
    ) {
      throw new Error(
        `TransactionSyncDispatcher only processes 'INSERT', 'UPDATE', and 'DELETE'. Received '${entry.operation}'.`
      );
    }

    // 3. Resolve and verify authenticated user
    const currentUser = await this.authPort.getCurrentUser();
    if (!currentUser || !currentUser.id) {
      throw new SyncAuthError('Sync aborted: User is not authenticated.');
    }

    // 4. Validate payload ID consistency when supplied
    if (entry.payload.id !== undefined && entry.payload.id !== entry.entityId) {
      throw new Error(
        `Sync aborted: Payload ID '${entry.payload.id}' does not match entityId '${entry.entityId}'.`
      );
    }

    // 5. Tenant validation strategy
    const payloadUserId = entry.payload.user_id ?? entry.payload.userId;
    if (entry.operation === 'INSERT') {
      // INSERT requires explicit payload user_id matching authenticated user
      if (typeof payloadUserId !== 'string' || payloadUserId !== currentUser.id) {
        throw new SyncAuthError(
          `Sync aborted: Outbox payload user_id '${payloadUserId}' does not match authenticated user '${currentUser.id}'.`
        );
      }
    } else {
      // UPDATE and DELETE: if user_id is provided, it must match authenticated user
      if (
        payloadUserId !== undefined &&
        (typeof payloadUserId !== 'string' || payloadUserId !== currentUser.id)
      ) {
        throw new SyncAuthError(
          `Sync aborted: Outbox payload user_id '${payloadUserId}' does not match authenticated user '${currentUser.id}'.`
        );
      }
    }

    // 6. Category Identity Guard & Resolution
    const rawCategory = entry.payload.category_id ?? entry.payload.categoryId;
    let resolvedCategoryId: string | null = null;

    if (rawCategory !== null && rawCategory !== undefined) {
      const rawCatStr = String(rawCategory);
      if (this.categoryResolver) {
        resolvedCategoryId = await this.categoryResolver.resolveCategory(rawCatStr, currentUser.id);
      }
      if (!resolvedCategoryId) {
        throw new SyncUnresolvedCategoryError(
          `Cannot sync transaction '${entry.entityId}': Category reference '${rawCatStr}' cannot be resolved to cloud identity. Categorized transaction synchronization is blocked until category synchronization is implemented.`,
          rawCatStr
        );
      }
    }

    // 7. Route to appropriate operation
    if (entry.operation === 'INSERT') {
      return await this.dispatchInsert(entry, currentUser.id, resolvedCategoryId);
    }

    if (entry.operation === 'UPDATE') {
      return await this.dispatchUpdate(entry, currentUser.id, resolvedCategoryId);
    }

    return await this.dispatchSoftDelete(entry, currentUser.id);
  }

  private async dispatchInsert(
    entry: LocalOutboxRecord,
    authenticatedUserId: string,
    resolvedCategoryId: string | null
  ): Promise<CloudTransactionRow> {
    const payloadWithResolvedCategory = {
      ...entry.payload,
      category_id: resolvedCategoryId
    };
    const cloudRow = TransactionMapper.mapCreatePayload(payloadWithResolvedCategory);

    const persisted = await this.transactionRepo.insert(cloudRow);

    if (persisted.id !== cloudRow.id || persisted.user_id !== authenticatedUserId) {
      throw new Error(
        `Persisted transaction confirmation failed for ID '${cloudRow.id}'. Remote ID or owner mismatch.`
      );
    }

    return persisted;
  }

  private async dispatchUpdate(
    entry: LocalOutboxRecord,
    authenticatedUserId: string,
    resolvedCategoryId: string | null
  ): Promise<CloudTransactionRow> {
    const entityId = entry.entityId;
    const { expectedVersion } = this.validateAndDeriveExpectedVersion(entry.payload, 'update');

    const rawCategory = entry.payload.category_id ?? entry.payload.categoryId;
    const updatePayload = {
      ...entry.payload
    };
    if (rawCategory !== undefined) {
      updatePayload.category_id = resolvedCategoryId;
    }

    const patch = TransactionMapper.mapUpdatePayload(updatePayload);

    // Call updatePartial with validated canonical expectedVersion.
    const persisted = await this.transactionRepo.updatePartial(
      entityId,
      authenticatedUserId,
      patch,
      expectedVersion
    );

    if (persisted.id !== entityId || persisted.user_id !== authenticatedUserId) {
      throw new Error(
        `Updated transaction confirmation failed for ID '${entityId}'. Remote ID or owner mismatch.`
      );
    }

    return persisted;
  }

  private async dispatchSoftDelete(
    entry: LocalOutboxRecord,
    authenticatedUserId: string
  ): Promise<CloudTransactionRow> {
    const entityId = entry.entityId;
    const { targetVersion, expectedVersion } = this.validateAndDeriveExpectedVersion(
      entry.payload,
      'delete'
    );

    // Stable soft-delete timestamp invariant: must be generated during local deletion
    // and persisted in outbox payload. Reject if missing or invalid.
    const rawDeletedAt = entry.payload.deleted_at ?? entry.payload.deletedAt;
    if (typeof rawDeletedAt !== 'string' || rawDeletedAt.trim().length === 0) {
      throw new Error('Missing or invalid deleted_at in transaction delete payload.');
    }

    const parsed = new Date(rawDeletedAt);
    if (isNaN(parsed.getTime())) {
      throw new Error(`Invalid deleted_at '${rawDeletedAt}' in delete payload.`);
    }
    const deletedAt = parsed.toISOString();

    // Repository softDelete performs an optimistic UPDATE setting deleted_at.
    // It NEVER performs a physical SQL DELETE.
    const persisted = await this.transactionRepo.softDelete(
      entityId,
      authenticatedUserId,
      deletedAt,
      expectedVersion,
      targetVersion
    );

    if (persisted.id !== entityId || persisted.user_id !== authenticatedUserId) {
      throw new Error(
        `Deleted transaction confirmation failed for ID '${entityId}'. Remote ID or owner mismatch.`
      );
    }

    return persisted;
  }

  /**
   * Validates target version and any supplied expected version aliases (expected_version, expectedVersion).
   * Guarantees:
   * 1. targetVersion is a safe integer >= 2 for UPDATE and DELETE.
   * 2. Canonical expectedVersion is derived strictly as targetVersion - 1.
   * 3. If explicit expected version is supplied, it must be a positive safe integer and strictly equal to targetVersion - 1.
   * 4. If both snake_case and camelCase aliases are supplied, both must be valid and strictly equal.
   * 5. Malformed values (null, strings, booleans, zero, negative, fractional, NaN, Infinity, unsafe integers)
   *    are rejected immediately without forwarding unvalidated payload values to the cloud repository.
   */
  private validateAndDeriveExpectedVersion(
    payload: Record<string, unknown>,
    operation: 'update' | 'delete'
  ): { targetVersion: number; expectedVersion: number } {
    const rawTarget = payload.version;
    if (
      typeof rawTarget !== 'number' ||
      !Number.isSafeInteger(rawTarget) ||
      rawTarget < 2
    ) {
      throw new Error(
        `Invalid target version '${rawTarget}' in transaction ${operation} payload: must be a safe integer >= 2.`
      );
    }
    const targetVersion = rawTarget;
    const derivedExpectedVersion = targetVersion - 1;

    const hasSnake = payload.expected_version !== undefined;
    const hasCamel = payload.expectedVersion !== undefined;

    if (!hasSnake && !hasCamel) {
      return { targetVersion, expectedVersion: derivedExpectedVersion };
    }

    // If both aliases are supplied, they must not conflict
    if (hasSnake && hasCamel && payload.expected_version !== payload.expectedVersion) {
      throw new Error(
        `Conflicting expected version aliases in transaction ${operation} payload: expected_version '${payload.expected_version}' does not match expectedVersion '${payload.expectedVersion}'.`
      );
    }

    const explicitValue = hasSnake ? payload.expected_version : payload.expectedVersion;

    if (
      typeof explicitValue !== 'number' ||
      !Number.isSafeInteger(explicitValue) ||
      explicitValue <= 0
    ) {
      throw new Error(
        `Invalid expected version '${explicitValue}' in transaction ${operation} payload: must be a positive safe integer.`
      );
    }

    if (explicitValue !== derivedExpectedVersion) {
      throw new Error(
        `Inconsistent expected version in transaction ${operation} payload: explicit expected version '${explicitValue}' does not match derived expected version '${derivedExpectedVersion}' for target version '${targetVersion}'.`
      );
    }

    return { targetVersion, expectedVersion: derivedExpectedVersion };
  }
}

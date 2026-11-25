import { LocalOutboxRecord } from '@/infrastructure/database/local/schema';
import { ISupabaseBudgetRepository } from '@/infrastructure/database/cloud/repositories/SupabaseBudgetRepository';
import { AuthPort } from '@/application/ports/AuthPort';
import { OutboxManager } from '@/infrastructure/sync/OutboxManager';
import { ICategoryResolver } from '@/infrastructure/sync/CategoryMappingService';
import { BudgetMapper, CloudBudgetRow } from '@/infrastructure/database/cloud/mappers/BudgetMapper';
import {
  SyncAuthError,
  SyncInProgressError,
  SyncUnresolvedCategoryError
} from '@/infrastructure/sync/errors/SyncErrors';
import { isValidUuid } from '@/domain/value-objects/Identifiers';

/**
 * BudgetSyncDispatcher
 *
 * Dedicated outbox dispatcher for budget synchronization.
 * Routes outbox mutations (INSERT, UPDATE, DELETE) to SupabaseBudgetRepository.
 *
 * Guarantees:
 * 1. Strict Tenant Isolation: Requires authenticated user; enforces payload user_id ownership.
 * 2. Strict Entity & Operation Filtering: Only processes 'budgets' and INSERT/UPDATE/DELETE.
 * 3. Category Identity Resolution: Resolves local category_id to verified cloud UUID via ICategoryResolver.
 * 4. Verified Remote Persistence: Calls markSuccess only after confirmed remote operation.
 * 5. Failure Retention: Records error metadata via markFailure without deleting entries.
 * 6. Tombstone Deletion: DELETE routes exclusively to repository.softDelete() and never physical DELETE.
 * 7. OCC Version Enforcement: Validates monotonic target version and expected_version aliases.
 */
export class BudgetSyncDispatcher {
  private readonly inFlightBudgets: Set<string> = new Set();

  constructor(
    private readonly budgetRepo: ISupabaseBudgetRepository,
    private readonly authPort: AuthPort,
    private readonly outboxManager?: OutboxManager,
    private readonly categoryResolver?: ICategoryResolver
  ) {}

  public async dispatch(entry: LocalOutboxRecord): Promise<void> {
    if (this.inFlightBudgets.has(entry.entityId)) {
      throw new SyncInProgressError(
        `Cannot dispatch outbox entry for budget '${entry.entityId}': An operation for this budget is already in progress.`
      );
    }

    this.inFlightBudgets.add(entry.entityId);

    try {
      await this.executeDispatch(entry);

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
      this.inFlightBudgets.delete(entry.entityId);
    }
  }

  private async executeDispatch(entry: LocalOutboxRecord): Promise<CloudBudgetRow> {
    // 1. Guard supported entity
    if (entry.entity !== 'budgets') {
      throw new Error(
        `BudgetSyncDispatcher only processes 'budgets' entities. Received '${entry.entity}'.`
      );
    }

    // 2. Guard supported operations
    if (
      entry.operation !== 'INSERT' &&
      entry.operation !== 'UPDATE' &&
      entry.operation !== 'DELETE'
    ) {
      throw new Error(
        `BudgetSyncDispatcher only processes 'INSERT', 'UPDATE', and 'DELETE'. Received '${entry.operation}'.`
      );
    }

    // 3. Verify authenticated user
    const currentUser = await this.authPort.getCurrentUser();
    if (!currentUser || !currentUser.id) {
      throw new SyncAuthError('Sync aborted: User is not authenticated.');
    }

    // 4. Verify payload ID matches entityId
    if (entry.payload.id !== undefined && entry.payload.id !== entry.entityId) {
      throw new Error(
        `Sync aborted: Payload ID '${entry.payload.id}' does not match entityId '${entry.entityId}'.`
      );
    }

    // 5. Enforce tenant ownership against authenticated user
    const payloadUserId = entry.payload.user_id ?? entry.payload.userId;
    if (entry.operation === 'INSERT') {
      if (typeof payloadUserId !== 'string' || payloadUserId !== currentUser.id) {
        throw new SyncAuthError(
          `Sync aborted: Outbox payload user_id '${payloadUserId}' does not match authenticated user '${currentUser.id}'.`
        );
      }
    } else {
      if (
        payloadUserId !== undefined &&
        (typeof payloadUserId !== 'string' || payloadUserId !== currentUser.id)
      ) {
        throw new SyncAuthError(
          `Sync aborted: Outbox payload user_id '${payloadUserId}' does not match authenticated user '${currentUser.id}'.`
        );
      }
    }

    if (entry.operation === 'INSERT') {
      return await this.dispatchInsert(entry, currentUser.id);
    }
    if (entry.operation === 'UPDATE') {
      return await this.dispatchUpdate(entry, currentUser.id);
    }
    return await this.dispatchSoftDelete(entry, currentUser.id);
  }

  private async dispatchInsert(
    entry: LocalOutboxRecord,
    authenticatedUserId: string
  ): Promise<CloudBudgetRow> {
    const rawCategory = entry.payload.category_id ?? entry.payload.categoryId;
    if (typeof rawCategory !== 'string' || rawCategory.trim().length === 0) {
      throw new SyncUnresolvedCategoryError(
        `Cannot sync budget '${entry.entityId}': Missing category reference.`,
        ''
      );
    }

    let resolvedCategoryId: string | null = null;
    if (this.categoryResolver) {
      resolvedCategoryId = await this.categoryResolver.resolveCategory(
        rawCategory.trim(),
        authenticatedUserId
      );
      if (!resolvedCategoryId) {
        throw new SyncUnresolvedCategoryError(
          `Cannot sync budget '${entry.entityId}': Category reference '${rawCategory}' could not be resolved to cloud identity.`,
          rawCategory
        );
      }
    } else if (isValidUuid(rawCategory)) {
      resolvedCategoryId = rawCategory.trim();
    } else {
      throw new SyncUnresolvedCategoryError(
        `Cannot sync budget '${entry.entityId}': Invalid category reference '${rawCategory}'.`,
        rawCategory
      );
    }

    const cloudRow = BudgetMapper.mapCreatePayload({
      ...entry.payload,
      category_id: resolvedCategoryId
    });

    const persisted = await this.budgetRepo.insert(cloudRow);

    if (persisted.id !== cloudRow.id || persisted.user_id !== authenticatedUserId) {
      throw new Error(
        `Persisted budget confirmation failed for ID '${cloudRow.id}'. Remote ID or owner mismatch.`
      );
    }

    return persisted;
  }

  private async dispatchUpdate(
    entry: LocalOutboxRecord,
    authenticatedUserId: string
  ): Promise<CloudBudgetRow> {
    const entityId = entry.entityId;
    const { targetVersion, expectedVersion } = this.validateAndDeriveExpectedVersion(
      entry.payload,
      'update'
    );

    const patch = BudgetMapper.mapUpdatePayload(entry.payload);

    const persisted = await this.budgetRepo.updatePartial(
      entityId,
      authenticatedUserId,
      patch,
      expectedVersion
    );

    if (
      persisted.id !== entityId ||
      persisted.user_id !== authenticatedUserId ||
      persisted.version !== targetVersion
    ) {
      throw new Error(
        `Updated budget confirmation failed for ID '${entityId}'. Remote ID, owner, or version mismatch.`
      );
    }

    return persisted;
  }

  private async dispatchSoftDelete(
    entry: LocalOutboxRecord,
    authenticatedUserId: string
  ): Promise<CloudBudgetRow> {
    const entityId = entry.entityId;
    const { targetVersion, expectedVersion } = this.validateAndDeriveExpectedVersion(
      entry.payload,
      'delete'
    );

    const deletePatch = BudgetMapper.mapSoftDeletePayload(entry.payload);

    const persisted = await this.budgetRepo.softDelete(
      entityId,
      authenticatedUserId,
      deletePatch.deleted_at!,
      expectedVersion,
      targetVersion
    );

    if (
      persisted.id !== entityId ||
      persisted.user_id !== authenticatedUserId ||
      persisted.version !== targetVersion ||
      !persisted.deleted_at
    ) {
      throw new Error(
        `Deleted budget confirmation failed for ID '${entityId}'. Remote ID, owner, version, or tombstone mismatch.`
      );
    }

    return persisted;
  }

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
        `Invalid target version '${rawTarget}' in budget ${operation} payload: must be a safe integer >= 2.`
      );
    }

    const targetVersion = rawTarget;
    const derivedExpectedVersion = targetVersion - 1;

    const hasSnake = payload.expected_version !== undefined;
    const hasCamel = payload.expectedVersion !== undefined;

    if (!hasSnake && !hasCamel) {
      return { targetVersion, expectedVersion: derivedExpectedVersion };
    }

    if (hasSnake && hasCamel && payload.expected_version !== payload.expectedVersion) {
      throw new Error(
        `Conflicting expected version aliases in budget ${operation} payload: expected_version '${payload.expected_version}' does not match expectedVersion '${payload.expectedVersion}'.`
      );
    }

    const explicitValue = hasSnake ? payload.expected_version : payload.expectedVersion;
    if (
      typeof explicitValue !== 'number' ||
      !Number.isSafeInteger(explicitValue) ||
      explicitValue <= 0
    ) {
      throw new Error(
        `Invalid expected version '${explicitValue}' in budget ${operation} payload: must be a positive safe integer.`
      );
    }

    if (explicitValue !== derivedExpectedVersion) {
      throw new Error(
        `Inconsistent expected version in budget ${operation} payload: expected '${explicitValue}' does not match derived '${derivedExpectedVersion}' for target version '${targetVersion}'.`
      );
    }

    return { targetVersion, expectedVersion: derivedExpectedVersion };
  }
}

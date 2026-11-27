import { LocalOutboxRecord } from '@/infrastructure/database/local/schema';
import { ISupabaseCategoryRepository } from '@/infrastructure/database/cloud/repositories/SupabaseCategoryRepository';
import { AuthPort } from '@/application/ports/AuthPort';
import { OutboxManager } from '@/infrastructure/sync/OutboxManager';
import {
  CategoryMapper,
  CloudCategoryRow
} from '@/infrastructure/database/cloud/mappers/CategoryMapper';
import { SyncAuthError, SyncInProgressError } from '@/infrastructure/sync/errors/SyncErrors';
import { ICategoryResolver } from '@/infrastructure/sync/CategoryMappingService';

export class CategorySyncDispatcher {
  private readonly inFlightCategories: Set<string> = new Set();

  constructor(
    private readonly categoryRepo: ISupabaseCategoryRepository,
    private readonly authPort: AuthPort,
    private readonly outboxManager?: OutboxManager,
    private readonly mappingService?: ICategoryResolver
  ) {}

  /**
   * Dispatches a single categories outbox entry to Supabase.
   * If an OutboxManager is provided and entry has a valid local ID,
   * automatically acknowledges success via markSuccess only after cloud verification,
   * or records failure metadata via markFailure on error.
   */
  public async dispatch(entry: LocalOutboxRecord): Promise<void> {
    if (this.inFlightCategories.has(entry.entityId)) {
      throw new SyncInProgressError(
        `Cannot dispatch outbox entry for category '${entry.entityId}': An operation for this category is already in progress.`
      );
    }

    this.inFlightCategories.add(entry.entityId);

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
      this.inFlightCategories.delete(entry.entityId);
    }
  }

  private async executeDispatch(entry: LocalOutboxRecord): Promise<CloudCategoryRow> {
    // 1. Guard supported entity
    if (entry.entity !== 'categories') {
      throw new Error(
        `CategorySyncDispatcher only processes 'categories' entities. Received '${entry.entity}'.`
      );
    }

    // 2. Guard supported operations
    if (entry.operation !== 'INSERT' && entry.operation !== 'UPDATE') {
      throw new Error(
        `CategorySyncDispatcher only processes 'INSERT' and 'UPDATE'. Received '${entry.operation}'.`
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
      if (typeof payloadUserId !== 'string' || payloadUserId !== currentUser.id) {
        throw new SyncAuthError(
          `Sync aborted: Outbox payload user_id '${payloadUserId}' does not match authenticated user '${currentUser.id}'.`
        );
      }
    } else if (entry.operation === 'UPDATE') {
      if (
        payloadUserId !== undefined &&
        (typeof payloadUserId !== 'string' || payloadUserId !== currentUser.id)
      ) {
        throw new SyncAuthError(
          `Sync aborted: Outbox payload user_id '${payloadUserId}' does not match authenticated user '${currentUser.id}'.`
        );
      }
    }

    // 6. Execute INSERT
    if (entry.operation === 'INSERT') {
      const cloudRow = CategoryMapper.mapCreatePayload(entry.payload);

      // If a default category was already mapped to an existing cloud default, confirm it without duplicating
      if (cloudRow.is_default && this.mappingService) {
        const mappedCloudId = await this.mappingService.getMapping(entry.entityId, currentUser.id);
        if (mappedCloudId && mappedCloudId !== entry.entityId) {
          const existingCloudDefault = await this.categoryRepo.findById(
            mappedCloudId,
            currentUser.id
          );
          if (
            existingCloudDefault &&
            existingCloudDefault.user_id === currentUser.id &&
            existingCloudDefault.is_default &&
            existingCloudDefault.type === cloudRow.type
          ) {
            await this.mappingService.setMapping(
              entry.entityId,
              existingCloudDefault.id,
              currentUser.id
            );
            return existingCloudDefault;
          }
        }
      }

      const persisted = await this.categoryRepo.insert(cloudRow);

      if (persisted.user_id !== currentUser.id) {
        throw new Error(
          `Persisted category confirmation failed for ID '${cloudRow.id}'. Remote owner mismatch.`
        );
      }

      // Record durable mapping
      if (this.mappingService) {
        await this.mappingService.setMapping(entry.entityId, persisted.id, currentUser.id);
      }

      return persisted;
    }

    // 7. Execute UPDATE
    const entityId = entry.entityId;
    const targetVersion = entry.payload.version;

    if (
      typeof targetVersion !== 'number' ||
      !Number.isSafeInteger(targetVersion) ||
      targetVersion < 2
    ) {
      throw new Error(`Invalid target version '${targetVersion}' in category update payload.`);
    }

    const expectedVersion = targetVersion - 1;
    const patch = CategoryMapper.mapUpdatePayload(entry.payload);

    // Resolve cloud ID from mapping if available
    let cloudId = entityId;
    if (this.mappingService) {
      const mapped = await this.mappingService.getMapping(entityId, currentUser.id);
      if (mapped) {
        cloudId = mapped;
      }
    }

    const persisted = await this.categoryRepo.updatePartial(
      cloudId,
      currentUser.id,
      patch,
      expectedVersion
    );

    if (persisted.user_id !== currentUser.id) {
      throw new Error(
        `Updated category confirmation failed for ID '${cloudId}'. Remote owner mismatch.`
      );
    }

    if (this.mappingService) {
      await this.mappingService.setMapping(entry.entityId, persisted.id, currentUser.id);
    }

    return persisted;
  }
}

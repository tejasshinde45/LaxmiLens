import { LocalOutboxRecord } from '@/infrastructure/database/local/schema';
import { ISupabaseRecurringRuleRepository } from '@/infrastructure/database/cloud/repositories/SupabaseRecurringRuleRepository';
import { AuthPort } from '@/application/ports/AuthPort';
import { OutboxManager } from '@/infrastructure/sync/OutboxManager';
import { ICategoryResolver } from '@/infrastructure/sync/CategoryMappingService';
import {
  CloudRecurringRuleRow,
  RecurringRuleMapper
} from '@/infrastructure/database/cloud/mappers/RecurringRuleMapper';
import {
  SyncAuthError,
  SyncInProgressError,
  SyncUnresolvedCategoryError
} from '@/infrastructure/sync/errors/SyncErrors';
import { isValidUuid } from '@/domain/value-objects/Identifiers';

export class RecurringRuleSyncDispatcher {
  private readonly inFlightRules: Set<string> = new Set();

  constructor(
    private readonly ruleRepo: ISupabaseRecurringRuleRepository,
    private readonly authPort: AuthPort,
    private readonly outboxManager?: OutboxManager,
    private readonly categoryResolver?: ICategoryResolver
  ) {}

  public async dispatch(entry: LocalOutboxRecord): Promise<void> {
    if (this.inFlightRules.has(entry.entityId)) {
      throw new SyncInProgressError(
        `Cannot dispatch recurring rule '${entry.entityId}': operation already in progress.`
      );
    }

    this.inFlightRules.add(entry.entityId);
    try {
      await this.executeDispatch(entry);
      if (this.outboxManager && typeof entry.id === 'number') {
        await this.outboxManager.markSuccess(entry.id);
      }
    } catch (error) {
      if (this.outboxManager && typeof entry.id === 'number') {
        const msg = error instanceof Error ? error.message : String(error);
        await this.outboxManager.markFailure(entry.id, msg);
      }
      throw error;
    } finally {
      this.inFlightRules.delete(entry.entityId);
    }
  }

  private async resolveOptionalCategory(
    rawCat: unknown,
    userId: string,
    entityId: string
  ): Promise<string | null> {
    if (rawCat === null || rawCat === undefined || String(rawCat).trim() === '') {
      return null;
    }
    const catStr = String(rawCat).trim();
    if (this.categoryResolver) {
      const resolved = await this.categoryResolver.resolveCategory(catStr, userId);
      if (!resolved) {
        throw new SyncUnresolvedCategoryError(
          `Cannot sync recurring rule '${entityId}': Category '${catStr}' could not be resolved to cloud UUID.`,
          catStr
        );
      }
      return resolved;
    }
    if (isValidUuid(catStr)) {
      return catStr;
    }
    throw new SyncUnresolvedCategoryError(
      `Cannot sync recurring rule '${entityId}': Invalid category ID '${catStr}'.`,
      catStr
    );
  }

  private async executeDispatch(entry: LocalOutboxRecord): Promise<CloudRecurringRuleRow> {
    if (entry.entity !== 'recurring_rules') {
      throw new Error(`RecurringRuleSyncDispatcher received unexpected entity '${entry.entity}'.`);
    }

    const currentUser = await this.authPort.getCurrentUser();
    if (!currentUser || !currentUser.id) {
      throw new SyncAuthError('Sync aborted: User is not authenticated.');
    }

    const payloadUserId = entry.payload.user_id ?? entry.payload.userId;
    if (
      payloadUserId !== undefined &&
      (typeof payloadUserId !== 'string' || payloadUserId !== currentUser.id)
    ) {
      throw new SyncAuthError(
        `Sync aborted: Outbox recurring rule user_id mismatch for '${entry.entityId}'.`
      );
    }

    if (entry.operation === 'INSERT') {
      const resolvedCat = await this.resolveOptionalCategory(
        entry.payload.category_id ?? entry.payload.categoryId,
        currentUser.id,
        entry.entityId
      );
      const row = RecurringRuleMapper.mapCreatePayload({
        ...entry.payload,
        category_id: resolvedCat
      });
      return await this.ruleRepo.insert(row);
    }

    if (entry.operation === 'UPDATE') {
      const targetVersion = Number(entry.payload.version);
      if (!Number.isSafeInteger(targetVersion) || targetVersion < 2) {
        throw new Error(`Invalid target version '${entry.payload.version}' for recurring rule update.`);
      }
      const expectedVersion = Number(entry.payload.expected_version ?? targetVersion - 1);

      const patchPayload: Record<string, unknown> = { ...entry.payload };
      if (patchPayload.category_id !== undefined || patchPayload.categoryId !== undefined) {
        patchPayload.category_id = await this.resolveOptionalCategory(
          patchPayload.category_id ?? patchPayload.categoryId,
          currentUser.id,
          entry.entityId
        );
      }

      const patch = RecurringRuleMapper.mapUpdatePayload(patchPayload);
      return await this.ruleRepo.updatePartial(
        entry.entityId,
        currentUser.id,
        patch,
        expectedVersion
      );
    }

    if (entry.operation === 'DELETE') {
      const targetVersion = Number(entry.payload.version);
      if (!Number.isSafeInteger(targetVersion) || targetVersion < 2) {
        throw new Error(`Invalid target version '${entry.payload.version}' for recurring rule delete.`);
      }
      const expectedVersion = Number(entry.payload.expected_version ?? targetVersion - 1);
      const patch = RecurringRuleMapper.mapSoftDeletePayload(entry.payload);
      return await this.ruleRepo.softDelete(
        entry.entityId,
        currentUser.id,
        patch.deleted_at!,
        expectedVersion,
        targetVersion
      );
    }

    throw new Error(`Unsupported operation '${entry.operation}' in RecurringRuleSyncDispatcher.`);
  }
}

import { LaxmiLensDB } from '@/infrastructure/database/local/DexieDatabase';
import {
  LocalOutboxRecord,
  LocalRecurringOccurrenceRecord,
  LocalRecurringRuleRecord
} from '@/infrastructure/database/local/schema';
import { ISupabaseRecurringRuleRepository } from '@/infrastructure/database/cloud/repositories/SupabaseRecurringRuleRepository';
import { ISupabaseRecurringOccurrenceRepository } from '@/infrastructure/database/cloud/repositories/SupabaseRecurringOccurrenceRepository';
import { RecurringRuleMapper } from '@/infrastructure/database/cloud/mappers/RecurringRuleMapper';
import { RecurringOccurrenceMapper } from '@/infrastructure/database/cloud/mappers/RecurringOccurrenceMapper';
import { AuthPort } from '@/application/ports/AuthPort';
import { ICategoryResolver } from './CategoryMappingService';
import { SyncAuthError } from './errors/SyncErrors';
import { validateUserId } from '@/domain/value-objects/Identifiers';

export interface RecurringPullConflict {
  entity: 'recurring_rules' | 'recurring_occurrences';
  entityId: string;
  reason: string;
}

export interface RecurringReconciliationResult {
  pulledCount: number;
  conflictCount: number;
  conflicts: RecurringPullConflict[];
}

export class RecurringReconciliationService {
  constructor(
    private readonly database: LaxmiLensDB,
    private readonly cloudRuleRepo: ISupabaseRecurringRuleRepository,
    private readonly cloudOccurrenceRepo: ISupabaseRecurringOccurrenceRepository,
    private readonly authPort: AuthPort,
    private readonly categoryResolver?: ICategoryResolver
  ) {}

  public async pullAndReconcile(userId?: string): Promise<RecurringReconciliationResult> {
    const currentUser = await this.authPort.getCurrentUser();
    if (!currentUser || !currentUser.id) {
      throw new SyncAuthError('Recurring reconciliation aborted: User is not authenticated.');
    }

    const authenticatedUserId = validateUserId(currentUser.id);
    if (userId && validateUserId(userId) !== authenticatedUserId) {
      throw new SyncAuthError(
        `Recurring reconciliation aborted: Requested user '${userId}' does not match authenticated user.`
      );
    }

    const [cloudRules, cloudOccurrences] = await Promise.all([
      this.cloudRuleRepo.findAll(authenticatedUserId, { includeDeleted: true }),
      this.cloudOccurrenceRepo.findAll(authenticatedUserId, { includeDeleted: true })
    ]);

    for (const row of cloudRules) {
      RecurringRuleMapper.validateCloudRow(row);
      if (row.user_id !== authenticatedUserId) {
        throw new SyncAuthError(`Cloud recurring rule '${row.id}' belongs to another user.`);
      }
    }

    for (const row of cloudOccurrences) {
      RecurringOccurrenceMapper.validateCloudRow(row);
      if (row.user_id !== authenticatedUserId) {
        throw new SyncAuthError(`Cloud recurring occurrence '${row.id}' belongs to another user.`);
      }
    }

    const resolvedLocalCatMap = new Map<string, string>();
    if (this.categoryResolver?.resolveLocalCategory) {
      const uniqueCloudCats = Array.from(
        new Set(cloudRules.map((r) => r.category_id).filter((c): c is string => Boolean(c)))
      );
      for (const cloudCatId of uniqueCloudCats) {
        const localCatId = await this.categoryResolver.resolveLocalCategory(
          cloudCatId,
          authenticatedUserId
        );
        if (localCatId) {
          resolvedLocalCatMap.set(cloudCatId, localCatId);
        }
      }
    }

    const result: RecurringReconciliationResult = {
      pulledCount: 0,
      conflictCount: 0,
      conflicts: []
    };

    await this.database.transaction(
      'rw',
      [
        this.database.recurringRules,
        this.database.recurringOccurrences,
        this.database.syncOutbox
      ],
      async () => {
        const outbox = (await this.database.syncOutbox
          .where('userId')
          .equals(authenticatedUserId)
          .toArray()) as LocalOutboxRecord[];

        const pendingRuleIds = new Set(
          outbox.filter((e) => e.entity === 'recurring_rules').map((e) => e.entityId)
        );
        const pendingOccIds = new Set(
          outbox.filter((e) => e.entity === 'recurring_occurrences').map((e) => e.entityId)
        );

        const localRules = await this.database.recurringRules
          .where('userId')
          .equals(authenticatedUserId)
          .toArray();
        const localRuleById = new Map<string, LocalRecurringRuleRecord>(
          localRules.map((r) => [r.id, r])
        );

        for (const cloudRule of cloudRules) {
          if (pendingRuleIds.has(cloudRule.id)) continue;
          const existing = localRuleById.get(cloudRule.id);

          if (cloudRule.deleted_at) {
            if (existing && !existing.deletedAt && cloudRule.version >= existing.version) {
              await this.database.recurringRules.put({
                ...existing,
                deletedAt: cloudRule.deleted_at,
                version: cloudRule.version,
                updatedAt: cloudRule.updated_at ?? cloudRule.deleted_at
              });
              result.pulledCount++;
            }
            continue;
          }

          const localCatId = cloudRule.category_id
            ? (resolvedLocalCatMap.get(cloudRule.category_id) ?? cloudRule.category_id)
            : null;
          const mapped = RecurringRuleMapper.toLocalRecord(cloudRule, localCatId);

          if (!existing || cloudRule.version > existing.version) {
            await this.database.recurringRules.put(mapped);
            result.pulledCount++;
          }
        }

        const localOccs = await this.database.recurringOccurrences
          .where('userId')
          .equals(authenticatedUserId)
          .toArray();
        const localOccById = new Map<string, LocalRecurringOccurrenceRecord>(
          localOccs.map((o) => [o.id, o])
        );
        const localOccBySlot = new Map<string, LocalRecurringOccurrenceRecord>(
          localOccs
            .filter((o) => !o.deletedAt)
            .map((o) => [`${o.recurringRuleId}:${o.occurrenceDate}`, o])
        );

        for (const cloudOcc of cloudOccurrences) {
          if (pendingOccIds.has(cloudOcc.id)) continue;
          const slotKey = `${cloudOcc.recurring_rule_id}:${cloudOcc.occurrence_date}`;
          const existing = localOccById.get(cloudOcc.id);

          if (cloudOcc.deleted_at) {
            if (existing && !existing.deletedAt && cloudOcc.version >= existing.version) {
              await this.database.recurringOccurrences.put({
                ...existing,
                deletedAt: cloudOcc.deleted_at,
                version: cloudOcc.version,
                updatedAt: cloudOcc.updated_at ?? cloudOcc.deleted_at
              });
              result.pulledCount++;
            }
            continue;
          }

          const slotOccupant = localOccBySlot.get(slotKey);
          if (slotOccupant && slotOccupant.id !== cloudOcc.id) {
            result.conflictCount++;
            result.conflicts.push({
              entity: 'recurring_occurrences',
              entityId: cloudOcc.id,
              reason: `Slot (${slotKey}) occupied locally by '${slotOccupant.id}'. Local occurrence preserved.`
            });
            continue;
          }

          const mappedOcc = RecurringOccurrenceMapper.toLocalRecord(cloudOcc);
          if (!existing || cloudOcc.version > existing.version) {
            await this.database.recurringOccurrences.put(mappedOcc);
            localOccBySlot.set(slotKey, mappedOcc);
            result.pulledCount++;
          }
        }
      }
    );

    return result;
  }
}

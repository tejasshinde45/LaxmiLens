import { LaxmiLensDB } from '@/infrastructure/database/local/DexieDatabase';
import { LocalBudgetRecord, LocalOutboxRecord } from '@/infrastructure/database/local/schema';
import { ISupabaseBudgetRepository } from '@/infrastructure/database/cloud/repositories/SupabaseBudgetRepository';
import { BudgetMapper, CloudBudgetRow } from '@/infrastructure/database/cloud/mappers/BudgetMapper';
import { AuthPort } from '@/application/ports/AuthPort';
import { ICategoryResolver } from './CategoryMappingService';
import { SyncAuthError } from './errors/SyncErrors';
import { validateUserId } from '@/domain/value-objects/Identifiers';

export interface BudgetPullConflict {
  budgetId: string;
  reason: string;
}

export interface BudgetReconciliationResult {
  pulledCount: number;
  insertedCount: number;
  updatedCount: number;
  deletedCount: number;
  skippedPendingCount: number;
  conflictCount: number;
  conflicts: BudgetPullConflict[];
}

/**
 * BudgetReconciliationService
 *
 * Reconciles cloud budgets (including tombstones) into the authenticated user's
 * isolated local Dexie database during manual synchronization.
 *
 * Guarantees:
 * 1. Strict User Context: Requires authenticated user matching optional requested userId.
 * 2. Pending Local Protection: Never overwrites budgets or (categoryId, period) slots
 *    with pending mutations (INSERT, UPDATE, DELETE) in syncOutbox.
 * 3. Tombstone Processing Order: Processes tombstoned rows before active rows so a
 *    remotely deleted-and-recreated budget for the same (categoryId, period) reconciles cleanly.
 * 4. Conflict Preservation: Never silently overwrites higher or divergent local versions.
 * 5. Atomic Local Reconciliation: Re-verifies syncOutbox inside the same Dexie rw transaction.
 */
export class BudgetReconciliationService {
  constructor(
    private readonly database: LaxmiLensDB,
    private readonly cloudBudgetRepo: ISupabaseBudgetRepository,
    private readonly authPort: AuthPort,
    private readonly categoryResolver?: ICategoryResolver
  ) {}

  public async pullAndReconcile(userId?: string): Promise<BudgetReconciliationResult> {
    const currentUser = await this.authPort.getCurrentUser();
    if (!currentUser || !currentUser.id) {
      throw new SyncAuthError('Budget reconciliation aborted: User is not authenticated.');
    }

    const authenticatedUserId = validateUserId(currentUser.id);
    if (userId && validateUserId(userId) !== authenticatedUserId) {
      throw new SyncAuthError(
        `Budget reconciliation aborted: Requested user '${userId}' does not match authenticated user '${authenticatedUserId}'.`
      );
    }

    // 1. Fetch remote budgets including tombstones for authenticated user
    const cloudRows = await this.cloudBudgetRepo.findAll(authenticatedUserId, {
      includeDeleted: true
    });

    // Validate all rows strictly before entering local write transaction
    for (const row of cloudRows) {
      BudgetMapper.validateCloudRow(row);
      if (row.user_id !== authenticatedUserId) {
        throw new SyncAuthError(
          `Budget reconciliation aborted: Cloud row '${row.id}' belongs to another user.`
        );
      }
    }

    // 2. Pre-resolve remote category IDs to local category IDs (outside Dexie rw lock)
    const resolvedLocalCatMap = new Map<string, string>();
    if (this.categoryResolver?.resolveLocalCategory) {
      const uniqueCloudCats = Array.from(new Set(cloudRows.map((r) => r.category_id)));
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

    // Order tombstones first so deleted-then-recreated cloud budgets for the same slot
    // clear old local entries before inserting replacement records.
    const tombstones = cloudRows.filter(
      (r) => r.deleted_at !== null && r.deleted_at !== undefined
    );
    const activeRows = cloudRows.filter(
      (r) => r.deleted_at === null || r.deleted_at === undefined
    );
    const orderedRows: CloudBudgetRow[] = [...tombstones, ...activeRows];

    const result: BudgetReconciliationResult = {
      pulledCount: 0,
      insertedCount: 0,
      updatedCount: 0,
      deletedCount: 0,
      skippedPendingCount: 0,
      conflictCount: 0,
      conflicts: []
    };

    // 3. Reconcile atomically inside a Dexie rw transaction covering budgets + syncOutbox
    await this.database.transaction(
      'rw',
      [this.database.budgets, this.database.syncOutbox],
      async () => {
        const allOutbox = (await this.database.syncOutbox
          .where('userId')
          .equals(authenticatedUserId)
          .toArray()) as LocalOutboxRecord[];

        const pendingBudgetEntries = allOutbox.filter((e) => e.entity === 'budgets');
        const pendingBudgetIds = new Set<string>();
        const pendingSlots = new Set<string>();

        for (const pending of pendingBudgetEntries) {
          pendingBudgetIds.add(pending.entityId);
          const rawCat = pending.payload?.category_id ?? pending.payload?.categoryId;
          const rawPeriod = pending.payload?.period;
          if (typeof rawCat === 'string' && typeof rawPeriod === 'string') {
            pendingSlots.add(`${rawCat}:${rawPeriod.trim()}`);
            const mappedLocal = resolvedLocalCatMap.get(rawCat);
            if (mappedLocal) {
              pendingSlots.add(`${mappedLocal}:${rawPeriod.trim()}`);
            }
          }
        }

        const localRecords = await this.database.budgets
          .where('userId')
          .equals(authenticatedUserId)
          .toArray();

        const localById = new Map<string, LocalBudgetRecord>();
        const localBySlot = new Map<string, LocalBudgetRecord>();

        for (const rec of localRecords) {
          localById.set(rec.id, rec);
          localBySlot.set(`${rec.categoryId}:${rec.period}`, rec);
        }

        // Also protect slots of pending budget outbox IDs even if payload omitted category_id/period
        for (const pendingId of pendingBudgetIds) {
          const matchedLocal = localById.get(pendingId);
          if (matchedLocal) {
            pendingSlots.add(`${matchedLocal.categoryId}:${matchedLocal.period}`);
          }
        }

        for (const cloudRow of orderedRows) {
          const localCatId = resolvedLocalCatMap.get(cloudRow.category_id) ?? cloudRow.category_id;
          const localSlotKey = `${localCatId}:${cloudRow.period.trim()}`;
          const cloudSlotKey = `${cloudRow.category_id}:${cloudRow.period.trim()}`;

          // Protect pending local changes from remote overwrite
          if (
            pendingBudgetIds.has(cloudRow.id) ||
            pendingSlots.has(localSlotKey) ||
            pendingSlots.has(cloudSlotKey)
          ) {
            result.skippedPendingCount++;
            continue;
          }

          const localExisting = localById.get(cloudRow.id);

          // A. Remote tombstone reconciliation
          if (cloudRow.deleted_at !== null && cloudRow.deleted_at !== undefined) {
            if (!localExisting) {
              continue;
            }

            if (cloudRow.version >= localExisting.version) {
              await this.database.budgets.delete(localExisting.id);
              localById.delete(localExisting.id);
              localBySlot.delete(`${localExisting.categoryId}:${localExisting.period}`);
              result.deletedCount++;
              result.pulledCount++;
            } else {
              result.conflictCount++;
              result.conflicts.push({
                budgetId: cloudRow.id,
                reason: `Remote tombstone for budget '${cloudRow.id}' has older version (${cloudRow.version}) than local record (${localExisting.version}). Local record preserved.`
              });
            }
            continue;
          }

          // B. Active remote record reconciliation
          const mappedRecord = BudgetMapper.toLocalRecord(cloudRow, localCatId);

          if (localExisting) {
            if (cloudRow.version > localExisting.version) {
              await this.database.budgets.put(mappedRecord);
              localById.set(mappedRecord.id, mappedRecord);
              localBySlot.set(localSlotKey, mappedRecord);
              result.updatedCount++;
              result.pulledCount++;
            } else if (cloudRow.version === localExisting.version) {
              const isIdentical =
                localExisting.limitPaise === mappedRecord.limitPaise &&
                localExisting.categoryId === mappedRecord.categoryId &&
                localExisting.period === mappedRecord.period;

              if (!isIdentical) {
                result.conflictCount++;
                result.conflicts.push({
                  budgetId: cloudRow.id,
                  reason: `Conflict on budget '${cloudRow.id}' at version ${cloudRow.version}: cloud limit (${mappedRecord.limitPaise}) differs from local limit (${localExisting.limitPaise}). Local record preserved.`
                });
              }
            } else {
              result.conflictCount++;
              result.conflicts.push({
                budgetId: cloudRow.id,
                reason: `Remote budget '${cloudRow.id}' has older version (${cloudRow.version}) than local record (${localExisting.version}). Local record preserved.`
              });
            }
            continue;
          }

          // Check slot uniqueness locally before inserting new remote budget
          const slotOccupant = localBySlot.get(localSlotKey);
          if (slotOccupant && slotOccupant.id !== mappedRecord.id) {
            result.conflictCount++;
            result.conflicts.push({
              budgetId: cloudRow.id,
              reason: `Cannot pull remote budget '${cloudRow.id}' for slot (${localSlotKey}): local budget '${slotOccupant.id}' already exists. Local record preserved.`
            });
            continue;
          }

          await this.database.budgets.put(mappedRecord);
          localById.set(mappedRecord.id, mappedRecord);
          localBySlot.set(localSlotKey, mappedRecord);
          result.insertedCount++;
          result.pulledCount++;
        }
      }
    );

    return result;
  }
}

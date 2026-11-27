import { AuthPort } from '@/application/ports/AuthPort';
import { validateUserId } from '@/domain/value-objects/Identifiers';
import { LaxmiLensDB } from '@/infrastructure/database/local/DexieDatabase';
import {
  LocalOutboxRecord,
  LocalTransactionRecord
} from '@/infrastructure/database/local/schema';
import {
  CloudTransactionRow,
  TransactionMapper
} from '@/infrastructure/database/cloud/mappers/TransactionMapper';
import { ISupabaseTransactionRepository } from '@/infrastructure/database/cloud/repositories/SupabaseTransactionRepository';
import { DEFAULT_CLOUD_PAGE_SIZE } from '@/infrastructure/database/cloud/repositories/cloudPagination';
import { normalizeOptionalText } from '@/utils/textNormalization';
import { ICategoryResolver } from './CategoryMappingService';
import { SyncAuthError } from './errors/SyncErrors';

export interface TransactionPullConflict {
  transactionId: string;
  reason: string;
}

export interface TransactionReconciliationResult {
  pulledCount: number;
  insertedCount: number;
  updatedCount: number;
  deletedCount: number;
  pagesFetched: number;
  skippedPendingCount: number;
  conflictCount: number;
  conflicts: TransactionPullConflict[];
}

const MAX_RECONCILE_PAGES = 10_000;

function areTransactionRecordsEquivalent(
  local: LocalTransactionRecord,
  mapped: LocalTransactionRecord
): boolean {
  const localDest = normalizeOptionalText(local.destinationAccountId ?? local.targetAccountId);
  const localNote = normalizeOptionalText(local.note) ?? normalizeOptionalText(local.notes);
  const localDeleted = local.deletedAt ?? (local.isDeleted ? local.updatedAt : null);
  const mappedDeleted = mapped.deletedAt ?? null;
  return (
    local.type === mapped.type &&
    (local.amountPaise ?? local.amountInPaise) === mapped.amountPaise &&
    (local.currency || 'INR') === (mapped.currency || 'INR') &&
    local.accountId === mapped.accountId &&
    localDest === normalizeOptionalText(mapped.destinationAccountId) &&
    normalizeOptionalText(local.categoryId) === normalizeOptionalText(mapped.categoryId) &&
    (local.title || local.description || '').trim() === mapped.title.trim() &&
    localNote === normalizeOptionalText(mapped.note) &&
    Date.parse(local.transactionDate || local.date || '') === Date.parse(mapped.transactionDate) &&
    ((localDeleted === null && mappedDeleted === null) ||
      (localDeleted !== null &&
        mappedDeleted !== null &&
        Date.parse(localDeleted) === Date.parse(mappedDeleted))) &&
    local.idempotencyKey === mapped.idempotencyKey &&
    (local.version ?? 1) === mapped.version
  );
}

/**
 * TransactionReconciliationService
 *
 * Reconciles paginated cloud transactions (including soft-delete tombstones) into the
 * authenticated user's isolated local Dexie database.
 *
 * Guarantees:
 * 1. Fetches all transaction pages without silent 1000-row truncation.
 * 2. Maps cloud category UUIDs to local category IDs via `ICategoryResolver.resolveLocalCategory`.
 * 3. Protects pending `syncOutbox` transaction mutations (by ID and idempotencyKey).
 * 4. Preserves local tombstones and higher optimistic versions cleanly.
 * 5. Never creates duplicate rows on repeated pulls or replays pulled rows to outbox.
 */
export class TransactionReconciliationService {
  constructor(
    private readonly database: LaxmiLensDB,
    private readonly cloudTransactionRepo: ISupabaseTransactionRepository,
    private readonly authPort: AuthPort,
    private readonly categoryResolver?: ICategoryResolver,
    private readonly pageSize: number = DEFAULT_CLOUD_PAGE_SIZE
  ) {}

  public async pullAndReconcile(userId?: string): Promise<TransactionReconciliationResult> {
    const currentUser = await this.authPort.getCurrentUser();
    if (!currentUser || !currentUser.id) {
      throw new SyncAuthError('Transaction reconciliation aborted: User is not authenticated.');
    }

    const authenticatedUserId = validateUserId(currentUser.id);
    if (userId && validateUserId(userId) !== authenticatedUserId) {
      throw new SyncAuthError(
        `Transaction reconciliation aborted: Requested user '${userId}' does not match authenticated user '${authenticatedUserId}'.`
      );
    }

    const { rows: cloudRows, pagesFetched } = await this.fetchAllCloudTransactions(
      authenticatedUserId
    );

    for (const row of cloudRows) {
      TransactionMapper.validateCloudRow(row);
      if (row.user_id !== authenticatedUserId) {
        throw new SyncAuthError(
          `Transaction reconciliation aborted: Cloud transaction '${row.id}' belongs to another user.`
        );
      }
    }

    // Pre-resolve remote category UUIDs -> local category IDs outside Dexie rw lock
    const resolvedLocalCatMap = new Map<string, string>();
    if (this.categoryResolver?.resolveLocalCategory) {
      const uniqueCloudCats = Array.from(
        new Set(
          cloudRows
            .map((r) => r.category_id)
            .filter((catId): catId is string => typeof catId === 'string' && catId.length > 0)
        )
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

    const tombstones = cloudRows.filter(
      (r) => r.deleted_at !== null && r.deleted_at !== undefined
    );
    const activeRows = cloudRows.filter(
      (r) => r.deleted_at === null || r.deleted_at === undefined
    );
    const orderedRows = [...tombstones, ...activeRows];

    const result: TransactionReconciliationResult = {
      pulledCount: 0,
      insertedCount: 0,
      updatedCount: 0,
      deletedCount: 0,
      pagesFetched,
      skippedPendingCount: 0,
      conflictCount: 0,
      conflicts: []
    };

    await this.database.transaction(
      'rw',
      [this.database.transactions, this.database.syncOutbox],
      async () => {
        const allOutbox = (await this.database.syncOutbox
          .where('userId')
          .equals(authenticatedUserId)
          .toArray()) as LocalOutboxRecord[];

        const pendingTxEntries = allOutbox.filter((e) => e.entity === 'transactions');
        const pendingTxIds = new Set<string>(pendingTxEntries.map((e) => e.entityId));
        const pendingIdempotencyKeys = new Set<string>();

        for (const pending of pendingTxEntries) {
          if (pending.idempotencyKey) {
            pendingIdempotencyKeys.add(pending.idempotencyKey.trim());
          }
          const rawKey =
            pending.payload?.idempotency_key ?? pending.payload?.idempotencyKey;
          if (typeof rawKey === 'string' && rawKey.trim().length > 0) {
            pendingIdempotencyKeys.add(rawKey.trim());
          }
        }

        const localRecords = (await this.database.transactions
          .where('userId')
          .equals(authenticatedUserId)
          .toArray()) as LocalTransactionRecord[];

        const localById = new Map<string, LocalTransactionRecord>();
        const localByIdempKey = new Map<string, LocalTransactionRecord>();
        for (const rec of localRecords) {
          localById.set(rec.id, rec);
          if (rec.idempotencyKey) {
            localByIdempKey.set(rec.idempotencyKey.trim(), rec);
          }
        }

        for (const pendingId of pendingTxIds) {
          const matchedLocal = localById.get(pendingId);
          if (matchedLocal?.idempotencyKey) {
            pendingIdempotencyKeys.add(matchedLocal.idempotencyKey.trim());
          }
        }

        for (const cloudRow of orderedRows) {
          const idempKey = cloudRow.idempotency_key.trim();
          if (pendingTxIds.has(cloudRow.id) || pendingIdempotencyKeys.has(idempKey)) {
            result.skippedPendingCount++;
            continue;
          }

          const keyOccupant = localByIdempKey.get(idempKey);
          if (keyOccupant && keyOccupant.id !== cloudRow.id) {
            result.conflictCount++;
            result.conflicts.push({
              transactionId: cloudRow.id,
              reason: `Idempotency key '${idempKey}' on cloud transaction '${cloudRow.id}' is already bound locally to '${keyOccupant.id}'. Local record preserved.`
            });
            continue;
          }

          const localCatId = cloudRow.category_id
            ? (resolvedLocalCatMap.get(cloudRow.category_id) ?? cloudRow.category_id)
            : null;
          const mappedRecord = TransactionMapper.toLocalRecord(cloudRow, localCatId);
          const localExisting = localById.get(cloudRow.id);
          const isCloudTombstone =
            cloudRow.deleted_at !== null && cloudRow.deleted_at !== undefined;

          if (!localExisting) {
            await this.database.transactions.put(mappedRecord);
            localById.set(mappedRecord.id, mappedRecord);
            localByIdempKey.set(idempKey, mappedRecord);
            if (isCloudTombstone) {
              result.deletedCount++;
            } else {
              result.insertedCount++;
            }
            result.pulledCount++;
            continue;
          }

          const isLocalDeleted =
            localExisting.deletedAt !== null || localExisting.isDeleted === true;
          const localVersion = localExisting.version ?? 1;

          if (isCloudTombstone) {
            if (localVersion > cloudRow.version) {
              result.conflictCount++;
              result.conflicts.push({
                transactionId: cloudRow.id,
                reason: `Remote tombstone for transaction '${cloudRow.id}' has older version (${cloudRow.version}) than local record (${localVersion}). Local record preserved.`
              });
              continue;
            }

            if (!isLocalDeleted || cloudRow.version > localVersion) {
              await this.database.transactions.put(mappedRecord);
              localById.set(mappedRecord.id, mappedRecord);
              localByIdempKey.set(idempKey, mappedRecord);
              result.deletedCount++;
              result.pulledCount++;
            } else if (!areTransactionRecordsEquivalent(localExisting, mappedRecord)) {
              result.conflictCount++;
              result.conflicts.push({
                transactionId: cloudRow.id,
                reason: `Conflict on tombstoned transaction '${cloudRow.id}' at version ${cloudRow.version}. Local record preserved.`
              });
            }
            continue;
          }

          // Active remote transaction: never resurrect a local tombstone
          if (isLocalDeleted) {
            result.conflictCount++;
            result.conflicts.push({
              transactionId: cloudRow.id,
              reason: `Local transaction '${cloudRow.id}' is soft-deleted; refusing active remote overwrite.`
            });
            continue;
          }

          // Protect immutable identity/monetary classification
          if (
            localExisting.type !== cloudRow.type ||
            (localExisting.currency || 'INR') !== (cloudRow.currency || 'INR') ||
            localExisting.idempotencyKey !== idempKey
          ) {
            result.conflictCount++;
            result.conflicts.push({
              transactionId: cloudRow.id,
              reason: `Cloud transaction '${cloudRow.id}' has immutable field divergence (type/currency/idempotencyKey). Local record preserved.`
            });
            continue;
          }

          if (cloudRow.version > localVersion) {
            await this.database.transactions.put(mappedRecord);
            localById.set(mappedRecord.id, mappedRecord);
            localByIdempKey.set(idempKey, mappedRecord);
            result.updatedCount++;
            result.pulledCount++;
          } else if (cloudRow.version === localVersion) {
            if (!areTransactionRecordsEquivalent(localExisting, mappedRecord)) {
              result.conflictCount++;
              result.conflicts.push({
                transactionId: cloudRow.id,
                reason: `Conflict on transaction '${cloudRow.id}' at version ${cloudRow.version}: cloud values differ from local record. Local record preserved.`
              });
            }
          } else {
            result.conflictCount++;
            result.conflicts.push({
              transactionId: cloudRow.id,
              reason: `Remote transaction '${cloudRow.id}' has older version (${cloudRow.version}) than local (${localVersion}). Local record preserved.`
            });
          }
        }
      }
    );

    return result;
  }

  private async fetchAllCloudTransactions(
    authenticatedUserId: string
  ): Promise<{ rows: CloudTransactionRow[]; pagesFetched: number }> {
    if (typeof this.cloudTransactionRepo.findPage === 'function') {
      const collected: CloudTransactionRow[] = [];
      const seenIds = new Set<string>();
      let offset = 0;
      let pagesFetched = 0;

      for (let pageIndex = 0; pageIndex < MAX_RECONCILE_PAGES; pageIndex++) {
        const page = await this.cloudTransactionRepo.findPage(authenticatedUserId, {
          offset,
          limit: this.pageSize,
          includeDeleted: true
        });
        pagesFetched++;

        for (const row of page.rows) {
          if (!seenIds.has(row.id)) {
            seenIds.add(row.id);
            collected.push(row);
          }
        }

        if (!page.hasMore || page.rows.length === 0 || page.nextOffset <= offset) {
          break;
        }
        offset = page.nextOffset;
      }

      return { rows: collected, pagesFetched };
    }

    if (typeof this.cloudTransactionRepo.findAll === 'function') {
      const rows = await this.cloudTransactionRepo.findAll(authenticatedUserId, {
        includeDeleted: true,
        pageSize: this.pageSize
      });
      return { rows, pagesFetched: rows.length > 0 ? 1 : 0 };
    }

    throw new Error(
      'SupabaseTransactionRepository is missing paginated read support (findPage/findAll).'
    );
  }
}

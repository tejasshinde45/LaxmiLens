import { AuthPort } from '@/application/ports/AuthPort';
import { validateUserId } from '@/domain/value-objects/Identifiers';
import { LaxmiLensDB } from '@/infrastructure/database/local/DexieDatabase';
import {
  LocalBorrowingRecord,
  LocalBorrowingRepaymentRecord,
  LocalLenderRecord,
  LocalOutboxRecord
} from '@/infrastructure/database/local/schema';
import {
  CloudLenderRow,
  LenderMapper
} from '@/infrastructure/database/cloud/mappers/LenderMapper';
import {
  BorrowingMapper,
  CloudBorrowingRow
} from '@/infrastructure/database/cloud/mappers/BorrowingMapper';
import {
  BorrowingRepaymentMapper,
  CloudBorrowingRepaymentRow
} from '@/infrastructure/database/cloud/mappers/BorrowingRepaymentMapper';
import { ISupabaseLenderRepository } from '@/infrastructure/database/cloud/repositories/SupabaseLenderRepository';
import { ISupabaseBorrowingRepository } from '@/infrastructure/database/cloud/repositories/SupabaseBorrowingRepository';
import { ISupabaseBorrowingRepaymentRepository } from '@/infrastructure/database/cloud/repositories/SupabaseBorrowingRepaymentRepository';
import { SyncAuthError } from './errors/SyncErrors';

export interface BorrowingsPullConflict {
  entity: 'lenders' | 'borrowings' | 'borrowing_repayments';
  entityId: string;
  reason: string;
}

export interface BorrowingsReconciliationResult {
  pulledCount: number;
  lenders: {
    pulledCount: number;
    insertedCount: number;
    updatedCount: number;
    skippedPendingCount: number;
    conflictCount: number;
  };
  borrowings: {
    pulledCount: number;
    insertedCount: number;
    updatedCount: number;
    skippedPendingCount: number;
    conflictCount: number;
  };
  repayments: {
    pulledCount: number;
    insertedCount: number;
    skippedPendingCount: number;
    conflictCount: number;
  };
  conflictCount: number;
  conflicts: BorrowingsPullConflict[];
}

function areLendersEquivalent(local: LocalLenderRecord, cloud: CloudLenderRow): boolean {
  return (
    local.name.trim() === cloud.name.trim() &&
    (local.phone ?? undefined) === (cloud.phone ?? undefined) &&
    (local.email ?? undefined) === (cloud.email ?? undefined) &&
    (local.notes ?? undefined) === (cloud.notes ?? undefined) &&
    Boolean(local.isArchived) === Boolean(cloud.is_archived)
  );
}

function normalizeOptionalIso(value?: string | null): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function areBorrowingsEquivalent(
  local: LocalBorrowingRecord,
  cloud: CloudBorrowingRow
): boolean {
  return (
    local.lenderId === cloud.lender_id.trim() &&
    local.amountPaise === cloud.amount_paise &&
    Date.parse(local.borrowingDate) === Date.parse(cloud.borrowing_date) &&
    normalizeOptionalIso(local.dueDate) === normalizeOptionalIso(cloud.due_date) &&
    local.receivingAccountId === cloud.receiving_account_id.trim() &&
    local.transactionId === cloud.transaction_id.trim() &&
    local.status === cloud.status &&
    (local.notes ?? undefined) === (cloud.notes ?? undefined)
  );
}

function areBorrowingContractsMatching(
  local: LocalBorrowingRecord,
  cloud: CloudBorrowingRow
): boolean {
  return (
    local.lenderId === cloud.lender_id.trim() &&
    local.amountPaise === cloud.amount_paise &&
    Date.parse(local.borrowingDate) === Date.parse(cloud.borrowing_date) &&
    local.receivingAccountId === cloud.receiving_account_id.trim() &&
    local.transactionId === cloud.transaction_id.trim()
  );
}

function areRepaymentsIdentical(
  local: LocalBorrowingRepaymentRecord,
  cloud: CloudBorrowingRepaymentRow
): boolean {
  return (
    local.borrowingId === cloud.borrowing_id.trim() &&
    local.lenderId === cloud.lender_id.trim() &&
    local.amountPaise === cloud.amount_paise &&
    Date.parse(local.repaymentDate) === Date.parse(cloud.repayment_date) &&
    local.paymentAccountId === cloud.payment_account_id.trim() &&
    local.transactionId === cloud.transaction_id.trim() &&
    (local.notes ?? undefined) === (cloud.notes ?? undefined)
  );
}

/**
 * BorrowingsReconciliationService
 *
 * Pulls and reconciles lenders, borrowings, and borrowing_repayments in strict relational order:
 * Lenders -> Borrowings -> Borrowing Repayments.
 *
 * Guarantees:
 * 1. Protects pending local outbox records for lenders, borrowings, repayments, and linked transactions.
 * 2. Preserves immutable borrowing contract terms and irreversible 'repaid' status.
 * 3. Treats borrowing repayments as strictly append-only & immutable (conflicts if existing row diverges).
 * 4. Rejects orphan repayments when parent borrowing is absent locally.
 */
export class BorrowingsReconciliationService {
  constructor(
    private readonly database: LaxmiLensDB,
    private readonly cloudLenderRepo: ISupabaseLenderRepository,
    private readonly cloudBorrowingRepo: ISupabaseBorrowingRepository,
    private readonly cloudRepaymentRepo: ISupabaseBorrowingRepaymentRepository,
    private readonly authPort: AuthPort
  ) {}

  public async pullAndReconcile(userId?: string): Promise<BorrowingsReconciliationResult> {
    const currentUser = await this.authPort.getCurrentUser();
    if (!currentUser || !currentUser.id) {
      throw new SyncAuthError('Borrowings reconciliation aborted: User is not authenticated.');
    }

    const authenticatedUserId = validateUserId(currentUser.id);
    if (userId && validateUserId(userId) !== authenticatedUserId) {
      throw new SyncAuthError(
        `Borrowings reconciliation aborted: Requested user '${userId}' does not match authenticated user.`
      );
    }

    const [cloudLenders, cloudBorrowings, cloudRepayments] = await Promise.all([
      this.cloudLenderRepo.findAll(authenticatedUserId),
      this.cloudBorrowingRepo.findAll(authenticatedUserId),
      this.cloudRepaymentRepo.findAll(authenticatedUserId)
    ]);

    for (const row of cloudLenders) {
      LenderMapper.validateCloudRow(row);
      if (row.user_id !== authenticatedUserId) {
        throw new SyncAuthError(`Cloud lender '${row.id}' belongs to another user.`);
      }
    }
    for (const row of cloudBorrowings) {
      BorrowingMapper.validateCloudRow(row);
      if (row.user_id !== authenticatedUserId) {
        throw new SyncAuthError(`Cloud borrowing '${row.id}' belongs to another user.`);
      }
    }
    for (const row of cloudRepayments) {
      BorrowingRepaymentMapper.validateCloudRow(row);
      if (row.user_id !== authenticatedUserId) {
        throw new SyncAuthError(`Cloud borrowing repayment '${row.id}' belongs to another user.`);
      }
    }

    const result: BorrowingsReconciliationResult = {
      pulledCount: 0,
      lenders: {
        pulledCount: 0,
        insertedCount: 0,
        updatedCount: 0,
        skippedPendingCount: 0,
        conflictCount: 0
      },
      borrowings: {
        pulledCount: 0,
        insertedCount: 0,
        updatedCount: 0,
        skippedPendingCount: 0,
        conflictCount: 0
      },
      repayments: {
        pulledCount: 0,
        insertedCount: 0,
        skippedPendingCount: 0,
        conflictCount: 0
      },
      conflictCount: 0,
      conflicts: []
    };

    await this.database.transaction(
      'rw',
      [
        this.database.lenders,
        this.database.borrowings,
        this.database.borrowingRepayments,
        this.database.syncOutbox
      ],
      async () => {
        const outbox = (await this.database.syncOutbox
          .where('userId')
          .equals(authenticatedUserId)
          .toArray()) as LocalOutboxRecord[];

        const pendingLenderIds = new Set<string>(
          outbox.filter((e) => e.entity === 'lenders').map((e) => e.entityId)
        );
        const pendingBorrowingEntries = outbox.filter((e) => e.entity === 'borrowings');
        const pendingBorrowingIds = new Set<string>(
          pendingBorrowingEntries.map((e) => e.entityId)
        );
        const pendingBorrowingTxIds = new Set<string>();
        for (const b of pendingBorrowingEntries) {
          const txId = b.payload?.transaction_id ?? b.payload?.transactionId;
          if (typeof txId === 'string' && txId.length > 0) {
            pendingBorrowingTxIds.add(txId);
          }
        }

        const pendingRepaymentEntries = outbox.filter(
          (e) => e.entity === 'borrowing_repayments'
        );
        const pendingRepaymentIds = new Set<string>(
          pendingRepaymentEntries.map((e) => e.entityId)
        );
        const pendingRepaymentTxIds = new Set<string>();
        const pendingRepaymentBorrowingIds = new Set<string>();
        for (const r of pendingRepaymentEntries) {
          const txId = r.payload?.transaction_id ?? r.payload?.transactionId;
          if (typeof txId === 'string' && txId.length > 0) {
            pendingRepaymentTxIds.add(txId);
          }
          const borId = r.payload?.borrowing_id ?? r.payload?.borrowingId;
          if (typeof borId === 'string' && borId.length > 0) {
            pendingRepaymentBorrowingIds.add(borId);
          }
        }

        const pendingTxIds = new Set<string>(
          outbox.filter((e) => e.entity === 'transactions').map((e) => e.entityId)
        );

        // -------------------------------------------------------------------
        // STAGE A: LENDERS
        // -------------------------------------------------------------------
        const localLenders = (await this.database.lenders
          .where('userId')
          .equals(authenticatedUserId)
          .toArray()) as LocalLenderRecord[];
        const localLenderById = new Map<string, LocalLenderRecord>(
          localLenders.map((l) => [l.id, l])
        );

        for (const cloudRow of cloudLenders) {
          if (pendingLenderIds.has(cloudRow.id)) {
            result.lenders.skippedPendingCount++;
            continue;
          }

          const localExisting = localLenderById.get(cloudRow.id);
          const mapped = LenderMapper.toLocalRecord(cloudRow);

          if (!localExisting) {
            await this.database.lenders.put(mapped);
            localLenderById.set(mapped.id, mapped);
            result.lenders.insertedCount++;
            result.lenders.pulledCount++;
            result.pulledCount++;
            continue;
          }

          if (areLendersEquivalent(localExisting, cloudRow)) {
            continue;
          }

          const cloudUpdatedMs = cloudRow.updated_at ? Date.parse(cloudRow.updated_at) : Number.NaN;
          const localUpdatedMs = Date.parse(localExisting.updatedAt);

          if (
            Number.isFinite(cloudUpdatedMs) &&
            Number.isFinite(localUpdatedMs) &&
            cloudUpdatedMs > localUpdatedMs
          ) {
            await this.database.lenders.put(mapped);
            localLenderById.set(mapped.id, mapped);
            result.lenders.updatedCount++;
            result.lenders.pulledCount++;
            result.pulledCount++;
          } else {
            result.lenders.conflictCount++;
            result.conflictCount++;
            result.conflicts.push({
              entity: 'lenders',
              entityId: cloudRow.id,
              reason: `Conflict on lender '${cloudRow.id}': local record has newer or equal timestamp and differing fields. Local record preserved.`
            });
          }
        }

        // -------------------------------------------------------------------
        // STAGE B: BORROWINGS (before Repayments)
        // -------------------------------------------------------------------
        const localBorrowings = (await this.database.borrowings
          .where('userId')
          .equals(authenticatedUserId)
          .toArray()) as LocalBorrowingRecord[];
        const localBorrowingById = new Map<string, LocalBorrowingRecord>();
        const localBorrowingByTxId = new Map<string, LocalBorrowingRecord>();
        for (const b of localBorrowings) {
          localBorrowingById.set(b.id, b);
          localBorrowingByTxId.set(b.transactionId, b);
        }

        for (const cloudRow of cloudBorrowings) {
          if (
            pendingBorrowingIds.has(cloudRow.id) ||
            pendingTxIds.has(cloudRow.transaction_id) ||
            pendingBorrowingTxIds.has(cloudRow.transaction_id) ||
            pendingRepaymentBorrowingIds.has(cloudRow.id)
          ) {
            result.borrowings.skippedPendingCount++;
            continue;
          }

          const txOccupant = localBorrowingByTxId.get(cloudRow.transaction_id.trim());
          if (txOccupant && txOccupant.id !== cloudRow.id) {
            result.borrowings.conflictCount++;
            result.conflictCount++;
            result.conflicts.push({
              entity: 'borrowings',
              entityId: cloudRow.id,
              reason: `Cloud borrowing '${cloudRow.id}' transaction_id '${cloudRow.transaction_id}' is already linked locally to '${txOccupant.id}'. Local record preserved.`
            });
            continue;
          }

          if (!localLenderById.has(cloudRow.lender_id.trim())) {
            result.borrowings.conflictCount++;
            result.conflictCount++;
            result.conflicts.push({
              entity: 'borrowings',
              entityId: cloudRow.id,
              reason: `Cannot pull borrowing '${cloudRow.id}': referenced lender '${cloudRow.lender_id}' does not exist locally.`
            });
            continue;
          }

          const localExisting = localBorrowingById.get(cloudRow.id);
          const mapped = BorrowingMapper.toLocalRecord(cloudRow);

          if (!localExisting) {
            await this.database.borrowings.put(mapped);
            localBorrowingById.set(mapped.id, mapped);
            localBorrowingByTxId.set(mapped.transactionId, mapped);
            result.borrowings.insertedCount++;
            result.borrowings.pulledCount++;
            result.pulledCount++;
            continue;
          }

          if (!areBorrowingContractsMatching(localExisting, cloudRow)) {
            result.borrowings.conflictCount++;
            result.conflictCount++;
            result.conflicts.push({
              entity: 'borrowings',
              entityId: cloudRow.id,
              reason: `Conflict on borrowing '${cloudRow.id}': immutable contract terms (lender/amount/date/accounts/transaction) differ from local record. Local record preserved.`
            });
            continue;
          }

          if (localExisting.status === 'repaid' && cloudRow.status === 'active') {
            result.borrowings.conflictCount++;
            result.conflictCount++;
            result.conflicts.push({
              entity: 'borrowings',
              entityId: cloudRow.id,
              reason: `Conflict on borrowing '${cloudRow.id}': refusing to downgrade irreversible local status 'repaid' to 'active'.`
            });
            continue;
          }

          if (areBorrowingsEquivalent(localExisting, cloudRow)) {
            continue;
          }

          const isSettlementProgression =
            localExisting.status === 'active' && cloudRow.status === 'repaid';
          const cloudUpdatedMs = cloudRow.updated_at ? Date.parse(cloudRow.updated_at) : Number.NaN;
          const localUpdatedMs = Date.parse(localExisting.updatedAt);

          if (
            isSettlementProgression ||
            (Number.isFinite(cloudUpdatedMs) &&
              Number.isFinite(localUpdatedMs) &&
              cloudUpdatedMs > localUpdatedMs)
          ) {
            await this.database.borrowings.put(mapped);
            localBorrowingById.set(mapped.id, mapped);
            localBorrowingByTxId.set(mapped.transactionId, mapped);
            result.borrowings.updatedCount++;
            result.borrowings.pulledCount++;
            result.pulledCount++;
          } else {
            result.borrowings.conflictCount++;
            result.conflictCount++;
            result.conflicts.push({
              entity: 'borrowings',
              entityId: cloudRow.id,
              reason: `Conflict on borrowing '${cloudRow.id}': mutable metadata differs while local record timestamp is newer or equal. Local record preserved.`
            });
          }
        }

        // -------------------------------------------------------------------
        // STAGE C: BORROWING REPAYMENTS (strictly append-only & immutable)
        // -------------------------------------------------------------------
        const localRepayments = (await this.database.borrowingRepayments
          .where('userId')
          .equals(authenticatedUserId)
          .toArray()) as LocalBorrowingRepaymentRecord[];
        const localRepaymentById = new Map<string, LocalBorrowingRepaymentRecord>();
        const localRepaymentByTxId = new Map<string, LocalBorrowingRepaymentRecord>();
        for (const rep of localRepayments) {
          localRepaymentById.set(rep.id, rep);
          localRepaymentByTxId.set(rep.transactionId, rep);
        }

        for (const cloudRow of cloudRepayments) {
          if (
            pendingRepaymentIds.has(cloudRow.id) ||
            pendingRepaymentTxIds.has(cloudRow.transaction_id) ||
            pendingTxIds.has(cloudRow.transaction_id)
          ) {
            result.repayments.skippedPendingCount++;
            continue;
          }

          const txOccupant = localRepaymentByTxId.get(cloudRow.transaction_id.trim());
          if (txOccupant && txOccupant.id !== cloudRow.id) {
            result.repayments.conflictCount++;
            result.conflictCount++;
            result.conflicts.push({
              entity: 'borrowing_repayments',
              entityId: cloudRow.id,
              reason: `Cloud repayment '${cloudRow.id}' transaction_id '${cloudRow.transaction_id}' is already linked locally to '${txOccupant.id}'. Local record preserved.`
            });
            continue;
          }

          const parentBorrowing = localBorrowingById.get(cloudRow.borrowing_id.trim());
          if (!parentBorrowing) {
            result.repayments.conflictCount++;
            result.conflictCount++;
            result.conflicts.push({
              entity: 'borrowing_repayments',
              entityId: cloudRow.id,
              reason: `Cannot pull repayment '${cloudRow.id}': parent borrowing '${cloudRow.borrowing_id}' does not exist locally.`
            });
            continue;
          }

          if (parentBorrowing.lenderId !== cloudRow.lender_id.trim()) {
            result.repayments.conflictCount++;
            result.conflictCount++;
            result.conflicts.push({
              entity: 'borrowing_repayments',
              entityId: cloudRow.id,
              reason: `Cloud repayment '${cloudRow.id}' lender '${cloudRow.lender_id}' does not match parent borrowing lender '${parentBorrowing.lenderId}'.`
            });
            continue;
          }

          const localExisting = localRepaymentById.get(cloudRow.id);
          if (!localExisting) {
            const mapped = BorrowingRepaymentMapper.toLocalRecord(cloudRow);
            await this.database.borrowingRepayments.put(mapped);
            localRepaymentById.set(mapped.id, mapped);
            localRepaymentByTxId.set(mapped.transactionId, mapped);
            result.repayments.insertedCount++;
            result.repayments.pulledCount++;
            result.pulledCount++;
            continue;
          }

          // Existing repayment MUST be immutable
          if (!areRepaymentsIdentical(localExisting, cloudRow)) {
            result.repayments.conflictCount++;
            result.conflictCount++;
            result.conflicts.push({
              entity: 'borrowing_repayments',
              entityId: cloudRow.id,
              reason: `Conflict on immutable repayment '${cloudRow.id}': cloud record differs from existing local repayment. Local ledger history preserved.`
            });
          }
        }
      }
    );

    return result;
  }
}

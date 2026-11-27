import { AuthPort } from '@/application/ports/AuthPort';
import { validateUserId } from '@/domain/value-objects/Identifiers';
import { LaxmiLensDB } from '@/infrastructure/database/local/DexieDatabase';
import {
  LocalAccountRecord,
  LocalBorrowingRecord,
  LocalBorrowingRepaymentRecord,
  LocalOutboxRecord,
  LocalRecurringRuleRecord,
  LocalTransactionRecord
} from '@/infrastructure/database/local/schema';
import {
  AccountMapper,
  CloudAccountRow
} from '@/infrastructure/database/cloud/mappers/AccountMapper';
import { ISupabaseAccountRepository } from '@/infrastructure/database/cloud/repositories/SupabaseAccountRepository';
import { SyncAuthError } from './errors/SyncErrors';

export interface AccountPullConflict {
  accountId: string;
  reason: string;
}

export interface AccountReconciliationResult {
  pulledCount: number;
  insertedCount: number;
  updatedCount: number;
  remappedFromAccountId: string | null;
  canonicalBorrowingsAccountId: string | null;
  remappedReferencesCount: number;
  blockedAccountIds: string[];
  skippedPendingCount: number;
  conflictCount: number;
  conflicts: AccountPullConflict[];
}

const ACCOUNT_REFERENCE_PAYLOAD_FIELDS = [
  'account_id',
  'accountId',
  'destination_account_id',
  'destinationAccountId',
  'target_account_id',
  'targetAccountId'
] as const;

const DISALLOWED_PB_REFERENCE_PAYLOAD_FIELDS = [
  'receiving_account_id',
  'receivingAccountId',
  'payment_account_id',
  'paymentAccountId'
] as const;

function areAccountRecordsEquivalent(
  local: LocalAccountRecord,
  cloud: CloudAccountRow
): boolean {
  const localType = local.accountType || local.type;
  const localOpening = local.openingBalancePaise ?? local.openingBalanceInPaise ?? 0;
  const localArchived = local.isArchived ?? local.status === 'archived';
  return (
    local.name.trim() === cloud.name.trim() &&
    localType === cloud.account_type &&
    localOpening === cloud.opening_balance_paise &&
    (local.currency || 'INR') === (cloud.currency || 'INR') &&
    (local.institutionName ?? undefined) === (cloud.institution_name ?? undefined) &&
    (local.color ?? undefined) === (cloud.color ?? undefined) &&
    (local.icon ?? undefined) === (cloud.icon ?? undefined) &&
    (local.notes ?? undefined) === (cloud.notes ?? undefined) &&
    (local.systemTag ?? null) === (cloud.system_tag ?? null) &&
    Boolean(localArchived) === Boolean(cloud.is_archived)
  );
}

/**
 * AccountReconciliationService
 *
 * Handles canonical Personal Borrowings identity adoption/remapping across devices
 * and cloud-to-local reconciliation for accounts.
 *
 * Guarantees:
 * 1. Cloud `personal_borrowings` account is treated as the single canonical UUID.
 * 2. When a local `personal_borrowings` account has a different UUID and safe remapping
 *    conditions hold, atomically remaps the account, dependent local transactions/rules,
 *    and pending outbox payloads while preserving IDs and idempotency keys.
 * 3. Stops and reports explicit conflicts (never mutating financial data) whenever safe
 *    remapping cannot be guaranteed (e.g., edited account, non-v1/non-pending transactions,
 *    currency mismatch, multiple local system accounts, or UUID collisions).
 * 4. Protects all accounts with pending `syncOutbox` mutations from remote overwrites.
 */
export class AccountReconciliationService {
  constructor(
    private readonly database: LaxmiLensDB,
    private readonly cloudAccountRepo: ISupabaseAccountRepository,
    private readonly authPort: AuthPort
  ) {}

  /**
   * Reconciles canonical Personal Borrowings system account identity before outbox pushes run.
   */
  public async reconcilePersonalBorrowingsIdentity(
    userId?: string
  ): Promise<AccountReconciliationResult> {
    return this.reconcileInternal(userId, { applyPullWrites: false });
  }

  /**
   * Reconciles Personal Borrowings identity and pulls all cloud accounts into local Dexie.
   */
  public async pullAndReconcile(userId?: string): Promise<AccountReconciliationResult> {
    return this.reconcileInternal(userId, { applyPullWrites: true });
  }

  private async reconcileInternal(
    userId: string | undefined,
    options: { applyPullWrites: boolean }
  ): Promise<AccountReconciliationResult> {
    const currentUser = await this.authPort.getCurrentUser();
    if (!currentUser || !currentUser.id) {
      throw new SyncAuthError('Account reconciliation aborted: User is not authenticated.');
    }

    const authenticatedUserId = validateUserId(currentUser.id);
    if (userId && validateUserId(userId) !== authenticatedUserId) {
      throw new SyncAuthError(
        `Account reconciliation aborted: Requested user '${userId}' does not match authenticated user '${authenticatedUserId}'.`
      );
    }

    const cloudRows = await this.cloudAccountRepo.findAll(authenticatedUserId);
    for (const row of cloudRows) {
      AccountMapper.validateCloudRow(row);
      if (row.user_id !== authenticatedUserId) {
        throw new SyncAuthError(
          `Account reconciliation aborted: Cloud account '${row.id}' belongs to another user.`
        );
      }
    }

    const result: AccountReconciliationResult = {
      pulledCount: 0,
      insertedCount: 0,
      updatedCount: 0,
      remappedFromAccountId: null,
      canonicalBorrowingsAccountId: null,
      remappedReferencesCount: 0,
      blockedAccountIds: [],
      skippedPendingCount: 0,
      conflictCount: 0,
      conflicts: []
    };

    const blockedSet = new Set<string>();

    await this.database.transaction(
      'rw',
      [
        this.database.accounts,
        this.database.transactions,
        this.database.borrowings,
        this.database.borrowingRepayments,
        this.database.recurringRules,
        this.database.syncOutbox
      ],
      async () => {
        const allOutbox = (await this.database.syncOutbox
          .where('userId')
          .equals(authenticatedUserId)
          .toArray()) as LocalOutboxRecord[];

        let localAccounts = (await this.database.accounts
          .where('userId')
          .equals(authenticatedUserId)
          .toArray()) as LocalAccountRecord[];

        // -------------------------------------------------------------------
        // PHASE 1: Personal Borrowings Canonical Identity Reconciliation
        // -------------------------------------------------------------------
        const cloudPBAccounts = cloudRows.filter(
          (row) => row.system_tag === 'personal_borrowings'
        );

        if (cloudPBAccounts.length > 1) {
          result.conflictCount++;
          result.conflicts.push({
            accountId: cloudPBAccounts[0].id,
            reason: `Cloud state contains ${cloudPBAccounts.length} accounts tagged 'personal_borrowings'; refusing ambiguous identity adoption.`
          });
          for (const c of cloudPBAccounts) blockedSet.add(c.id);
          for (const l of localAccounts.filter((a) => a.systemTag === 'personal_borrowings')) {
            blockedSet.add(l.id);
          }
        } else if (cloudPBAccounts.length === 1) {
          const cloudPB = cloudPBAccounts[0];
          result.canonicalBorrowingsAccountId = cloudPB.id;

          if (cloudPB.account_type !== 'other' || cloudPB.opening_balance_paise !== 0) {
            result.conflictCount++;
            result.conflicts.push({
              accountId: cloudPB.id,
              reason: `Cloud Personal Borrowings account '${cloudPB.id}' violates system account invariants (type=${cloudPB.account_type}, openingBalance=${cloudPB.opening_balance_paise}).`
            });
            blockedSet.add(cloudPB.id);
            for (const l of localAccounts.filter((a) => a.systemTag === 'personal_borrowings')) {
              blockedSet.add(l.id);
            }
          } else {
            const localPBAccounts = localAccounts.filter(
              (a) => a.systemTag === 'personal_borrowings'
            );
            const canonicalOccupant = localAccounts.find((a) => a.id === cloudPB.id);

            if (localPBAccounts.length > 1) {
              result.conflictCount++;
              result.conflicts.push({
                accountId: localPBAccounts[0].id,
                reason: `Local database contains ${localPBAccounts.length} 'personal_borrowings' accounts; manual resolution required before remapping to canonical '${cloudPB.id}'.`
              });
              for (const l of localPBAccounts) blockedSet.add(l.id);
              blockedSet.add(cloudPB.id);
            } else if (localPBAccounts.length === 0) {
              if (canonicalOccupant) {
                result.conflictCount++;
                result.conflicts.push({
                  accountId: cloudPB.id,
                  reason: `Canonical cloud 'personal_borrowings' ID '${cloudPB.id}' collides with existing non-system local account '${canonicalOccupant.name}'. Local account preserved.`
                });
                blockedSet.add(cloudPB.id);
              } else {
                const canonicalLocal = AccountMapper.toLocalRecord(cloudPB);
                await this.database.accounts.put(canonicalLocal);
                localAccounts.push(canonicalLocal);
                result.insertedCount++;
                result.pulledCount++;
              }
            } else {
              const localPB = localPBAccounts[0];
              if (localPB.id !== cloudPB.id) {
                const unsafeReasons: string[] = [];

                if (canonicalOccupant && canonicalOccupant.id !== localPB.id) {
                  unsafeReasons.push(
                    `Canonical ID '${cloudPB.id}' already belongs locally to '${canonicalOccupant.name}'.`
                  );
                }

                const localOpening =
                  localPB.openingBalancePaise ?? localPB.openingBalanceInPaise ?? 0;
                const localType = localPB.accountType || localPB.type;
                const localArchived = Boolean(localPB.isArchived ?? localPB.status === 'archived');
                const localPBOutbox = allOutbox.filter(
                  (e) => e.entity === 'accounts' && e.entityId === localPB.id
                );

                if (
                  localPB.version > 1 ||
                  localPBOutbox.some((e) => e.operation !== 'INSERT')
                ) {
                  unsafeReasons.push(
                    `Local Personal Borrowings account '${localPB.id}' has local edits (version=${localPB.version}).`
                  );
                }

                if (
                  localType !== 'other' ||
                  localOpening !== 0 ||
                  (localPB.currency || 'INR') !== (cloudPB.currency || 'INR') ||
                  localArchived !== Boolean(cloudPB.is_archived)
                ) {
                  unsafeReasons.push(
                    `Local Personal Borrowings account '${localPB.id}' attributes diverge from canonical cloud account '${cloudPB.id}' (currency=${localPB.currency} vs ${cloudPB.currency}, openingBalance=${localOpening}, archived=${localArchived}).`
                  );
                }

                const pendingTxInsertIds = new Set(
                  allOutbox
                    .filter((e) => e.entity === 'transactions' && e.operation === 'INSERT')
                    .map((e) => e.entityId)
                );
                const pendingRuleInsertIds = new Set(
                  allOutbox
                    .filter((e) => e.entity === 'recurring_rules' && e.operation === 'INSERT')
                    .map((e) => e.entityId)
                );

                const localTxs = (await this.database.transactions
                  .where('userId')
                  .equals(authenticatedUserId)
                  .toArray()) as LocalTransactionRecord[];

                const affectedTxs = localTxs.filter(
                  (t) =>
                    t.accountId === localPB.id ||
                    t.destinationAccountId === localPB.id ||
                    t.targetAccountId === localPB.id
                );

                for (const tx of affectedTxs) {
                  if (tx.deletedAt !== null || tx.isDeleted === true) {
                    unsafeReasons.push(
                      `Deleted transaction '${tx.id}' references local Personal Borrowings ID '${localPB.id}'.`
                    );
                    continue;
                  }
                  if ((tx.version ?? 1) > 1 || !pendingTxInsertIds.has(tx.id)) {
                    unsafeReasons.push(
                      `Transaction '${tx.id}' referencing '${localPB.id}' is not an unpushed v1 INSERT (version=${tx.version}).`
                    );
                  }
                  if ((tx.currency || 'INR') !== (cloudPB.currency || 'INR')) {
                    unsafeReasons.push(
                      `Transaction '${tx.id}' currency '${tx.currency}' mismatches canonical account currency '${cloudPB.currency}'.`
                    );
                  }
                }

                const localBorrowings = (await this.database.borrowings
                  .where('userId')
                  .equals(authenticatedUserId)
                  .toArray()) as LocalBorrowingRecord[];
                if (localBorrowings.some((b) => b.receivingAccountId === localPB.id)) {
                  unsafeReasons.push(
                    `Borrowing record uses liability account '${localPB.id}' as receivingAccountId.`
                  );
                }

                const localRepayments = (await this.database.borrowingRepayments
                  .where('userId')
                  .equals(authenticatedUserId)
                  .toArray()) as LocalBorrowingRepaymentRecord[];
                if (localRepayments.some((r) => r.paymentAccountId === localPB.id)) {
                  unsafeReasons.push(
                    `Repayment record uses liability account '${localPB.id}' as paymentAccountId.`
                  );
                }

                const localRules = (await this.database.recurringRules
                  .where('userId')
                  .equals(authenticatedUserId)
                  .toArray()) as LocalRecurringRuleRecord[];
                const affectedRules = localRules.filter(
                  (r) => r.accountId === localPB.id || r.targetAccountId === localPB.id
                );
                for (const rule of affectedRules) {
                  if ((rule.version ?? 1) > 1 || !pendingRuleInsertIds.has(rule.id)) {
                    unsafeReasons.push(
                      `Recurring rule '${rule.id}' referencing '${localPB.id}' is not an unpushed v1 INSERT.`
                    );
                  }
                }

                for (const outboxEntry of allOutbox) {
                  const p = outboxEntry.payload || {};
                  for (const disallowedField of DISALLOWED_PB_REFERENCE_PAYLOAD_FIELDS) {
                    if (p[disallowedField] === localPB.id) {
                      unsafeReasons.push(
                        `Pending outbox '${outboxEntry.entity}' (${outboxEntry.entityId}) references '${localPB.id}' in '${disallowedField}'.`
                      );
                    }
                  }
                  if (
                    outboxEntry.entity === 'transactions' &&
                    outboxEntry.operation !== 'INSERT' &&
                    !pendingTxInsertIds.has(outboxEntry.entityId) &&
                    ACCOUNT_REFERENCE_PAYLOAD_FIELDS.some((f) => p[f] === localPB.id)
                  ) {
                    unsafeReasons.push(
                      `Pending transaction ${outboxEntry.operation} (${outboxEntry.entityId}) references '${localPB.id}' without a pending INSERT.`
                    );
                  }
                }

                if (unsafeReasons.length > 0) {
                  result.conflictCount++;
                  result.conflicts.push({
                    accountId: localPB.id,
                    reason: `Cannot safely remap local Personal Borrowings '${localPB.id}' to canonical '${cloudPB.id}': ${unsafeReasons.join(' ')}`
                  });
                  blockedSet.add(localPB.id);
                  blockedSet.add(cloudPB.id);
                } else {
                  // Safe atomic remapping across local tables & pending outbox payloads
                  const oldId = localPB.id;
                  const canonicalId = cloudPB.id;

                  await this.database.accounts.delete(oldId);
                  const canonicalRecord = AccountMapper.toLocalRecord(cloudPB);
                  await this.database.accounts.put(canonicalRecord);
                  localAccounts = localAccounts
                    .filter((a) => a.id !== oldId)
                    .concat(canonicalRecord);

                  let remappedCount = 0;

                  for (const tx of affectedTxs) {
                    const updatedTx: LocalTransactionRecord = {
                      ...tx,
                      accountId: tx.accountId === oldId ? canonicalId : tx.accountId,
                      destinationAccountId:
                        tx.destinationAccountId === oldId ? canonicalId : tx.destinationAccountId,
                      targetAccountId:
                        tx.targetAccountId === oldId ? canonicalId : tx.targetAccountId
                    };
                    await this.database.transactions.put(updatedTx);
                    remappedCount++;
                  }

                  for (const rule of affectedRules) {
                    const updatedRule: LocalRecurringRuleRecord = {
                      ...rule,
                      accountId: rule.accountId === oldId ? canonicalId : rule.accountId,
                      targetAccountId:
                        rule.targetAccountId === oldId ? canonicalId : rule.targetAccountId
                    };
                    await this.database.recurringRules.put(updatedRule);
                    remappedCount++;
                  }

                  for (let i = 0; i < allOutbox.length; i++) {
                    const outboxEntry = allOutbox[i];
                    if (outboxEntry.id === undefined) continue;

                    if (
                      outboxEntry.entity === 'accounts' &&
                      outboxEntry.entityId === oldId &&
                      outboxEntry.operation === 'INSERT'
                    ) {
                      const updatedPayload: Record<string, unknown> = {
                        ...outboxEntry.payload,
                        id: canonicalId,
                        name: cloudPB.name,
                        account_type: cloudPB.account_type,
                        opening_balance_paise: cloudPB.opening_balance_paise,
                        currency: cloudPB.currency,
                        color: cloudPB.color,
                        icon: cloudPB.icon,
                        notes: cloudPB.notes,
                        system_tag: 'personal_borrowings',
                        is_archived: cloudPB.is_archived,
                        version: cloudPB.version
                      };
                      await this.database.syncOutbox.update(outboxEntry.id, {
                        entityId: canonicalId,
                        payload: updatedPayload
                      });
                      allOutbox[i] = {
                        ...outboxEntry,
                        entityId: canonicalId,
                        payload: updatedPayload
                      };
                      remappedCount++;
                      continue;
                    }

                    const payload = outboxEntry.payload || {};
                    let touched = false;
                    const updatedPayload: Record<string, unknown> = { ...payload };
                    for (const field of ACCOUNT_REFERENCE_PAYLOAD_FIELDS) {
                      if (updatedPayload[field] === oldId) {
                        updatedPayload[field] = canonicalId;
                        touched = true;
                      }
                    }

                    if (touched) {
                      await this.database.syncOutbox.update(outboxEntry.id, {
                        payload: updatedPayload
                      });
                      allOutbox[i] = {
                        ...outboxEntry,
                        payload: updatedPayload
                      };
                      remappedCount++;
                    }
                  }

                  result.remappedFromAccountId = oldId;
                  result.remappedReferencesCount = remappedCount;
                  result.insertedCount++;
                  result.pulledCount++;
                }
              }
            }
          }
        }

        if (!options.applyPullWrites) {
          result.blockedAccountIds = Array.from(blockedSet);
          return;
        }

        // -------------------------------------------------------------------
        // PHASE 2: General Account Cloud-to-Local Reconciliation
        // -------------------------------------------------------------------
        const pendingAccountIds = new Set<string>(
          allOutbox.filter((e) => e.entity === 'accounts').map((e) => e.entityId)
        );
        const localById = new Map<string, LocalAccountRecord>(
          localAccounts.map((a) => [a.id, a])
        );
        const existingPBAccount = localAccounts.find(
          (a) => a.systemTag === 'personal_borrowings'
        );

        for (const cloudRow of cloudRows) {
          if (blockedSet.has(cloudRow.id)) {
            continue;
          }

          if (pendingAccountIds.has(cloudRow.id)) {
            result.skippedPendingCount++;
            continue;
          }

          // Never insert a second Personal Borrowings account locally
          if (
            cloudRow.system_tag === 'personal_borrowings' &&
            existingPBAccount &&
            existingPBAccount.id !== cloudRow.id
          ) {
            result.conflictCount++;
            result.conflicts.push({
              accountId: cloudRow.id,
              reason: `Cloud 'personal_borrowings' account '${cloudRow.id}' conflicts with local system account '${existingPBAccount.id}'. Local account preserved.`
            });
            continue;
          }

          const localExisting = localById.get(cloudRow.id);
          const mappedRecord = AccountMapper.toLocalRecord(cloudRow);

          if (!localExisting) {
            await this.database.accounts.put(mappedRecord);
            localById.set(mappedRecord.id, mappedRecord);
            result.insertedCount++;
            result.pulledCount++;
            continue;
          }

          // Protect immutable system_tag / currency invariants
          if (
            (localExisting.systemTag ?? null) !== (cloudRow.system_tag ?? null) ||
            (localExisting.currency || 'INR') !== (cloudRow.currency || 'INR')
          ) {
            result.conflictCount++;
            result.conflicts.push({
              accountId: cloudRow.id,
              reason: `Cloud account '${cloudRow.id}' has immutable identity/currency mismatch against local record. Local record preserved.`
            });
            continue;
          }

          const localVersion = localExisting.version ?? 1;
          if (cloudRow.version > localVersion) {
            await this.database.accounts.put(mappedRecord);
            localById.set(mappedRecord.id, mappedRecord);
            result.updatedCount++;
            result.pulledCount++;
          } else if (cloudRow.version === localVersion) {
            if (!areAccountRecordsEquivalent(localExisting, cloudRow)) {
              result.conflictCount++;
              result.conflicts.push({
                accountId: cloudRow.id,
                reason: `Conflict on account '${cloudRow.id}' at version ${cloudRow.version}: cloud fields differ from local record. Local record preserved.`
              });
            }
          } else {
            result.conflictCount++;
            result.conflicts.push({
              accountId: cloudRow.id,
              reason: `Remote account '${cloudRow.id}' has older version (${cloudRow.version}) than local (${localVersion}). Local record preserved.`
            });
          }
        }

        result.blockedAccountIds = Array.from(blockedSet);
      }
    );

    return result;
  }
}

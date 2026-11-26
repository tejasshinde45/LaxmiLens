import {
  BackupArchiveDocument,
  SafetyBackupReceipt
} from '@/application/dto/BackupDTO';
import { CapturedLocalSnapshot } from '@/application/ports/BackupStoragePort';
import { computeCanonicalSha256Hex } from '@/application/services/BackupEncryptionService';
import { SafetyBackupRequiredError } from '@/domain/errors/BackupErrors';

export const SAFETY_BACKUP_RECEIPT_TTL_MS = 15 * 60 * 1000;

interface StoredSafetyReceiptRecord {
  readonly receiptId: string;
  readonly userId: string;
  readonly databaseIdentity: string;
  readonly stateDigestSha256Hex: string;
  readonly expiresAtMs: number;
}

/**
 * Computes a deterministic canonical SHA-256 fingerprint of the current user's local
 * database snapshot across restorable financial/metadata stores, quarantined exclusions,
 * and pending outbox state.
 */
export async function computeLocalDatabaseStateDigest(
  snapshot: CapturedLocalSnapshot,
  archive: BackupArchiveDocument
): Promise<string> {
  const outboxStateSummary = (snapshot.rawStoreData.pendingOutbox ?? []).map((entry) => ({
    entity: entry.entity,
    entityId: entry.entityId,
    operation: entry.operation,
    idempotencyKey: entry.idempotencyKey,
    attempts: entry.attempts
  }));

  return await computeCanonicalSha256Hex({
    dexieSchemaVersion: snapshot.dexieSchemaVersion,
    payloadSha256Hex: archive.manifest.integrity.payloadSha256Hex,
    excludedQuarantinedCounts: archive.manifest.excludedQuarantinedCounts,
    outboxStateSummary
  });
}

/**
 * Ephemeral in-memory registry for short-lived, single-use safety-backup receipts.
 * Receipts are never persisted to storage and never contain passphrases or keys.
 */
export class SafetyBackupReceiptRegistry {
  private readonly activeReceipts = new Map<string, StoredSafetyReceiptRecord>();

  constructor(private readonly ttlMs: number = SAFETY_BACKUP_RECEIPT_TTL_MS) {}

  public issueReceipt(params: {
    userId: string;
    databaseIdentity: string;
    stateDigestSha256Hex: string;
    nowMs?: number;
  }): SafetyBackupReceipt {
    const nowMs = params.nowMs ?? Date.now();
    const expiresAtMs = nowMs + this.ttlMs;
    const receiptId = globalThis.crypto.randomUUID();

    const record: StoredSafetyReceiptRecord = {
      receiptId,
      userId: params.userId,
      databaseIdentity: params.databaseIdentity,
      stateDigestSha256Hex: params.stateDigestSha256Hex,
      expiresAtMs
    };

    this.activeReceipts.set(receiptId, record);

    return Object.freeze({
      receiptId,
      userId: params.userId,
      databaseIdentity: params.databaseIdentity,
      stateDigestSha256Hex: params.stateDigestSha256Hex,
      issuedAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString()
    });
  }

  public validateAndConsumeReceipt(
    receipt: unknown,
    context: {
      userId: string;
      databaseIdentity: string;
      currentStateDigestSha256Hex: string;
      nowMs?: number;
    }
  ): void {
    if (
      !receipt ||
      typeof receipt !== 'object' ||
      typeof (receipt as SafetyBackupReceipt).receiptId !== 'string'
    ) {
      throw new SafetyBackupRequiredError();
    }

    const candidate = receipt as SafetyBackupReceipt;
    const stored = this.activeReceipts.get(candidate.receiptId);
    if (!stored) {
      throw new SafetyBackupRequiredError(
        'Safety backup receipt is missing, invalid, or has already been consumed.'
      );
    }

    const nowMs = context.nowMs ?? Date.now();
    if (nowMs > stored.expiresAtMs) {
      this.activeReceipts.delete(stored.receiptId);
      throw new SafetyBackupRequiredError(
        'Safety backup receipt has expired. Download a fresh safety backup before replacing.'
      );
    }

    if (
      stored.userId !== context.userId ||
      candidate.userId !== stored.userId
    ) {
      throw new SafetyBackupRequiredError(
        'Safety backup receipt is bound to a different user account.'
      );
    }

    if (
      stored.databaseIdentity !== context.databaseIdentity ||
      candidate.databaseIdentity !== stored.databaseIdentity
    ) {
      this.activeReceipts.delete(stored.receiptId);
      throw new SafetyBackupRequiredError(
        'Safety backup receipt is bound to a different database session and is no longer valid.'
      );
    }

    if (
      stored.stateDigestSha256Hex !== context.currentStateDigestSha256Hex ||
      candidate.stateDigestSha256Hex !== stored.stateDigestSha256Hex
    ) {
      this.activeReceipts.delete(stored.receiptId);
      throw new SafetyBackupRequiredError(
        'Local database state has changed since the safety backup was generated. Create a new safety backup before replacing.'
      );
    }

    // Consume unconditionally so a verified receipt can never be reused.
    this.activeReceipts.delete(stored.receiptId);
  }

  public invalidateForUser(userId: string): void {
    for (const [receiptId, record] of this.activeReceipts.entries()) {
      if (record.userId === userId) {
        this.activeReceipts.delete(receiptId);
      }
    }
  }

  public clear(): void {
    this.activeReceipts.clear();
  }

  public countActive(): number {
    return this.activeReceipts.size;
  }
}

export const defaultSafetyBackupReceiptRegistry = new SafetyBackupReceiptRegistry();

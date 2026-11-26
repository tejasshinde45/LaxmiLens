import {
  BACKUP_REPLACE_CONFIRMATION_TEXT,
  ExecuteBackupRestoreInputDTO,
  ExecuteBackupRestoreResultDTO
} from '@/application/dto/BackupDTO';
import { AuthPort } from '@/application/ports/AuthPort';
import {
  BackupCacheInvalidator,
  BackupStoragePort,
  BackupSyncActivityGuard
} from '@/application/ports/BackupStoragePort';
import { BackupValidationService } from '@/application/services/BackupValidationService';
import {
  SafetyBackupReceiptRegistry,
  computeLocalDatabaseStateDigest,
  defaultSafetyBackupReceiptRegistry
} from '@/application/services/SafetyBackupReceiptService';
import {
  BackupValidationError,
  SafetyBackupRequiredError
} from '@/domain/errors/BackupErrors';
import {
  resolveVerifiedBackupActor,
  runWithExclusiveBackupLock
} from './backupUseCaseHelpers';

/**
 * Coordinates with the shared sync/backup exclusive lock across live-state verification,
 * single-use safety-backup receipt validation/consumption, atomic 14-store Dexie write,
 * and React Query cache invalidation without triggering automatic cloud synchronization.
 */
export class ExecuteBackupRestoreUseCase {
  constructor(
    private readonly authPort: AuthPort,
    private readonly backupStorage: BackupStoragePort,
    private readonly syncGuard?: BackupSyncActivityGuard,
    private readonly validationService: BackupValidationService = new BackupValidationService(),
    private readonly cacheInvalidator?: BackupCacheInvalidator,
    private readonly scopedUserId?: string,
    private readonly receiptRegistry: SafetyBackupReceiptRegistry = defaultSafetyBackupReceiptRegistry
  ) {}

  public async execute(
    input: ExecuteBackupRestoreInputDTO
  ): Promise<ExecuteBackupRestoreResultDTO> {
    return runWithExclusiveBackupLock(this.syncGuard, 'restore', async () => {
      const actor = await resolveVerifiedBackupActor(this.authPort, this.scopedUserId);

      if (input.mode !== 'empty' && input.mode !== 'replace') {
        throw new BackupValidationError(
          `Unsupported restore mode '${String(input.mode)}'. Supported modes are 'empty' and 'replace'.`
        );
      }

      if (input.mode === 'replace') {
        if (input.confirmationText?.trim() !== BACKUP_REPLACE_CONFIRMATION_TEXT) {
          throw new BackupValidationError(
            `Replace restore requires typing '${BACKUP_REPLACE_CONFIRMATION_TEXT}' to confirm overwriting existing local data.`
          );
        }

        if (!input.safetyBackupReceipt) {
          throw new SafetyBackupRequiredError(
            'A genuine verifiable safety backup receipt is required before replacing local data.'
          );
        }

        const liveSnapshot = await this.backupStorage.captureUserSnapshot(actor.userId);
        const liveStateArchive = await this.validationService.buildSanitizedArchive({
          userId: actor.userId,
          ...(actor.email ? { email: actor.email } : {}),
          dexieSchemaVersion: liveSnapshot.dexieSchemaVersion,
          rawStoreData: liveSnapshot.rawStoreData,
          preExcludedQuarantinedCounts: liveSnapshot.preExcludedQuarantinedCounts
        });
        const currentStateDigestSha256Hex = await computeLocalDatabaseStateDigest(
          liveSnapshot,
          liveStateArchive
        );

        this.receiptRegistry.validateAndConsumeReceipt(input.safetyBackupReceipt, {
          userId: actor.userId,
          databaseIdentity: this.backupStorage.getDatabaseIdentity(),
          currentStateDigestSha256Hex
        });
      }

      const restorePendingOutbox = input.restorePendingOutbox ?? true;
      const currentDexieSchemaVersion = this.backupStorage.getDexieSchemaVersion();
      const targetSummary = await this.backupStorage.getTargetRestoreSummary(actor.userId);

      const preview = await this.validationService.validateForRestore(input.archive, {
        authenticatedUserId: actor.userId,
        currentDexieSchemaVersion,
        mode: input.mode,
        restorePendingOutbox,
        confirmationText: input.confirmationText,
        safetyBackupConfirmed: input.mode === 'replace',
        targetSummary: {
          ...targetSummary,
          currentDexieSchemaVersion
        }
      });

      const unusedSeededDefaultCategoryIdsToDelete =
        input.mode === 'empty' &&
        preview.categoryIdentityContract.targetDefaultReconciliationAction ===
          'replace_unused_seeded_defaults'
          ? [...preview.categoryIdentityContract.unresolvedSeededDefaultCategoryIds]
          : [];

      if (unusedSeededDefaultCategoryIdsToDelete.length > 0) {
        const referencedSet = new Set(targetSummary.referencedCategoryIds ?? []);
        const referencedConflict = unusedSeededDefaultCategoryIdsToDelete.find((id) =>
          referencedSet.has(id)
        );
        if (referencedConflict) {
          throw new BackupValidationError(
            `Cannot replace category '${referencedConflict}' because existing local financial records reference it.`
          );
        }
      }

      const execution = await this.backupStorage.executeAtomicRestore({
        userId: actor.userId,
        mode: input.mode,
        restorePendingOutbox,
        archive: input.archive,
        unusedSeededDefaultCategoryIdsToDelete,
        validator: this.validationService
      });

      let cachesInvalidated = false;
      if (this.cacheInvalidator) {
        await this.cacheInvalidator.invalidateUserCaches(actor.userId);
        cachesInvalidated = true;
      }

      return {
        restoredAt: new Date().toISOString(),
        mode: input.mode,
        restoredCounts: execution.restoredCounts,
        restoredOutboxCount: execution.restoredOutboxCount,
        replacedSeededDefaultCategoryIds: execution.replacedSeededDefaultCategoryIds,
        cachesInvalidated,
        autoSyncTriggered: false
      };
    });
  }
}

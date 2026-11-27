import {
  BackupArchiveDocument,
  GenerateRestorePreviewInputDTO,
  RestorePreviewSummaryDTO
} from '@/application/dto/BackupDTO';
import { AuthPort } from '@/application/ports/AuthPort';
import {
  BackupStoragePort,
  BackupSyncActivityGuard
} from '@/application/ports/BackupStoragePort';
import { BackupValidationService } from '@/application/services/BackupValidationService';
import { InvalidBackupFormatError } from '@/domain/errors/BackupErrors';
import { DecryptBackupFileUseCase } from './DecryptBackupFileUseCase';
import {
  resolveVerifiedBackupActor,
  runWithExclusiveBackupLock
} from './backupUseCaseHelpers';

/**
 * Generates a pre-restore summary and runs full schema, ownership, canonical SHA-256,
 * referential integrity, category identity, and target compatibility validation before writes.
 */
export class GenerateRestorePreviewUseCase {
  constructor(
    private readonly authPort: AuthPort,
    private readonly backupStorage: BackupStoragePort,
    private readonly syncGuard?: BackupSyncActivityGuard,
    private readonly decryptUseCase: DecryptBackupFileUseCase = new DecryptBackupFileUseCase(
      authPort,
      syncGuard
    ),
    private readonly validationService: BackupValidationService = new BackupValidationService(),
    private readonly scopedUserId?: string
  ) {}

  public async execute(
    input: GenerateRestorePreviewInputDTO
  ): Promise<RestorePreviewSummaryDTO> {
    return runWithExclusiveBackupLock(
      this.syncGuard,
      'restore',
      async () => {
        const actor = await resolveVerifiedBackupActor(this.authPort, this.scopedUserId);

        let archive: BackupArchiveDocument | undefined = input.archive;
        if (!archive) {
          if (input.file !== undefined || input.rawContent !== undefined) {
            const decryptArgs = {
              file: input.file,
              rawContent: input.rawContent,
              passphrase: input.passphrase ?? ''
            };
            const decrypted =
              typeof this.decryptUseCase.executeUnlocked === 'function'
                ? await this.decryptUseCase.executeUnlocked(decryptArgs)
                : await this.decryptUseCase.execute(decryptArgs);
            archive = decrypted.archive;
          } else {
            throw new InvalidBackupFormatError(
              'Either a decrypted backup archive or encrypted backup file is required to generate a preview.'
            );
          }
        }

        const targetSummary = await this.backupStorage.getTargetRestoreSummary(actor.userId);
        const currentDexieSchemaVersion = this.backupStorage.getDexieSchemaVersion();

        return await this.validationService.validateForRestore(archive, {
          authenticatedUserId: actor.userId,
          currentDexieSchemaVersion,
          mode: input.mode,
          restorePendingOutbox: input.restorePendingOutbox ?? true,
          confirmationText: input.confirmationText,
          safetyBackupConfirmed: input.safetyBackupConfirmed,
          targetSummary: {
            ...targetSummary,
            currentDexieSchemaVersion
          }
        });
      },
      { broadcastRestoreCompleted: false }
    );
  }
}

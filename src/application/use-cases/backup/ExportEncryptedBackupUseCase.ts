import {
  BACKUP_FILE_EXTENSION,
  BACKUP_MIN_PASSPHRASE_LENGTH,
  ExportEncryptedBackupInputDTO,
  ExportEncryptedBackupResultDTO
} from '@/application/dto/BackupDTO';
import { AuthPort } from '@/application/ports/AuthPort';
import {
  BackupFileExporter,
  BackupStoragePort,
  BackupSyncActivityGuard
} from '@/application/ports/BackupStoragePort';
import { BackupEncryptionService } from '@/application/services/BackupEncryptionService';
import { BackupValidationService } from '@/application/services/BackupValidationService';
import {
  SafetyBackupReceiptRegistry,
  computeLocalDatabaseStateDigest,
  defaultSafetyBackupReceiptRegistry
} from '@/application/services/SafetyBackupReceiptService';
import { BackupEncryptionError } from '@/domain/errors/BackupErrors';
import {
  resolveVerifiedBackupActor,
  runWithExclusiveBackupLock
} from './backupUseCaseHelpers';

function buildDefaultBackupFilename(exportedAtIso: string): string {
  const datePart = exportedAtIso.slice(0, 10).replace(/[^0-9-]/g, '');
  const timePart = exportedAtIso
    .slice(11, 19)
    .replace(/:/g, '-')
    .replace(/[^0-9-]/g, '');
  const suffix = datePart && timePart ? `${datePart}_${timePart}` : 'snapshot';
  return `laxmilens-backup-${suffix}${BACKUP_FILE_EXTENSION}`;
}

export function sanitizeBackupFilename(
  rawFilename: string | undefined,
  fallbackIso: string
): string {
  const fallback = buildDefaultBackupFilename(fallbackIso);
  if (!rawFilename || rawFilename.trim().length === 0) {
    return fallback;
  }

  const stripped = rawFilename
    .replace(/\.laxmibak$/i, '')
    .replace(/\.json$/i, '')
    .replace(/[\x00-\x1f<>:"/\\|?*]+/g, ' ')
    .replace(/\.\.+/g, '.')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 100)
    .replace(/[.-]+$/, '');

  if (!stripped) {
    return fallback;
  }

  return `${stripped}${BACKUP_FILE_EXTENSION}`;
}

/**
 * Captures a user-scoped consistent Dexie snapshot across all 14 stores under the shared
 * sync/backup exclusive lock, encrypts with PBKDF2 + AES-256-GCM, exports the file, and
 * issues an ephemeral single-use safety-backup receipt bound to user, DB, and snapshot state.
 */
export class ExportEncryptedBackupUseCase {
  constructor(
    private readonly authPort: AuthPort,
    private readonly backupStorage: BackupStoragePort,
    private readonly syncGuard?: BackupSyncActivityGuard,
    private readonly encryptionService: BackupEncryptionService = new BackupEncryptionService(),
    private readonly validationService: BackupValidationService = new BackupValidationService(),
    private readonly fileExporter?: BackupFileExporter,
    private readonly scopedUserId?: string,
    private readonly receiptRegistry: SafetyBackupReceiptRegistry = defaultSafetyBackupReceiptRegistry
  ) {}

  public async execute(
    input: ExportEncryptedBackupInputDTO
  ): Promise<ExportEncryptedBackupResultDTO> {
    return runWithExclusiveBackupLock(this.syncGuard, 'backup', async () => {
      const actor = await resolveVerifiedBackupActor(this.authPort, this.scopedUserId);

      if (typeof input?.passphrase !== 'string' || input.passphrase.trim().length === 0) {
        throw new BackupEncryptionError('Backup passphrase is required.');
      }
      if (input.passphrase.length < BACKUP_MIN_PASSPHRASE_LENGTH) {
        throw new BackupEncryptionError(
          `Backup passphrase must be at least ${BACKUP_MIN_PASSPHRASE_LENGTH} characters long.`
        );
      }

      const exportedAt = new Date().toISOString();
      const snapshot = await this.backupStorage.captureUserSnapshot(actor.userId);

      const archive = await this.validationService.buildSanitizedArchive({
        userId: actor.userId,
        ...(actor.email ? { email: actor.email } : {}),
        dexieSchemaVersion: snapshot.dexieSchemaVersion,
        exportedAt,
        rawStoreData: snapshot.rawStoreData,
        preExcludedQuarantinedCounts: snapshot.preExcludedQuarantinedCounts
      });

      const envelope = await this.encryptionService.encryptArchive(archive, input.passphrase, {
        createdAt: exportedAt
      });

      const safeFilename = sanitizeBackupFilename(input.filename, exportedAt);
      const shouldDownload = input.downloadFile !== false;

      let byteLength: number;
      let downloaded = false;

      if (shouldDownload && this.fileExporter) {
        const exportResult = this.fileExporter.downloadEnvelope(envelope, safeFilename);
        byteLength = exportResult.byteLength;
        downloaded = exportResult.downloaded;
      } else {
        byteLength = new TextEncoder().encode(JSON.stringify(envelope)).byteLength;
      }

      const stateDigestSha256Hex = await computeLocalDatabaseStateDigest(snapshot, archive);
      const safetyBackupReceipt = this.receiptRegistry.issueReceipt({
        userId: actor.userId,
        databaseIdentity: this.backupStorage.getDatabaseIdentity(),
        stateDigestSha256Hex
      });

      return {
        filename: safeFilename,
        byteLength,
        downloaded,
        safetyBackupCreated: true,
        safetyBackupReceipt,
        envelope,
        manifest: archive.manifest
      };
    });
  }
}

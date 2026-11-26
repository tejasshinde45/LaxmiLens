import {
  BACKUP_MAX_ENVELOPE_BYTES,
  DecryptBackupFileInputDTO,
  DecryptedBackupResultDTO
} from '@/application/dto/BackupDTO';
import { AuthPort } from '@/application/ports/AuthPort';
import { BackupSyncActivityGuard } from '@/application/ports/BackupStoragePort';
import {
  BackupEncryptionService,
  parseAndValidateEncryptedEnvelope
} from '@/application/services/BackupEncryptionService';
import {
  BackupDecryptionError,
  InvalidBackupFormatError
} from '@/domain/errors/BackupErrors';
import {
  assertNoManualSyncRunning,
  resolveVerifiedBackupActor
} from './backupUseCaseHelpers';

async function readFileContentSafely(file: Blob): Promise<string> {
  if (typeof file.size === 'number' && file.size > BACKUP_MAX_ENVELOPE_BYTES) {
    throw new InvalidBackupFormatError(
      `Backup container exceeds the maximum supported file size of ${BACKUP_MAX_ENVELOPE_BYTES} bytes.`
    );
  }

  if (typeof file.text === 'function') {
    return await file.text();
  }

  if (typeof file.arrayBuffer === 'function') {
    const buffer = await file.arrayBuffer();
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  }

  if (typeof FileReader !== 'undefined') {
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result);
        } else {
          reject(new InvalidBackupFormatError('Failed to decode backup file contents as text.'));
        }
      };
      reader.onerror = () => {
        reject(new InvalidBackupFormatError('Failed to read backup file from disk.'));
      };
      reader.readAsText(file, 'utf-8');
    });
  }

  throw new InvalidBackupFormatError('Unable to read backup file content in this environment.');
}

/**
 * Validates the outer encrypted envelope before key derivation and decrypts the archive
 * for the authenticated user without retaining the passphrase.
 */
export class DecryptBackupFileUseCase {
  constructor(
    private readonly authPort: AuthPort,
    private readonly syncGuard?: BackupSyncActivityGuard,
    private readonly encryptionService: BackupEncryptionService = new BackupEncryptionService(),
    private readonly scopedUserId?: string
  ) {}

  public async execute(input: DecryptBackupFileInputDTO): Promise<DecryptedBackupResultDTO> {
    assertNoManualSyncRunning(this.syncGuard);
    await resolveVerifiedBackupActor(this.authPort, this.scopedUserId);

    let payloadToParse: unknown = input?.rawContent;
    if (input?.file !== undefined) {
      payloadToParse = await readFileContentSafely(input.file);
    }

    if (payloadToParse === undefined || payloadToParse === null) {
      throw new InvalidBackupFormatError('A backup file or envelope payload is required.');
    }

    if (typeof input?.passphrase !== 'string' || input.passphrase.trim().length === 0) {
      throw new BackupDecryptionError('Backup passphrase is required for decryption.');
    }

    // Validate outer envelope before key derivation to prevent PBKDF2 DoS or downgrade attacks.
    const { envelope } = parseAndValidateEncryptedEnvelope(payloadToParse);
    const archive = await this.encryptionService.decryptEnvelope(envelope, input.passphrase);

    return {
      archive,
      envelope
    };
  }
}

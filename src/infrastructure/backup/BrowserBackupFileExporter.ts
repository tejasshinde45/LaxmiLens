import {
  BACKUP_FILE_EXTENSION,
  BACKUP_MIME_TYPE,
  EncryptedBackupEnvelope
} from '@/application/dto/BackupDTO';
import {
  BackupFileExportOutcome,
  BackupFileExporter
} from '@/application/ports/BackupStoragePort';

const OBJECT_URL_REVOKE_DELAY_MS = 1000;
const pendingObjectUrlTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleObjectUrlRevoke(objectUrl: string): void {
  const existing = pendingObjectUrlTimers.get(objectUrl);
  if (existing !== undefined) {
    clearTimeout(existing);
  }

  const timer = setTimeout(() => {
    pendingObjectUrlTimers.delete(objectUrl);
    if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(objectUrl);
    }
  }, OBJECT_URL_REVOKE_DELAY_MS);

  pendingObjectUrlTimers.set(objectUrl, timer);
}

/**
 * Initiates a client-side Blob download for an encrypted backup envelope, removes the
 * temporary anchor immediately, and defers URL.revokeObjectURL cleanup safely.
 */
export class BrowserBackupFileExporter implements BackupFileExporter {
  public downloadEnvelope(
    envelope: EncryptedBackupEnvelope,
    filename?: string
  ): BackupFileExportOutcome {
    const serialized = JSON.stringify(envelope, null, 2);
    const byteLength = new TextEncoder().encode(serialized).byteLength;
    const resolvedFilename =
      filename && filename.trim().length > 0
        ? filename
        : `laxmilens-backup${BACKUP_FILE_EXTENSION}`;

    if (
      typeof document === 'undefined' ||
      typeof Blob === 'undefined' ||
      typeof URL === 'undefined' ||
      typeof URL.createObjectURL !== 'function' ||
      typeof URL.revokeObjectURL !== 'function'
    ) {
      return {
        filename: resolvedFilename,
        byteLength,
        downloaded: false
      };
    }

    const blob = new Blob([serialized], { type: `${BACKUP_MIME_TYPE};charset=utf-8;` });
    const objectUrl = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = resolvedFilename;
    link.style.display = 'none';

    try {
      document.body.appendChild(link);
      link.click();
    } finally {
      if (link.parentNode) {
        link.parentNode.removeChild(link);
      }
      scheduleObjectUrlRevoke(objectUrl);
    }

    return {
      filename: resolvedFilename,
      byteLength,
      downloaded: true
    };
  }
}

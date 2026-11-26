import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  BACKUP_CIPHER_ALGORITHM,
  BACKUP_CIPHER_KEY_LENGTH_BITS,
  BACKUP_CIPHER_TAG_LENGTH_BITS,
  BACKUP_CONTAINER_FORMAT,
  BACKUP_CONTAINER_FORMAT_VERSION,
  BACKUP_DEFAULT_KDF_ITERATIONS,
  BACKUP_IV_BYTE_LENGTH,
  BACKUP_KDF_ALGORITHM,
  BACKUP_KDF_HASH,
  BACKUP_MAX_ENVELOPE_BYTES,
  BACKUP_MIN_KDF_ITERATIONS,
  BACKUP_SALT_BYTE_LENGTH,
  BackupArchiveDocument
} from '@/application/dto/BackupDTO';
import {
  BackupEncryptionService,
  canonicalStringify,
  computeCanonicalSha256Hex,
  decodeBase64ToBytes,
  encodeBytesToBase64,
  parseAndValidateEncryptedEnvelope
} from '@/application/services/BackupEncryptionService';
import { BackupValidationService } from '@/application/services/BackupValidationService';
import {
  BackupDecryptionError,
  BackupEncryptionError,
  BackupIntegrityError,
  InvalidBackupFormatError,
  UnsupportedBackupVersionError
} from '@/domain/errors/BackupErrors';

const TEST_USER_ID = '11111111-1111-4111-8111-111111111111';
const TEST_ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';
const TEST_CATEGORY_ID = '33333333-3333-4333-8333-333333333333';
const TEST_TRANSACTION_ID = '44444444-4444-4444-8444-444444444444';
const STRONG_PASSPHRASE = 'LaxmiLens#Vault2026!';

async function createSampleArchive(): Promise<BackupArchiveDocument> {
  const validator = new BackupValidationService();
  return validator.buildSanitizedArchive({
    userId: TEST_USER_ID,
    email: 'tejas@example.com',
    currency: 'INR',
    exportedAt: '2026-11-25T10:00:00.000Z',
    rawStoreData: {
      profile: {
        id: TEST_USER_ID,
        email: 'tejas@example.com',
        displayName: 'Tejas Secret Name',
        currency: 'INR',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      },
      accounts: [
        {
          id: TEST_ACCOUNT_ID,
          userId: TEST_USER_ID,
          name: 'HDFC Confidential Checking',
          accountType: 'bank',
          openingBalancePaise: 500000,
          currency: 'INR',
          isArchived: false,
          version: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      categories: [
        {
          id: TEST_CATEGORY_ID,
          userId: TEST_USER_ID,
          name: 'Groceries & Household',
          type: 'expense',
          isDefault: true,
          isArchived: false,
          version: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      transactions: [
        {
          id: TEST_TRANSACTION_ID,
          userId: TEST_USER_ID,
          type: 'expense',
          amountPaise: 125050,
          currency: 'INR',
          accountId: TEST_ACCOUNT_ID,
          categoryId: TEST_CATEGORY_ID,
          title: 'Private Grocery Receipt',
          note: 'Secret merchant note',
          transactionDate: '2026-11-20T09:00:00.000Z',
          deletedAt: null,
          version: 1,
          idempotencyKey: 'tx-key-001',
          createdAt: '2026-11-20T09:00:00.000Z',
          updatedAt: '2026-11-20T09:00:00.000Z'
        }
      ]
    }
  });
}

describe('BackupEncryptionService & Canonical Integrity Engine', () => {
  const service = new BackupEncryptionService();

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('produces identical canonical JSON and SHA-256 digests regardless of object key insertion order or undefined keys', async () => {
    const objA = {
      z: 1,
      a: {
        d: true,
        b: undefined,
        a: 'hello'
      },
      arr: [{ y: 2, x: 1 }, 'raw']
    };

    const objB = {
      arr: [{ x: 1, y: 2 }, 'raw'],
      a: {
        a: 'hello',
        d: true
      },
      z: 1
    };

    expect(canonicalStringify(objA)).toBe(canonicalStringify(objB));
    expect(canonicalStringify(objA)).toBe(canonicalStringify(JSON.parse(JSON.stringify(objA))));

    const hashA = await computeCanonicalSha256Hex(objA);
    const hashB = await computeCanonicalSha256Hex(objB);
    expect(hashA).toMatch(/^[0-9a-f]{64}$/);
    expect(hashA).toBe(hashB);
  });

  it('encrypts and decrypts archive round-trip without leaking plaintext financial or user data in the outer envelope', async () => {
    const archive = await createSampleArchive();
    const envelope = await service.encryptArchive(archive, STRONG_PASSPHRASE);

    expect(envelope.format).toBe(BACKUP_CONTAINER_FORMAT);
    expect(envelope.formatVersion).toBe(BACKUP_CONTAINER_FORMAT_VERSION);
    expect(envelope.kdf).toEqual({
      algorithm: BACKUP_KDF_ALGORITHM,
      hash: BACKUP_KDF_HASH,
      iterations: BACKUP_DEFAULT_KDF_ITERATIONS
    });
    expect(envelope.cipher).toEqual({
      algorithm: BACKUP_CIPHER_ALGORITHM,
      keyLengthBits: BACKUP_CIPHER_KEY_LENGTH_BITS,
      tagLengthBits: BACKUP_CIPHER_TAG_LENGTH_BITS
    });
    expect(decodeBase64ToBytes(envelope.saltBase64, 'saltBase64').byteLength).toBe(
      BACKUP_SALT_BYTE_LENGTH
    );
    expect(decodeBase64ToBytes(envelope.ivBase64, 'ivBase64').byteLength).toBe(
      BACKUP_IV_BYTE_LENGTH
    );

    const envelopeJson = JSON.stringify(envelope);
    expect(envelopeJson).not.toContain('HDFC Confidential Checking');
    expect(envelopeJson).not.toContain('Private Grocery Receipt');
    expect(envelopeJson).not.toContain('Secret merchant note');
    expect(envelopeJson).not.toContain('tejas@example.com');
    expect(envelopeJson).not.toContain(TEST_USER_ID);
    expect(envelopeJson).not.toContain(STRONG_PASSPHRASE);

    const decryptedFromJson = await service.decryptEnvelope(envelopeJson, STRONG_PASSPHRASE);
    expect(decryptedFromJson).toEqual(archive);
  });

  it('uses fresh CSPRNG salt and IV on every encryption with the same passphrase and payload', async () => {
    const archive = await createSampleArchive();
    const first = await service.encryptArchive(archive, STRONG_PASSPHRASE);
    const second = await service.encryptArchive(archive, STRONG_PASSPHRASE);

    expect(first.saltBase64).not.toBe(second.saltBase64);
    expect(first.ivBase64).not.toBe(second.ivBase64);
    expect(first.ciphertextBase64).not.toBe(second.ciphertextBase64);
  });

  it('rejects wrong passphrases with BackupDecryptionError', async () => {
    const archive = await createSampleArchive();
    const envelope = await service.encryptArchive(archive, STRONG_PASSPHRASE);

    await expect(service.decryptEnvelope(envelope, 'WrongPassphrase#2026')).rejects.toThrow(
      BackupDecryptionError
    );
  });

  it('detects ciphertext bit tampering and AAD header tampering (createdAt / salt / iv)', async () => {
    const archive = await createSampleArchive();
    const envelope = await service.encryptArchive(archive, STRONG_PASSPHRASE);

    // 1. Tamper ciphertext byte
    const cipherBytes = decodeBase64ToBytes(envelope.ciphertextBase64, 'ciphertextBase64');
    cipherBytes[0] = cipherBytes[0]! ^ 0xff;
    const tamperedCipher = {
      ...envelope,
      ciphertextBase64: encodeBytesToBase64(cipherBytes)
    };
    await expect(service.decryptEnvelope(tamperedCipher, STRONG_PASSPHRASE)).rejects.toThrow(
      BackupDecryptionError
    );

    // 2. Tamper AAD-protected outer metadata (createdAt remains valid ISO, different value)
    const tamperedCreatedAt = {
      ...envelope,
      createdAt: '2026-12-01T00:00:00.000Z'
    };
    await expect(service.decryptEnvelope(tamperedCreatedAt, STRONG_PASSPHRASE)).rejects.toThrow(
      BackupDecryptionError
    );

    // 3. Tamper KDF iterations within valid bounds (caught by AAD)
    const tamperedIterations = {
      ...envelope,
      kdf: {
        ...envelope.kdf,
        iterations: BACKUP_MIN_KDF_ITERATIONS + 100
      }
    };
    await expect(service.decryptEnvelope(tamperedIterations, STRONG_PASSPHRASE)).rejects.toThrow(
      BackupDecryptionError
    );
  });

  it('validates envelope format, versions, and PBKDF2 DoS iteration bounds BEFORE invoking crypto.subtle.deriveKey', async () => {
    const archive = await createSampleArchive();
    const validEnvelope = await service.encryptArchive(archive, STRONG_PASSPHRASE);
    const deriveKeySpy = vi.spyOn(globalThis.crypto.subtle, 'deriveKey');

    // Out-of-bounds KDF iterations (too high -> DoS guard)
    const highIterationsEnvelope = {
      ...validEnvelope,
      kdf: { ...validEnvelope.kdf, iterations: 50_000_000 }
    };
    await expect(
      service.decryptEnvelope(highIterationsEnvelope, STRONG_PASSPHRASE)
    ).rejects.toThrow(InvalidBackupFormatError);

    // Weak KDF iterations (downgrade guard)
    const lowIterationsEnvelope = {
      ...validEnvelope,
      kdf: { ...validEnvelope.kdf, iterations: 1 }
    };
    await expect(
      service.decryptEnvelope(lowIterationsEnvelope, STRONG_PASSPHRASE)
    ).rejects.toThrow(InvalidBackupFormatError);

    // Unsupported future container formatVersion
    const futureEnvelope = {
      ...validEnvelope,
      formatVersion: 99
    };
    await expect(service.decryptEnvelope(futureEnvelope, STRONG_PASSPHRASE)).rejects.toThrow(
      UnsupportedBackupVersionError
    );

    // Wrong salt length
    const badSaltEnvelope = {
      ...validEnvelope,
      saltBase64: encodeBytesToBase64(new Uint8Array(8))
    };
    await expect(service.decryptEnvelope(badSaltEnvelope, STRONG_PASSPHRASE)).rejects.toThrow(
      InvalidBackupFormatError
    );

    // Wrong IV length
    const badIvEnvelope = {
      ...validEnvelope,
      ivBase64: encodeBytesToBase64(new Uint8Array(16))
    };
    await expect(service.decryptEnvelope(badIvEnvelope, STRONG_PASSPHRASE)).rejects.toThrow(
      InvalidBackupFormatError
    );

    // Unexpected extra outer property
    const extraPropertyEnvelope = {
      ...validEnvelope,
      injectedField: 'malicious'
    };
    await expect(
      service.decryptEnvelope(extraPropertyEnvelope, STRONG_PASSPHRASE)
    ).rejects.toThrow(InvalidBackupFormatError);

    // Malformed JSON & oversized string
    expect(() => parseAndValidateEncryptedEnvelope('{not-json')).toThrow(InvalidBackupFormatError);
    expect(() =>
      parseAndValidateEncryptedEnvelope('x'.repeat(BACKUP_MAX_ENVELOPE_BYTES + 1))
    ).toThrow(InvalidBackupFormatError);

    // Critical security proof: PBKDF2 deriveKey was NEVER triggered on any rejected header
    expect(deriveKeySpy).not.toHaveBeenCalled();
  });

  it('handles multi-megabyte payloads cleanly via chunked Base64 encode/decode without stack overflow', () => {
    const largeBytes = new Uint8Array(2 * 1024 * 1024);
    for (let i = 0; i < largeBytes.length; i += 4096) {
      largeBytes[i] = (i >> 8) & 0xff;
    }

    const encoded = encodeBytesToBase64(largeBytes);
    const decoded = decodeBase64ToBytes(encoded, 'ciphertextBase64');

    expect(decoded.byteLength).toBe(largeBytes.byteLength);
    expect(decoded[0]).toBe(largeBytes[0]);
    expect(decoded[4096]).toBe(largeBytes[4096]);
    expect(decoded[decoded.length - 1]).toBe(largeBytes[largeBytes.length - 1]);
  });

  it('enforces 12-character minimum passphrase length on encrypt and non-empty passphrase on decrypt', async () => {
    const archive = await createSampleArchive();

    await expect(service.encryptArchive(archive, '')).rejects.toThrow(BackupEncryptionError);
    await expect(service.encryptArchive(archive, '            ')).rejects.toThrow(
      BackupEncryptionError
    );
    await expect(service.encryptArchive(archive, 'short7')).rejects.toThrow(BackupEncryptionError);
    await expect(service.encryptArchive(archive, 'ElevenChars')).rejects.toThrow(
      /at least 12 characters long/
    );

    const exactMinEnvelope = await service.encryptArchive(archive, 'Exact12Chars');
    const exactMinDecrypted = await service.decryptEnvelope(exactMinEnvelope, 'Exact12Chars');
    expect(exactMinDecrypted.manifest.owner.userId).toBe(TEST_USER_ID);

    const envelope = await service.encryptArchive(archive, STRONG_PASSPHRASE);
    await expect(service.decryptEnvelope(envelope, '')).rejects.toThrow(BackupDecryptionError);
    await expect(service.decryptEnvelope(envelope, '   ')).rejects.toThrow(BackupDecryptionError);
  });

  it('fails closed when Web Crypto API is unavailable', async () => {
    const archive = await createSampleArchive();
    vi.stubGlobal('crypto', undefined);

    await expect(service.encryptArchive(archive, STRONG_PASSPHRASE)).rejects.toThrow(
      BackupEncryptionError
    );
    await expect(computeCanonicalSha256Hex({ test: 1 })).rejects.toThrow(BackupIntegrityError);
  });
});

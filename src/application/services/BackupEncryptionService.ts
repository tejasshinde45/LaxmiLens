import {
  BACKUP_CIPHER_ALGORITHM,
  BACKUP_CIPHER_KEY_LENGTH_BITS,
  BACKUP_CIPHER_TAG_LENGTH_BITS,
  BACKUP_CONTAINER_FORMAT,
  BACKUP_CONTAINER_FORMAT_VERSION,
  BACKUP_DEFAULT_KDF_ITERATIONS,
  BACKUP_GCM_TAG_BYTE_LENGTH,
  BACKUP_IV_BYTE_LENGTH,
  BACKUP_KDF_ALGORITHM,
  BACKUP_KDF_HASH,
  BACKUP_MAX_ENVELOPE_BYTES,
  BACKUP_MAX_KDF_ITERATIONS,
  BACKUP_MAX_PLAINTEXT_BYTES,
  BACKUP_MIN_KDF_ITERATIONS,
  BACKUP_MIN_PASSPHRASE_LENGTH,
  BACKUP_SALT_BYTE_LENGTH,
  BackupArchiveDocument,
  BackupCipherHeader,
  BackupEncryptionOptions,
  BackupKdfHeader,
  EncryptedBackupEnvelope
} from '@/application/dto/BackupDTO';
import {
  BackupDecryptionError,
  BackupEncryptionError,
  BackupIntegrityError,
  InvalidBackupFormatError,
  UnsupportedBackupVersionError
} from '@/domain/errors/BackupErrors';

const BASE64_CHUNK_SIZE = 8192;
const STRICT_BASE64_REGEX =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})?$/;

const ALLOWED_ENVELOPE_KEYS = new Set<string>([
  'format',
  'formatVersion',
  'createdAt',
  'kdf',
  'cipher',
  'saltBase64',
  'ivBase64',
  'ciphertextBase64'
]);

const ALLOWED_KDF_KEYS = new Set<string>(['algorithm', 'hash', 'iterations']);
const ALLOWED_CIPHER_KEYS = new Set<string>([
  'algorithm',
  'keyLengthBits',
  'tagLengthBits'
]);

interface ValidatedEnvelopeParts {
  envelope: EncryptedBackupEnvelope;
  salt: Uint8Array;
  iv: Uint8Array;
  ciphertext: Uint8Array;
  aadBytes: Uint8Array;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype || proto?.constructor?.name === 'Object';
}

function hasOnlyAllowedKeys(obj: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(obj).every((key) => allowed.has(key));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function getWebCrypto(): Crypto {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi || !cryptoApi.subtle || typeof cryptoApi.getRandomValues !== 'function') {
    throw new BackupEncryptionError(
      'Web Crypto API (crypto.subtle) is required for encrypted backups but is unavailable in this environment.'
    );
  }
  return cryptoApi;
}

function validateIsoTimestampString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new InvalidBackupFormatError(`Envelope '${fieldName}' must be a valid ISO timestamp.`);
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new InvalidBackupFormatError(`Envelope '${fieldName}' is not a parseable timestamp.`);
  }
  return value;
}

function buildHeaderForAad(envelope: Omit<EncryptedBackupEnvelope, 'ciphertextBase64'>): Uint8Array {
  const canonicalHeader = canonicalStringify({
    format: envelope.format,
    formatVersion: envelope.formatVersion,
    createdAt: envelope.createdAt,
    kdf: envelope.kdf,
    cipher: envelope.cipher,
    saltBase64: envelope.saltBase64,
    ivBase64: envelope.ivBase64
  });
  return new TextEncoder().encode(canonicalHeader);
}

/**
 * Deterministic JSON serializer matching JSON.stringify value semantics
 * (omits `undefined` object properties, converts Dates via ISO strings)
 * while sorting object keys lexicographically at every depth.
 */
export function canonicalStringify(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new BackupIntegrityError(
        'Cannot canonically serialize non-finite numeric values in backup payload.'
      );
    }
    return JSON.stringify(value);
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new BackupIntegrityError('Cannot canonically serialize invalid Date values.');
    }
    return JSON.stringify(value.toISOString());
  }

  if (typeof value !== 'object') {
    throw new BackupIntegrityError(
      `Unsupported value type '${typeof value}' during canonical backup serialization.`
    );
  }

  if (seen.has(value)) {
    throw new BackupIntegrityError('Circular object reference detected in backup payload.');
  }

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const items = value.map((item) => {
        if (item === undefined || typeof item === 'function' || typeof item === 'symbol') {
          return 'null';
        }
        return canonicalStringify(item, seen);
      });
      return `[${items.join(',')}]`;
    }

    if (!isPlainRecord(value)) {
      throw new BackupIntegrityError(
        'Non-plain object instances are not permitted in canonical backup serialization.'
      );
    }

    const sortedKeys = Object.keys(value).sort();
    const entries: string[] = [];
    for (const key of sortedKeys) {
      const prop = value[key];
      if (prop === undefined || typeof prop === 'function' || typeof prop === 'symbol') {
        continue;
      }
      entries.push(`${JSON.stringify(key)}:${canonicalStringify(prop, seen)}`);
    }
    return `{${entries.join(',')}}`;
  } finally {
    seen.delete(value);
  }
}

/**
 * Computes lowercase SHA-256 hex digest over the canonical JSON serialization of a value.
 */
export async function computeCanonicalSha256Hex(value: unknown): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new BackupIntegrityError(
      'Web Crypto SHA-256 (crypto.subtle) is required for backup checksum verification.'
    );
  }

  const canonicalJson = canonicalStringify(value);
  const encoded = new TextEncoder().encode(canonicalJson);
  const digestBuffer = await subtle.digest('SHA-256', toArrayBuffer(encoded));
  const digestBytes = new Uint8Array(digestBuffer);

  let hex = '';
  for (let i = 0; i < digestBytes.length; i += 1) {
    hex += digestBytes[i]!.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Chunk-safe Base64 encoder avoiding spread operator stack limits on multi-MB payloads.
 */
export function encodeBytesToBase64(bytes: Uint8Array): string {
  if (bytes.length === 0) {
    return '';
  }

  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_SIZE) {
    const chunk = bytes.subarray(offset, offset + BASE64_CHUNK_SIZE);
    let chunkStr = '';
    for (let i = 0; i < chunk.length; i += 1) {
      chunkStr += String.fromCharCode(chunk[i]!);
    }
    binary += chunkStr;
  }

  return btoa(binary);
}

/**
 * Strict RFC 4648 Base64 decoder that rejects non-canonical padding or embedded whitespace.
 */
export function decodeBase64ToBytes(encoded: unknown, fieldName: string): Uint8Array {
  if (typeof encoded !== 'string' || encoded.length === 0) {
    throw new InvalidBackupFormatError(`Envelope field '${fieldName}' must be a non-empty Base64 string.`);
  }

  if (/\s/.test(encoded) || encoded.length % 4 !== 0 || !STRICT_BASE64_REGEX.test(encoded)) {
    throw new InvalidBackupFormatError(`Envelope field '${fieldName}' contains invalid Base64 encoding.`);
  }

  let binary: string;
  try {
    binary = atob(encoded);
  } catch {
    throw new InvalidBackupFormatError(`Envelope field '${fieldName}' could not be decoded from Base64.`);
  }

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Parses raw backup file JSON (when given as string) and validates all envelope metadata,
 * cryptographic algorithm parameters, KDF iteration bounds, and salt/IV/ciphertext sizes
 * strictly BEFORE any key derivation (PBKDF2) is attempted.
 */
export function parseAndValidateEncryptedEnvelope(rawInput: unknown): ValidatedEnvelopeParts {
  let parsed: unknown = rawInput;

  if (typeof rawInput === 'string') {
    if (rawInput.trim().length === 0) {
      throw new InvalidBackupFormatError('Backup file is empty.');
    }
    if (rawInput.length > BACKUP_MAX_ENVELOPE_BYTES) {
      throw new InvalidBackupFormatError(
        `Backup container exceeds the maximum supported file size of ${BACKUP_MAX_ENVELOPE_BYTES} bytes.`
      );
    }
    try {
      parsed = JSON.parse(rawInput);
    } catch {
      throw new InvalidBackupFormatError('Backup file is not valid JSON.');
    }
  }

  if (!isPlainRecord(parsed) || !hasOnlyAllowedKeys(parsed, ALLOWED_ENVELOPE_KEYS)) {
    throw new InvalidBackupFormatError(
      'Invalid encrypted backup envelope structure or unexpected header properties.'
    );
  }

  if (parsed.format !== BACKUP_CONTAINER_FORMAT) {
    throw new InvalidBackupFormatError(
      `Unsupported backup container format '${String(parsed.format ?? '')}'.`
    );
  }

  if (
    typeof parsed.formatVersion !== 'number' ||
    !Number.isSafeInteger(parsed.formatVersion) ||
    parsed.formatVersion <= 0
  ) {
    throw new InvalidBackupFormatError('Backup formatVersion must be a positive safe integer.');
  }

  if (parsed.formatVersion !== BACKUP_CONTAINER_FORMAT_VERSION) {
    throw new UnsupportedBackupVersionError(
      `Unsupported encrypted container version ${parsed.formatVersion}. Supported version: ${BACKUP_CONTAINER_FORMAT_VERSION}.`
    );
  }

  const createdAt = validateIsoTimestampString(parsed.createdAt, 'createdAt');

  const kdf = validateKdfHeader(parsed.kdf);
  const cipher = validateCipherHeader(parsed.cipher);

  const salt = decodeBase64ToBytes(parsed.saltBase64, 'saltBase64');
  if (salt.byteLength !== BACKUP_SALT_BYTE_LENGTH) {
    throw new InvalidBackupFormatError(
      `Invalid salt length (${salt.byteLength} bytes). Expected ${BACKUP_SALT_BYTE_LENGTH} bytes.`
    );
  }

  const iv = decodeBase64ToBytes(parsed.ivBase64, 'ivBase64');
  if (iv.byteLength !== BACKUP_IV_BYTE_LENGTH) {
    throw new InvalidBackupFormatError(
      `Invalid IV length (${iv.byteLength} bytes). Expected ${BACKUP_IV_BYTE_LENGTH} bytes.`
    );
  }

  const ciphertext = decodeBase64ToBytes(parsed.ciphertextBase64, 'ciphertextBase64');
  if (
    ciphertext.byteLength < BACKUP_GCM_TAG_BYTE_LENGTH ||
    ciphertext.byteLength > BACKUP_MAX_PLAINTEXT_BYTES + BACKUP_GCM_TAG_BYTE_LENGTH
  ) {
    throw new InvalidBackupFormatError(
      `Ciphertext byte length (${ciphertext.byteLength}) is outside allowed bounds.`
    );
  }

  const envelope: EncryptedBackupEnvelope = {
    format: BACKUP_CONTAINER_FORMAT,
    formatVersion: BACKUP_CONTAINER_FORMAT_VERSION,
    createdAt,
    kdf,
    cipher,
    saltBase64: parsed.saltBase64 as string,
    ivBase64: parsed.ivBase64 as string,
    ciphertextBase64: parsed.ciphertextBase64 as string
  };

  return {
    envelope,
    salt,
    iv,
    ciphertext,
    aadBytes: buildHeaderForAad(envelope)
  };
}

function validateKdfHeader(rawKdf: unknown): BackupKdfHeader {
  if (!isPlainRecord(rawKdf) || !hasOnlyAllowedKeys(rawKdf, ALLOWED_KDF_KEYS)) {
    throw new InvalidBackupFormatError('Envelope KDF header is missing or malformed.');
  }

  if (rawKdf.algorithm !== BACKUP_KDF_ALGORITHM || rawKdf.hash !== BACKUP_KDF_HASH) {
    throw new InvalidBackupFormatError(
      'Unsupported backup key derivation algorithm. Required: PBKDF2 with SHA-256.'
    );
  }

  const iterations = rawKdf.iterations;
  if (
    typeof iterations !== 'number' ||
    !Number.isSafeInteger(iterations) ||
    iterations < BACKUP_MIN_KDF_ITERATIONS ||
    iterations > BACKUP_MAX_KDF_ITERATIONS
  ) {
    throw new InvalidBackupFormatError(
      `Envelope KDF iterations (${String(iterations)}) must be an integer between ${BACKUP_MIN_KDF_ITERATIONS} and ${BACKUP_MAX_KDF_ITERATIONS}.`
    );
  }

  return {
    algorithm: BACKUP_KDF_ALGORITHM,
    hash: BACKUP_KDF_HASH,
    iterations
  };
}

function validateCipherHeader(rawCipher: unknown): BackupCipherHeader {
  if (!isPlainRecord(rawCipher) || !hasOnlyAllowedKeys(rawCipher, ALLOWED_CIPHER_KEYS)) {
    throw new InvalidBackupFormatError('Envelope cipher header is missing or malformed.');
  }

  if (
    rawCipher.algorithm !== BACKUP_CIPHER_ALGORITHM ||
    rawCipher.keyLengthBits !== BACKUP_CIPHER_KEY_LENGTH_BITS ||
    rawCipher.tagLengthBits !== BACKUP_CIPHER_TAG_LENGTH_BITS
  ) {
    throw new InvalidBackupFormatError(
      'Unsupported backup cipher suite. Required: AES-GCM 256-bit key with 128-bit authentication tag.'
    );
  }

  return {
    algorithm: BACKUP_CIPHER_ALGORITHM,
    keyLengthBits: BACKUP_CIPHER_KEY_LENGTH_BITS,
    tagLengthBits: BACKUP_CIPHER_TAG_LENGTH_BITS
  };
}

async function deriveAesGcmKey(
  cryptoApi: Crypto,
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
  usage: 'encrypt' | 'decrypt'
): Promise<CryptoKey> {
  const passphraseBytes = new TextEncoder().encode(passphrase);
  const baseKey = await cryptoApi.subtle.importKey(
    'raw',
    toArrayBuffer(passphraseBytes),
    { name: BACKUP_KDF_ALGORITHM },
    false,
    ['deriveKey']
  );

  return cryptoApi.subtle.deriveKey(
    {
      name: BACKUP_KDF_ALGORITHM,
      salt: toArrayBuffer(salt),
      iterations,
      hash: BACKUP_KDF_HASH
    },
    baseKey,
    {
      name: BACKUP_CIPHER_ALGORITHM,
      length: BACKUP_CIPHER_KEY_LENGTH_BITS
    },
    false,
    [usage]
  );
}

/**
 * Pure Web Crypto encryption and integrity service for LaxmiLens backups.
 * Never persists keys or passphrases and binds container metadata via AES-GCM AAD.
 */
export class BackupEncryptionService {
  public async encryptArchive(
    archive: BackupArchiveDocument,
    passphrase: string,
    options: BackupEncryptionOptions = {}
  ): Promise<EncryptedBackupEnvelope> {
    const cryptoApi = getWebCrypto();

    if (typeof passphrase !== 'string' || passphrase.trim().length === 0) {
      throw new BackupEncryptionError('Backup passphrase is required.');
    }

    if (passphrase.length < BACKUP_MIN_PASSPHRASE_LENGTH) {
      throw new BackupEncryptionError(
        `Backup passphrase must be at least ${BACKUP_MIN_PASSPHRASE_LENGTH} characters long.`
      );
    }

    if (!archive || typeof archive !== 'object') {
      throw new BackupEncryptionError('Backup archive document must be a valid object.');
    }

    const iterations = options.iterations ?? BACKUP_DEFAULT_KDF_ITERATIONS;
    if (
      !Number.isSafeInteger(iterations) ||
      iterations < BACKUP_MIN_KDF_ITERATIONS ||
      iterations > BACKUP_MAX_KDF_ITERATIONS
    ) {
      throw new BackupEncryptionError(
        `PBKDF2 iterations must be between ${BACKUP_MIN_KDF_ITERATIONS} and ${BACKUP_MAX_KDF_ITERATIONS}.`
      );
    }

    const createdAt = options.createdAt ?? new Date().toISOString();
    validateIsoTimestampString(createdAt, 'createdAt');

    let serializedArchive: string;
    try {
      serializedArchive = JSON.stringify(archive);
    } catch {
      throw new BackupEncryptionError('Failed to serialize backup archive payload.');
    }

    const plaintextBytes = new TextEncoder().encode(serializedArchive);
    if (plaintextBytes.byteLength > BACKUP_MAX_PLAINTEXT_BYTES) {
      throw new BackupEncryptionError(
        `Backup payload exceeds maximum supported plaintext size of ${BACKUP_MAX_PLAINTEXT_BYTES} bytes.`
      );
    }

    const salt = cryptoApi.getRandomValues(new Uint8Array(BACKUP_SALT_BYTE_LENGTH));
    const iv = cryptoApi.getRandomValues(new Uint8Array(BACKUP_IV_BYTE_LENGTH));

    const saltBase64 = encodeBytesToBase64(salt);
    const ivBase64 = encodeBytesToBase64(iv);

    const kdf: BackupKdfHeader = {
      algorithm: BACKUP_KDF_ALGORITHM,
      hash: BACKUP_KDF_HASH,
      iterations
    };
    const cipher: BackupCipherHeader = {
      algorithm: BACKUP_CIPHER_ALGORITHM,
      keyLengthBits: BACKUP_CIPHER_KEY_LENGTH_BITS,
      tagLengthBits: BACKUP_CIPHER_TAG_LENGTH_BITS
    };

    const aadBytes = buildHeaderForAad({
      format: BACKUP_CONTAINER_FORMAT,
      formatVersion: BACKUP_CONTAINER_FORMAT_VERSION,
      createdAt,
      kdf,
      cipher,
      saltBase64,
      ivBase64
    });

    try {
      const aesKey = await deriveAesGcmKey(cryptoApi, passphrase, salt, iterations, 'encrypt');
      const ciphertextBuffer = await cryptoApi.subtle.encrypt(
        {
          name: BACKUP_CIPHER_ALGORITHM,
          iv: toArrayBuffer(iv),
          additionalData: toArrayBuffer(aadBytes),
          tagLength: BACKUP_CIPHER_TAG_LENGTH_BITS
        },
        aesKey,
        toArrayBuffer(plaintextBytes)
      );

      return {
        format: BACKUP_CONTAINER_FORMAT,
        formatVersion: BACKUP_CONTAINER_FORMAT_VERSION,
        createdAt,
        kdf,
        cipher,
        saltBase64,
        ivBase64,
        ciphertextBase64: encodeBytesToBase64(new Uint8Array(ciphertextBuffer))
      };
    } catch (error) {
      if (error instanceof BackupEncryptionError) {
        throw error;
      }
      throw new BackupEncryptionError('Web Crypto AES-GCM encryption failed.');
    }
  }

  public async decryptEnvelope(
    rawInput: string | EncryptedBackupEnvelope | unknown,
    passphrase: string
  ): Promise<BackupArchiveDocument> {
    const validated = parseAndValidateEncryptedEnvelope(rawInput);

    if (typeof passphrase !== 'string' || passphrase.trim().length === 0) {
      throw new BackupDecryptionError('Backup passphrase is required for decryption.');
    }

    let cryptoApi: Crypto;
    try {
      cryptoApi = getWebCrypto();
    } catch {
      throw new BackupDecryptionError(
        'Web Crypto API (crypto.subtle) is required for backup decryption but is unavailable.'
      );
    }

    let decryptedBuffer: ArrayBuffer;
    try {
      const aesKey = await deriveAesGcmKey(
        cryptoApi,
        passphrase,
        validated.salt,
        validated.envelope.kdf.iterations,
        'decrypt'
      );

      decryptedBuffer = await cryptoApi.subtle.decrypt(
        {
          name: BACKUP_CIPHER_ALGORITHM,
          iv: toArrayBuffer(validated.iv),
          additionalData: toArrayBuffer(validated.aadBytes),
          tagLength: BACKUP_CIPHER_TAG_LENGTH_BITS
        },
        aesKey,
        toArrayBuffer(validated.ciphertext)
      );
    } catch {
      throw new BackupDecryptionError();
    }

    let decryptedJson: string;
    try {
      decryptedJson = new TextDecoder('utf-8', { fatal: true }).decode(decryptedBuffer);
    } catch {
      throw new BackupDecryptionError('Decrypted backup payload did not contain valid UTF-8 data.');
    }

    let parsedArchive: unknown;
    try {
      parsedArchive = JSON.parse(decryptedJson);
    } catch {
      throw new BackupDecryptionError('Decrypted backup payload did not contain valid JSON.');
    }

    if (!isPlainRecord(parsedArchive)) {
      throw new BackupDecryptionError('Decrypted backup archive must be a JSON object.');
    }

    return parsedArchive as unknown as BackupArchiveDocument;
  }

  public validateEnvelope(rawInput: unknown): EncryptedBackupEnvelope {
    return parseAndValidateEncryptedEnvelope(rawInput).envelope;
  }
}

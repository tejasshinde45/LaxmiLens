import { describe, expect, it } from 'vitest';
import {
  AMBIGUOUS_UNASSIGNED_USER_ID,
  BACKUP_REPLACE_CONFIRMATION_TEXT,
  BackupArchiveDocument,
  BackupCategoryRecord,
  BackupRecordCounts,
  BuildBackupArchiveInput,
  CURRENT_DEXIE_SCHEMA_VERSION,
  QUARANTINE_USER_ID_PREFIX
} from '@/application/dto/BackupDTO';
import { computeCanonicalSha256Hex } from '@/application/services/BackupEncryptionService';
import { BackupValidationService } from '@/application/services/BackupValidationService';
import {
  BackupIntegrityError,
  BackupOwnershipMismatchError,
  BackupValidationError,
  UnsupportedBackupVersionError
} from '@/domain/errors/BackupErrors';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '99999999-9999-4999-8999-999999999999';

const ACC_BANK = '22222222-2222-4222-8222-222222222201';
const ACC_BORROWINGS = '22222222-2222-4222-8222-222222222202';

const CAT_EXPENSE = '33333333-3333-4333-8333-333333333301';
const CAT_INCOME = '33333333-3333-4333-8333-333333333302';

const TX_EXPENSE = '44444444-4444-4444-8444-444444444401';
const TX_BORROWING = '44444444-4444-4444-8444-444444444402';
const TX_REPAYMENT = '44444444-4444-4444-8444-444444444403';

const BUDGET_ID = '55555555-5555-4555-8555-555555555501';
const RULE_ID = '66666666-6666-4666-8666-666666666601';
const OCC_ID = '77777777-7777-4777-8777-777777777701';
const LENDER_ID = '88888888-8888-4888-8888-888888888801';
const BORROWING_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const REPAYMENT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const NOTIFICATION_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const CLOUD_CAT_ID = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';

function emptyCounts(): BackupRecordCounts {
  return {
    profile: 0,
    accounts: 0,
    categories: 0,
    transactions: 0,
    budgets: 0,
    recurringRules: 0,
    recurringOccurrences: 0,
    lenders: 0,
    borrowings: 0,
    borrowingRepayments: 0,
    notifications: 0,
    notificationPreferences: 0,
    categoryMappings: 0,
    pendingOutbox: 0
  };
}

function createValidBuildInput(): BuildBackupArchiveInput {
  return {
    userId: USER_A,
    email: 'usera@example.com',
    currency: 'INR',
    exportedAt: '2026-11-25T12:00:00.000Z',
    rawStoreData: {
      profile: {
        id: USER_A,
        email: 'usera@example.com',
        displayName: 'User A',
        currency: 'INR',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      },
      accounts: [
        {
          id: ACC_BANK,
          userId: USER_A,
          name: 'Primary Bank',
          accountType: 'bank',
          openingBalancePaise: -25000,
          currency: 'INR',
          isArchived: false,
          version: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        },
        {
          id: ACC_BORROWINGS,
          userId: USER_A,
          name: 'Personal Borrowings',
          accountType: 'other',
          openingBalancePaise: 0,
          currency: 'INR',
          systemTag: 'personal_borrowings',
          isArchived: false,
          version: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      categories: [
        {
          id: CAT_EXPENSE,
          userId: USER_A,
          name: 'Groceries & Household',
          type: 'expense',
          isDefault: true,
          isArchived: false,
          version: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        },
        {
          id: CAT_INCOME,
          userId: USER_A,
          name: 'Salary & Wages',
          type: 'income',
          isDefault: true,
          isArchived: false,
          version: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      transactions: [
        {
          id: TX_EXPENSE,
          userId: USER_A,
          type: 'expense',
          amountPaise: 15000,
          currency: 'INR',
          accountId: ACC_BANK,
          categoryId: CAT_EXPENSE,
          title: 'Weekly Vegetables',
          transactionDate: '2026-11-10T10:00:00.000Z',
          deletedAt: null,
          version: 1,
          deviceId: 'device-1',
          idempotencyKey: 'tx-exp-1',
          createdAt: '2026-11-10T10:00:00.000Z',
          updatedAt: '2026-11-10T10:00:00.000Z'
        },
        {
          id: TX_BORROWING,
          userId: USER_A,
          type: 'income',
          amountPaise: 100000,
          currency: 'INR',
          accountId: ACC_BORROWINGS,
          categoryId: CAT_INCOME,
          title: 'Loan from Friend',
          transactionDate: '2026-11-05T10:00:00.000Z',
          deletedAt: null,
          version: 1,
          idempotencyKey: 'tx-bor-1',
          createdAt: '2026-11-05T10:00:00.000Z',
          updatedAt: '2026-11-05T10:00:00.000Z'
        },
        {
          id: TX_REPAYMENT,
          userId: USER_A,
          type: 'transfer',
          amountPaise: 50000,
          currency: 'INR',
          accountId: ACC_BANK,
          destinationAccountId: ACC_BORROWINGS,
          title: 'Partial Repayment',
          transactionDate: '2026-11-15T10:00:00.000Z',
          deletedAt: null,
          version: 1,
          idempotencyKey: 'tx-rep-1',
          createdAt: '2026-11-15T10:00:00.000Z',
          updatedAt: '2026-11-15T10:00:00.000Z'
        }
      ],
      budgets: [
        {
          id: BUDGET_ID,
          userId: USER_A,
          categoryId: CAT_EXPENSE,
          period: '2026-11',
          limitPaise: 200000,
          version: 1,
          createdAt: '2026-11-01T00:00:00.000Z',
          updatedAt: '2026-11-01T00:00:00.000Z'
        }
      ],
      recurringRules: [
        {
          id: RULE_ID,
          userId: USER_A,
          title: 'Monthly Rent',
          type: 'expense',
          amountPaise: 1500000,
          accountId: ACC_BANK,
          categoryId: CAT_EXPENSE,
          frequency: 'monthly',
          interval: 1,
          anchorDayOfMonth: 5,
          startDate: '2026-01-05',
          nextDueDate: '2026-12-05',
          status: 'active',
          requiresUserConfirmation: true,
          version: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-11-05T00:00:00.000Z'
        }
      ],
      recurringOccurrences: [
        {
          id: OCC_ID,
          userId: USER_A,
          recurringRuleId: RULE_ID,
          occurrenceDate: '2026-11-05',
          status: 'confirmed',
          transactionId: TX_EXPENSE,
          idempotencyKey: `rec-${RULE_ID}-2026-11-05`,
          confirmedAt: '2026-11-05T09:00:00.000Z',
          version: 1,
          createdAt: '2026-11-01T00:00:00.000Z',
          updatedAt: '2026-11-05T09:00:00.000Z'
        }
      ],
      lenders: [
        {
          id: LENDER_ID,
          userId: USER_A,
          name: 'Rahul',
          isArchived: false,
          createdAt: '2026-11-05T00:00:00.000Z',
          updatedAt: '2026-11-05T00:00:00.000Z'
        }
      ],
      borrowings: [
        {
          id: BORROWING_ID,
          userId: USER_A,
          lenderId: LENDER_ID,
          amountPaise: 100000,
          borrowingDate: '2026-11-05',
          receivingAccountId: ACC_BORROWINGS,
          transactionId: TX_BORROWING,
          status: 'active',
          createdAt: '2026-11-05T00:00:00.000Z',
          updatedAt: '2026-11-05T00:00:00.000Z'
        }
      ],
      borrowingRepayments: [
        {
          id: REPAYMENT_ID,
          userId: USER_A,
          borrowingId: BORROWING_ID,
          lenderId: LENDER_ID,
          amountPaise: 50000,
          repaymentDate: '2026-11-15',
          paymentAccountId: ACC_BANK,
          transactionId: TX_REPAYMENT,
          createdAt: '2026-11-15T00:00:00.000Z',
          updatedAt: '2026-11-15T00:00:00.000Z'
        }
      ],
      notifications: [
        {
          id: NOTIFICATION_ID,
          userId: USER_A,
          category: 'budget_warning',
          severity: 'warning',
          status: 'unread',
          dedupeKey: 'budget-warn-2026-11',
          title: 'Budget Warning',
          message: 'Approaching budget limit',
          entityType: 'budget',
          entityId: BUDGET_ID,
          triggerDate: '2026-11-20',
          actionRoute: '/budgets',
          metadataJson: JSON.stringify({ budgetId: BUDGET_ID }),
          version: 1,
          createdAt: '2026-11-20T10:00:00.000Z',
          updatedAt: '2026-11-20T10:00:00.000Z'
        }
      ],
      notificationPreferences: [
        {
          userId: USER_A,
          recurringPaymentEnabled: true,
          budgetWarningEnabled: true,
          budgetExceededEnabled: false,
          upcomingLeadDays: 5,
          version: 2,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-11-10T00:00:00.000Z'
        }
      ],
      syncMetadata: [
        {
          key: `cat_map:${USER_A}:${CAT_EXPENSE}`,
          value: CLOUD_CAT_ID,
          updatedAt: '2026-11-01T00:00:00.000Z'
        },
        {
          key: `cat_rev:${USER_A}:${CLOUD_CAT_ID}`,
          value: CAT_EXPENSE,
          updatedAt: '2026-11-01T00:00:00.000Z'
        },
        {
          key: `legacy_migration_${USER_A}`,
          value: 'completed',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      pendingOutbox: [
        {
          id: 42,
          userId: USER_A,
          entity: 'transactions',
          entityId: TX_EXPENSE,
          operation: 'INSERT',
          payload: { id: TX_EXPENSE, amount_paise: 15000 },
          idempotencyKey: 'tx-exp-1',
          attempts: 4,
          lastAttemptAt: '2026-11-20T11:00:00.000Z',
          lastError: 'Network offline',
          createdAt: '2026-11-10T10:00:00.000Z'
        }
      ]
    }
  };
}

async function resignChecksum(archive: BackupArchiveDocument): Promise<BackupArchiveDocument> {
  return {
    ...archive,
    manifest: {
      ...archive.manifest,
      integrity: {
        ...archive.manifest.integrity,
        payloadSha256Hex: await computeCanonicalSha256Hex(archive.data)
      }
    }
  };
}

describe('BackupValidationService', () => {
  const service = new BackupValidationService();

  it('builds sanitized Dexie v8 archive: omits foreign/legacy metadata, discloses quarantined records, strips outbox transient fields', async () => {
    const input = createValidBuildInput();
    input.rawStoreData.accounts = [
      ...(input.rawStoreData.accounts ?? []),
      {
        id: '22222222-2222-4222-8222-222222222298',
        userId: `${QUARANTINE_USER_ID_PREFIX}unresolved-ownership`,
        name: 'Quarantined Account',
        accountType: 'cash',
        openingBalancePaise: 100,
        currency: 'INR',
        isArchived: false,
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      },
      {
        id: '22222222-2222-4222-8222-222222222299',
        userId: USER_B,
        name: 'Foreign User Account',
        accountType: 'cash',
        openingBalancePaise: 999,
        currency: 'INR',
        isArchived: false,
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    ];
    input.rawStoreData.transactions = [
      ...(input.rawStoreData.transactions ?? []),
      {
        id: '44444444-4444-4444-8444-444444444499',
        userId: AMBIGUOUS_UNASSIGNED_USER_ID,
        type: 'expense',
        amountPaise: 500,
        currency: 'INR',
        accountId: ACC_BANK,
        title: 'Ambiguous Tx',
        transactionDate: '2026-01-01T00:00:00.000Z',
        deletedAt: null,
        version: 1,
        idempotencyKey: 'amb-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    ];
    input.rawStoreData.syncMetadata = [
      ...(input.rawStoreData.syncMetadata ?? []),
      {
        key: `cat_map:${USER_B}:${CAT_EXPENSE}`,
        value: CLOUD_CAT_ID,
        updatedAt: '2026-11-01T00:00:00.000Z'
      }
    ];

    const archive = await service.buildSanitizedArchive(input);

    expect(archive.manifest.dexieSchemaVersion).toBe(CURRENT_DEXIE_SCHEMA_VERSION);
    expect(archive.manifest.dexieSchemaVersion).toBe(8);
    expect(archive.manifest.counts.accounts).toBe(2);
    expect(archive.manifest.counts.transactions).toBe(3);
    expect(archive.manifest.excludedQuarantinedCounts.accounts).toBe(1);
    expect(archive.manifest.excludedQuarantinedCounts.transactions).toBe(1);
    expect(archive.manifest.excludedQuarantinedCounts.total).toBe(2);

    // Foreign user B's account and category mapping are completely absent
    expect(archive.data.accounts.every((a) => a.userId === USER_A)).toBe(true);
    expect(archive.data.categoryMappings).toHaveLength(2);
    expect(archive.data.categoryMappings.every((m) => m.key.includes(USER_A))).toBe(true);

    // Outbox local id/lastError/lastAttemptAt stripped and attempts reset to 0
    expect(archive.data.pendingOutbox).toHaveLength(1);
    const outboxEntry = archive.data.pendingOutbox[0] as unknown as Record<string, unknown>;
    expect(outboxEntry.id).toBeUndefined();
    expect(outboxEntry.lastError).toBeUndefined();
    expect(outboxEntry.lastAttemptAt).toBeUndefined();
    expect(outboxEntry.attempts).toBe(0);
    expect(outboxEntry.idempotencyKey).toBe('tx-exp-1');

    // Validated cleanly for restore preview with quarantine disclosure warning
    const preview = await service.validateForRestore(archive, {
      authenticatedUserId: USER_A,
      mode: 'empty',
      targetSummary: {
        authenticatedUserId: USER_A,
        currentDexieSchemaVersion: 8,
        existingCounts: emptyCounts()
      }
    });

    expect(preview.valid).toBe(true);
    expect(preview.excludedQuarantinedCounts.total).toBe(2);
    expect(preview.pendingOutboxToRestoreCount).toBe(1);
    expect(preview.warnings.some((w) => w.includes('2 quarantined or ambiguous'))).toBe(true);
  });

  it('rejects backups owned by another user account', async () => {
    const archive = await service.buildSanitizedArchive(createValidBuildInput());

    await expect(
      service.validateForRestore(archive, { authenticatedUserId: USER_B })
    ).rejects.toThrow(BackupOwnershipMismatchError);
  });

  it('rejects backups exported from newer unsupported Dexie schema versions', async () => {
    const archive = await service.buildSanitizedArchive(createValidBuildInput());
    archive.manifest.dexieSchemaVersion = CURRENT_DEXIE_SCHEMA_VERSION + 1;

    await expect(
      service.validateForRestore(archive, {
        authenticatedUserId: USER_A,
        currentDexieSchemaVersion: CURRENT_DEXIE_SCHEMA_VERSION
      })
    ).rejects.toThrow(UnsupportedBackupVersionError);
  });

  it('rejects archives whose SHA-256 payload checksum or manifest counts are tampered', async () => {
    const archive = await service.buildSanitizedArchive(createValidBuildInput());
    archive.data.accounts[0]!.openingBalancePaise = 9999999;

    await expect(
      service.validateForRestore(archive, { authenticatedUserId: USER_A })
    ).rejects.toThrow(BackupIntegrityError);

    const archiveWithBadCount = await service.buildSanitizedArchive(createValidBuildInput());
    archiveWithBadCount.manifest.counts.accounts = 99;
    await expect(
      service.validateForRestore(archiveWithBadCount, { authenticatedUserId: USER_A })
    ).rejects.toThrow(BackupIntegrityError);
  });

  it('rejects invalid financial integer amounts (floats, zero/negative transaction or budget limits)', async () => {
    const baseArchive = await service.buildSanitizedArchive(createValidBuildInput());
    baseArchive.data.transactions[0]!.amountPaise = 125.5;
    const resigned = await resignChecksum(baseArchive);

    await expect(
      service.validateForRestore(resigned, { authenticatedUserId: USER_A })
    ).rejects.toThrow(BackupValidationError);
  });

  it('rejects broken referential integrity and category type mismatches across transactions and budgets', async () => {
    // 1. Missing category reference on transaction
    const missingCatArchive = await service.buildSanitizedArchive(createValidBuildInput());
    missingCatArchive.data.transactions[0]!.categoryId = '00000000-0000-4000-8000-000000000999';
    await expect(
      service.validateForRestore(await resignChecksum(missingCatArchive), {
        authenticatedUserId: USER_A
      })
    ).rejects.toThrow(BackupValidationError);

    // 2. Category type mismatch (expense transaction referencing income category)
    const typeMismatchArchive = await service.buildSanitizedArchive(createValidBuildInput());
    typeMismatchArchive.data.transactions[0]!.categoryId = CAT_INCOME;
    await expect(
      service.validateForRestore(await resignChecksum(typeMismatchArchive), {
        authenticatedUserId: USER_A
      })
    ).rejects.toThrow(BackupValidationError);

    // 3. Budget referencing non-expense category
    const budgetTypeArchive = await service.buildSanitizedArchive(createValidBuildInput());
    budgetTypeArchive.data.budgets[0]!.categoryId = CAT_INCOME;
    await expect(
      service.validateForRestore(await resignChecksum(budgetTypeArchive), {
        authenticatedUserId: USER_A
      })
    ).rejects.toThrow(BackupValidationError);

    // 4. Broken borrowing repayment -> missing parent borrowing
    const orphanRepaymentArchive = await service.buildSanitizedArchive(createValidBuildInput());
    orphanRepaymentArchive.data.borrowingRepayments[0]!.borrowingId =
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa999';
    await expect(
      service.validateForRestore(await resignChecksum(orphanRepaymentArchive), {
        authenticatedUserId: USER_A
      })
    ).rejects.toThrow(BackupValidationError);
  });

  it('handles freshly initialized local databases with seeded default categories cleanly without name-only blind assumptions', async () => {
    const archive = await service.buildSanitizedArchive(createValidBuildInput());

    const newlySeededTargetCategories: BackupCategoryRecord[] = [
      {
        id: '33333333-3333-4333-8333-999999999901',
        userId: USER_A,
        name: 'Groceries & Household',
        type: 'expense',
        isDefault: true,
        isArchived: false,
        version: 1,
        createdAt: '2026-11-25T11:00:00.000Z',
        updatedAt: '2026-11-25T11:00:00.000Z'
      },
      {
        id: '33333333-3333-4333-8333-999999999902',
        userId: USER_A,
        name: 'Salary & Wages',
        type: 'income',
        isDefault: true,
        isArchived: false,
        version: 1,
        createdAt: '2026-11-25T11:00:00.000Z',
        updatedAt: '2026-11-25T11:00:00.000Z'
      }
    ];

    const counts = emptyCounts();
    counts.categories = 2;

    const preview = await service.validateForRestore(archive, {
      authenticatedUserId: USER_A,
      mode: 'empty',
      targetSummary: {
        authenticatedUserId: USER_A,
        currentDexieSchemaVersion: 8,
        existingCounts: counts,
        existingCategories: newlySeededTargetCategories
      }
    });

    expect(preview.modeCompatibility.canRestoreIntoEmpty).toBe(true);
    expect(preview.modeCompatibility.targetHasOnlyDefaultCategories).toBe(true);
    expect(preview.defaultCategorySummary.matchedDefaultIdsCount).toBe(0);
    expect(preview.defaultCategorySummary.conflictingDefaultIdsCount).toBe(2);
    expect(preview.categoryIdentityContract.matchingStrategy).toBe('uuid-and-sync-mapping-only');
    expect(preview.categoryIdentityContract.nameOnlyMatchingPermitted).toBe(false);
    expect(preview.categoryIdentityContract.preservesBackupCategoryUuids).toBe(true);
    expect(preview.categoryIdentityContract.targetDefaultReconciliationAction).toBe(
      'replace_unused_seeded_defaults'
    );
    expect(preview.categoryIdentityContract.unresolvedSeededDefaultCategoryIds).toEqual([
      '33333333-3333-4333-8333-999999999901',
      '33333333-3333-4333-8333-999999999902'
    ]);
    expect(preview.warnings.some((w) => w.includes('freshly seeded default categories'))).toBe(true);
  });

  it('rejects ambiguous categoryMappings and conflicting target category identity collisions while preserving identical default UUIDs', async () => {
    // 1. Ambiguous forward cat_map claiming same cloud UUID twice
    const ambiguousMapArchive = await service.buildSanitizedArchive(createValidBuildInput());
    ambiguousMapArchive.data.categoryMappings.push({
      key: `cat_map:${USER_A}:${CAT_INCOME}`,
      value: CLOUD_CAT_ID,
      updatedAt: '2026-11-01T00:00:00.000Z'
    });
    ambiguousMapArchive.manifest.counts.categoryMappings =
      ambiguousMapArchive.data.categoryMappings.length;
    await expect(
      service.validateForRestore(await resignChecksum(ambiguousMapArchive), {
        authenticatedUserId: USER_A
      })
    ).rejects.toThrow(BackupValidationError);

    // 2. Forward / reverse cat_map <-> cat_rev asymmetry
    const asymmetricMapArchive = await service.buildSanitizedArchive(createValidBuildInput());
    asymmetricMapArchive.data.categoryMappings[1]!.value = CAT_INCOME;
    await expect(
      service.validateForRestore(await resignChecksum(asymmetricMapArchive), {
        authenticatedUserId: USER_A
      })
    ).rejects.toThrow(BackupValidationError);

    // 3. Dangling cat_map referencing nonexistent local category
    const danglingMapArchive = await service.buildSanitizedArchive(createValidBuildInput());
    danglingMapArchive.data.categoryMappings.push({
      key: `cat_map:${USER_A}:33333333-3333-4333-8333-000000000999`,
      value: 'dddddddd-dddd-4ddd-8ddd-000000000999',
      updatedAt: '2026-11-01T00:00:00.000Z'
    });
    danglingMapArchive.manifest.counts.categoryMappings =
      danglingMapArchive.data.categoryMappings.length;
    await expect(
      service.validateForRestore(await resignChecksum(danglingMapArchive), {
        authenticatedUserId: USER_A
      })
    ).rejects.toThrow(BackupValidationError);

    // 4. Same category UUID colliding with conflicting type in target DB
    const validArchive = await service.buildSanitizedArchive(createValidBuildInput());
    const counts = emptyCounts();
    counts.categories = 1;
    await expect(
      service.validateForRestore(validArchive, {
        authenticatedUserId: USER_A,
        mode: 'empty',
        targetSummary: {
          authenticatedUserId: USER_A,
          currentDexieSchemaVersion: 8,
          existingCounts: counts,
          existingCategories: [
            {
              id: CAT_EXPENSE,
              userId: USER_A,
              name: 'Groceries & Household',
              type: 'income',
              isDefault: true,
              isArchived: false,
              version: 1,
              createdAt: '2026-11-25T11:00:00.000Z',
              updatedAt: '2026-11-25T11:00:00.000Z'
            }
          ]
        }
      })
    ).rejects.toThrow(BackupValidationError);

    // 5. Identical default UUIDs -> preserve_identical_uuids (even if renamed)
    const identicalUuidCounts = emptyCounts();
    identicalUuidCounts.categories = 2;
    const identicalPreview = await service.validateForRestore(validArchive, {
      authenticatedUserId: USER_A,
      mode: 'empty',
      targetSummary: {
        authenticatedUserId: USER_A,
        currentDexieSchemaVersion: 8,
        existingCounts: identicalUuidCounts,
        existingCategories: [
          {
            id: CAT_EXPENSE,
            userId: USER_A,
            name: 'Renamed Household Groceries',
            type: 'expense',
            isDefault: true,
            isArchived: false,
            version: 2,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-11-25T11:00:00.000Z'
          },
          {
            id: CAT_INCOME,
            userId: USER_A,
            name: 'Salary & Wages',
            type: 'income',
            isDefault: true,
            isArchived: false,
            version: 1,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-11-25T11:00:00.000Z'
          }
        ]
      }
    });

    expect(identicalPreview.defaultCategorySummary.matchedDefaultIdsCount).toBe(2);
    expect(identicalPreview.categoryIdentityContract.targetDefaultReconciliationAction).toBe(
      'preserve_identical_uuids'
    );
    expect(identicalPreview.categoryIdentityContract.unresolvedSeededDefaultCategoryIds).toEqual(
      []
    );
  });

  it('enforces replace confirmation and blocks empty mode when target holds user financial data', async () => {
    const archive = await service.buildSanitizedArchive(createValidBuildInput());
    const nonEmptyCounts = emptyCounts();
    nonEmptyCounts.accounts = 1;
    nonEmptyCounts.transactions = 3;

    const targetSummary = {
      authenticatedUserId: USER_A,
      currentDexieSchemaVersion: 8,
      existingCounts: nonEmptyCounts
    };

    // Blocks 'empty' mode
    await expect(
      service.validateForRestore(archive, {
        authenticatedUserId: USER_A,
        mode: 'empty',
        targetSummary
      })
    ).rejects.toThrow(BackupValidationError);

    // Rejects unsupported mode like 'merge'
    await expect(
      service.validateForRestore(archive, {
        authenticatedUserId: USER_A,
        mode: 'merge' as unknown as 'replace',
        targetSummary
      })
    ).rejects.toThrow(BackupValidationError);

    // Blocks 'replace' without exact 'REPLACE' confirmation
    await expect(
      service.validateForRestore(archive, {
        authenticatedUserId: USER_A,
        mode: 'replace',
        confirmationText: 'YES',
        safetyBackupConfirmed: true,
        targetSummary
      })
    ).rejects.toThrow(BackupValidationError);

    // Blocks 'replace' without safety backup confirmation
    await expect(
      service.validateForRestore(archive, {
        authenticatedUserId: USER_A,
        mode: 'replace',
        confirmationText: BACKUP_REPLACE_CONFIRMATION_TEXT,
        safetyBackupConfirmed: false,
        targetSummary
      })
    ).rejects.toThrow(BackupValidationError);

    // Succeeds when both confirmations are provided
    const replacePreview = await service.validateForRestore(archive, {
      authenticatedUserId: USER_A,
      mode: 'replace',
      confirmationText: BACKUP_REPLACE_CONFIRMATION_TEXT,
      safetyBackupConfirmed: true,
      restorePendingOutbox: false,
      targetSummary
    });

    expect(replacePreview.valid).toBe(true);
    expect(replacePreview.modeCompatibility.requiresReplaceConfirmation).toBe(true);
    expect(replacePreview.pendingOutboxToRestoreCount).toBe(0);
    expect(replacePreview.warnings.some((w) => w.includes('will not be restored'))).toBe(true);
  });

  it('rejects quarantined records illegally injected into restorable payload arrays', async () => {
    const archive = await service.buildSanitizedArchive(createValidBuildInput());
    archive.data.lenders.push({
      id: '88888888-8888-4888-8888-888888888899',
      userId: `${QUARANTINE_USER_ID_PREFIX}invalid-data`,
      name: 'Poison Lender',
      isArchived: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    });
    archive.manifest.counts.lenders = archive.data.lenders.length;
    const resigned = await resignChecksum(archive);

    await expect(
      service.validateForRestore(resigned, { authenticatedUserId: USER_A })
    ).rejects.toThrow(BackupIntegrityError);
  });
});

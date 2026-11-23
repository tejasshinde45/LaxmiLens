import Dexie, { type Table } from 'dexie';
import { APP_CONFIG } from '@/config/constants';
import { isValidUuid } from '@/domain/value-objects/Identifiers';
import {
  LocalProfileRecord,
  LocalAccountRecord,
  LocalTransactionRecord,
  LocalCategoryRecord,
  LocalBudgetRecord,
  LocalRecurringRuleRecord,
  LocalOutboxRecord,
  LocalSyncMetadataRecord
} from './schema';

export class LaxmiLensDB extends Dexie {
  public profiles!: Table<LocalProfileRecord, string>;
  public accounts!: Table<LocalAccountRecord, string>;
  public transactions!: Table<LocalTransactionRecord, string>;
  public categories!: Table<LocalCategoryRecord, string>;
  public budgets!: Table<LocalBudgetRecord, string>;
  public recurringRules!: Table<LocalRecurringRuleRecord, string>;
  public syncOutbox!: Table<LocalOutboxRecord, number>;
  public syncMetadata!: Table<LocalSyncMetadataRecord, string>;

  constructor(dbName: string = APP_CONFIG.database.name) {
    super(dbName);

    // Graceful handling of cross-tab version changes to prevent blocked upgrades
    this.on('versionchange', () => {
      this.close();
      return false;
    });
    this.on('blocked', () => {
      console.warn(`Dexie database '${this.name}' upgrade was blocked by another open connection.`);
    });

    // Initial Schema Version 1
    this.version(1).stores({
      accounts: 'id, type, status, version, createdAt',
      transactions: 'id, type, accountId, targetAccountId, categoryId, date, status, idempotencyKey, version, isDeleted, [accountId+date]',
      categories: 'id, type, parentId, isSystem, version',
      budgets: 'id, categoryId, period, [categoryId+period], version',
      recurringRules: 'id, frequency, isActive, nextDueDate, version',
      syncOutbox: '++id, entity, entityId, operation, idempotencyKey, attempts, createdAt',
      syncMetadata: 'key, updatedAt'
    });

    // Version 2: Core Financial Foundation (Milestone 3)
    this.version(2)
      .stores({
        profiles: 'id, email, currency',
        accounts: 'id, userId, accountType, isArchived, version, createdAt',
        transactions:
          'id, userId, type, accountId, destinationAccountId, categoryId, transactionDate, deletedAt, idempotencyKey, version, [accountId+transactionDate], [userId+transactionDate]',
        categories: 'id, userId, type, isArchived, isDefault, version',
        budgets: 'id, categoryId, period, [categoryId+period], version',
        recurringRules: 'id, frequency, isActive, nextDueDate, version',
        syncOutbox: '++id, entity, entityId, operation, idempotencyKey, attempts, createdAt',
        syncMetadata: 'key, updatedAt'
      })
      .upgrade((tx) => {
        // Upgrade existing local data without data loss
        return Promise.all([
          tx
            .table('accounts')
            .toCollection()
            .modify((acc: LocalAccountRecord) => {
              acc.userId = acc.userId || 'local-user';
              acc.accountType =
                acc.accountType || (acc.type as LocalAccountRecord['accountType']) || 'other';
              acc.openingBalancePaise =
                acc.openingBalancePaise ?? acc.openingBalanceInPaise ?? 0;
              acc.isArchived = acc.isArchived ?? (acc.status === 'archived');
            }),
          tx
            .table('categories')
            .toCollection()
            .modify((cat: LocalCategoryRecord) => {
              cat.userId = cat.userId || 'local-user';
              cat.isDefault = cat.isDefault ?? cat.isSystem ?? false;
              cat.isArchived = cat.isArchived ?? false;
            }),
          tx
            .table('transactions')
            .toCollection()
            .modify((t: LocalTransactionRecord) => {
              t.userId = t.userId || 'local-user';
              t.amountPaise = t.amountPaise ?? t.amountInPaise ?? 0;
              t.title = t.title || t.description || 'Transaction';
              t.note = t.note ?? t.notes;
              t.transactionDate = t.transactionDate || t.date || new Date().toISOString();
              t.destinationAccountId = t.destinationAccountId || t.targetAccountId;
              t.deletedAt = t.deletedAt ?? (t.isDeleted ? new Date().toISOString() : null);
            })
        ]);
      });

    // Version 3: User-Scoped Outbox Foundation (Phase 2D.7.1 & 2D.7.1.1 Hardening)
    this.version(3)
      .stores({
        syncOutbox:
          '++id, userId, entity, entityId, operation, idempotencyKey, attempts, createdAt, [userId+id], [userId+entity]'
      })
      .upgrade(async (tx) => {
        // Upgrade existing local outbox records to guarantee ownership integrity safely and idempotently
        await tx
          .table('syncOutbox')
          .toCollection()
          .modify((record: LocalOutboxRecord) => {
            // 1. Check if record already carries a recognized quarantine tag (idempotency)
            if (
              typeof record.userId === 'string' &&
              (record.userId.startsWith('quarantine-') || record.userId === 'ambiguous-unassigned')
            ) {
              return;
            }

            // 2. Extract and validate all potential ownership sources
            const payload = (record.payload || {}) as Record<string, unknown>;

            const topLevelUuid =
              typeof record.userId === 'string' && isValidUuid(record.userId)
                ? record.userId.trim().toLowerCase()
                : undefined;

            const payloadSnakeUuid =
              typeof payload.user_id === 'string' && isValidUuid(payload.user_id)
                ? payload.user_id.trim().toLowerCase()
                : undefined;

            const payloadCamelUuid =
              typeof payload.userId === 'string' && isValidUuid(payload.userId)
                ? payload.userId.trim().toLowerCase()
                : undefined;

            // 3. Check for malformed (non-UUID) ownership indicators in historical records (e.g. 'local-user')
            const hasMalformedTopLevel =
              typeof record.userId === 'string' &&
              record.userId.trim() !== '' &&
              !topLevelUuid;

            const hasMalformedPayload =
              (typeof payload.user_id === 'string' &&
                payload.user_id.trim() !== '' &&
                !payloadSnakeUuid) ||
              (typeof payload.userId === 'string' &&
                payload.userId.trim() !== '' &&
                !payloadCamelUuid);

            // 4. Check for conflicts across available valid UUID sources
            const validSources = [
              topLevelUuid,
              payloadSnakeUuid,
              payloadCamelUuid
            ].filter((s): s is string => Boolean(s));

            const hasConflict =
              validSources.length > 1 &&
              validSources.some((src) => src !== validSources[0]);

            if (hasConflict) {
              // Conflicting ownership between top-level, payload.user_id, or payload.userId
              record.userId = 'quarantine-conflicting-ownership';
              return;
            }

            if (validSources.length > 0) {
              // At least one valid UUID source exists and they all agree
              record.userId = validSources[0];
              return;
            }

            // 5. If no valid UUID was found (missing, empty, or malformed non-UUID such as 'local-user')
            if (hasMalformedTopLevel || hasMalformedPayload) {
              record.userId = 'quarantine-malformed-ownership';
            } else {
              record.userId = 'ambiguous-unassigned';
            }
          });
      });

    // Version 4: User-Scoped Local Repository Isolation (Phase 2D.7.2)
    this.version(4)
      .stores({
        accounts:
          'id, userId, accountType, isArchived, version, createdAt, [userId+id], [userId+isArchived]',
        transactions:
          'id, userId, type, accountId, destinationAccountId, categoryId, transactionDate, deletedAt, idempotencyKey, version, [accountId+transactionDate], [userId+transactionDate], [userId+id], [userId+accountId]',
        categories:
          'id, userId, type, isArchived, isDefault, version, [userId+id], [userId+type]'
      })
      .upgrade((_tx) => {
        // Compound indexes are built automatically by Dexie during store upgrade.
        // All existing historical records across all accounts, transactions, and categories
        // are preserved strictly without data loss, re-assignment, or partition clearing.
      });
  }
}

// Singleton local database instance
export const db = new LaxmiLensDB();

import { Budget, BUDGET_PERIOD_REGEX } from '@/domain/entities/Budget';
import {
  createBudgetId,
  createCategoryId,
  isValidUuid,
  validateUserId
} from '@/domain/value-objects/Identifiers';
import { InvalidUserIdError } from '@/domain/errors/DomainErrors';
import {
  InvalidBudgetLimitError,
  InvalidBudgetPeriodError
} from '@/domain/errors/BudgetErrors';
import { LocalBudgetRecord } from '@/infrastructure/database/local/schema';

export interface CloudBudgetRow {
  id: string; // UUID
  user_id: string; // UUID
  category_id: string; // UUID
  period: string; // YYYY-MM
  limit_paise: number; // BIGINT > 0
  version: number; // INT >= 1
  created_at?: string; // TIMESTAMPTZ
  updated_at?: string; // TIMESTAMPTZ
  deleted_at: string | null; // TIMESTAMPTZ or null
}

export class BudgetMapper {
  /**
   * Validates all structural, financial, and temporal fields of a CloudBudgetRow.
   * Rejects malformed cloud records instead of silently defaulting invalid values.
   */
  public static validateCloudRow(row: CloudBudgetRow): void {
    if (!row || typeof row !== 'object') {
      throw new Error('Malformed cloud budget row: expected object.');
    }
    if (typeof row.id !== 'string' || !isValidUuid(row.id)) {
      throw new Error(`Invalid cloud budget ID '${row.id}': must be a valid UUID.`);
    }
    validateUserId(row.user_id);

    if (typeof row.category_id !== 'string' || !isValidUuid(row.category_id)) {
      throw new Error(`Invalid cloud budget category_id '${row.category_id}': must be a valid UUID.`);
    }
    if (typeof row.period !== 'string' || !BUDGET_PERIOD_REGEX.test(row.period.trim())) {
      throw new InvalidBudgetPeriodError(
        `Invalid cloud budget period '${row.period}'. Expected format YYYY-MM with valid month (01-12).`
      );
    }
    if (
      typeof row.limit_paise !== 'number' ||
      !Number.isSafeInteger(row.limit_paise) ||
      row.limit_paise <= 0
    ) {
      throw new InvalidBudgetLimitError(
        `Invalid cloud budget limit_paise '${row.limit_paise}': must be a positive safe integer in paise.`
      );
    }
    if (
      typeof row.version !== 'number' ||
      !Number.isSafeInteger(row.version) ||
      row.version < 1
    ) {
      throw new Error(`Invalid cloud budget version '${row.version}': must be a positive integer >= 1.`);
    }

    if (row.created_at !== undefined) {
      const created = new Date(row.created_at);
      if (isNaN(created.getTime())) {
        throw new Error(`Invalid cloud budget created_at '${row.created_at}'.`);
      }
    }
    if (row.updated_at !== undefined) {
      const updated = new Date(row.updated_at);
      if (isNaN(updated.getTime())) {
        throw new Error(`Invalid cloud budget updated_at '${row.updated_at}'.`);
      }
    }
    if (row.deleted_at !== null && row.deleted_at !== undefined) {
      const deleted = new Date(row.deleted_at);
      if (isNaN(deleted.getTime())) {
        throw new Error(`Invalid cloud budget deleted_at '${row.deleted_at}'.`);
      }
    }
  }

  /**
   * Converts an active CloudBudgetRow to the domain Budget entity.
   * Rejects tombstoned or malformed cloud rows.
   */
  public static toDomain(row: CloudBudgetRow): Budget {
    this.validateCloudRow(row);

    if (row.deleted_at !== null && row.deleted_at !== undefined) {
      throw new Error(`Cannot map tombstoned cloud budget '${row.id}' to an active Budget domain entity.`);
    }

    return new Budget({
      id: createBudgetId(row.id.trim()),
      userId: validateUserId(row.user_id),
      categoryId: createCategoryId(row.category_id.trim()),
      period: row.period.trim(),
      limitPaise: row.limit_paise,
      version: row.version,
      createdAt: row.created_at ? new Date(row.created_at) : undefined,
      updatedAt: row.updated_at ? new Date(row.updated_at) : undefined
    });
  }

  /**
   * Converts an active CloudBudgetRow to a canonical Dexie LocalBudgetRecord.
   */
  public static toLocalRecord(
    row: CloudBudgetRow,
    resolvedLocalCategoryId?: string
  ): LocalBudgetRecord {
    this.validateCloudRow(row);

    if (row.deleted_at !== null && row.deleted_at !== undefined) {
      throw new Error(`Cannot map tombstoned cloud budget '${row.id}' to a local active record.`);
    }

    const categoryId = resolvedLocalCategoryId ?? row.category_id.trim();
    if (!isValidUuid(categoryId)) {
      throw new Error(`Invalid resolved local category ID '${categoryId}'.`);
    }

    const nowIso = new Date().toISOString();
    return {
      id: row.id.trim(),
      userId: validateUserId(row.user_id),
      categoryId,
      period: row.period.trim(),
      limitPaise: row.limit_paise,
      version: row.version,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : nowIso,
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : nowIso
    };
  }

  /**
   * Converts a domain Budget entity to a canonical CloudBudgetRow.
   */
  public static toCloud(budget: Budget): CloudBudgetRow {
    if (!Number.isSafeInteger(budget.limitPaise) || budget.limitPaise <= 0) {
      throw new InvalidBudgetLimitError();
    }

    return {
      id: budget.id,
      user_id: budget.userId,
      category_id: budget.categoryId,
      period: budget.period,
      limit_paise: budget.limitPaise,
      version: budget.version,
      created_at: budget.createdAt.toISOString(),
      updated_at: budget.updatedAt.toISOString(),
      deleted_at: null
    };
  }

  /**
   * Maps an outbox INSERT payload to a validated CloudBudgetRow.
   */
  public static mapCreatePayload(payload: Record<string, unknown>): CloudBudgetRow {
    const id = payload.id;
    if (typeof id !== 'string' || !isValidUuid(id)) {
      throw new Error(`Invalid budget ID '${id}': must be a valid UUID.`);
    }

    const userId = payload.user_id ?? payload.userId;
    if (typeof userId !== 'string' || !isValidUuid(userId)) {
      throw new InvalidUserIdError(`Invalid user ID '${userId}': must be a valid UUID.`);
    }

    const categoryId = payload.category_id ?? payload.categoryId;
    if (typeof categoryId !== 'string' || !isValidUuid(categoryId)) {
      throw new Error(`Invalid category ID '${categoryId}': must be a valid UUID.`);
    }

    const rawPeriod = payload.period;
    if (typeof rawPeriod !== 'string' || !BUDGET_PERIOD_REGEX.test(rawPeriod.trim())) {
      throw new InvalidBudgetPeriodError(
        `Invalid budget period '${rawPeriod}'. Expected format YYYY-MM with valid month (01-12).`
      );
    }

    const rawLimit = payload.limit_paise ?? payload.limitPaise;
    if (
      typeof rawLimit !== 'number' ||
      !Number.isSafeInteger(rawLimit) ||
      rawLimit <= 0
    ) {
      throw new InvalidBudgetLimitError(
        `Budget limit_paise '${rawLimit}' must be a strictly positive safe integer in paise.`
      );
    }

    let version = 1;
    if (payload.version !== undefined) {
      if (
        typeof payload.version !== 'number' ||
        !Number.isSafeInteger(payload.version) ||
        payload.version < 1
      ) {
        throw new Error(`Invalid budget version '${payload.version}': must be a positive integer >= 1.`);
      }
      version = payload.version;
    }

    const row: CloudBudgetRow = {
      id: id.trim(),
      user_id: userId.trim(),
      category_id: categoryId.trim(),
      period: rawPeriod.trim(),
      limit_paise: rawLimit,
      version,
      deleted_at: null
    };

    if (payload.created_at !== undefined) {
      if (typeof payload.created_at !== 'string' || isNaN(new Date(payload.created_at).getTime())) {
        throw new Error(`Invalid created_at '${payload.created_at}' in budget create payload.`);
      }
      row.created_at = new Date(payload.created_at).toISOString();
    }

    if (payload.updated_at !== undefined) {
      if (typeof payload.updated_at !== 'string' || isNaN(new Date(payload.updated_at).getTime())) {
        throw new Error(`Invalid updated_at '${payload.updated_at}' in budget create payload.`);
      }
      row.updated_at = new Date(payload.updated_at).toISOString();
    }

    return row;
  }

  /**
   * Maps an outbox UPDATE payload to a partial CloudBudgetRow.
   * Strips immutable identity fields (id, user_id, category_id, period, created_at, deleted_at).
   */
  public static mapUpdatePayload(payload: Record<string, unknown>): Partial<CloudBudgetRow> {
    const patch: Partial<CloudBudgetRow> = {};

    if (payload.version !== undefined) {
      if (
        typeof payload.version !== 'number' ||
        !Number.isSafeInteger(payload.version) ||
        payload.version < 2
      ) {
        throw new Error(`Invalid target version '${payload.version}' in budget update payload.`);
      }
      patch.version = payload.version;
    }

    const rawLimit = payload.limit_paise ?? payload.limitPaise;
    if (rawLimit !== undefined) {
      if (
        typeof rawLimit !== 'number' ||
        !Number.isSafeInteger(rawLimit) ||
        rawLimit <= 0
      ) {
        throw new InvalidBudgetLimitError(
          `Budget limit_paise '${rawLimit}' must be a strictly positive safe integer in paise.`
        );
      }
      patch.limit_paise = rawLimit;
    }

    if (patch.limit_paise === undefined) {
      throw new InvalidBudgetLimitError('Budget update payload must supply a valid positive integer limit_paise.');
    }

    if (payload.updated_at !== undefined) {
      if (typeof payload.updated_at !== 'string' || isNaN(new Date(payload.updated_at).getTime())) {
        throw new Error(`Invalid updated_at '${payload.updated_at}' in budget update payload.`);
      }
      patch.updated_at = new Date(payload.updated_at).toISOString();
    } else {
      patch.updated_at = new Date().toISOString();
    }

    // Enforce immutability at mapper boundary
    delete (patch as Record<string, unknown>).id;
    delete (patch as Record<string, unknown>).user_id;
    delete (patch as Record<string, unknown>).category_id;
    delete (patch as Record<string, unknown>).period;
    delete (patch as Record<string, unknown>).created_at;
    delete (patch as Record<string, unknown>).deleted_at;
    delete (patch as Record<string, unknown>).limitInPaise;
    delete (patch as Record<string, unknown>).limit_in_paise;

    return patch;
  }

  /**
   * Maps an outbox DELETE operation into a tombstone update patch.
   * Never executes a physical SQL DELETE.
   */
  public static mapSoftDeletePayload(
    payload: Record<string, unknown>
  ): Pick<CloudBudgetRow, 'deleted_at' | 'version' | 'updated_at'> {
    if (
      typeof payload.version !== 'number' ||
      !Number.isSafeInteger(payload.version) ||
      payload.version < 2
    ) {
      throw new Error(`Invalid version '${payload.version}' in budget delete payload.`);
    }

    const rawDeletedAt = payload.deleted_at ?? payload.deletedAt;
    if (typeof rawDeletedAt !== 'string' || rawDeletedAt.trim().length === 0) {
      throw new Error('Missing or invalid deleted_at in budget delete payload.');
    }

    const parsedDeleted = new Date(rawDeletedAt);
    if (isNaN(parsedDeleted.getTime())) {
      throw new Error(`Invalid deleted_at '${rawDeletedAt}' in budget delete payload.`);
    }

    return {
      deleted_at: parsedDeleted.toISOString(),
      version: payload.version,
      updated_at: new Date().toISOString()
    };
  }
}

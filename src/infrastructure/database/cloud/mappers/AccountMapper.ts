import { Account, AccountType } from '@/domain/entities/Account';
import {
  createAccountId,
  validateUserId,
  isValidUuid
} from '@/domain/value-objects/Identifiers';
import { InvalidMoneyError, InvalidUserIdError } from '@/domain/errors/DomainErrors';

export interface CloudAccountRow {
  id: string; // UUID
  user_id: string; // UUID
  name: string;
  account_type: AccountType;
  opening_balance_paise: number;
  currency: string;
  institution_name: string | null;
  color: string | null;
  icon: string | null;
  notes: string | null;
  system_tag?: string | null;
  is_archived: boolean;
  version: number;
  created_at?: string;
  updated_at?: string;
}

const VALID_ACCOUNT_TYPES: ReadonlySet<string> = new Set([
  'cash',
  'bank',
  'savings',
  'credit_card',
  'wallet',
  'other'
]);

export class AccountMapper {
  /**
   * Converts a raw PostgreSQL cloud account row to the domain Account entity.
   */
  public static toDomain(row: CloudAccountRow): Account {
    if (!Number.isSafeInteger(row.opening_balance_paise)) {
      throw new InvalidMoneyError('opening_balance_paise from cloud is not a safe integer.');
    }

    return new Account({
      id: createAccountId(row.id),
      userId: validateUserId(row.user_id),
      name: row.name,
      accountType: row.account_type,
      openingBalancePaise: row.opening_balance_paise,
      currency: row.currency || 'INR',
      institutionName: row.institution_name ?? undefined,
      color: row.color ?? undefined,
      icon: row.icon ?? undefined,
      notes: row.notes ?? undefined,
      systemTag: row.system_tag ?? undefined,
      isArchived: Boolean(row.is_archived),
      version: row.version,
      createdAt: row.created_at ? new Date(row.created_at) : undefined,
      updatedAt: row.updated_at ? new Date(row.updated_at) : undefined
    });
  }

  /**
   * Converts a domain Account entity to a complete CloudAccountRow.
   */
  public static toCloud(account: Account): CloudAccountRow {
    if (!Number.isSafeInteger(account.openingBalancePaise)) {
      throw new InvalidMoneyError('Account openingBalancePaise must be a valid safe integer.');
    }

    return {
      id: account.id,
      user_id: account.userId,
      name: account.name,
      account_type: account.accountType,
      opening_balance_paise: account.openingBalancePaise,
      currency: account.currency,
      institution_name: account.institutionName ?? null,
      color: account.color ?? null,
      icon: account.icon ?? null,
      notes: account.notes ?? null,
      system_tag: account.systemTag ?? null,
      is_archived: account.isArchived,
      version: account.version,
      created_at: account.createdAt.toISOString(),
      updated_at: account.updatedAt.toISOString()
    };
  }

  /**
   * Maps an outbox INSERT payload to a complete CloudAccountRow.
   * Excludes all legacy Dexie fields and validates integer paise strictly.
   */
  public static mapCreatePayload(payload: Record<string, unknown>): CloudAccountRow {
    const id = payload.id;
    if (typeof id !== 'string' || !isValidUuid(id)) {
      throw new Error(`Invalid account ID '${id}': must be a valid UUID.`);
    }

    const userId = payload.user_id;
    if (typeof userId !== 'string' || !isValidUuid(userId)) {
      throw new InvalidUserIdError(`Invalid user ID '${userId}': must be a valid UUID.`);
    }

    const name = payload.name;
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new Error('Account name must not be empty.');
    }

    const accountType = (payload.account_type || payload.type) as string;
    if (!VALID_ACCOUNT_TYPES.has(accountType)) {
      throw new Error(`Invalid account type '${accountType}'.`);
    }

    const openingBalancePaise = payload.opening_balance_paise;
    if (
      openingBalancePaise === undefined ||
      openingBalancePaise === null ||
      typeof openingBalancePaise !== 'number' ||
      !Number.isSafeInteger(openingBalancePaise)
    ) {
      throw new InvalidMoneyError('Account opening_balance_paise must be a valid safe integer in paise.');
    }

    const version = typeof payload.version === 'number' && Number.isSafeInteger(payload.version)
      ? payload.version
      : 1;

    const currency = typeof payload.currency === 'string' && payload.currency.trim().length === 3
      ? payload.currency.trim().toUpperCase()
      : 'INR';

    const institutionName =
      typeof payload.institution_name === 'string' && payload.institution_name.trim().length > 0
        ? payload.institution_name.trim()
        : null;

    const color =
      typeof payload.color === 'string' && payload.color.trim().length > 0
        ? payload.color.trim()
        : null;

    const icon =
      typeof payload.icon === 'string' && payload.icon.trim().length > 0
        ? payload.icon.trim()
        : null;

    const notes =
      typeof payload.notes === 'string' && payload.notes.trim().length > 0
        ? payload.notes.trim()
        : null;

    const systemTag =
      typeof payload.system_tag === 'string' && payload.system_tag.trim().length > 0
        ? payload.system_tag.trim()
        : null;

    return {
      id,
      user_id: userId,
      name: name.trim(),
      account_type: accountType as AccountType,
      opening_balance_paise: openingBalancePaise,
      currency,
      institution_name: institutionName,
      color,
      icon,
      notes,
      system_tag: systemTag,
      is_archived: Boolean(payload.is_archived),
      version
    };
  }

  /**
   * Maps an outbox UPDATE payload to a partial CloudAccountRow.
   * Prevents mutation of immutable fields: id, user_id, created_at, and currency.
   * Avoids destructive NULL overwrites for omitted optional fields.
   */
  public static mapUpdatePayload(payload: Record<string, unknown>): Partial<CloudAccountRow> {
    const patch: Partial<CloudAccountRow> = {};

    if (payload.version !== undefined) {
      if (typeof payload.version !== 'number' || !Number.isSafeInteger(payload.version) || payload.version < 1) {
        throw new Error(`Invalid target version '${payload.version}' in update payload.`);
      }
      patch.version = payload.version;
    }

    if (payload.name !== undefined) {
      if (typeof payload.name !== 'string' || payload.name.trim().length === 0) {
        throw new Error('Account name must not be empty.');
      }
      patch.name = payload.name.trim();
    }

    if (payload.account_type !== undefined) {
      const type = payload.account_type as string;
      if (!VALID_ACCOUNT_TYPES.has(type)) {
        throw new Error(`Invalid account type '${type}'.`);
      }
      patch.account_type = type as AccountType;
    }

    if (payload.opening_balance_paise !== undefined) {
      if (
        typeof payload.opening_balance_paise !== 'number' ||
        !Number.isSafeInteger(payload.opening_balance_paise)
      ) {
        throw new InvalidMoneyError('opening_balance_paise must be a valid safe integer in paise.');
      }
      patch.opening_balance_paise = payload.opening_balance_paise;
    }

    if (payload.institution_name !== undefined) {
      patch.institution_name =
        typeof payload.institution_name === 'string' && payload.institution_name.trim().length > 0
          ? payload.institution_name.trim()
          : null;
    }

    if (payload.color !== undefined) {
      patch.color =
        typeof payload.color === 'string' && payload.color.trim().length > 0
          ? payload.color.trim()
          : null;
    }

    if (payload.icon !== undefined) {
      patch.icon =
        typeof payload.icon === 'string' && payload.icon.trim().length > 0
          ? payload.icon.trim()
          : null;
    }

    if (payload.notes !== undefined) {
      patch.notes =
        typeof payload.notes === 'string' && payload.notes.trim().length > 0
          ? payload.notes.trim()
          : null;
    }

    // system_tag is immutable on UPDATE and strictly excluded from cloud update patches
    if (payload.is_archived !== undefined) {
      patch.is_archived = Boolean(payload.is_archived);
    }

    // Always provide explicit updated_at timestamp
    patch.updated_at = new Date().toISOString();

    // Explicitly strip any disallowed immutable fields if accidentally passed in payload
    delete (patch as Record<string, unknown>).id;
    delete (patch as Record<string, unknown>).user_id;
    delete (patch as Record<string, unknown>).created_at;
    delete (patch as Record<string, unknown>).currency;

    // Explicitly strip legacy Dexie fields
    delete (patch as Record<string, unknown>).type;
    delete (patch as Record<string, unknown>).openingBalanceInPaise;
    delete (patch as Record<string, unknown>).status;

    return patch;
  }

  /**
   * Maps an outbox archive payload into a minimal patch.
   */
  public static mapArchivePayload(
    payload: Record<string, unknown>
  ): Pick<CloudAccountRow, 'is_archived' | 'version' | 'updated_at'> {
    if (typeof payload.version !== 'number' || !Number.isSafeInteger(payload.version) || payload.version < 1) {
      throw new Error(`Invalid version '${payload.version}' in archive payload.`);
    }

    return {
      is_archived: true,
      version: payload.version,
      updated_at: new Date().toISOString()
    };
  }

  /**
   * Maps an outbox restore payload into a minimal patch.
   */
  public static mapRestorePayload(
    payload: Record<string, unknown>
  ): Pick<CloudAccountRow, 'is_archived' | 'version' | 'updated_at'> {
    if (typeof payload.version !== 'number' || !Number.isSafeInteger(payload.version) || payload.version < 1) {
      throw new Error(`Invalid version '${payload.version}' in restore payload.`);
    }

    return {
      is_archived: false,
      version: payload.version,
      updated_at: new Date().toISOString()
    };
  }
}

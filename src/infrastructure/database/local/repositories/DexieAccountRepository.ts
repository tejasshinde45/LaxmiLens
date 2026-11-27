import { AccountRepository } from '@/domain/repositories/AccountRepository';
import { Account, AccountType } from '@/domain/entities/Account';
import { AccountId, UserId, createAccountId, validateUserId } from '@/domain/value-objects/Identifiers';
import { InvalidUserIdError, AccountNotFoundError, UnauthorizedEntityAccessError } from '@/domain/errors/DomainErrors';
import { db, LaxmiLensDB } from '../DexieDatabase';
import { LocalAccountRecord } from '../schema';

export class DexieAccountRepository implements AccountRepository {
  constructor(private readonly database: LaxmiLensDB = db) {}

  public async findById(id: AccountId, userId: UserId): Promise<Account | null> {
    const validatedUserId = validateUserId(userId);
    let record: LocalAccountRecord | undefined | null;
    if (typeof this.database.accounts.where === 'function') {
      record = await this.database.accounts
        .where('[userId+id]')
        .equals([validatedUserId, id])
        .first();
    } else {
      const candidate = await this.database.accounts.get(id);
      if (candidate && candidate.userId === validatedUserId) {
        record = candidate;
      }
    }
    if (!record) {
      const raw = await this.database.accounts.get(id);
      if (raw && raw.userId && raw.userId !== validatedUserId) {
        throw new UnauthorizedEntityAccessError('Account', id);
      }
      return null;
    }
    return this.toDomain(record);
  }

  public async findByUserId(userId: UserId): Promise<Account[]> {
    const validatedUserId = validateUserId(userId);
    const records = await this.database.accounts.where('userId').equals(validatedUserId).toArray();
    return records.map((r) => this.toDomain(r));
  }

  public async findAll(userId: UserId): Promise<Account[]> {
    const validatedUserId = validateUserId(userId);
    return this.findByUserId(validatedUserId);
  }

  public async save(account: Account): Promise<void> {
    const validatedUserId = validateUserId(account.userId);
    const existing = await this.database.accounts.get(account.id);
    if (existing && existing.userId && existing.userId !== validatedUserId) {
      throw new UnauthorizedEntityAccessError('Account', account.id);
    }
    const record = this.toRecord(account);
    await this.database.accounts.put(record);
  }

  public async saveBatch(accounts: Account[]): Promise<void> {
    for (const a of accounts) {
      const validatedUserId = validateUserId(a.userId);
      const existing = await this.database.accounts.get(a.id);
      if (existing && existing.userId && existing.userId !== validatedUserId) {
        throw new UnauthorizedEntityAccessError('Account', a.id);
      }
    }
    const records = accounts.map((a) => this.toRecord(a));
    await this.database.accounts.bulkPut(records);
  }

  public async archive(id: AccountId, userId: UserId, version?: number): Promise<void> {
    const validatedUserId = validateUserId(userId);
    const existing = await this.database.accounts.get(id);
    if (!existing) {
      throw new AccountNotFoundError(id);
    }
    if (existing.userId !== validatedUserId) {
      throw new UnauthorizedEntityAccessError('Account', id);
    }
    const newVersion = version !== undefined ? version : (existing.version ?? 0) + 1;
    await this.database.accounts.update(id, {
      isArchived: true,
      version: newVersion,
      status: 'archived',
      updatedAt: new Date().toISOString()
    });
  }

  public async restore(id: AccountId, userId: UserId, version?: number): Promise<void> {
    const validatedUserId = validateUserId(userId);
    const existing = await this.database.accounts.get(id);
    if (!existing) {
      throw new AccountNotFoundError(id);
    }
    if (existing.userId !== validatedUserId) {
      throw new UnauthorizedEntityAccessError('Account', id);
    }
    const newVersion = version !== undefined ? version : (existing.version ?? 0) + 1;
    await this.database.accounts.update(id, {
      isArchived: false,
      version: newVersion,
      status: 'active',
      updatedAt: new Date().toISOString()
    });
  }

  public async delete(id: AccountId, userId: UserId): Promise<void> {
    const validatedUserId = validateUserId(userId);
    const existing = await this.database.accounts.get(id);
    if (!existing) {
      throw new AccountNotFoundError(id);
    }
    if (existing.userId !== validatedUserId) {
      throw new UnauthorizedEntityAccessError('Account', id);
    }
    await this.database.accounts.delete(id);
  }

  private toDomain(record: LocalAccountRecord): Account {
    if (!record.userId) {
      throw new InvalidUserIdError(`Account record '${record.id}' is missing a valid userId.`);
    }
    return new Account({
      id: createAccountId(record.id),
      userId: validateUserId(record.userId),
      name: record.name,
      accountType: (record.accountType || record.type || 'other') as AccountType,
      currency: record.currency || 'INR',
      openingBalancePaise: record.openingBalancePaise ?? record.openingBalanceInPaise ?? 0,
      institutionName: record.institutionName,
      color: record.color,
      icon: record.icon,
      notes: record.notes,
      systemTag: record.systemTag ?? undefined,
      isArchived: record.isArchived ?? (record.status === 'archived'),
      version: record.version ?? 1,
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt)
    });
  }

  private toRecord(account: Account): LocalAccountRecord {
    const validatedUserId = validateUserId(account.userId);
    return {
      id: account.id,
      userId: validatedUserId,
      name: account.name,
      accountType: account.accountType,
      currency: account.currency,
      openingBalancePaise: account.openingBalancePaise,
      institutionName: account.institutionName,
      color: account.color,
      icon: account.icon,
      notes: account.notes,
      systemTag: account.systemTag ?? null,
      isArchived: account.isArchived,
      version: account.version,
      createdAt: account.createdAt.toISOString(),
      updatedAt: account.updatedAt.toISOString(),

      // Compatibility fields
      type: account.accountType,
      openingBalanceInPaise: account.openingBalancePaise,
      status: account.isArchived ? 'archived' : 'active'
    };
  }
}

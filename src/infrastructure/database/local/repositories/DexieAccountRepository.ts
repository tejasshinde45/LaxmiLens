import { AccountRepository } from '@/domain/repositories/AccountRepository';
import { Account, AccountType } from '@/domain/entities/Account';
import { AccountId, UserId, createAccountId, validateUserId } from '@/domain/value-objects/Identifiers';
import { InvalidUserIdError } from '@/domain/errors/DomainErrors';
import { db, LaxmiLensDB } from '../DexieDatabase';
import { LocalAccountRecord } from '../schema';

export class DexieAccountRepository implements AccountRepository {
  constructor(private readonly database: LaxmiLensDB = db) {}

  public async findById(id: AccountId): Promise<Account | null> {
    const record = await this.database.accounts.get(id);
    return record ? this.toDomain(record) : null;
  }

  public async findByUserId(userId: UserId): Promise<Account[]> {
    const records = await this.database.accounts.where('userId').equals(userId).toArray();
    return records.map((r) => this.toDomain(r));
  }

  public async findAll(): Promise<Account[]> {
    const records = await this.database.accounts.toArray();
    return records.map((r) => this.toDomain(r));
  }

  public async save(account: Account): Promise<void> {
    const record = this.toRecord(account);
    await this.database.accounts.put(record);
  }

  public async saveBatch(accounts: Account[]): Promise<void> {
    const records = accounts.map((a) => this.toRecord(a));
    await this.database.accounts.bulkPut(records);
  }

  public async archive(id: AccountId, version?: number): Promise<void> {
    const existing = await this.database.accounts.get(id);
    const newVersion = version !== undefined ? version : (existing ? (existing.version ?? 0) + 1 : 1);
    await this.database.accounts.update(id, {
      isArchived: true,
      version: newVersion,
      status: 'archived',
      updatedAt: new Date().toISOString()
    });
  }

  public async restore(id: AccountId, version?: number): Promise<void> {
    const existing = await this.database.accounts.get(id);
    const newVersion = version !== undefined ? version : (existing ? (existing.version ?? 0) + 1 : 1);
    await this.database.accounts.update(id, {
      isArchived: false,
      version: newVersion,
      status: 'active',
      updatedAt: new Date().toISOString()
    });
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

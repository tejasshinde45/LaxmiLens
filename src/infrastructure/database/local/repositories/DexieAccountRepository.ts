import { AccountRepository } from '@/domain/repositories/AccountRepository';
import { Account, AccountType } from '@/domain/entities/Account';
import { AccountId, UserId, createAccountId, createUserId } from '@/domain/value-objects/Identifiers';
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

  public async archive(id: AccountId): Promise<void> {
    await this.database.accounts.update(id, {
      isArchived: true,
      updatedAt: new Date().toISOString()
    });
  }

  private toDomain(record: LocalAccountRecord): Account {
    return new Account({
      id: createAccountId(record.id),
      userId: createUserId(record.userId || 'local-user'),
      name: record.name,
      accountType: (record.accountType || record.type || 'other') as AccountType,
      currency: record.currency || 'INR',
      openingBalancePaise: record.openingBalancePaise ?? record.openingBalanceInPaise ?? 0,
      institutionName: record.institutionName,
      color: record.color,
      icon: record.icon,
      isArchived: record.isArchived ?? (record.status === 'archived'),
      version: record.version ?? 1,
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt)
    });
  }

  private toRecord(account: Account): LocalAccountRecord {
    return {
      id: account.id,
      userId: account.userId,
      name: account.name,
      accountType: account.accountType,
      currency: account.currency,
      openingBalancePaise: account.openingBalancePaise,
      institutionName: account.institutionName,
      color: account.color,
      icon: account.icon,
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

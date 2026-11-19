import { AccountRepository } from '@/domain/repositories/AccountRepository';
import { Account } from '@/domain/entities/Account';
import { AccountId, createAccountId } from '@/domain/value-objects/Identifiers';
import { Money } from '@/domain/value-objects/Money';
import { db, LaxmiLensDB } from '../DexieDatabase';
import { LocalAccountRecord } from '../schema';

export class DexieAccountRepository implements AccountRepository {
  constructor(private readonly database: LaxmiLensDB = db) {}

  public async findById(id: AccountId): Promise<Account | null> {
    const record = await this.database.accounts.get(id);
    return record ? this.toDomain(record) : null;
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
      status: 'archived',
      updatedAt: new Date().toISOString()
    });
  }

  private toDomain(record: LocalAccountRecord): Account {
    return new Account({
      id: createAccountId(record.id),
      name: record.name,
      type: record.type,
      currency: record.currency,
      openingBalance: Money.fromPaise(record.openingBalanceInPaise, record.currency),
      status: record.status,
      color: record.color,
      icon: record.icon,
      version: record.version,
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt)
    });
  }

  private toRecord(account: Account): LocalAccountRecord {
    return {
      id: account.id,
      name: account.name,
      type: account.type,
      currency: account.currency,
      openingBalanceInPaise: account.openingBalance.paise,
      status: account.status,
      color: account.color,
      icon: account.icon,
      version: account.version,
      createdAt: account.createdAt.toISOString(),
      updatedAt: account.updatedAt.toISOString()
    };
  }
}

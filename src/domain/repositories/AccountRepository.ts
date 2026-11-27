import { AccountId, UserId } from '../value-objects/Identifiers';
import { Account } from '../entities/Account';

export interface AccountRepository {
  findById(id: AccountId, userId: UserId): Promise<Account | null>;
  findByUserId(userId: UserId): Promise<Account[]>;
  findAll(userId: UserId): Promise<Account[]>;
  save(account: Account): Promise<void>;
  saveBatch(accounts: Account[]): Promise<void>;
  archive(id: AccountId, userId: UserId, version?: number): Promise<void>;
  restore(id: AccountId, userId: UserId, version?: number): Promise<void>;
  delete?(id: AccountId, userId: UserId): Promise<void>;
}

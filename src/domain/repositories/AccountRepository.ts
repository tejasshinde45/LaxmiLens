import { AccountId, UserId } from '../value-objects/Identifiers';
import { Account } from '../entities/Account';

export interface AccountRepository {
  findById(id: AccountId): Promise<Account | null>;
  findByUserId(userId: UserId): Promise<Account[]>;
  findAll(): Promise<Account[]>;
  save(account: Account): Promise<void>;
  saveBatch(accounts: Account[]): Promise<void>;
  archive(id: AccountId): Promise<void>;
}

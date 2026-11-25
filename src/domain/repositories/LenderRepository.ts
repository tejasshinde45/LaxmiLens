import { LenderId, UserId } from '../value-objects/Identifiers';
import { Lender } from '../entities/Lender';

export interface LenderRepository {
  findById(id: LenderId, userId: UserId): Promise<Lender | null>;
  findByName(name: string, userId: UserId): Promise<Lender | null>;
  findByUserId(userId: UserId): Promise<Lender[]>;
  save(lender: Lender): Promise<void>;
  archive(id: LenderId, userId: UserId): Promise<void>;
}

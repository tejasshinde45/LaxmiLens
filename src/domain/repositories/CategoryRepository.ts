import { CategoryId, UserId } from '../value-objects/Identifiers';
import { Category } from '../entities/Category';

export interface CategoryRepository {
  findById(id: CategoryId, userId: UserId): Promise<Category | null>;
  findByUserId(userId: UserId): Promise<Category[]>;
  findAll(userId: UserId): Promise<Category[]>;
  save(category: Category): Promise<void>;
  saveBatch(categories: Category[]): Promise<void>;
  archive(id: CategoryId, userId: UserId): Promise<void>;
  seedDefaults(userId: UserId): Promise<Category[]>;
}

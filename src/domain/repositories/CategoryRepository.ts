import { CategoryId, UserId } from '../value-objects/Identifiers';
import { Category } from '../entities/Category';

export interface CategoryRepository {
  findById(id: CategoryId): Promise<Category | null>;
  findByUserId(userId: UserId): Promise<Category[]>;
  findAll(): Promise<Category[]>;
  save(category: Category): Promise<void>;
  saveBatch(categories: Category[]): Promise<void>;
  archive(id: CategoryId): Promise<void>;
  seedDefaults(userId: UserId): Promise<Category[]>;
}

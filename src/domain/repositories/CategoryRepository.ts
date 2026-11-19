import { CategoryId } from '../value-objects/Identifiers';
import { Category } from '../entities/Category';

export interface CategoryRepository {
  findById(id: CategoryId): Promise<Category | null>;
  findAll(): Promise<Category[]>;
  save(category: Category): Promise<void>;
  delete(id: CategoryId): Promise<void>;
}

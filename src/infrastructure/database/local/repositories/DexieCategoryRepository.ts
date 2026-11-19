import { CategoryRepository } from '@/domain/repositories/CategoryRepository';
import { Category, DEFAULT_CATEGORY_SEEDS } from '@/domain/entities/Category';
import { CategoryId, UserId, createCategoryId, createUserId } from '@/domain/value-objects/Identifiers';
import { db, LaxmiLensDB } from '../DexieDatabase';
import { LocalCategoryRecord } from '../schema';

export class DexieCategoryRepository implements CategoryRepository {
  constructor(private readonly database: LaxmiLensDB = db) {}

  public async findById(id: CategoryId): Promise<Category | null> {
    const record = await this.database.categories.get(id);
    return record ? this.toDomain(record) : null;
  }

  public async findByUserId(userId: UserId): Promise<Category[]> {
    const records = await this.database.categories.where('userId').equals(userId).toArray();
    return records.map((r) => this.toDomain(r));
  }

  public async findAll(): Promise<Category[]> {
    const records = await this.database.categories.toArray();
    return records.map((r) => this.toDomain(r));
  }

  public async save(category: Category): Promise<void> {
    const record = this.toRecord(category);
    await this.database.categories.put(record);
  }

  public async saveBatch(categories: Category[]): Promise<void> {
    const records = categories.map((c) => this.toRecord(c));
    await this.database.categories.bulkPut(records);
  }

  public async archive(id: CategoryId): Promise<void> {
    await this.database.categories.update(id, {
      isArchived: true,
      updatedAt: new Date().toISOString()
    });
  }

  public async seedDefaults(userId: UserId): Promise<Category[]> {
    const existing = await this.findByUserId(userId);
    if (existing.length > 0) {
      return existing;
    }

    const seeded: Category[] = DEFAULT_CATEGORY_SEEDS.map((seed) => {
      const id = createCategoryId(crypto.randomUUID());
      return new Category({
        id,
        userId,
        name: seed.name,
        type: seed.type,
        icon: seed.icon,
        color: seed.color,
        isDefault: true,
        isArchived: false,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      });
    });

    await this.saveBatch(seeded);
    return seeded;
  }

  private toDomain(record: LocalCategoryRecord): Category {
    return new Category({
      id: createCategoryId(record.id),
      userId: createUserId(record.userId || 'local-user'),
      name: record.name,
      type: record.type,
      icon: record.icon,
      color: record.color,
      isDefault: record.isDefault ?? record.isSystem ?? false,
      isArchived: record.isArchived ?? false,
      version: record.version ?? 1,
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt)
    });
  }

  private toRecord(category: Category): LocalCategoryRecord {
    return {
      id: category.id,
      userId: category.userId,
      name: category.name,
      type: category.type,
      icon: category.icon,
      color: category.color,
      isDefault: category.isDefault,
      isArchived: category.isArchived,
      version: category.version,
      createdAt: category.createdAt.toISOString(),
      updatedAt: category.updatedAt.toISOString(),

      // Compatibility
      isSystem: category.isDefault
    };
  }
}

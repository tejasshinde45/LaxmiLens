import { CategoryRepository } from '@/domain/repositories/CategoryRepository';
import { SyncPort } from '@/application/ports/SyncPort';
import { CreateCategoryDTO, CategoryResponseDTO } from '@/application/dto/CategoryDTO';
import { Category } from '@/domain/entities/Category';
import { createCategoryId, createUserId } from '@/domain/value-objects/Identifiers';

export class CreateCategoryUseCase {
  constructor(
    private readonly categoryRepo: CategoryRepository,
    private readonly syncPort: SyncPort
  ) {}

  public async execute(dto: CreateCategoryDTO): Promise<CategoryResponseDTO> {
    const id = createCategoryId(crypto.randomUUID());
    const userId = createUserId(dto.userId || 'local-user');

    const category = new Category({
      id,
      userId,
      name: dto.name,
      type: dto.type,
      icon: dto.icon,
      color: dto.color,
      isDefault: dto.isDefault ?? false,
      isArchived: false,
      version: 1
    });

    await this.categoryRepo.save(category);

    await this.syncPort.enqueue({
      entity: 'categories',
      entityId: category.id,
      operation: 'INSERT',
      payload: {
        id: category.id,
        user_id: category.userId,
        name: category.name,
        type: category.type,
        icon: category.icon,
        color: category.color,
        is_default: category.isDefault,
        is_archived: category.isArchived,
        version: category.version
      },
      idempotencyKey: crypto.randomUUID()
    });

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
      updatedAt: category.updatedAt.toISOString()
    };
  }
}

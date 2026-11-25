import { BudgetRepository } from '@/domain/repositories/BudgetRepository';
import { Budget } from '@/domain/entities/Budget';
import {
  BudgetId,
  CategoryId,
  UserId,
  createBudgetId,
  createCategoryId,
  validateUserId
} from '@/domain/value-objects/Identifiers';
import { UnauthorizedEntityAccessError } from '@/domain/errors/DomainErrors';
import { BudgetNotFoundError, DuplicateBudgetError } from '@/domain/errors/BudgetErrors';
import { db, LaxmiLensDB } from '../DexieDatabase';
import { LocalBudgetRecord } from '../schema';

export class DexieBudgetRepository implements BudgetRepository {
  constructor(private readonly database: LaxmiLensDB = db) {}

  public async findById(id: BudgetId, userId: UserId): Promise<Budget | null> {
    const validatedUserId = validateUserId(userId);
    let record: LocalBudgetRecord | undefined | null;

    if (typeof this.database.budgets.where === 'function') {
      record = await this.database.budgets
        .where('[userId+id]')
        .equals([validatedUserId, id])
        .first();
    } else {
      const candidate = await this.database.budgets.get(id);
      if (candidate && candidate.userId === validatedUserId) {
        record = candidate;
      }
    }

    if (!record) {
      const raw = await this.database.budgets.get(id);
      if (raw && raw.userId && raw.userId !== validatedUserId) {
        throw new UnauthorizedEntityAccessError('Budget', id);
      }
      return null;
    }

    return this.toDomain(record);
  }

  public async findByPeriod(period: string, userId: UserId): Promise<Budget[]> {
    const validatedUserId = validateUserId(userId);
    let records: LocalBudgetRecord[];

    if (typeof this.database.budgets.where === 'function') {
      records = await this.database.budgets
        .where('[userId+period]')
        .equals([validatedUserId, period])
        .toArray();
    } else {
      const all = await this.database.budgets.toArray();
      records = all.filter(
        (r) => r.userId === validatedUserId && r.period === period
      );
    }

    return records.map((r) => this.toDomain(r));
  }

  public async findByCategoryAndPeriod(
    categoryId: CategoryId,
    period: string,
    userId: UserId
  ): Promise<Budget | null> {
    const validatedUserId = validateUserId(userId);
    let record: LocalBudgetRecord | undefined | null;

    if (typeof this.database.budgets.where === 'function') {
      record = await this.database.budgets
        .where('[userId+categoryId+period]')
        .equals([validatedUserId, categoryId, period])
        .first();
    } else {
      const all = await this.database.budgets.toArray();
      record = all.find(
        (r) =>
          r.userId === validatedUserId &&
          r.categoryId === categoryId &&
          r.period === period
      );
    }

    if (!record) {
      return null;
    }

    return this.toDomain(record);
  }

  public async save(budget: Budget): Promise<void> {
    const validatedUserId = validateUserId(budget.userId);
    const record = this.toRecord(budget);

    // Execute cross-user guard, uniqueness check, and write atomically in a single rw transaction
    await this.database.transaction('rw', [this.database.budgets], async () => {
      const existing = await this.database.budgets.get(budget.id);
      if (existing && existing.userId !== validatedUserId) {
        throw new UnauthorizedEntityAccessError('Budget', budget.id);
      }

      let matches: LocalBudgetRecord[];
      if (typeof this.database.budgets.where === 'function') {
        matches = await this.database.budgets
          .where('[userId+categoryId+period]')
          .equals([validatedUserId, budget.categoryId, budget.period])
          .toArray();
      } else {
        const all = await this.database.budgets.toArray();
        matches = all.filter(
          (b) =>
            b.userId === validatedUserId &&
            b.categoryId === budget.categoryId &&
            b.period === budget.period
        );
      }

      const duplicate = matches.find((b) => b.id !== budget.id);
      if (duplicate) {
        throw new DuplicateBudgetError(budget.categoryId, budget.period);
      }

      await this.database.budgets.put(record);
    });
  }

  public async delete(id: BudgetId, userId: UserId): Promise<void> {
    const validatedUserId = validateUserId(userId);
    const existing = await this.database.budgets.get(id);

    if (!existing) {
      throw new BudgetNotFoundError(id);
    }

    if (existing.userId !== validatedUserId) {
      throw new UnauthorizedEntityAccessError('Budget', id);
    }

    await this.database.budgets.delete(id);
  }

  private toDomain(record: LocalBudgetRecord): Budget {
    const rawLimit = record.limitPaise ?? record.limitInPaise;
    return new Budget({
      id: createBudgetId(record.id),
      userId: validateUserId(record.userId),
      categoryId: createCategoryId(record.categoryId),
      period: record.period,
      limitPaise: rawLimit,
      version: record.version ?? 1,
      createdAt: record.createdAt ? new Date(record.createdAt) : undefined,
      updatedAt: record.updatedAt ? new Date(record.updatedAt) : undefined
    });
  }

  private toRecord(budget: Budget): LocalBudgetRecord {
    return {
      id: budget.id,
      userId: budget.userId,
      categoryId: budget.categoryId,
      period: budget.period,
      limitPaise: budget.limitPaise,
      version: budget.version,
      createdAt: budget.createdAt.toISOString(),
      updatedAt: budget.updatedAt.toISOString()
    };
  }
}

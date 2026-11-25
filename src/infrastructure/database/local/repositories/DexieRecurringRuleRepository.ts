import {
  RecurringRule,
  RecurringRuleStatus
} from '@/domain/entities/RecurringRule';
import { RecurringRuleRepository } from '@/domain/repositories/RecurringRuleRepository';
import {
  AccountId,
  CategoryId,
  RecurringRuleId,
  UserId,
  createAccountId,
  createCategoryId,
  createRecurringRuleId,
  validateUserId
} from '@/domain/value-objects/Identifiers';
import { Money } from '@/domain/value-objects/Money';
import { UnauthorizedEntityAccessError } from '@/domain/errors/DomainErrors';
import { RecurringRuleNotFoundError } from '@/domain/errors/RecurringErrors';
import { db, LaxmiLensDB } from '../DexieDatabase';
import { LocalRecurringRuleRecord } from '../schema';

export interface RecurringQueryOptions {
  includeDeleted?: boolean;
}

export class DexieRecurringRuleRepository implements RecurringRuleRepository {
  constructor(private readonly database: LaxmiLensDB = db) {}

  public async findById(
    id: RecurringRuleId,
    userId: UserId,
    options?: RecurringQueryOptions
  ): Promise<RecurringRule | null> {
    const validatedUserId = validateUserId(userId);
    const includeDeleted = options?.includeDeleted ?? false;

    let record: LocalRecurringRuleRecord | undefined | null;
    if (typeof this.database.recurringRules.where === 'function') {
      record = await this.database.recurringRules
        .where('[userId+id]')
        .equals([validatedUserId, id])
        .first();
    } else {
      const candidate = await this.database.recurringRules.get(id);
      if (candidate && candidate.userId === validatedUserId) {
        record = candidate;
      }
    }

    if (!record) {
      const raw = await this.database.recurringRules.get(id);
      if (raw && raw.userId && raw.userId !== validatedUserId) {
        throw new UnauthorizedEntityAccessError('RecurringRule', id);
      }
      return null;
    }

    if (!includeDeleted && record.deletedAt) {
      return null;
    }

    return this.toDomain(record);
  }

  public async findAll(
    userId: UserId,
    options?: RecurringQueryOptions
  ): Promise<RecurringRule[]> {
    const validatedUserId = validateUserId(userId);
    const includeDeleted = options?.includeDeleted ?? false;

    const records =
      typeof this.database.recurringRules.where === 'function'
        ? await this.database.recurringRules.where('userId').equals(validatedUserId).toArray()
        : (await this.database.recurringRules.toArray()).filter(
            (r) => r.userId === validatedUserId
          );

    return records
      .filter((r) => includeDeleted || !r.deletedAt)
      .map((r) => this.toDomain(r));
  }

  public async findByStatus(
    status: RecurringRuleStatus,
    userId: UserId
  ): Promise<RecurringRule[]> {
    const validatedUserId = validateUserId(userId);
    const records =
      typeof this.database.recurringRules.where === 'function'
        ? await this.database.recurringRules
            .where('[userId+status]')
            .equals([validatedUserId, status])
            .toArray()
        : (await this.database.recurringRules.toArray()).filter(
            (r) => r.userId === validatedUserId && r.status === status
          );

    return records.filter((r) => !r.deletedAt).map((r) => this.toDomain(r));
  }

  public async save(rule: RecurringRule): Promise<void> {
    const validatedUserId = validateUserId(rule.userId);
    const record = this.toRecord(rule);

    await this.database.transaction('rw', [this.database.recurringRules], async () => {
      const existing = await this.database.recurringRules.get(rule.id);
      if (existing && existing.userId !== validatedUserId) {
        throw new UnauthorizedEntityAccessError('RecurringRule', rule.id);
      }
      await this.database.recurringRules.put(record);
    });
  }

  public async delete(id: RecurringRuleId, userId: UserId): Promise<void> {
    const validatedUserId = validateUserId(userId);

    await this.database.transaction('rw', [this.database.recurringRules], async () => {
      const existing = await this.database.recurringRules.get(id);
      if (!existing) {
        throw new RecurringRuleNotFoundError(id);
      }
      if (existing.userId !== validatedUserId) {
        throw new UnauthorizedEntityAccessError('RecurringRule', id);
      }
      const nowIso = new Date().toISOString();
      await this.database.recurringRules.put({
        ...existing,
        deletedAt: existing.deletedAt ?? nowIso,
        version: (existing.version ?? 1) + 1,
        updatedAt: nowIso
      });
    });
  }

  private toDomain(record: LocalRecurringRuleRecord): RecurringRule {
    if (record.type === 'transfer') {
      throw new Error(`Unsupported legacy recurring rule type 'transfer' for rule '${record.id}'.`);
    }
    const rawAmount = record.amountPaise ?? record.amountInPaise ?? 0;
    return new RecurringRule({
      id: createRecurringRuleId(record.id),
      userId: validateUserId(record.userId),
      title: record.title || record.name || 'Recurring Schedule',
      description: record.description,
      type: record.type,
      amount: Money.fromPaise(rawAmount, 'INR'),
      accountId: createAccountId(record.accountId) as AccountId,
      categoryId: record.categoryId ? (createCategoryId(record.categoryId) as CategoryId) : undefined,
      frequency: record.frequency,
      interval: record.interval ?? 1,
      anchorDayOfMonth: record.anchorDayOfMonth,
      startDate: record.startDate,
      endDate: record.endDate ?? null,
      nextDueDate: record.nextDueDate,
      lastGeneratedDate: record.lastGeneratedDate ?? null,
      status: record.status ?? (record.isActive === false ? 'paused' : 'active'),
      requiresUserConfirmation: record.requiresUserConfirmation ?? true,
      version: record.version ?? 1,
      createdAt: record.createdAt ? new Date(record.createdAt) : undefined,
      updatedAt: record.updatedAt ? new Date(record.updatedAt) : undefined,
      deletedAt: record.deletedAt ? new Date(record.deletedAt) : null
    });
  }

  private toRecord(rule: RecurringRule): LocalRecurringRuleRecord {
    return {
      id: rule.id,
      userId: rule.userId,
      title: rule.title,
      description: rule.description,
      type: rule.type,
      amountPaise: rule.amount.paise,
      accountId: rule.accountId,
      categoryId: rule.categoryId,
      frequency: rule.frequency,
      interval: rule.interval,
      anchorDayOfMonth: rule.anchorDayOfMonth,
      startDate: rule.startDate,
      endDate: rule.endDate,
      nextDueDate: rule.nextDueDate,
      lastGeneratedDate: rule.lastGeneratedDate,
      status: rule.status,
      requiresUserConfirmation: rule.requiresUserConfirmation,
      version: rule.version,
      createdAt: rule.createdAt.toISOString(),
      updatedAt: rule.updatedAt.toISOString(),
      deletedAt: rule.deletedAt ? rule.deletedAt.toISOString() : null
    };
  }
}

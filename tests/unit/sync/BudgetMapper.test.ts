import { describe, it, expect } from 'vitest';
import { Budget } from '@/domain/entities/Budget';
import { createBudgetId, createCategoryId, validateUserId } from '@/domain/value-objects/Identifiers';
import { InvalidBudgetLimitError, InvalidBudgetPeriodError } from '@/domain/errors/BudgetErrors';
import { InvalidUserIdError } from '@/domain/errors/DomainErrors';
import { BudgetMapper, CloudBudgetRow } from '@/infrastructure/database/cloud/mappers/BudgetMapper';

describe('BudgetMapper', () => {
  const budgetId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const userId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const categoryId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const localCategoryId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const iso1 = '2026-04-01T10:00:00.000Z';
  const iso2 = '2026-04-02T12:30:00.000Z';

  const activeCloudRow: CloudBudgetRow = {
    id: budgetId,
    user_id: userId,
    category_id: categoryId,
    period: '2026-04',
    limit_paise: 1500000, // INR 15,000.00
    version: 2,
    created_at: iso1,
    updated_at: iso2,
    deleted_at: null
  };

  describe('toDomain', () => {
    it('maps valid active CloudBudgetRow to Budget entity preserving paise and timestamps', () => {
      const entity = BudgetMapper.toDomain(activeCloudRow);

      expect(entity).toBeInstanceOf(Budget);
      expect(entity.id).toBe(budgetId);
      expect(entity.userId).toBe(userId);
      expect(entity.categoryId).toBe(categoryId);
      expect(entity.period).toBe('2026-04');
      expect(entity.limitPaise).toBe(1500000);
      expect(entity.version).toBe(2);
      expect(entity.createdAt.toISOString()).toBe(iso1);
      expect(entity.updatedAt.toISOString()).toBe(iso2);
    });

    it('rejects tombstoned rows when mapping active domain entity', () => {
      const tombstoned: CloudBudgetRow = {
        ...activeCloudRow,
        deleted_at: '2026-04-05T09:00:00.000Z'
      };

      expect(() => BudgetMapper.toDomain(tombstoned)).toThrow(/tombstoned/i);
    });

    it('rejects invalid financial amounts, periods, IDs, versions, and timestamps', () => {
      expect(() =>
        BudgetMapper.toDomain({ ...activeCloudRow, limit_paise: 0 })
      ).toThrow(InvalidBudgetLimitError);
      expect(() =>
        BudgetMapper.toDomain({ ...activeCloudRow, limit_paise: -500 })
      ).toThrow(InvalidBudgetLimitError);
      expect(() =>
        BudgetMapper.toDomain({ ...activeCloudRow, limit_paise: 1500.5 })
      ).toThrow(InvalidBudgetLimitError);
      expect(() =>
        BudgetMapper.toDomain({ ...activeCloudRow, period: '2026-13' })
      ).toThrow(InvalidBudgetPeriodError);
      expect(() =>
        BudgetMapper.toDomain({ ...activeCloudRow, period: '2026-00' })
      ).toThrow(InvalidBudgetPeriodError);
      expect(() =>
        BudgetMapper.toDomain({ ...activeCloudRow, id: 'not-a-uuid' })
      ).toThrow(/Invalid cloud budget ID/);
      expect(() =>
        BudgetMapper.toDomain({ ...activeCloudRow, user_id: 'bad-user' })
      ).toThrow(InvalidUserIdError);
      expect(() =>
        BudgetMapper.toDomain({ ...activeCloudRow, category_id: 'bad-cat' })
      ).toThrow(/category_id/);
      expect(() =>
        BudgetMapper.toDomain({ ...activeCloudRow, version: 0 })
      ).toThrow(/version/);
      expect(() =>
        BudgetMapper.toDomain({ ...activeCloudRow, created_at: 'invalid-date' })
      ).toThrow(/created_at/);
      expect(() =>
        BudgetMapper.validateCloudRow({ ...activeCloudRow, deleted_at: 'invalid-date' })
      ).toThrow(/deleted_at/);
    });
  });

  describe('toLocalRecord & toCloud', () => {
    it('maps active CloudBudgetRow to LocalBudgetRecord using resolved local category ID', () => {
      const localRecord = BudgetMapper.toLocalRecord(activeCloudRow, localCategoryId);

      expect(localRecord).toEqual({
        id: budgetId,
        userId,
        categoryId: localCategoryId,
        period: '2026-04',
        limitPaise: 1500000,
        version: 2,
        createdAt: iso1,
        updatedAt: iso2
      });
    });

    it('rejects tombstoned rows and invalid resolved category IDs in toLocalRecord', () => {
      expect(() =>
        BudgetMapper.toLocalRecord({ ...activeCloudRow, deleted_at: iso2 }, localCategoryId)
      ).toThrow(/tombstoned/i);
      expect(() =>
        BudgetMapper.toLocalRecord(activeCloudRow, 'invalid-local-cat')
      ).toThrow(/Invalid resolved local category ID/);
    });

    it('maps Budget domain entity back to canonical CloudBudgetRow', () => {
      const entity = new Budget({
        id: createBudgetId(budgetId),
        userId: validateUserId(userId),
        categoryId: createCategoryId(categoryId),
        period: '2026-04',
        limitPaise: 250000,
        version: 3,
        createdAt: new Date(iso1),
        updatedAt: new Date(iso2)
      });

      expect(BudgetMapper.toCloud(entity)).toEqual({
        id: budgetId,
        user_id: userId,
        category_id: categoryId,
        period: '2026-04',
        limit_paise: 250000,
        version: 3,
        created_at: iso1,
        updated_at: iso2,
        deleted_at: null
      });
    });
  });

  describe('outbox payload mapping', () => {
    it('maps camelCase and snake_case create payloads cleanly with integer paise', () => {
      const mapped = BudgetMapper.mapCreatePayload({
        id: budgetId,
        userId,
        categoryId,
        period: '2026-05',
        limitPaise: 500000,
        version: 1,
        created_at: iso1,
        updated_at: iso2
      });

      expect(mapped).toEqual({
        id: budgetId,
        user_id: userId,
        category_id: categoryId,
        period: '2026-05',
        limit_paise: 500000,
        version: 1,
        created_at: iso1,
        updated_at: iso2,
        deleted_at: null
      });
    });

    it('rejects invalid limit_paise or period in mapCreatePayload', () => {
      expect(() =>
        BudgetMapper.mapCreatePayload({
          id: budgetId,
          user_id: userId,
          category_id: categoryId,
          period: '2026-05',
          limit_paise: 99.95
        })
      ).toThrow(InvalidBudgetLimitError);

      expect(() =>
        BudgetMapper.mapCreatePayload({
          id: budgetId,
          user_id: userId,
          category_id: categoryId,
          period: '2026-99',
          limit_paise: 500000
        })
      ).toThrow(InvalidBudgetPeriodError);
    });

    it('maps update payload and strips immutable identity, ownership, category, period, and deleted_at', () => {
      const patch = BudgetMapper.mapUpdatePayload({
        id: '99999999-9999-4999-8999-999999999999',
        user_id: '88888888-8888-4888-8888-888888888888',
        category_id: '77777777-7777-4777-8777-777777777777',
        period: '2030-01',
        created_at: '2020-01-01T00:00:00.000Z',
        deleted_at: '2026-04-10T00:00:00.000Z',
        limit_paise: 850000,
        version: 2,
        updated_at: iso2
      });

      expect(patch).toEqual({
        limit_paise: 850000,
        version: 2,
        updated_at: iso2
      });
      expect(patch).not.toHaveProperty('id');
      expect(patch).not.toHaveProperty('user_id');
      expect(patch).not.toHaveProperty('category_id');
      expect(patch).not.toHaveProperty('period');
      expect(patch).not.toHaveProperty('created_at');
      expect(patch).not.toHaveProperty('deleted_at');
    });

    it('maps soft delete payload cleanly and validates version >= 2 and deleted_at', () => {
      const deletePatch = BudgetMapper.mapSoftDeletePayload({
        version: 2,
        deleted_at: iso2
      });

      expect(deletePatch.version).toBe(2);
      expect(deletePatch.deleted_at).toBe(iso2);
      expect(deletePatch.updated_at).toBeTruthy();

      expect(() =>
        BudgetMapper.mapSoftDeletePayload({ version: 1, deleted_at: iso2 })
      ).toThrow(/Invalid version/);
      expect(() =>
        BudgetMapper.mapSoftDeletePayload({ version: 2, deleted_at: '' })
      ).toThrow(/deleted_at/);
    });
  });
});

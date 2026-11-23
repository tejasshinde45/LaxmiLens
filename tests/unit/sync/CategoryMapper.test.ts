import { describe, it, expect } from 'vitest';
import {
  CategoryMapper,
  CloudCategoryRow
} from '@/infrastructure/database/cloud/mappers/CategoryMapper';
import { Category } from '@/domain/entities/Category';
import { createCategoryId, createUserId } from '@/domain/value-objects/Identifiers';
import { InvalidUserIdError } from '@/domain/errors/DomainErrors';

describe('CategoryMapper', () => {
  const validCatId = '11111111-1111-4111-8111-111111111111';
  const validUserId = '22222222-2222-4222-8222-222222222222';
  const validIso = '2026-03-01T10:00:00.000Z';

  const sampleCloudRow: CloudCategoryRow = {
    id: validCatId,
    user_id: validUserId,
    name: 'Groceries',
    type: 'expense',
    icon: 'ShoppingCart',
    color: '#D9827C',
    is_default: false,
    is_archived: false,
    version: 1,
    created_at: validIso,
    updated_at: validIso
  };

  describe('toDomain', () => {
    it('maps a valid CloudCategoryRow to a domain Category entity', () => {
      const entity = CategoryMapper.toDomain(sampleCloudRow);
      expect(entity).toBeInstanceOf(Category);
      expect(entity.id).toBe(validCatId);
      expect(entity.userId).toBe(validUserId);
      expect(entity.name).toBe('Groceries');
      expect(entity.type).toBe('expense');
      expect(entity.icon).toBe('ShoppingCart');
      expect(entity.color).toBe('#D9827C');
      expect(entity.isDefault).toBe(false);
      expect(entity.isArchived).toBe(false);
      expect(entity.version).toBe(1);
      expect(entity.createdAt).toEqual(new Date(validIso));
    });

    it('rejects an invalid category type', () => {
      const invalid = { ...sampleCloudRow, type: 'transfer' as unknown as 'expense' };
      expect(() => CategoryMapper.toDomain(invalid)).toThrow(/Invalid category type/);
    });
  });

  describe('toCloud', () => {
    it('maps a domain Category entity to CloudCategoryRow', () => {
      const category = new Category({
        id: createCategoryId(validCatId),
        userId: createUserId(validUserId),
        name: 'Salary',
        type: 'income',
        icon: 'Briefcase',
        color: '#72B895',
        isDefault: true,
        isArchived: false,
        version: 2,
        createdAt: new Date(validIso),
        updatedAt: new Date(validIso)
      });

      const cloud = CategoryMapper.toCloud(category);
      expect(cloud.id).toBe(validCatId);
      expect(cloud.user_id).toBe(validUserId);
      expect(cloud.name).toBe('Salary');
      expect(cloud.type).toBe('income');
      expect(cloud.is_default).toBe(true);
      expect(cloud.is_archived).toBe(false);
      expect(cloud.version).toBe(2);
      expect(cloud.created_at).toBe(validIso);
      expect(cloud.updated_at).toBe(validIso);
    });
  });

  describe('mapCreatePayload', () => {
    it('maps a valid outbox INSERT payload to CloudCategoryRow', () => {
      const payload = {
        id: validCatId,
        user_id: validUserId,
        name: '  Dining Out  ',
        type: 'expense',
        icon: 'Utensils',
        color: '#D9827C',
        is_default: false,
        is_archived: false,
        version: 1
      };

      const result = CategoryMapper.mapCreatePayload(payload);
      expect(result.id).toBe(validCatId);
      expect(result.user_id).toBe(validUserId);
      expect(result.name).toBe('Dining Out');
      expect(result.type).toBe('expense');
      expect(result.icon).toBe('Utensils');
      expect(result.color).toBe('#D9827C');
      expect(result.is_default).toBe(false);
      expect(result.is_archived).toBe(false);
      expect(result.version).toBe(1);
    });

    it('rejects invalid or missing category ID', () => {
      expect(() =>
        CategoryMapper.mapCreatePayload({
          id: 'invalid-id',
          user_id: validUserId,
          name: 'Food',
          type: 'expense'
        })
      ).toThrow(/must be a valid UUID/);
    });

    it('rejects invalid user ID', () => {
      expect(() =>
        CategoryMapper.mapCreatePayload({
          id: validCatId,
          user_id: 'bad-user',
          name: 'Food',
          type: 'expense'
        })
      ).toThrow(InvalidUserIdError);
    });

    it('rejects empty category name', () => {
      expect(() =>
        CategoryMapper.mapCreatePayload({
          id: validCatId,
          user_id: validUserId,
          name: '   ',
          type: 'expense'
        })
      ).toThrow(/must not be empty/);
    });

    it('rejects category name exceeding 100 characters', () => {
      expect(() =>
        CategoryMapper.mapCreatePayload({
          id: validCatId,
          user_id: validUserId,
          name: 'A'.repeat(101),
          type: 'expense'
        })
      ).toThrow(/exceeds maximum length/);
    });

    it('rejects invalid category type', () => {
      expect(() =>
        CategoryMapper.mapCreatePayload({
          id: validCatId,
          user_id: validUserId,
          name: 'Food',
          type: 'investment'
        })
      ).toThrow(/Invalid category type/);
    });
  });

  describe('mapUpdatePayload', () => {
    it('maps a valid outbox UPDATE payload and strips immutable/legacy fields', () => {
      const payload = {
        id: validCatId,
        user_id: validUserId,
        created_at: validIso,
        parentId: 'parent-123',
        isSystem: true,
        name: 'Updated Groceries',
        icon: 'ShoppingCart2',
        color: '#FFFFFF',
        is_archived: true,
        version: 3
      };

      const patch = CategoryMapper.mapUpdatePayload(payload);
      expect(patch.name).toBe('Updated Groceries');
      expect(patch.icon).toBe('ShoppingCart2');
      expect(patch.color).toBe('#FFFFFF');
      expect(patch.is_archived).toBe(true);
      expect(patch.version).toBe(3);
      expect(patch.updated_at).toBeDefined();

      // Ensure immutable fields are stripped
      expect((patch as Record<string, unknown>).id).toBeUndefined();
      expect((patch as Record<string, unknown>).user_id).toBeUndefined();
      expect((patch as Record<string, unknown>).created_at).toBeUndefined();
      expect((patch as Record<string, unknown>).parentId).toBeUndefined();
      expect((patch as Record<string, unknown>).isSystem).toBeUndefined();
    });

    it('rejects invalid version in update payload', () => {
      expect(() =>
        CategoryMapper.mapUpdatePayload({
          version: -1
        })
      ).toThrow(/Invalid target version/);
    });
  });
});

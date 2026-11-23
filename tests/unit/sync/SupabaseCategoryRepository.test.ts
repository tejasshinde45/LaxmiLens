import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SupabaseCategoryRepository,
  ISupabaseCategoryRepository
} from '@/infrastructure/database/cloud/repositories/SupabaseCategoryRepository';
import { CloudCategoryRow } from '@/infrastructure/database/cloud/mappers/CategoryMapper';
import {
  SyncAuthError,
  SyncConflictError,
  SyncDatabaseError
} from '@/infrastructure/sync/errors/SyncErrors';

describe('SupabaseCategoryRepository', () => {
  const validCatId = '11111111-1111-4111-8111-111111111111';
  const validUserId = '22222222-2222-4222-8222-222222222222';
  const otherUserId = '33333333-3333-4333-8333-333333333333';
  const validIso = '2026-03-01T10:00:00.000Z';

  const sampleCategory: CloudCategoryRow = {
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

  let mockClient: any;
  let repo: ISupabaseCategoryRepository;

  beforeEach(() => {
    mockClient = {
      from: vi.fn()
    };
    repo = new SupabaseCategoryRepository(mockClient);
  });

  describe('insert', () => {
    it('rejects insert when user_id is missing', async () => {
      const invalid = { ...sampleCategory, user_id: '' };
      await expect(repo.insert(invalid)).rejects.toThrow(SyncAuthError);
    });

    it('rejects insert when category ID is not a valid UUID', async () => {
      const invalid = { ...sampleCategory, id: 'cat-123' };
      await expect(repo.insert(invalid)).rejects.toThrow(/invalid category ID/);
    });

    it('inserts a valid category row and returns verified data', async () => {
      const insertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: sampleCategory, error: null })
        })
      });
      mockClient.from.mockReturnValue({ insert: insertMock });

      const result = await repo.insert(sampleCategory);
      expect(result).toEqual(sampleCategory);
      expect(mockClient.from).toHaveBeenCalledWith('categories');
    });

    it('handles error 23505 idempotently when identical record already exists', async () => {
      // First insert call fails with 23505
      const insertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { code: '23505', message: 'duplicate key value violates unique constraint' }
          })
        })
      });

      // findById lookup returns the identical record
      const selectMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: sampleCategory, error: null })
          })
        })
      });

      mockClient.from.mockImplementation((table: string) => {
        if (table === 'categories') {
          return {
            insert: insertMock,
            select: selectMock
          };
        }
        return {};
      });

      const result = await repo.insert(sampleCategory);
      expect(result).toEqual(sampleCategory);
    });

    it('throws SyncConflictError on 23505 when conflicting data exists in cloud', async () => {
      const insertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { code: '23505', message: 'duplicate key' }
          })
        })
      });

      const differingCloudRecord: CloudCategoryRow = {
        ...sampleCategory,
        name: 'Different Name'
      };

      const selectMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: differingCloudRecord, error: null })
          })
        })
      });

      mockClient.from.mockImplementation(() => ({
        insert: insertMock,
        select: selectMock
      }));

      await expect(repo.insert(sampleCategory)).rejects.toThrow(SyncConflictError);
    });

    it('throws SyncConflictError on 23505 when category belongs to another user', async () => {
      const insertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { code: '23505', message: 'duplicate key' }
          })
        })
      });

      const otherUserCategory: CloudCategoryRow = {
        ...sampleCategory,
        user_id: otherUserId
      };

      const selectMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: otherUserCategory, error: null })
          })
        })
      });

      mockClient.from.mockImplementation(() => ({
        insert: insertMock,
        select: selectMock
      }));

      await expect(repo.insert(sampleCategory)).rejects.toThrow(SyncConflictError);
    });

    it('throws SyncDatabaseError when RLS error 42501 occurs', async () => {
      const insertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { code: '42501', message: 'new row violates row-level security policy' }
          })
        })
      });
      mockClient.from.mockReturnValue({ insert: insertMock });

      await expect(repo.insert(sampleCategory)).rejects.toThrow(SyncDatabaseError);
    });
  });

  describe('updatePartial', () => {
    it('updates category successfully with optimistic version match', async () => {
      const currentCategory = { ...sampleCategory, version: 1 };
      const updatedCategory = { ...sampleCategory, name: 'Household', version: 2 };

      const selectMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: currentCategory, error: null })
          })
        })
      });

      const updateMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: updatedCategory, error: null })
              })
            })
          })
        })
      });

      mockClient.from.mockReturnValue({
        select: selectMock,
        update: updateMock
      });

      const result = await repo.updatePartial(validCatId, validUserId, { name: 'Household' }, 1);
      expect(result.name).toBe('Household');
      expect(result.version).toBe(2);
    });

    it('throws SyncConflictError when category is not found in cloud', async () => {
      const selectMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
          })
        })
      });
      mockClient.from.mockReturnValue({ select: selectMock });

      await expect(
        repo.updatePartial(validCatId, validUserId, { name: 'Household' }, 1)
      ).rejects.toThrow(SyncConflictError);
    });

    it('throws SyncConflictError when version conflict occurs', async () => {
      const cloudRecordAtVersion2 = { ...sampleCategory, version: 2 };

      const selectMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: cloudRecordAtVersion2, error: null })
          })
        })
      });
      mockClient.from.mockReturnValue({ select: selectMock });

      await expect(
        repo.updatePartial(validCatId, validUserId, { name: 'Household', version: 2 }, 1)
      ).rejects.toThrow(SyncConflictError);
    });
  });

  describe('findAll', () => {
    it('returns empty array when user_id is empty', async () => {
      const result = await repo.findAll('');
      expect(result).toEqual([]);
    });

    it('queries categories for the authenticated user', async () => {
      const selectMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [sampleCategory], error: null })
      });
      mockClient.from.mockReturnValue({ select: selectMock });

      const result = await repo.findAll(validUserId);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(validCatId);
    });
  });
});

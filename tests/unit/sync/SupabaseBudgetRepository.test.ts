import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SupabaseBudgetRepository,
  ISupabaseBudgetRepository
} from '@/infrastructure/database/cloud/repositories/SupabaseBudgetRepository';
import { ISupabaseCategoryRepository } from '@/infrastructure/database/cloud/repositories/SupabaseCategoryRepository';
import { CloudBudgetRow } from '@/infrastructure/database/cloud/mappers/BudgetMapper';
import { CloudCategoryRow } from '@/infrastructure/database/cloud/mappers/CategoryMapper';
import {
  SyncAuthError,
  SyncConflictError,
  SyncDatabaseError,
  SyncUnresolvedCategoryError
} from '@/infrastructure/sync/errors/SyncErrors';

describe('SupabaseBudgetRepository', () => {
  const budgetId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const otherBudgetId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const userId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const otherUserId = '99999999-9999-4999-8999-999999999999';
  const categoryId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const iso1 = '2026-04-01T10:00:00.000Z';
  const iso2 = '2026-04-02T10:00:00.000Z';

  const expenseCategory: CloudCategoryRow = {
    id: categoryId,
    user_id: userId,
    name: 'Groceries',
    type: 'expense',
    icon: 'ShoppingCart',
    color: '#D9827C',
    is_default: false,
    is_archived: false,
    version: 1,
    created_at: iso1,
    updated_at: iso1
  };

  const sampleBudget: CloudBudgetRow = {
    id: budgetId,
    user_id: userId,
    category_id: categoryId,
    period: '2026-04',
    limit_paise: 1200000,
    version: 1,
    created_at: iso1,
    updated_at: iso1,
    deleted_at: null
  };

  let mockClient: any;
  let mockCategoryRepo: ISupabaseCategoryRepository;
  let repo: ISupabaseBudgetRepository;

  beforeEach(() => {
    mockClient = {
      from: vi.fn()
    };
    mockCategoryRepo = {
      insert: vi.fn(),
      updatePartial: vi.fn(),
      findById: vi.fn().mockResolvedValue(expenseCategory),
      findAll: vi.fn(),
      findByNameAndType: vi.fn()
    };
    repo = new SupabaseBudgetRepository(mockClient, mockCategoryRepo);
  });

  function createSelectQueryMock(result: { data: any; error: any }) {
    const chain: any = {
      eq: vi.fn(() => chain),
      is: vi.fn(() => chain),
      select: vi.fn(() => chain),
      order: vi.fn().mockResolvedValue(result),
      maybeSingle: vi.fn().mockResolvedValue(result),
      single: vi.fn().mockResolvedValue(result)
    };
    return chain;
  }

  describe('insert', () => {
    it('rejects unauthenticated insert and non-null deleted_at', async () => {
      await expect(repo.insert({ ...sampleBudget, user_id: '' })).rejects.toThrow(SyncAuthError);
      await expect(repo.insert({ ...sampleBudget, deleted_at: iso2 })).rejects.toThrow(
        /deleted_at already set/
      );
    });

    it('rejects insert when category does not exist or belongs to another user', async () => {
      vi.mocked(mockCategoryRepo.findById).mockResolvedValueOnce(null);
      await expect(repo.insert(sampleBudget)).rejects.toThrow(SyncUnresolvedCategoryError);

      vi.mocked(mockCategoryRepo.findById).mockResolvedValueOnce({
        ...expenseCategory,
        user_id: otherUserId
      });
      await expect(repo.insert(sampleBudget)).rejects.toThrow(SyncUnresolvedCategoryError);
    });

    it('rejects insert when referenced category is income rather than expense', async () => {
      vi.mocked(mockCategoryRepo.findById).mockResolvedValueOnce({
        ...expenseCategory,
        type: 'income'
      });

      await expect(repo.insert(sampleBudget)).rejects.toThrow(/must be of type expense/);
    });

    it('inserts valid budget row and returns persisted row', async () => {
      const insertChain = {
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: sampleBudget, error: null })
        })
      };
      mockClient.from.mockReturnValue({
        insert: vi.fn().mockReturnValue(insertChain)
      });

      const persisted = await repo.insert(sampleBudget);
      expect(persisted).toEqual(sampleBudget);
      expect(mockClient.from).toHaveBeenCalledWith('budgets');
    });

    it('handles 23505 idempotently when identical active budget already exists', async () => {
      const insertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { code: '23505', message: 'duplicate key value violates unique constraint' }
          })
        })
      });
      const selectChain = createSelectQueryMock({ data: sampleBudget, error: null });

      mockClient.from.mockReturnValue({
        insert: insertMock,
        select: vi.fn().mockReturnValue(selectChain)
      });

      const result = await repo.insert(sampleBudget);
      expect(result).toEqual(sampleBudget);
    });

    it('rejects 23505 when the same budget ID is already tombstoned (never reactivates deleted ID)', async () => {
      const insertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { code: '23505', message: 'duplicate primary key' }
          })
        })
      });
      const selectChain = createSelectQueryMock({
        data: { ...sampleBudget, version: 2, deleted_at: iso2 },
        error: null
      });

      mockClient.from.mockReturnValue({
        insert: insertMock,
        select: vi.fn().mockReturnValue(selectChain)
      });

      await expect(repo.insert(sampleBudget)).rejects.toThrow(SyncConflictError);
    });

    it('rejects 23505 with SyncConflictError when another active budget already occupies (category_id, period)', async () => {
      const insertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { code: '23505', message: 'idx_budgets_active_user_category_period' }
          })
        })
      });

      let selectCallCount = 0;
      mockClient.from.mockImplementation(() => ({
        insert: insertMock,
        select: vi.fn().mockImplementation(() => {
          selectCallCount++;
          if (selectCallCount === 1) {
            // findById returns null (different budget ID!)
            return createSelectQueryMock({ data: null, error: null });
          }
          // findActiveByCategoryAndPeriod finds active occupant
          return createSelectQueryMock({
            data: { ...sampleBudget, id: otherBudgetId },
            error: null
          });
        })
      }));

      await expect(repo.insert(sampleBudget)).rejects.toThrow(/already exists in cloud for category/);
    });

    it('translates PostgreSQL error 23503 and 42501 appropriately', async () => {
      mockClient.from.mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { code: '23503', message: 'fk violation' }
            })
          })
        })
      });
      await expect(repo.insert(sampleBudget)).rejects.toThrow(SyncUnresolvedCategoryError);

      mockClient.from.mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { code: '42501', message: 'rls violation' }
            })
          })
        })
      });
      await expect(repo.insert(sampleBudget)).rejects.toThrow(SyncDatabaseError);
    });
  });

  describe('updatePartial', () => {
    it('applies OCC update, sanitizes immutable fields, and enforces active non-tombstoned row', async () => {
      const updatedRow: CloudBudgetRow = {
        ...sampleBudget,
        limit_paise: 1800000,
        version: 2,
        updated_at: iso2
      };
      const updateSpy = vi.fn().mockReturnValue(createSelectQueryMock({ data: updatedRow, error: null }));
      mockClient.from.mockReturnValue({ update: updateSpy });

      const result = await repo.updatePartial(
        budgetId,
        userId,
        {
          id: otherBudgetId,
          user_id: otherUserId,
          category_id: otherBudgetId,
          period: '2030-01',
          deleted_at: iso2,
          limit_paise: 1800000,
          version: 2,
          updated_at: iso2
        },
        1
      );

      expect(result).toEqual(updatedRow);
      const passedPatch = updateSpy.mock.calls[0][0];
      expect(passedPatch).toEqual({
        limit_paise: 1800000,
        version: 2,
        updated_at: iso2
      });
    });

    it('returns idempotently when cloud row is already at target version with matching limit', async () => {
      const committedRow: CloudBudgetRow = {
        ...sampleBudget,
        limit_paise: 1800000,
        version: 2,
        updated_at: iso2
      };

      mockClient.from.mockReturnValue({
        update: vi.fn().mockReturnValue(createSelectQueryMock({ data: null, error: null })),
        select: vi.fn().mockReturnValue(createSelectQueryMock({ data: committedRow, error: null }))
      });

      const result = await repo.updatePartial(
        budgetId,
        userId,
        { limit_paise: 1800000, version: 2 },
        1
      );
      expect(result).toEqual(committedRow);
    });

    it('rejects update with SyncConflictError when target row is tombstoned or version drifted', async () => {
      mockClient.from.mockReturnValue({
        update: vi.fn().mockReturnValue(createSelectQueryMock({ data: null, error: null })),
        select: vi.fn().mockReturnValue(
          createSelectQueryMock({
            data: { ...sampleBudget, version: 2, deleted_at: iso2 },
            error: null
          })
        )
      });

      await expect(
        repo.updatePartial(budgetId, userId, { limit_paise: 1800000, version: 2 }, 1)
      ).rejects.toThrow(/tombstoned/);

      mockClient.from.mockReturnValue({
        update: vi.fn().mockReturnValue(createSelectQueryMock({ data: null, error: null })),
        select: vi.fn().mockReturnValue(
          createSelectQueryMock({
            data: { ...sampleBudget, version: 3 },
            error: null
          })
        )
      });

      await expect(
        repo.updatePartial(budgetId, userId, { limit_paise: 1800000, version: 2 }, 1)
      ).rejects.toThrow(/Version conflict/);
    });
  });

  describe('softDelete', () => {
    it('executes tombstone UPDATE via deleted_at (never physical DELETE) and validates version', async () => {
      const tombstoned: CloudBudgetRow = {
        ...sampleBudget,
        version: 2,
        deleted_at: iso2,
        updated_at: iso2
      };
      const updateSpy = vi.fn().mockReturnValue(createSelectQueryMock({ data: tombstoned, error: null }));
      const deleteSpy = vi.fn();
      mockClient.from.mockReturnValue({
        update: updateSpy,
        delete: deleteSpy
      });

      const result = await repo.softDelete(budgetId, userId, iso2, 1, 2);
      expect(result).toEqual(tombstoned);
      expect(deleteSpy).not.toHaveBeenCalled();
      expect(updateSpy.mock.calls[0][0]).toMatchObject({
        deleted_at: iso2,
        version: 2
      });
    });

    it('handles softDelete idempotent retry cleanly when already tombstoned at target version', async () => {
      const tombstoned: CloudBudgetRow = {
        ...sampleBudget,
        version: 2,
        deleted_at: iso2
      };

      mockClient.from.mockReturnValue({
        update: vi.fn().mockReturnValue(createSelectQueryMock({ data: null, error: null })),
        select: vi.fn().mockReturnValue(createSelectQueryMock({ data: tombstoned, error: null }))
      });

      const result = await repo.softDelete(budgetId, userId, iso2, 1, 2);
      expect(result).toEqual(tombstoned);
    });

    it('rejects softDelete when cloud version is ahead', async () => {
      mockClient.from.mockReturnValue({
        update: vi.fn().mockReturnValue(createSelectQueryMock({ data: null, error: null })),
        select: vi.fn().mockReturnValue(
          createSelectQueryMock({
            data: { ...sampleBudget, version: 4 },
            error: null
          })
        )
      });

      await expect(repo.softDelete(budgetId, userId, iso2, 1, 2)).rejects.toThrow(SyncConflictError);
    });
  });

  describe('reads and tenant isolation', () => {
    it('excludes tombstones by default and returns them when includeDeleted is true', async () => {
      const tombstoned: CloudBudgetRow = {
        ...sampleBudget,
        id: otherBudgetId,
        version: 2,
        deleted_at: iso2
      };

      const defaultChain = createSelectQueryMock({
        data: [sampleBudget, tombstoned],
        error: null
      });
      mockClient.from.mockReturnValue({ select: vi.fn().mockReturnValue(defaultChain) });

      const activeOnly = await repo.findAll(userId);
      expect(activeOnly).toEqual([sampleBudget]);
      expect(defaultChain.is).toHaveBeenCalledWith('deleted_at', null);

      const withDeletedChain = createSelectQueryMock({
        data: [sampleBudget, tombstoned],
        error: null
      });
      mockClient.from.mockReturnValue({ select: vi.fn().mockReturnValue(withDeletedChain) });

      const all = await repo.findAll(userId, { includeDeleted: true });
      expect(all).toHaveLength(2);
      expect(withDeletedChain.is).not.toHaveBeenCalled();
    });

    it('rejects retrieved rows belonging to another user with SyncAuthError', async () => {
      const foreignRow: CloudBudgetRow = { ...sampleBudget, user_id: otherUserId };
      mockClient.from.mockReturnValue({
        select: vi.fn().mockReturnValue(createSelectQueryMock({ data: foreignRow, error: null }))
      });

      await expect(repo.findById(budgetId, userId)).rejects.toThrow(SyncAuthError);
    });
  });
});

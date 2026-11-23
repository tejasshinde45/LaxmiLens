import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CategorySyncDispatcher } from '@/infrastructure/sync/dispatchers/CategorySyncDispatcher';
import { ISupabaseCategoryRepository } from '@/infrastructure/database/cloud/repositories/SupabaseCategoryRepository';
import { AuthPort } from '@/application/ports/AuthPort';
import { OutboxManager } from '@/infrastructure/sync/OutboxManager';
import { ICategoryResolver } from '@/infrastructure/sync/CategoryMappingService';
import { LocalOutboxRecord } from '@/infrastructure/database/local/schema';
import {
  SyncAuthError,
  SyncInProgressError
} from '@/infrastructure/sync/errors/SyncErrors';
import { CloudCategoryRow } from '@/infrastructure/database/cloud/mappers/CategoryMapper';

describe('CategorySyncDispatcher', () => {
  const validCatId = '11111111-1111-4111-8111-111111111111';
  const validUserId = '22222222-2222-4222-8222-222222222222';
  const otherUserId = '33333333-3333-4333-8333-333333333333';
  const validIso = '2026-03-01T10:00:00.000Z';

  let mockRepo: ISupabaseCategoryRepository;
  let mockAuth: AuthPort;
  let mockOutboxManager: OutboxManager;
  let mockMappingService: ICategoryResolver;
  let dispatcher: CategorySyncDispatcher;

  beforeEach(() => {
    mockRepo = {
      insert: vi.fn(),
      updatePartial: vi.fn(),
      findById: vi.fn(),
      findAll: vi.fn(),
      findByNameAndType: vi.fn()
    };

    mockAuth = {
      getCurrentUser: vi.fn().mockResolvedValue({
        id: validUserId,
        email: 'user@example.com'
      }),
      getSession: vi.fn(),
      signInWithPassword: vi.fn(),
      signUpWithPassword: vi.fn(),
      signInWithOAuth: vi.fn(),
      signOut: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      updatePassword: vi.fn(),
      onAuthStateChange: vi.fn().mockReturnValue(() => {})
    };

    mockOutboxManager = {
      markSuccess: vi.fn().mockResolvedValue(undefined),
      markFailure: vi.fn().mockResolvedValue(undefined)
    } as unknown as OutboxManager;

    mockMappingService = {
      getMapping: vi.fn().mockResolvedValue(null),
      setMapping: vi.fn().mockResolvedValue(undefined),
      resolveCategory: vi.fn().mockResolvedValue(validCatId)
    };

    dispatcher = new CategorySyncDispatcher(
      mockRepo,
      mockAuth,
      mockOutboxManager,
      mockMappingService
    );
  });

  describe('Validation & Authorization', () => {
    it('rejects unsupported entity', async () => {
      const entry: LocalOutboxRecord = {
        id: 1,
        entity: 'budgets' as any,
        entityId: validCatId,
        operation: 'INSERT',
        payload: {},
        idempotencyKey: 'k-1',
        attempts: 0,
        createdAt: validIso
      };

      await expect(dispatcher.dispatch(entry)).rejects.toThrow(/only processes 'categories'/);
    });

    it('rejects unsupported operation', async () => {
      const entry: LocalOutboxRecord = {
        id: 2,
        entity: 'categories',
        entityId: validCatId,
        operation: 'DELETE',
        payload: {},
        idempotencyKey: 'k-2',
        attempts: 0,
        createdAt: validIso
      };

      await expect(dispatcher.dispatch(entry)).rejects.toThrow(/only processes 'INSERT' and 'UPDATE'/);
    });

    it('rejects unauthenticated user with SyncAuthError', async () => {
      mockAuth.getCurrentUser = vi.fn().mockResolvedValue(null);

      const entry: LocalOutboxRecord = {
        id: 3,
        entity: 'categories',
        entityId: validCatId,
        operation: 'INSERT',
        payload: { id: validCatId, user_id: validUserId, name: 'Food', type: 'expense' },
        idempotencyKey: 'k-3',
        attempts: 0,
        createdAt: validIso
      };

      await expect(dispatcher.dispatch(entry)).rejects.toThrow(SyncAuthError);
    });

    it('rejects payload ID mismatch with entityId', async () => {
      const entry: LocalOutboxRecord = {
        id: 4,
        entity: 'categories',
        entityId: validCatId,
        operation: 'INSERT',
        payload: {
          id: '44444444-4444-4444-8444-444444444444',
          user_id: validUserId,
          name: 'Food',
          type: 'expense'
        },
        idempotencyKey: 'k-4',
        attempts: 0,
        createdAt: validIso
      };

      await expect(dispatcher.dispatch(entry)).rejects.toThrow(/does not match entityId/);
    });

    it('rejects cross-tenant payload user_id mismatch with SyncAuthError', async () => {
      const entry: LocalOutboxRecord = {
        id: 5,
        entity: 'categories',
        entityId: validCatId,
        operation: 'INSERT',
        payload: { id: validCatId, user_id: otherUserId, name: 'Food', type: 'expense' },
        idempotencyKey: 'k-5',
        attempts: 0,
        createdAt: validIso
      };

      await expect(dispatcher.dispatch(entry)).rejects.toThrow(SyncAuthError);
    });
  });

  describe('INSERT Dispatch', () => {
    it('dispatches valid INSERT to cloud repo and records mapping', async () => {
      const persistedCategory: CloudCategoryRow = {
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

      mockRepo.insert = vi.fn().mockResolvedValue(persistedCategory);

      const entry: LocalOutboxRecord = {
        id: 10,
        entity: 'categories',
        entityId: validCatId,
        operation: 'INSERT',
        payload: {
          id: validCatId,
          user_id: validUserId,
          name: 'Groceries',
          type: 'expense',
          icon: 'ShoppingCart',
          color: '#D9827C',
          version: 1
        },
        idempotencyKey: 'k-10',
        attempts: 0,
        createdAt: validIso
      };

      await dispatcher.dispatch(entry);

      expect(mockRepo.insert).toHaveBeenCalledTimes(1);
      expect(mockMappingService.setMapping).toHaveBeenCalledWith(validCatId, validCatId, validUserId);
      expect(mockOutboxManager.markSuccess).toHaveBeenCalledWith(10);
      expect(mockOutboxManager.markFailure).not.toHaveBeenCalled();
    });
  });

  describe('UPDATE Dispatch', () => {
    it('dispatches valid UPDATE with version progression and acknowledges outbox', async () => {
      const updatedCategory: CloudCategoryRow = {
        id: validCatId,
        user_id: validUserId,
        name: 'Household & Groceries',
        type: 'expense',
        icon: 'ShoppingCart',
        color: '#D9827C',
        is_default: false,
        is_archived: false,
        version: 2,
        created_at: validIso,
        updated_at: validIso
      };

      mockRepo.updatePartial = vi.fn().mockResolvedValue(updatedCategory);

      const entry: LocalOutboxRecord = {
        id: 20,
        entity: 'categories',
        entityId: validCatId,
        operation: 'UPDATE',
        payload: {
          id: validCatId,
          name: 'Household & Groceries',
          version: 2
        },
        idempotencyKey: 'k-20',
        attempts: 0,
        createdAt: validIso
      };

      await dispatcher.dispatch(entry);

      expect(mockRepo.updatePartial).toHaveBeenCalledWith(
        validCatId,
        validUserId,
        expect.objectContaining({ name: 'Household & Groceries', version: 2 }),
        1
      );
      expect(mockOutboxManager.markSuccess).toHaveBeenCalledWith(20);
    });

    it('rejects UPDATE with version < 2', async () => {
      const entry: LocalOutboxRecord = {
        id: 21,
        entity: 'categories',
        entityId: validCatId,
        operation: 'UPDATE',
        payload: {
          id: validCatId,
          name: 'Household',
          version: 1 // must be >= 2
        },
        idempotencyKey: 'k-21',
        attempts: 0,
        createdAt: validIso
      };

      await expect(dispatcher.dispatch(entry)).rejects.toThrow(/Invalid target version/);
      expect(mockOutboxManager.markFailure).toHaveBeenCalledWith(21, expect.stringContaining('Invalid target version'));
      expect(mockOutboxManager.markSuccess).not.toHaveBeenCalled();
    });
  });

  describe('Error handling & Failure retention', () => {
    it('records error metadata and preserves entry upon repository failure', async () => {
      mockRepo.insert = vi.fn().mockRejectedValue(new Error('Network timeout'));

      const entry: LocalOutboxRecord = {
        id: 30,
        entity: 'categories',
        entityId: validCatId,
        operation: 'INSERT',
        payload: {
          id: validCatId,
          user_id: validUserId,
          name: 'Food',
          type: 'expense'
        },
        idempotencyKey: 'k-30',
        attempts: 0,
        createdAt: validIso
      };

      await expect(dispatcher.dispatch(entry)).rejects.toThrow('Network timeout');
      expect(mockOutboxManager.markFailure).toHaveBeenCalledWith(30, 'Network timeout');
      expect(mockOutboxManager.markSuccess).not.toHaveBeenCalled();
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TransactionSyncDispatcher } from '@/infrastructure/sync/dispatchers/TransactionSyncDispatcher';
import { ISupabaseTransactionRepository } from '@/infrastructure/database/cloud/repositories/SupabaseTransactionRepository';
import { AuthPort, AuthUser } from '@/application/ports/AuthPort';
import { OutboxManager } from '@/infrastructure/sync/OutboxManager';
import { LocalOutboxRecord } from '@/infrastructure/database/local/schema';
import { CloudTransactionRow } from '@/infrastructure/database/cloud/mappers/TransactionMapper';
import {
  SyncAuthError,
  SyncConflictError,
  SyncDatabaseError,
  SyncInProgressError,
  SyncUnresolvedCategoryError,
  SyncAccountDependencyError
} from '@/infrastructure/sync/errors/SyncErrors';

describe('TransactionSyncDispatcher', () => {
  const validTxId = '11111111-1111-4111-8111-111111111111';
  const validUserId = '22222222-2222-4222-8222-222222222222';
  const validSourceAccId = '33333333-3333-4333-8333-333333333333';
  const validDestAccId = '44444444-4444-4444-8444-444444444444';
  const validDateIso = '2026-11-21T12:00:00.000Z';

  const mockUser: AuthUser = {
    id: validUserId,
    email: 'user@example.com'
  };

  const sampleExpenseRow: CloudTransactionRow = {
    id: validTxId,
    user_id: validUserId,
    type: 'expense',
    amount_paise: 50000,
    currency: 'INR',
    account_id: validSourceAccId,
    destination_account_id: null,
    category_id: null,
    title: 'Groceries',
    note: 'Weekly essentials',
    transaction_date: validDateIso,
    deleted_at: null,
    version: 1,
    device_id: 'dev-1',
    idempotency_key: 'idemp-1',
    created_at: validDateIso,
    updated_at: validDateIso
  };

  let mockRepo: ISupabaseTransactionRepository;
  let mockAuthPort: AuthPort;
  let mockOutboxManager: OutboxManager;
  let dispatcher: TransactionSyncDispatcher;

  beforeEach(() => {
    mockRepo = {
      insert: vi.fn().mockResolvedValue(sampleExpenseRow),
      updatePartial: vi.fn().mockResolvedValue({ ...sampleExpenseRow, version: 2, title: 'Updated' }),
      softDelete: vi.fn().mockResolvedValue({ ...sampleExpenseRow, version: 2, deleted_at: validDateIso }),
      findById: vi.fn().mockResolvedValue(sampleExpenseRow),
      findByIdempotencyKey: vi.fn().mockResolvedValue(null)
    };

    mockAuthPort = {
      getCurrentUser: vi.fn().mockResolvedValue(mockUser),
      signInWithEmail: vi.fn(),
      signUpWithEmail: vi.fn(),
      signInWithOAuth: vi.fn(),
      signOut: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      updatePassword: vi.fn(),
      onAuthStateChange: vi.fn().mockReturnValue(() => {})
    };

    mockOutboxManager = {
      markSuccess: vi.fn().mockResolvedValue(undefined),
      markFailure: vi.fn().mockResolvedValue(undefined),
      enqueue: vi.fn(),
      getPendingCount: vi.fn(),
      getPendingEntries: vi.fn(),
      clearOutbox: vi.fn(),
      processOutbox: vi.fn()
    } as unknown as OutboxManager;

    dispatcher = new TransactionSyncDispatcher(mockRepo, mockAuthPort, mockOutboxManager);
  });

  describe('1. Successful INSERT dispatch', () => {
    it('successfully dispatches INSERT outbox record and marks outbox success', async () => {
      const entry: LocalOutboxRecord = {
        id: 101,
        entity: 'transactions',
        entityId: validTxId,
        operation: 'INSERT',
        payload: {
          id: validTxId,
          user_id: validUserId,
          type: 'expense',
          amount_paise: 50000,
          currency: 'INR',
          account_id: validSourceAccId,
          destination_account_id: null,
          category_id: null,
          title: 'Groceries',
          note: 'Weekly essentials',
          transaction_date: validDateIso,
          deleted_at: null,
          version: 1,
          device_id: 'dev-1',
          idempotency_key: 'idemp-1'
        },
        idempotencyKey: 'idemp-1',
        attempts: 0,
        createdAt: validDateIso
      };

      await dispatcher.dispatch(entry);

      expect(mockAuthPort.getCurrentUser).toHaveBeenCalled();
      expect(mockRepo.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          id: validTxId,
          user_id: validUserId,
          type: 'expense',
          amount_paise: 50000,
          account_id: validSourceAccId,
          category_id: null,
          version: 1
        })
      );
      expect(mockOutboxManager.markSuccess).toHaveBeenCalledWith(101);
      expect(mockOutboxManager.markFailure).not.toHaveBeenCalled();
    });
  });

  describe('2. Successful UPDATE dispatch', () => {
    it('successfully dispatches UPDATE outbox record and marks outbox success', async () => {
      const entry: LocalOutboxRecord = {
        id: 102,
        entity: 'transactions',
        entityId: validTxId,
        operation: 'UPDATE',
        payload: {
          id: validTxId,
          user_id: validUserId,
          title: 'Updated Groceries Title',
          amount_paise: 65000,
          version: 2
        },
        idempotencyKey: 'idemp-2',
        attempts: 0,
        createdAt: validDateIso
      };

      await dispatcher.dispatch(entry);

      expect(mockRepo.updatePartial).toHaveBeenCalledWith(
        validTxId,
        validUserId,
        expect.objectContaining({
          title: 'Updated Groceries Title',
          amount_paise: 65000,
          version: 2
        }),
        1 // expectedVersion = targetVersion (2) - 1
      );
      expect(mockOutboxManager.markSuccess).toHaveBeenCalledWith(102);
      expect(mockOutboxManager.markFailure).not.toHaveBeenCalled();
    });
  });

  describe('3. Successful soft-delete dispatch', () => {
    it('successfully dispatches DELETE outbox record via repository.softDelete', async () => {
      const deletedAt = '2026-11-21T13:00:00.000Z';
      const entry: LocalOutboxRecord = {
        id: 103,
        entity: 'transactions',
        entityId: validTxId,
        operation: 'DELETE',
        payload: {
          id: validTxId,
          user_id: validUserId,
          deleted_at: deletedAt,
          version: 2
        },
        idempotencyKey: 'idemp-3',
        attempts: 0,
        createdAt: validDateIso
      };

      await dispatcher.dispatch(entry);

      expect(mockRepo.softDelete).toHaveBeenCalledWith(
        validTxId,
        validUserId,
        deletedAt,
        1, // expectedVersion
        2  // targetVersion
      );
      expect(mockOutboxManager.markSuccess).toHaveBeenCalledWith(103);
      expect(mockOutboxManager.markFailure).not.toHaveBeenCalled();
    });
  });

  describe('4. Missing authenticated user', () => {
    it('rejects dispatch when authPort returns null user', async () => {
      mockAuthPort.getCurrentUser = vi.fn().mockResolvedValue(null);

      const entry: LocalOutboxRecord = {
        id: 104,
        entity: 'transactions',
        entityId: validTxId,
        operation: 'INSERT',
        payload: { id: validTxId, user_id: validUserId, version: 1 },
        idempotencyKey: 'k-4',
        attempts: 0,
        createdAt: validDateIso
      };

      await expect(dispatcher.dispatch(entry)).rejects.toThrow(SyncAuthError);
      expect(mockRepo.insert).not.toHaveBeenCalled();
      expect(mockOutboxManager.markFailure).toHaveBeenCalledWith(104, expect.stringContaining('not authenticated'));
      expect(mockOutboxManager.markSuccess).not.toHaveBeenCalled();
    });
  });

  describe('5. Payload user ID mismatch', () => {
    it('rejects INSERT when payload user_id differs from authenticated user', async () => {
      const entry: LocalOutboxRecord = {
        id: 105,
        entity: 'transactions',
        entityId: validTxId,
        operation: 'INSERT',
        payload: {
          id: validTxId,
          user_id: '99999999-9999-4999-8999-999999999999',
          type: 'expense',
          amount_paise: 50000,
          currency: 'INR',
          account_id: validSourceAccId,
          title: 'Test',
          transaction_date: validDateIso,
          version: 1,
          idempotency_key: 'k-5'
        },
        idempotencyKey: 'k-5',
        attempts: 0,
        createdAt: validDateIso
      };

      await expect(dispatcher.dispatch(entry)).rejects.toThrow(SyncAuthError);
      expect(mockRepo.insert).not.toHaveBeenCalled();
      expect(mockOutboxManager.markFailure).toHaveBeenCalledWith(105, expect.stringContaining('does not match authenticated user'));
    });

    it('rejects UPDATE when supplied payload user_id differs from authenticated user', async () => {
      const entry: LocalOutboxRecord = {
        id: 106,
        entity: 'transactions',
        entityId: validTxId,
        operation: 'UPDATE',
        payload: {
          id: validTxId,
          user_id: '99999999-9999-4999-8999-999999999999',
          title: 'Update with bad owner',
          version: 2
        },
        idempotencyKey: 'k-6',
        attempts: 0,
        createdAt: validDateIso
      };

      await expect(dispatcher.dispatch(entry)).rejects.toThrow(SyncAuthError);
      expect(mockRepo.updatePartial).not.toHaveBeenCalled();
      expect(mockOutboxManager.markFailure).toHaveBeenCalledWith(106, expect.stringContaining('does not match authenticated user'));
    });
  });

  describe('6. Outbox entity ID mismatch', () => {
    it('rejects dispatch when payload ID does not match outbox entityId', async () => {
      const entry: LocalOutboxRecord = {
        id: 107,
        entity: 'transactions',
        entityId: validTxId,
        operation: 'INSERT',
        payload: {
          id: '88888888-8888-4888-8888-888888888888', // Mismatched ID
          user_id: validUserId,
          version: 1
        },
        idempotencyKey: 'k-7',
        attempts: 0,
        createdAt: validDateIso
      };

      await expect(dispatcher.dispatch(entry)).rejects.toThrow(/Payload ID '.*' does not match entityId/);
      expect(mockRepo.insert).not.toHaveBeenCalled();
      expect(mockOutboxManager.markFailure).toHaveBeenCalledWith(107, expect.any(String));
    });
  });

  describe('7. Unsupported operation rejection', () => {
    it('rejects unsupported operation on transactions entity', async () => {
      const entry: LocalOutboxRecord = {
        id: 108,
        entity: 'transactions',
        entityId: validTxId,
        operation: 'ARCHIVE' as any,
        payload: { id: validTxId, version: 2 },
        idempotencyKey: 'k-8',
        attempts: 0,
        createdAt: validDateIso
      };

      await expect(dispatcher.dispatch(entry)).rejects.toThrow(/TransactionSyncDispatcher only processes 'INSERT', 'UPDATE', and 'DELETE'/);
      expect(mockOutboxManager.markFailure).toHaveBeenCalledWith(108, expect.any(String));
    });

    it('rejects non-transactions entity', async () => {
      const entry: LocalOutboxRecord = {
        id: 109,
        entity: 'accounts',
        entityId: validTxId,
        operation: 'INSERT',
        payload: { id: validTxId },
        idempotencyKey: 'k-9',
        attempts: 0,
        createdAt: validDateIso
      };

      await expect(dispatcher.dispatch(entry)).rejects.toThrow(/TransactionSyncDispatcher only processes 'transactions' entities/);
      expect(mockOutboxManager.markFailure).toHaveBeenCalledWith(109, expect.any(String));
    });
  });

  describe('8. Invalid payload rejection', () => {
    it('rejects INSERT payload with negative amount', async () => {
      const entry: LocalOutboxRecord = {
        id: 110,
        entity: 'transactions',
        entityId: validTxId,
        operation: 'INSERT',
        payload: {
          id: validTxId,
          user_id: validUserId,
          type: 'expense',
          amount_paise: -500, // Invalid
          currency: 'INR',
          account_id: validSourceAccId,
          title: 'Negative Amount',
          transaction_date: validDateIso,
          version: 1,
          idempotency_key: 'k-10'
        },
        idempotencyKey: 'k-10',
        attempts: 0,
        createdAt: validDateIso
      };

      await expect(dispatcher.dispatch(entry)).rejects.toThrow();
      expect(mockRepo.insert).not.toHaveBeenCalled();
      expect(mockOutboxManager.markFailure).toHaveBeenCalledWith(110, expect.any(String));
    });
  });

  describe('9. Strict expected version validation and integrity', () => {
    describe('UPDATE expected version validation', () => {
      it('safely derives canonical expectedVersion = V - 1 when neither alias is supplied', async () => {
        const entry: LocalOutboxRecord = {
          id: 111,
          entity: 'transactions',
          entityId: validTxId,
          operation: 'UPDATE',
          payload: {
            id: validTxId,
            user_id: validUserId,
            title: 'No Alias Supplied',
            version: 5
          },
          idempotencyKey: 'k-111',
          attempts: 0,
          createdAt: validDateIso
        };

        await dispatcher.dispatch(entry);

        expect(mockRepo.updatePartial).toHaveBeenCalledWith(
          validTxId,
          validUserId,
          expect.any(Object),
          4 // 5 - 1
        );
      });

      it('accepts explicit expected_version equal to V - 1', async () => {
        const entry: LocalOutboxRecord = {
          id: 1111,
          entity: 'transactions',
          entityId: validTxId,
          operation: 'UPDATE',
          payload: {
            id: validTxId,
            user_id: validUserId,
            title: 'Explicit Snake Version',
            version: 3,
            expected_version: 2
          },
          idempotencyKey: 'k-1111',
          attempts: 0,
          createdAt: validDateIso
        };

        await dispatcher.dispatch(entry);

        expect(mockRepo.updatePartial).toHaveBeenCalledWith(
          validTxId,
          validUserId,
          expect.any(Object),
          2
        );
      });

      it('accepts explicit expectedVersion equal to V - 1', async () => {
        const entry: LocalOutboxRecord = {
          id: 1112,
          entity: 'transactions',
          entityId: validTxId,
          operation: 'UPDATE',
          payload: {
            id: validTxId,
            user_id: validUserId,
            title: 'Explicit Camel Version',
            version: 4,
            expectedVersion: 3
          },
          idempotencyKey: 'k-1112',
          attempts: 0,
          createdAt: validDateIso
        };

        await dispatcher.dispatch(entry);

        expect(mockRepo.updatePartial).toHaveBeenCalledWith(
          validTxId,
          validUserId,
          expect.any(Object),
          3
        );
      });

      it('accepts both aliases when both are valid and equal to V - 1', async () => {
        const entry: LocalOutboxRecord = {
          id: 1113,
          entity: 'transactions',
          entityId: validTxId,
          operation: 'UPDATE',
          payload: {
            id: validTxId,
            user_id: validUserId,
            title: 'Both Aliases Equal',
            version: 3,
            expected_version: 2,
            expectedVersion: 2
          },
          idempotencyKey: 'k-1113',
          attempts: 0,
          createdAt: validDateIso
        };

        await dispatcher.dispatch(entry);

        expect(mockRepo.updatePartial).toHaveBeenCalledWith(
          validTxId,
          validUserId,
          expect.any(Object),
          2
        );
      });

      it('rejects UPDATE when explicit expected_version contradicts V - 1 without calling repo', async () => {
        const entry: LocalOutboxRecord = {
          id: 1114,
          entity: 'transactions',
          entityId: validTxId,
          operation: 'UPDATE',
          payload: {
            id: validTxId,
            user_id: validUserId,
            title: 'Contradictory Expected Version',
            version: 3,
            expected_version: 99 // Should be 2
          },
          idempotencyKey: 'k-1114',
          attempts: 0,
          createdAt: validDateIso
        };

        await expect(dispatcher.dispatch(entry)).rejects.toThrow(
          /Inconsistent expected version/
        );
        expect(mockRepo.updatePartial).not.toHaveBeenCalled();
        expect(mockOutboxManager.markFailure).toHaveBeenCalledWith(
          1114,
          expect.stringContaining('Inconsistent expected version')
        );
      });

      it('rejects UPDATE when conflicting snake_case and camelCase aliases are supplied', async () => {
        const entry: LocalOutboxRecord = {
          id: 1115,
          entity: 'transactions',
          entityId: validTxId,
          operation: 'UPDATE',
          payload: {
            id: validTxId,
            user_id: validUserId,
            title: 'Conflicting Aliases',
            version: 3,
            expected_version: 2,
            expectedVersion: 1 // Disagrees
          },
          idempotencyKey: 'k-1115',
          attempts: 0,
          createdAt: validDateIso
        };

        await expect(dispatcher.dispatch(entry)).rejects.toThrow(
          /Conflicting expected version aliases/
        );
        expect(mockRepo.updatePartial).not.toHaveBeenCalled();
      });

      it.each([
        ['zero', 0],
        ['negative', -1],
        ['fraction', 1.5],
        ['string', '2'],
        ['null', null],
        ['boolean', true],
        ['unsafe integer', Number.MAX_SAFE_INTEGER + 2],
        ['NaN', NaN]
      ])('rejects UPDATE when explicit expected version is %s without calling repo', async (_label, invalidVal) => {
        const entry: LocalOutboxRecord = {
          id: 1116,
          entity: 'transactions',
          entityId: validTxId,
          operation: 'UPDATE',
          payload: {
            id: validTxId,
            user_id: validUserId,
            title: 'Invalid Explicit Version',
            version: 3,
            expected_version: invalidVal
          },
          idempotencyKey: 'k-1116',
          attempts: 0,
          createdAt: validDateIso
        };

        await expect(dispatcher.dispatch(entry)).rejects.toThrow(
          /must be a positive safe integer/
        );
        expect(mockRepo.updatePartial).not.toHaveBeenCalled();
      });

      it.each([
        ['missing', undefined],
        ['less than 2', 1],
        ['string', '2'],
        ['fractional', 2.5]
      ])('rejects UPDATE when target version is %s without calling repo', async (_label, invalidVersion) => {
        const entry: LocalOutboxRecord = {
          id: 1117,
          entity: 'transactions',
          entityId: validTxId,
          operation: 'UPDATE',
          payload: {
            id: validTxId,
            user_id: validUserId,
            title: 'Invalid Target Version',
            version: invalidVersion as any
          },
          idempotencyKey: 'k-1117',
          attempts: 0,
          createdAt: validDateIso
        };

        await expect(dispatcher.dispatch(entry)).rejects.toThrow(
          /Invalid target version/
        );
        expect(mockRepo.updatePartial).not.toHaveBeenCalled();
      });
    });

    describe('DELETE expected version validation', () => {
      it('safely derives canonical expectedVersion = V - 1 when neither alias is supplied', async () => {
        const entry: LocalOutboxRecord = {
          id: 112,
          entity: 'transactions',
          entityId: validTxId,
          operation: 'DELETE',
          payload: {
            id: validTxId,
            user_id: validUserId,
            deleted_at: validDateIso,
            version: 4
          },
          idempotencyKey: 'k-112',
          attempts: 0,
          createdAt: validDateIso
        };

        await dispatcher.dispatch(entry);

        expect(mockRepo.softDelete).toHaveBeenCalledWith(
          validTxId,
          validUserId,
          validDateIso,
          3, // expectedVersion = 4 - 1
          4  // targetVersion
        );
      });

      it('accepts DELETE with correct explicit expected_version equal to V - 1', async () => {
        const entry: LocalOutboxRecord = {
          id: 1121,
          entity: 'transactions',
          entityId: validTxId,
          operation: 'DELETE',
          payload: {
            id: validTxId,
            user_id: validUserId,
            deleted_at: validDateIso,
            version: 3,
            expected_version: 2
          },
          idempotencyKey: 'k-1121',
          attempts: 0,
          createdAt: validDateIso
        };

        await dispatcher.dispatch(entry);

        expect(mockRepo.softDelete).toHaveBeenCalledWith(
          validTxId,
          validUserId,
          validDateIso,
          2,
          3
        );
      });

      it('accepts DELETE with correct explicit expectedVersion equal to V - 1', async () => {
        const entry: LocalOutboxRecord = {
          id: 1122,
          entity: 'transactions',
          entityId: validTxId,
          operation: 'DELETE',
          payload: {
            id: validTxId,
            user_id: validUserId,
            deleted_at: validDateIso,
            version: 5,
            expectedVersion: 4
          },
          idempotencyKey: 'k-1122',
          attempts: 0,
          createdAt: validDateIso
        };

        await dispatcher.dispatch(entry);

        expect(mockRepo.softDelete).toHaveBeenCalledWith(
          validTxId,
          validUserId,
          validDateIso,
          4,
          5
        );
      });

      it('rejects DELETE when explicit expected_version contradicts V - 1 without calling repo', async () => {
        const entry: LocalOutboxRecord = {
          id: 1123,
          entity: 'transactions',
          entityId: validTxId,
          operation: 'DELETE',
          payload: {
            id: validTxId,
            user_id: validUserId,
            deleted_at: validDateIso,
            version: 3,
            expected_version: 99
          },
          idempotencyKey: 'k-1123',
          attempts: 0,
          createdAt: validDateIso
        };

        await expect(dispatcher.dispatch(entry)).rejects.toThrow(
          /Inconsistent expected version/
        );
        expect(mockRepo.softDelete).not.toHaveBeenCalled();
      });

      it('rejects DELETE when conflicting aliases are supplied', async () => {
        const entry: LocalOutboxRecord = {
          id: 1124,
          entity: 'transactions',
          entityId: validTxId,
          operation: 'DELETE',
          payload: {
            id: validTxId,
            user_id: validUserId,
            deleted_at: validDateIso,
            version: 3,
            expected_version: 2,
            expectedVersion: 1
          },
          idempotencyKey: 'k-1124',
          attempts: 0,
          createdAt: validDateIso
        };

        await expect(dispatcher.dispatch(entry)).rejects.toThrow(
          /Conflicting expected version aliases/
        );
        expect(mockRepo.softDelete).not.toHaveBeenCalled();
      });

      it('rejects DELETE when explicit expected version is null without calling repo', async () => {
        const entry: LocalOutboxRecord = {
          id: 1125,
          entity: 'transactions',
          entityId: validTxId,
          operation: 'DELETE',
          payload: {
            id: validTxId,
            user_id: validUserId,
            deleted_at: validDateIso,
            version: 3,
            expected_version: null
          },
          idempotencyKey: 'k-1125',
          attempts: 0,
          createdAt: validDateIso
        };

        await expect(dispatcher.dispatch(entry)).rejects.toThrow(
          /must be a positive safe integer/
        );
        expect(mockRepo.softDelete).not.toHaveBeenCalled();
      });

      it.each([
        ['missing', undefined],
        ['less than 2', 1],
        ['string', '2']
      ])('rejects DELETE when target version is %s without calling repo', async (_label, invalidVersion) => {
        const entry: LocalOutboxRecord = {
          id: 1126,
          entity: 'transactions',
          entityId: validTxId,
          operation: 'DELETE',
          payload: {
            id: validTxId,
            user_id: validUserId,
            deleted_at: validDateIso,
            version: invalidVersion as any
          },
          idempotencyKey: 'k-1126',
          attempts: 0,
          createdAt: validDateIso
        };

        await expect(dispatcher.dispatch(entry)).rejects.toThrow(
          /Invalid target version/
        );
        expect(mockRepo.softDelete).not.toHaveBeenCalled();
      });
    });
  });

  describe('10. Category rejection on INSERT', () => {
    it('rejects categorized INSERT with SyncUnresolvedCategoryError and retains entry in outbox', async () => {
      const entry: LocalOutboxRecord = {
        id: 113,
        entity: 'transactions',
        entityId: validTxId,
        operation: 'INSERT',
        payload: {
          id: validTxId,
          user_id: validUserId,
          type: 'expense',
          amount_paise: 50000,
          currency: 'INR',
          account_id: validSourceAccId,
          category_id: '55555555-5555-4555-8555-555555555555', // Unresolved category
          title: 'Groceries',
          transaction_date: validDateIso,
          version: 1,
          idempotency_key: 'k-13'
        },
        idempotencyKey: 'k-13',
        attempts: 0,
        createdAt: validDateIso
      };

      await expect(dispatcher.dispatch(entry)).rejects.toThrow(SyncUnresolvedCategoryError);
      expect(mockRepo.insert).not.toHaveBeenCalled();
      expect(mockOutboxManager.markFailure).toHaveBeenCalledWith(113, expect.stringContaining('Category reference'));
      expect(mockOutboxManager.markSuccess).not.toHaveBeenCalled();
    });
  });

  describe('11. Category rejection on UPDATE with omitted category_id', () => {
    it('propagates SyncUnresolvedCategoryError when repository detects cloud transaction is categorized', async () => {
      mockRepo.updatePartial = vi.fn().mockRejectedValue(
        new SyncUnresolvedCategoryError('Cannot update categorized transaction in cloud', 'cat-123')
      );

      const entry: LocalOutboxRecord = {
        id: 114,
        entity: 'transactions',
        entityId: validTxId,
        operation: 'UPDATE',
        payload: {
          id: validTxId,
          user_id: validUserId,
          title: 'Title update only', // category_id omitted
          version: 2
        },
        idempotencyKey: 'k-14',
        attempts: 0,
        createdAt: validDateIso
      };

      await expect(dispatcher.dispatch(entry)).rejects.toThrow(SyncUnresolvedCategoryError);
      expect(mockRepo.updatePartial).toHaveBeenCalled();
      expect(mockOutboxManager.markFailure).toHaveBeenCalledWith(114, expect.stringContaining('Cannot update categorized transaction'));
      expect(mockOutboxManager.markSuccess).not.toHaveBeenCalled();
    });

    it('rejects UPDATE directly in dispatcher when local payload specifies category_id', async () => {
      const entry: LocalOutboxRecord = {
        id: 115,
        entity: 'transactions',
        entityId: validTxId,
        operation: 'UPDATE',
        payload: {
          id: validTxId,
          user_id: validUserId,
          title: 'Categorized Update',
          category_id: '55555555-5555-4555-8555-555555555555',
          version: 2
        },
        idempotencyKey: 'k-15',
        attempts: 0,
        createdAt: validDateIso
      };

      await expect(dispatcher.dispatch(entry)).rejects.toThrow(SyncUnresolvedCategoryError);
      expect(mockRepo.updatePartial).not.toHaveBeenCalled();
      expect(mockOutboxManager.markFailure).toHaveBeenCalledWith(115, expect.stringContaining('Category reference'));
      expect(mockOutboxManager.markSuccess).not.toHaveBeenCalled();
    });
  });

  describe('12. Account dependency error propagation', () => {
    it('propagates SyncAccountDependencyError without transforming to generic auth error', async () => {
      mockRepo.insert = vi.fn().mockRejectedValue(
        new SyncAccountDependencyError('Referenced source account not found in cloud', validSourceAccId)
      );

      const entry: LocalOutboxRecord = {
        id: 116,
        entity: 'transactions',
        entityId: validTxId,
        operation: 'INSERT',
        payload: {
          id: validTxId,
          user_id: validUserId,
          type: 'expense',
          amount_paise: 50000,
          currency: 'INR',
          account_id: validSourceAccId,
          destination_account_id: null,
          category_id: null,
          title: 'Orphan Transaction',
          transaction_date: validDateIso,
          version: 1,
          idempotency_key: 'k-16'
        },
        idempotencyKey: 'k-16',
        attempts: 0,
        createdAt: validDateIso
      };

      await expect(dispatcher.dispatch(entry)).rejects.toThrow(SyncAccountDependencyError);
      expect(mockOutboxManager.markFailure).toHaveBeenCalledWith(116, expect.stringContaining('Referenced source account not found'));
      expect(mockOutboxManager.markSuccess).not.toHaveBeenCalled();
    });
  });

  describe('13. OCC conflict propagation', () => {
    it('propagates SyncConflictError on optimistic concurrency mismatch', async () => {
      mockRepo.updatePartial = vi.fn().mockRejectedValue(
        new SyncConflictError('Version conflict on transaction')
      );

      const entry: LocalOutboxRecord = {
        id: 117,
        entity: 'transactions',
        entityId: validTxId,
        operation: 'UPDATE',
        payload: {
          id: validTxId,
          user_id: validUserId,
          title: 'Stale Update',
          version: 2
        },
        idempotencyKey: 'k-17',
        attempts: 0,
        createdAt: validDateIso
      };

      await expect(dispatcher.dispatch(entry)).rejects.toThrow(SyncConflictError);
      expect(mockOutboxManager.markFailure).toHaveBeenCalledWith(117, expect.stringContaining('Version conflict'));
      expect(mockOutboxManager.markSuccess).not.toHaveBeenCalled();
    });
  });

  describe('14. Network failure handling', () => {
    it('propagates SyncDatabaseError on network or PostgREST failure', async () => {
      mockRepo.insert = vi.fn().mockRejectedValue(
        new SyncDatabaseError('Failed to fetch from Supabase', 'PGRST500')
      );

      const entry: LocalOutboxRecord = {
        id: 118,
        entity: 'transactions',
        entityId: validTxId,
        operation: 'INSERT',
        payload: {
          id: validTxId,
          user_id: validUserId,
          type: 'expense',
          amount_paise: 50000,
          currency: 'INR',
          account_id: validSourceAccId,
          destination_account_id: null,
          category_id: null,
          title: 'Network Fail',
          transaction_date: validDateIso,
          version: 1,
          idempotency_key: 'k-18'
        },
        idempotencyKey: 'k-18',
        attempts: 0,
        createdAt: validDateIso
      };

      await expect(dispatcher.dispatch(entry)).rejects.toThrow(SyncDatabaseError);
      expect(mockOutboxManager.markFailure).toHaveBeenCalledWith(118, expect.stringContaining('Failed to fetch'));
      expect(mockOutboxManager.markSuccess).not.toHaveBeenCalled();
    });
  });

  describe('15. Outbox acknowledgement only after repository success', () => {
    it('only calls markSuccess after repository remote persistence confirms', async () => {
      let repoResolved = false;
      mockRepo.insert = vi.fn().mockImplementation(async () => {
        expect(mockOutboxManager.markSuccess).not.toHaveBeenCalled();
        repoResolved = true;
        return sampleExpenseRow;
      });

      const entry: LocalOutboxRecord = {
        id: 119,
        entity: 'transactions',
        entityId: validTxId,
        operation: 'INSERT',
        payload: {
          id: validTxId,
          user_id: validUserId,
          type: 'expense',
          amount_paise: 50000,
          currency: 'INR',
          account_id: validSourceAccId,
          destination_account_id: null,
          category_id: null,
          title: 'Test Order',
          transaction_date: validDateIso,
          version: 1,
          idempotency_key: 'k-19'
        },
        idempotencyKey: 'k-19',
        attempts: 0,
        createdAt: validDateIso
      };

      await dispatcher.dispatch(entry);

      expect(repoResolved).toBe(true);
      expect(mockOutboxManager.markSuccess).toHaveBeenCalledWith(119);
    });
  });

  describe('16. Outbox retention after failure', () => {
    it('retains entry in outbox by calling markFailure and never calling markSuccess', async () => {
      mockRepo.insert = vi.fn().mockRejectedValue(new Error('Fatal database glitch'));

      const entry: LocalOutboxRecord = {
        id: 120,
        entity: 'transactions',
        entityId: validTxId,
        operation: 'INSERT',
        payload: {
          id: validTxId,
          user_id: validUserId,
          type: 'expense',
          amount_paise: 50000,
          currency: 'INR',
          account_id: validSourceAccId,
          destination_account_id: null,
          category_id: null,
          title: 'Retain Me',
          transaction_date: validDateIso,
          version: 1,
          idempotency_key: 'k-20'
        },
        idempotencyKey: 'k-20',
        attempts: 1,
        createdAt: validDateIso
      };

      await expect(dispatcher.dispatch(entry)).rejects.toThrow('Fatal database glitch');

      expect(mockOutboxManager.markFailure).toHaveBeenCalledWith(120, 'Fatal database glitch');
      expect(mockOutboxManager.markSuccess).not.toHaveBeenCalled();
    });
  });

  describe('17. Correct target version and deleted_at propagation', () => {
    it('correctly passes deleted_at and target version to repository.softDelete', async () => {
      const customDeletedAt = '2026-11-21T18:45:00.000Z';
      const entry: LocalOutboxRecord = {
        id: 121,
        entity: 'transactions',
        entityId: validTxId,
        operation: 'DELETE',
        payload: {
          id: validTxId,
          user_id: validUserId,
          deleted_at: customDeletedAt,
          version: 5
        },
        idempotencyKey: 'k-21',
        attempts: 0,
        createdAt: validDateIso
      };

      await dispatcher.dispatch(entry);

      expect(mockRepo.softDelete).toHaveBeenCalledWith(
        validTxId,
        validUserId,
        customDeletedAt,
        4, // expectedVersion = 5 - 1
        5  // targetVersion
      );
    });
  });

  describe('18. No physical DELETE operation', () => {
    it('routes outbox DELETE strictly to softDelete and has no physical delete method', async () => {
      const entry: LocalOutboxRecord = {
        id: 122,
        entity: 'transactions',
        entityId: validTxId,
        operation: 'DELETE',
        payload: {
          id: validTxId,
          user_id: validUserId,
          deleted_at: validDateIso,
          version: 2
        },
        idempotencyKey: 'k-22',
        attempts: 0,
        createdAt: validDateIso
      };

      await dispatcher.dispatch(entry);

      expect(mockRepo.softDelete).toHaveBeenCalled();
      // Verify no hard-delete method was called or exists on ISupabaseTransactionRepository
      expect((mockRepo as any).delete).toBeUndefined();
    });

    it('rejects DELETE when deleted_at is missing in payload', async () => {
      const entry: LocalOutboxRecord = {
        id: 1221,
        entity: 'transactions',
        entityId: validTxId,
        operation: 'DELETE',
        payload: {
          id: validTxId,
          user_id: validUserId,
          version: 2
          // deleted_at missing
        },
        idempotencyKey: 'k-22a',
        attempts: 0,
        createdAt: validDateIso
      };

      await expect(dispatcher.dispatch(entry)).rejects.toThrow(/Missing or invalid deleted_at/);
      expect(mockRepo.softDelete).not.toHaveBeenCalled();
      expect(mockOutboxManager.markFailure).toHaveBeenCalledWith(1221, expect.stringContaining('Missing or invalid deleted_at'));
    });

    it('rejects DELETE when deleted_at is an unparseable date string', async () => {
      const entry: LocalOutboxRecord = {
        id: 1222,
        entity: 'transactions',
        entityId: validTxId,
        operation: 'DELETE',
        payload: {
          id: validTxId,
          user_id: validUserId,
          deleted_at: 'not-a-date',
          version: 2
        },
        idempotencyKey: 'k-22b',
        attempts: 0,
        createdAt: validDateIso
      };

      await expect(dispatcher.dispatch(entry)).rejects.toThrow(/Invalid deleted_at/);
      expect(mockRepo.softDelete).not.toHaveBeenCalled();
      expect(mockOutboxManager.markFailure).toHaveBeenCalledWith(1222, expect.stringContaining('Invalid deleted_at'));
    });
  });

  describe('19. No accidental duplicate acknowledgement', () => {
    it('calls markSuccess at most once per dispatch invocation', async () => {
      const entry: LocalOutboxRecord = {
        id: 123,
        entity: 'transactions',
        entityId: validTxId,
        operation: 'INSERT',
        payload: {
          id: validTxId,
          user_id: validUserId,
          type: 'transfer',
          amount_paise: 100000,
          currency: 'INR',
          account_id: validSourceAccId,
          destination_account_id: validDestAccId,
          category_id: null,
          title: 'Transfer to Savings',
          transaction_date: validDateIso,
          version: 1,
          idempotency_key: 'k-23'
        },
        idempotencyKey: 'k-23',
        attempts: 0,
        createdAt: validDateIso
      };

      await dispatcher.dispatch(entry);

      expect(mockOutboxManager.markSuccess).toHaveBeenCalledTimes(1);
      expect(mockOutboxManager.markFailure).toHaveBeenCalledTimes(0);
    });
  });

  describe('20. No concurrent processing of events for the same transaction', () => {
    it('rejects concurrent dispatch for the same transaction entityId with SyncInProgressError', async () => {
      let resolveInsert: (val: CloudTransactionRow) => void;
      const delayedInsertPromise = new Promise<CloudTransactionRow>((resolve) => {
        resolveInsert = resolve;
      });

      mockRepo.insert = vi.fn().mockImplementation(() => delayedInsertPromise);

      const entry1: LocalOutboxRecord = {
        id: 124,
        entity: 'transactions',
        entityId: validTxId,
        operation: 'INSERT',
        payload: {
          id: validTxId,
          user_id: validUserId,
          type: 'expense',
          amount_paise: 50000,
          currency: 'INR',
          account_id: validSourceAccId,
          destination_account_id: null,
          category_id: null,
          title: 'Concurrent 1',
          transaction_date: validDateIso,
          version: 1,
          idempotency_key: 'k-24a'
        },
        idempotencyKey: 'k-24a',
        attempts: 0,
        createdAt: validDateIso
      };

      const entry2: LocalOutboxRecord = {
        id: 125,
        entity: 'transactions',
        entityId: validTxId, // SAME transaction ID
        operation: 'UPDATE',
        payload: {
          id: validTxId,
          user_id: validUserId,
          title: 'Concurrent 2',
          version: 2
        },
        idempotencyKey: 'k-24b',
        attempts: 0,
        createdAt: validDateIso
      };

      // Start dispatching entry1 (does not resolve immediately)
      const dispatchPromise1 = dispatcher.dispatch(entry1);

      // Attempt to dispatch entry2 concurrently for the SAME entityId
      await expect(dispatcher.dispatch(entry2)).rejects.toThrow(SyncInProgressError);

      // Now resolve entry1
      resolveInsert!(sampleExpenseRow);
      await dispatchPromise1;

      // After entry1 completes, subsequent dispatch for the same entityId is allowed
      mockRepo.updatePartial = vi.fn().mockResolvedValue({ ...sampleExpenseRow, version: 2 });
      await expect(dispatcher.dispatch(entry2)).resolves.not.toThrow();
    });

    it('allows concurrent dispatch for DIFFERENT transaction entityIds', async () => {
      const differentTxId = '55555555-5555-4555-8555-555555555555';

      let resolve1!: (val: CloudTransactionRow) => void;
      const delayedPromise1 = new Promise<CloudTransactionRow>((res) => { resolve1 = res; });

      let resolve2!: (val: CloudTransactionRow) => void;
      const delayedPromise2 = new Promise<CloudTransactionRow>((res) => { resolve2 = res; });

      mockRepo.insert = vi.fn().mockImplementation((row: CloudTransactionRow) => {
        if (row.id === validTxId) {
          return delayedPromise1;
        }
        return delayedPromise2;
      });

      const entryA: LocalOutboxRecord = {
        id: 126,
        entity: 'transactions',
        entityId: validTxId,
        operation: 'INSERT',
        payload: {
          id: validTxId,
          user_id: validUserId,
          type: 'expense',
          amount_paise: 10000,
          currency: 'INR',
          account_id: validSourceAccId,
          destination_account_id: null,
          category_id: null,
          title: 'Tx A',
          transaction_date: validDateIso,
          version: 1,
          idempotency_key: 'k-25a'
        },
        idempotencyKey: 'k-25a',
        attempts: 0,
        createdAt: validDateIso
      };

      const entryB: LocalOutboxRecord = {
        id: 127,
        entity: 'transactions',
        entityId: differentTxId, // DIFFERENT transaction ID
        operation: 'INSERT',
        payload: {
          id: differentTxId,
          user_id: validUserId,
          type: 'expense',
          amount_paise: 20000,
          currency: 'INR',
          account_id: validSourceAccId,
          destination_account_id: null,
          category_id: null,
          title: 'Tx B',
          transaction_date: validDateIso,
          version: 1,
          idempotency_key: 'k-25b'
        },
        idempotencyKey: 'k-25b',
        attempts: 0,
        createdAt: validDateIso
      };

      const promiseA = dispatcher.dispatch(entryA);
      const promiseB = dispatcher.dispatch(entryB);

      resolve1(sampleExpenseRow);
      resolve2({ ...sampleExpenseRow, id: differentTxId });

      await expect(Promise.all([promiseA, promiseB])).resolves.not.toThrow();
      expect(mockOutboxManager.markSuccess).toHaveBeenCalledWith(126);
      expect(mockOutboxManager.markSuccess).toHaveBeenCalledWith(127);
    });
  });

  describe('21. Outbox acknowledgement failure handling', () => {
    it('propagates error and marks failure if markSuccess rejects', async () => {
      mockRepo.insert = vi.fn().mockResolvedValue(sampleExpenseRow);
      const ackError = new Error('QuotaExceededError: IndexedDB full');
      mockOutboxManager.markSuccess = vi.fn().mockRejectedValue(ackError);

      const entry: LocalOutboxRecord = {
        id: 128,
        entity: 'transactions',
        entityId: validTxId,
        operation: 'INSERT',
        payload: {
          id: validTxId,
          user_id: validUserId,
          type: 'expense',
          amount_paise: 50000,
          currency: 'INR',
          account_id: validSourceAccId,
          destination_account_id: null,
          category_id: null,
          title: 'Ack Failure Test',
          transaction_date: validDateIso,
          version: 1,
          idempotency_key: 'k-28'
        },
        idempotencyKey: 'k-28',
        attempts: 0,
        createdAt: validDateIso
      };

      await expect(dispatcher.dispatch(entry)).rejects.toThrow('QuotaExceededError: IndexedDB full');

      expect(mockRepo.insert).toHaveBeenCalledTimes(1);
      expect(mockOutboxManager.markSuccess).toHaveBeenCalledTimes(1);
      expect(mockOutboxManager.markFailure).toHaveBeenCalledWith(128, 'QuotaExceededError: IndexedDB full');
    });
  });
});

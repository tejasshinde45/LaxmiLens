import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SupabaseTransactionRepository,
  ISupabaseTransactionRepository
} from '@/infrastructure/database/cloud/repositories/SupabaseTransactionRepository';
import { CloudTransactionRow } from '@/infrastructure/database/cloud/mappers/TransactionMapper';
import { ISupabaseAccountRepository } from '@/infrastructure/database/cloud/repositories/SupabaseAccountRepository';
import { CloudAccountRow } from '@/infrastructure/database/cloud/mappers/AccountMapper';
import {
  SyncAuthError,
  SyncConflictError,
  SyncDatabaseError,
  SyncUnresolvedCategoryError,
  SyncAccountDependencyError
} from '@/infrastructure/sync/errors/SyncErrors';
import { TransferAccountMismatchError } from '@/domain/errors/DomainErrors';
import { SupabaseClient } from '@supabase/supabase-js';

describe('SupabaseTransactionRepository', () => {
  const validTxId = '11111111-1111-4111-8111-111111111111';
  const validUserId = '22222222-2222-4222-8222-222222222222';
  const validSourceAccId = '33333333-3333-4333-8333-333333333333';
  const validDestAccId = '44444444-4444-4444-8444-444444444444';
  const validDateIso = '2026-11-21T12:00:00.000Z';

  const sampleExpense: CloudTransactionRow = {
    id: validTxId,
    user_id: validUserId,
    type: 'expense',
    amount_paise: 50000,
    currency: 'INR',
    account_id: validSourceAccId,
    destination_account_id: null,
    category_id: null, // Uncategorized as required until category sync
    title: 'Groceries',
    note: 'Fresh market',
    transaction_date: validDateIso,
    deleted_at: null,
    version: 1,
    device_id: 'dev-1',
    idempotency_key: 'idemp-1',
    created_at: validDateIso,
    updated_at: validDateIso
  };

  const sampleTransfer: CloudTransactionRow = {
    id: validTxId,
    user_id: validUserId,
    type: 'transfer',
    amount_paise: 100000,
    currency: 'INR',
    account_id: validSourceAccId,
    destination_account_id: validDestAccId,
    category_id: null,
    title: 'Transfer to Savings',
    note: null,
    transaction_date: validDateIso,
    deleted_at: null,
    version: 1,
    device_id: null,
    idempotency_key: 'idemp-transfer',
    created_at: validDateIso,
    updated_at: validDateIso
  };

  const sampleSourceAccount: CloudAccountRow = {
    id: validSourceAccId,
    user_id: validUserId,
    name: 'Checking Account',
    account_type: 'bank',
    opening_balance_paise: 1000000,
    currency: 'INR',
    institution_name: 'HDFC',
    color: '#000000',
    icon: 'Wallet',
    notes: null,
    is_archived: false,
    version: 1
  };

  const sampleDestAccount: CloudAccountRow = {
    id: validDestAccId,
    user_id: validUserId,
    name: 'Savings Account',
    account_type: 'savings',
    opening_balance_paise: 500000,
    currency: 'INR',
    institution_name: 'SBI',
    color: '#111111',
    icon: 'Bank',
    notes: null,
    is_archived: false,
    version: 1
  };

  let mockClient: any;
  let mockAccountRepo: ISupabaseAccountRepository;
  let repo: ISupabaseTransactionRepository;

  beforeEach(() => {
    mockClient = {
      from: vi.fn()
    };

    mockAccountRepo = {
      findById: vi.fn(async (id: string) => {
        if (id === validSourceAccId) return sampleSourceAccount;
        if (id === validDestAccId) return sampleDestAccount;
        return null;
      }),
      findAll: vi.fn(async () => [sampleSourceAccount, sampleDestAccount]),
      insert: vi.fn(),
      updatePartial: vi.fn()
    };

    repo = new SupabaseTransactionRepository(
      mockClient as unknown as SupabaseClient,
      mockAccountRepo
    );
  });

  describe('1 & 2. Successful transaction INSERT & Preserved local UUID', () => {
    it('successfully inserts a new transaction and preserves the local client UUID', async () => {
      const selectSingleMock = vi.fn().mockResolvedValue({
        data: sampleExpense,
        error: null
      });

      const insertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: selectSingleMock
        })
      });

      mockClient.from.mockReturnValue({ insert: insertMock });

      const result = await repo.insert(sampleExpense);

      expect(mockClient.from).toHaveBeenCalledWith('transactions');
      expect(insertMock).toHaveBeenCalledWith(sampleExpense);
      expect(result.id).toBe(validTxId);
      expect(result).toEqual(sampleExpense);
    });
  });

  describe('3. Successful duplicate INSERT reconciliation', () => {
    it('handles PostgreSQL 23505 as idempotent success when cloud record has matching data', async () => {
      // 1. Initial insert returns 23505 duplicate key
      const insertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { code: '23505', message: 'duplicate key value violates unique constraint' }
          })
        })
      });

      // 2. findById retrieves the existing identical record
      const selectMaybeSingleMock = vi.fn().mockResolvedValue({
        data: sampleExpense,
        error: null
      });

      const selectMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: selectMaybeSingleMock
          })
        })
      });

      mockClient.from.mockImplementation((table: string) => {
        if (table === 'transactions') {
          return { insert: insertMock, select: selectMock };
        }
        return {};
      });

      const result = await repo.insert(sampleExpense);
      expect(result).toEqual(sampleExpense);
    });
  });

  describe('4. Duplicate ID with mismatched content rejected', () => {
    it('throws SyncConflictError when duplicate ID exists in cloud with conflicting data', async () => {
      const insertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { code: '23505', message: 'duplicate key value' }
          })
        })
      });

      // Cloud record has different amount
      const conflictingCloudRecord = {
        ...sampleExpense,
        amount_paise: 99999
      };

      const selectMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: conflictingCloudRecord,
              error: null
            })
          })
        })
      });

      mockClient.from.mockImplementation((table: string) => {
        if (table === 'transactions') {
          return { insert: insertMock, select: selectMock };
        }
        return {};
      });

      await expect(repo.insert(sampleExpense)).rejects.toThrow(SyncConflictError);
    });

    it('throws SyncConflictError when duplicate ID exists in cloud but has been soft-deleted', async () => {
      const insertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { code: '23505', message: 'duplicate key value' }
          })
        })
      });

      // Cloud record is soft-deleted
      const softDeletedCloudRecord = {
        ...sampleExpense,
        deleted_at: '2026-11-21T12:00:00.000Z'
      };

      const selectMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: softDeletedCloudRecord,
              error: null
            })
          })
        })
      });

      mockClient.from.mockImplementation((table: string) => {
        if (table === 'transactions') {
          return { insert: insertMock, select: selectMock };
        }
        return {};
      });

      await expect(repo.insert(sampleExpense)).rejects.toThrow(SyncConflictError);
    });
  });

  describe('5. Idempotency-key collision with different transaction rejected', () => {
    it('throws SyncConflictError when idempotency key was already used for a different transaction ID', async () => {
      const insertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { code: '23505', message: 'unique constraint unique_user_idempotency_key' }
          })
        })
      });

      // findById returns null (different ID)
      const findByIdMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
        })
      });

      // findByIdempotencyKey returns an existing transaction with a different ID
      const existingTxWithSameKey: CloudTransactionRow = {
        ...sampleExpense,
        id: '99999999-9999-4999-8999-999999999999'
      };

      const findByKeyMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: existingTxWithSameKey, error: null })
        })
      });

      mockClient.from.mockReturnValue({
        insert: insertMock,
        select: vi.fn().mockImplementation((_cols: string) => {
          return {
            eq: vi.fn().mockImplementation((col: string, val: string) => {
              if (col === 'id') {
                return findByIdMock();
              }
              if (col === 'idempotency_key') {
                return findByKeyMock();
              }
              return { maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
            })
          };
        })
      });

      await expect(repo.insert(sampleExpense)).rejects.toThrow(SyncConflictError);
    });

    it('throws SyncConflictError when duplicate idempotency key exists in cloud but has been soft-deleted', async () => {
      const insertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { code: '23505', message: 'unique constraint unique_user_idempotency_key' }
          })
        })
      });

      // findById returns null
      const findByIdMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
        })
      });

      // findByIdempotencyKey returns an existing transaction with matching ID but deleted_at set
      const softDeletedByKey: CloudTransactionRow = {
        ...sampleExpense,
        deleted_at: '2026-11-21T12:00:00.000Z'
      };

      const findByKeyMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: softDeletedByKey, error: null })
        })
      });

      mockClient.from.mockReturnValue({
        insert: insertMock,
        select: vi.fn().mockImplementation(() => ({
          eq: vi.fn().mockImplementation((col: string) => {
            if (col === 'id') return findByIdMock();
            if (col === 'idempotency_key') return findByKeyMock();
            return { maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
          })
        }))
      });

      await expect(repo.insert(sampleExpense)).rejects.toThrow(SyncConflictError);
    });
  });

  describe('6 & 7. Successful UPDATE & Expected Version usage', () => {
    it('updates mutable fields filtering by id, userId, and expectedVersion', async () => {
      const patch = {
        title: 'New Groceries Title',
        amount_paise: 65000,
        version: 2
      };

      const updatedRow: CloudTransactionRow = {
        ...sampleExpense,
        ...patch,
        updated_at: '2026-11-21T13:00:00.000Z'
      };

      const eqVersionMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: updatedRow,
            error: null
          })
        })
      });

      const eqUserMock = vi.fn().mockReturnValue({ eq: eqVersionMock });
      const eqIdMock = vi.fn().mockReturnValue({ eq: eqUserMock });
      const updateMock = vi.fn().mockReturnValue({ eq: eqIdMock });

      const findByIdMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: sampleExpense,
              error: null
            })
          })
        })
      });

      mockClient.from.mockImplementation((table: string) => {
        if (table === 'transactions') {
          return {
            select: findByIdMock,
            update: updateMock
          };
        }
        return {};
      });

      const result = await repo.updatePartial(validTxId, validUserId, patch, 1);

      expect(mockClient.from).toHaveBeenCalledWith('transactions');
      expect(updateMock).toHaveBeenCalled();
      expect(eqIdMock).toHaveBeenCalledWith('id', validTxId);
      expect(eqUserMock).toHaveBeenCalledWith('user_id', validUserId);
      expect(eqVersionMock).toHaveBeenCalledWith('version', 1);
      expect(result.version).toBe(2);
      expect(result.title).toBe('New Groceries Title');
    });
  });

  describe('8. UPDATE returns conflict when 0 rows returned or version conflict', () => {
    it('throws SyncConflictError on optimistic concurrency version mismatch', async () => {
      // Current cloud row has already advanced to version 3
      const currentCloudRow = {
        ...sampleExpense,
        version: 3
      };

      const selectMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: currentCloudRow, error: null })
          })
        })
      });

      mockClient.from.mockImplementation((table: string) => {
        if (table === 'transactions') {
          return { select: selectMock };
        }
        return {};
      });

      await expect(
        repo.updatePartial(validTxId, validUserId, { title: 'Stale' }, 1)
      ).rejects.toThrow(SyncConflictError);
    });

    it('returns current row when update was already applied at target version (idempotent replay)', async () => {
      const alreadyUpdated: CloudTransactionRow = {
        ...sampleExpense,
        title: 'Replayed Title',
        version: 2
      };

      const selectMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: alreadyUpdated, error: null })
          })
        })
      });

      mockClient.from.mockReturnValue({ select: selectMock });

      const result = await repo.updatePartial(
        validTxId,
        validUserId,
        { title: 'Replayed Title', version: 2 },
        1
      );
      expect(result).toEqual(alreadyUpdated);
    });

    it('rejects update if cloud record is already at target version but data has diverged', async () => {
      const divergedCloud: CloudTransactionRow = {
        ...sampleExpense,
        title: 'Different Server Title',
        version: 2
      };

      const selectMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: divergedCloud, error: null })
          })
        })
      });

      mockClient.from.mockReturnValue({ select: selectMock });

      await expect(
        repo.updatePartial(
          validTxId,
          validUserId,
          { title: 'My Local Title', version: 2 },
          1
        )
      ).rejects.toThrow(SyncConflictError);
    });

    it('rejects update if cloud record has already been soft-deleted', async () => {
      const softDeletedInCloud: CloudTransactionRow = {
        ...sampleExpense,
        deleted_at: '2026-11-21T12:30:00.000Z',
        version: 2
      };

      const selectMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: softDeletedInCloud, error: null })
          })
        })
      });

      mockClient.from.mockReturnValue({ select: selectMock });

      await expect(
        repo.updatePartial(validTxId, validUserId, { title: 'Revive' }, 1)
      ).rejects.toThrow(SyncConflictError);
    });
  });

  describe('9 & 10. Successful soft-delete UPDATE & Never calls .delete()', () => {
    it('soft-deletes using an optimistic UPDATE, setting deleted_at, and never calls .delete()', async () => {
      const deletedAt = '2026-11-21T14:00:00.000Z';
      const softDeletedRow: CloudTransactionRow = {
        ...sampleExpense,
        deleted_at: deletedAt,
        version: 2
      };

      const updateMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: softDeletedRow,
                  error: null
                })
              })
            })
          })
        })
      });

      const deleteMock = vi.fn();

      mockClient.from.mockReturnValue({
        update: updateMock,
        delete: deleteMock
      });

      const result = await repo.softDelete(validTxId, validUserId, deletedAt, 1, 2);

      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          deleted_at: deletedAt,
          version: 2
        })
      );
      expect(deleteMock).not.toHaveBeenCalled();
      expect(result.deleted_at).toBe(deletedAt);
      expect(result.version).toBe(2);
    });
  });

  describe('11. Repeated soft-delete handled safely', () => {
    it('treats repeated soft-delete as idempotent success without re-incrementing version', async () => {
      const deletedAt = '2026-11-21T14:00:00.000Z';
      // 1. Update affects 0 rows
      const updateMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
              })
            })
          })
        })
      });

      // 2. Current cloud row is already soft-deleted at target version 2
      const alreadyDeletedRow: CloudTransactionRow = {
        ...sampleExpense,
        deleted_at: deletedAt,
        version: 2
      };

      const selectMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: alreadyDeletedRow, error: null })
          })
        })
      });

      mockClient.from.mockImplementation((table: string) => {
        if (table === 'transactions') {
          return { update: updateMock, select: selectMock };
        }
        return {};
      });

      const result = await repo.softDelete(validTxId, validUserId, deletedAt, 1, 2);
      expect(result).toEqual(alreadyDeletedRow);
    });
  });

  describe('12. Missing authentication rejected', () => {
    it('rejects insert when user_id is missing or empty', async () => {
      const unauthTx = { ...sampleExpense, user_id: '' };
      await expect(repo.insert(unauthTx)).rejects.toThrow(SyncAuthError);
    });

    it('rejects updatePartial when userId parameter is empty', async () => {
      await expect(repo.updatePartial(validTxId, '', { title: 'Test' }, 1)).rejects.toThrow(
        SyncAuthError
      );
    });

    it('rejects softDelete when userId parameter is empty', async () => {
      await expect(repo.softDelete(validTxId, '', validDateIso, 1)).rejects.toThrow(SyncAuthError);
    });

    it('rejects findById when userId parameter is empty', async () => {
      await expect(repo.findById(validTxId, '')).rejects.toThrow(SyncAuthError);
    });

    it('rejects findByIdempotencyKey when userId parameter is empty', async () => {
      await expect(repo.findByIdempotencyKey('key', '')).rejects.toThrow(SyncAuthError);
    });
  });

  describe('13 & 14. Category Identity Safety Guard', () => {
    it('rejects categorized transaction with SyncUnresolvedCategoryError on insert', async () => {
      const categorizedTx: CloudTransactionRow = {
        ...sampleExpense,
        category_id: '55555555-5555-4555-8555-555555555555'
      };

      await expect(repo.insert(categorizedTx)).rejects.toThrow(SyncUnresolvedCategoryError);
    });

    it('rejects updatePartial attempting to set a non-null category_id', async () => {
      const selectMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: sampleExpense, error: null })
          })
        })
      });
      mockClient.from.mockReturnValue({ select: selectMock });

      await expect(
        repo.updatePartial(
          validTxId,
          validUserId,
          { category_id: '55555555-5555-4555-8555-555555555555' },
          1
        )
      ).rejects.toThrow(SyncUnresolvedCategoryError);
    });

    it('rejects updatePartial when cloud transaction is already categorized even if patch omits category_id', async () => {
      const categorizedCloudRecord: CloudTransactionRow = {
        ...sampleExpense,
        category_id: '55555555-5555-4555-8555-555555555555'
      };

      const selectMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: categorizedCloudRecord, error: null })
          })
        })
      });
      mockClient.from.mockReturnValue({ select: selectMock });

      await expect(
        repo.updatePartial(validTxId, validUserId, { title: 'New Title Only' }, 1)
      ).rejects.toThrow(SyncUnresolvedCategoryError);
    });

    it('rejects updatePartial attempting to set category_id to null when cloud transaction is categorized', async () => {
      const categorizedCloudRecord: CloudTransactionRow = {
        ...sampleExpense,
        category_id: '55555555-5555-4555-8555-555555555555'
      };

      const selectMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: categorizedCloudRecord, error: null })
          })
        })
      });
      mockClient.from.mockReturnValue({ select: selectMock });

      await expect(
        repo.updatePartial(validTxId, validUserId, { category_id: null }, 1)
      ).rejects.toThrow(SyncUnresolvedCategoryError);
    });

    it('allows uncategorized transaction (category_id = null) through category validation', async () => {
      const insertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: sampleExpense, error: null })
        })
      });
      mockClient.from.mockReturnValue({ insert: insertMock });

      const result = await repo.insert(sampleExpense);
      expect(result.category_id).toBeNull();
    });
  });

  describe('Tenant Isolation on queries', () => {
    it('enforces user_id filter when querying findById', async () => {
      const eqUserMock = vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: sampleExpense, error: null })
      });
      const eqIdMock = vi.fn().mockReturnValue({ eq: eqUserMock });
      const selectMock = vi.fn().mockReturnValue({ eq: eqIdMock });

      mockClient.from.mockReturnValue({ select: selectMock });

      const result = await repo.findById(validTxId, validUserId);

      expect(mockClient.from).toHaveBeenCalledWith('transactions');
      expect(eqIdMock).toHaveBeenCalledWith('id', validTxId);
      expect(eqUserMock).toHaveBeenCalledWith('user_id', validUserId);
      expect(result).toEqual(sampleExpense);
    });

    it('enforces user_id filter when querying findByIdempotencyKey', async () => {
      const eqUserMock = vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: sampleExpense, error: null })
      });
      const eqKeyMock = vi.fn().mockReturnValue({ eq: eqUserMock });
      const selectMock = vi.fn().mockReturnValue({ eq: eqKeyMock });

      mockClient.from.mockReturnValue({ select: selectMock });

      const result = await repo.findByIdempotencyKey('idemp-1', validUserId);

      expect(mockClient.from).toHaveBeenCalledWith('transactions');
      expect(eqKeyMock).toHaveBeenCalledWith('idempotency_key', 'idemp-1');
      expect(eqUserMock).toHaveBeenCalledWith('user_id', validUserId);
      expect(result).toEqual(sampleExpense);
    });
  });

  describe('15 & 16. Account Dependency Safety', () => {
    it('rejects insert when referenced source account does not exist in cloud', async () => {
      const missingSourceTx: CloudTransactionRow = {
        ...sampleExpense,
        account_id: '99999999-9999-4999-8999-999999999999'
      };

      await expect(repo.insert(missingSourceTx)).rejects.toThrow(SyncAccountDependencyError);
    });

    it('rejects transfer insert when destination account does not exist in cloud', async () => {
      const missingDestTransfer: CloudTransactionRow = {
        ...sampleTransfer,
        destination_account_id: '99999999-9999-4999-8999-999999999999'
      };

      await expect(repo.insert(missingDestTransfer)).rejects.toThrow(SyncAccountDependencyError);
    });

    it('rejects transfer where destination account equals source account', async () => {
      const selfTransfer: CloudTransactionRow = {
        ...sampleTransfer,
        destination_account_id: validSourceAccId
      };

      await expect(repo.insert(selfTransfer)).rejects.toThrow(TransferAccountMismatchError);
    });
  });

  describe('17. Transfer remains one transaction row', () => {
    it('inserts a transfer as a single transaction row with source and destination accounts', async () => {
      const selectSingleMock = vi.fn().mockResolvedValue({
        data: sampleTransfer,
        error: null
      });

      const insertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: selectSingleMock
        })
      });

      mockClient.from.mockReturnValue({ insert: insertMock });

      const result = await repo.insert(sampleTransfer);

      expect(mockClient.from).toHaveBeenCalledWith('transactions');
      expect(mockClient.from).toHaveBeenCalledTimes(1);
      expect(insertMock).toHaveBeenCalledTimes(1);
      expect(result.type).toBe('transfer');
      expect(result.account_id).toBe(validSourceAccId);
      expect(result.destination_account_id).toBe(validDestAccId);
    });
  });

  describe('18. Error classification for PostgreSQL and network errors', () => {
    it('classifies 42501 as SyncDatabaseError with isRlsError() === true', async () => {
      const insertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { code: '42501', message: 'permission denied for table transactions' }
          })
        })
      });

      mockClient.from.mockReturnValue({ insert: insertMock });

      try {
        await repo.insert(sampleExpense);
        expect.unreachable('Should have thrown SyncDatabaseError');
      } catch (err) {
        expect(err).toBeInstanceOf(SyncDatabaseError);
        expect((err as SyncDatabaseError).isRlsError()).toBe(true);
      }
    });

    it('classifies general network or PostgREST failures as SyncDatabaseError', async () => {
      const insertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { code: 'PGRST500', message: 'Internal Server Error' }
          })
        })
      });

      mockClient.from.mockReturnValue({ insert: insertMock });

      await expect(repo.insert(sampleExpense)).rejects.toThrow(SyncDatabaseError);
    });
  });

  describe('19. Paginated cloud transaction retrieval (findPage & findAll)', () => {
    const buildTxRow = (index: number, overrides: Partial<CloudTransactionRow> = {}): CloudTransactionRow => ({
      ...sampleExpense,
      id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
      title: `Tx ${index}`,
      idempotency_key: `idemp-${index}`,
      created_at: `2026-11-21T12:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`,
      ...overrides
    });

    it('paginates through multiple pages via findPage including tombstones without silent truncation', async () => {
      const deletedRow = buildTxRow(2, {
        deleted_at: '2026-11-22T09:00:00.000Z',
        version: 2
      });
      const allRows = [buildTxRow(1), deletedRow, buildTxRow(3)];
      const rangeCalls: Array<[number, number]> = [];

      mockClient.from.mockImplementation(() => {
        let filterDeletedOnly = false;
        const builder: Record<string, unknown> = {
          select: vi.fn().mockImplementation(() => builder),
          eq: vi.fn().mockImplementation(() => builder),
          is: vi.fn().mockImplementation(() => {
            filterDeletedOnly = true;
            return builder;
          }),
          order: vi.fn().mockImplementation(() => builder),
          range: vi.fn().mockImplementation(async (from: number, to: number) => {
            rangeCalls.push([from, to]);
            const source = filterDeletedOnly
              ? allRows.filter((r) => r.deleted_at === null)
              : allRows;
            return {
              data: source.slice(from, to + 1),
              error: null
            };
          })
        };
        return builder;
      });

      const page1 = await repo.findPage(validUserId, { offset: 0, limit: 2 });
      expect(page1.rows.map((r) => r.title)).toEqual(['Tx 1', 'Tx 2']);
      expect(page1.rows[1].deleted_at).toBe('2026-11-22T09:00:00.000Z');
      expect(page1.hasMore).toBe(true);
      expect(page1.nextOffset).toBe(2);

      const page2 = await repo.findPage(validUserId, { offset: page1.nextOffset, limit: 2 });
      expect(page2.rows.map((r) => r.title)).toEqual(['Tx 3']);
      expect(page2.hasMore).toBe(false);
      expect(page2.nextOffset).toBe(3);

      expect(rangeCalls).toEqual([
        [0, 2],
        [2, 4]
      ]);

      const allFetched = await repo.findAll(validUserId, { pageSize: 2 });
      expect(allFetched).toHaveLength(3);
      expect(allFetched[1].deleted_at).toBe('2026-11-22T09:00:00.000Z');
    });

    it('rejects cross-user rows returned from cloud queries', async () => {
      const foreignRow = buildTxRow(99, { user_id: '99999999-9999-4999-8999-999999999999' });

      mockClient.from.mockImplementation(() => {
        const builder: Record<string, unknown> = {
          select: vi.fn().mockImplementation(() => builder),
          eq: vi.fn().mockImplementation(() => builder),
          order: vi.fn().mockImplementation(() => builder),
          range: vi.fn().mockResolvedValue({ data: [foreignRow], error: null })
        };
        return builder;
      });

      await expect(repo.findPage(validUserId, { offset: 0, limit: 50 })).rejects.toThrow(
        SyncAuthError
      );
      await expect(repo.findAll(validUserId, { pageSize: 50 })).rejects.toThrow(SyncAuthError);
    });
  });
});

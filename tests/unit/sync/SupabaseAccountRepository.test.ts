import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SupabaseAccountRepository } from '@/infrastructure/database/cloud/repositories/SupabaseAccountRepository';
import { CloudAccountRow } from '@/infrastructure/database/cloud/mappers/AccountMapper';
import { SyncConflictError, SyncDatabaseError } from '@/infrastructure/sync/errors/SyncErrors';
import { SupabaseClient } from '@supabase/supabase-js';

describe('SupabaseAccountRepository', () => {
  const validId = '123e4567-e89b-12d3-a456-426614174000';
  const validUserId = '987fcdeb-51a2-43f7-9876-543210987654';

  const sampleAccount: CloudAccountRow = {
    id: validId,
    user_id: validUserId,
    name: 'HDFC Bank',
    account_type: 'bank',
    opening_balance_paise: 500000,
    currency: 'INR',
    institution_name: 'HDFC',
    color: '#10B981',
    icon: 'Landmark',
    notes: 'Primary salary',
    is_archived: false,
    version: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z'
  };

  let mockClient: any;
  let repo: SupabaseAccountRepository;

  beforeEach(() => {
    mockClient = {
      from: vi.fn()
    };
    repo = new SupabaseAccountRepository(mockClient as unknown as SupabaseClient);
  });

  describe('insert', () => {
    it('successfully inserts a new account and verifies returned row', async () => {
      const selectSingleMock = vi.fn().mockResolvedValue({
        data: sampleAccount,
        error: null
      });

      const insertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: selectSingleMock
        })
      });

      mockClient.from.mockReturnValue({ insert: insertMock });

      const result = await repo.insert(sampleAccount);

      expect(mockClient.from).toHaveBeenCalledWith('accounts');
      expect(insertMock).toHaveBeenCalledWith(sampleAccount);
      expect(result).toEqual(sampleAccount);
    });

    it('handles 23505 duplicate key as idempotent success when cloud record matches identical creation data', async () => {
      // 1. First insert call returns 23505
      const insertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { code: '23505', message: 'duplicate key value violates unique constraint' }
          })
        })
      });

      // 2. findById call returns the already-committed identical row
      const selectMaybeSingleMock = vi.fn().mockResolvedValue({
        data: sampleAccount,
        error: null
      });

      const selectMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: selectMaybeSingleMock
        })
      });

      mockClient.from.mockImplementation((table: string) => {
        if (table === 'accounts') {
          return {
            insert: insertMock,
            select: selectMock
          };
        }
        return {};
      });

      const result = await repo.insert(sampleAccount);
      expect(result).toEqual(sampleAccount);
    });

    it('handles 23505 duplicate key as SyncConflictError when cloud record has conflicting data', async () => {
      const insertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { code: '23505', message: 'duplicate key value' }
          })
        })
      });

      const differingAccount = {
        ...sampleAccount,
        name: 'Completely Different Name',
        opening_balance_paise: 999999
      };

      const selectMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: differingAccount,
            error: null
          })
        })
      });

      mockClient.from.mockImplementation(() => ({
        insert: insertMock,
        select: selectMock
      }));

      await expect(repo.insert(sampleAccount)).rejects.toThrow(SyncConflictError);
    });

    it('handles 23505 duplicate key as SyncConflictError when institution_name differs', async () => {
      const insertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { code: '23505', message: 'duplicate key value' }
          })
        })
      });

      const differingAccount = {
        ...sampleAccount,
        institution_name: 'Different Institution'
      };

      const selectMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: differingAccount,
            error: null
          })
        })
      });

      mockClient.from.mockImplementation(() => ({
        insert: insertMock,
        select: selectMock
      }));

      await expect(repo.insert(sampleAccount)).rejects.toThrow(SyncConflictError);
    });

    it('handles 23505 duplicate key as SyncConflictError when color differs', async () => {
      const insertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { code: '23505', message: 'duplicate key value' }
          })
        })
      });

      const differingAccount = {
        ...sampleAccount,
        color: '#FF0000'
      };

      const selectMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: differingAccount,
            error: null
          })
        })
      });

      mockClient.from.mockImplementation(() => ({
        insert: insertMock,
        select: selectMock
      }));

      await expect(repo.insert(sampleAccount)).rejects.toThrow(SyncConflictError);
    });

    it('handles 23505 duplicate key as SyncConflictError when icon differs', async () => {
      const insertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { code: '23505', message: 'duplicate key value' }
          })
        })
      });

      const differingAccount = {
        ...sampleAccount,
        icon: 'Wallet'
      };

      const selectMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: differingAccount,
            error: null
          })
        })
      });

      mockClient.from.mockImplementation(() => ({
        insert: insertMock,
        select: selectMock
      }));

      await expect(repo.insert(sampleAccount)).rejects.toThrow(SyncConflictError);
    });

    it('handles 23505 duplicate key as SyncConflictError when notes differ', async () => {
      const insertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { code: '23505', message: 'duplicate key value' }
          })
        })
      });

      const differingAccount = {
        ...sampleAccount,
        notes: 'Completely different notes'
      };

      const selectMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: differingAccount,
            error: null
          })
        })
      });

      mockClient.from.mockImplementation(() => ({
        insert: insertMock,
        select: selectMock
      }));

      await expect(repo.insert(sampleAccount)).rejects.toThrow(SyncConflictError);
    });

    it('handles 23505 duplicate key as idempotent success when cloud NULL optional fields match incoming undefined values', async () => {
      const accountWithUndefinedOptionals: CloudAccountRow = {
        id: validId,
        user_id: validUserId,
        name: 'Basic Account',
        account_type: 'cash',
        opening_balance_paise: 0,
        currency: 'INR',
        institution_name: undefined as unknown as null,
        color: undefined as unknown as null,
        icon: undefined as unknown as null,
        notes: undefined as unknown as null,
        is_archived: false,
        version: 1
      };

      const existingCloudRowWithNulls: CloudAccountRow = {
        id: validId,
        user_id: validUserId,
        name: 'Basic Account',
        account_type: 'cash',
        opening_balance_paise: 0,
        currency: 'INR',
        institution_name: null,
        color: null,
        icon: null,
        notes: null,
        is_archived: false,
        version: 1,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z'
      };

      const insertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { code: '23505', message: 'duplicate key value' }
          })
        })
      });

      const selectMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: existingCloudRowWithNulls,
            error: null
          })
        })
      });

      mockClient.from.mockImplementation(() => ({
        insert: insertMock,
        select: selectMock
      }));

      const result = await repo.insert(accountWithUndefinedOptionals);
      expect(result).toEqual(existingCloudRowWithNulls);
    });

    it('handles 23505 duplicate key as SyncConflictError when existing cloud has non-NULL optional value and incoming is NULL', async () => {
      const accountWithNullNotes: CloudAccountRow = {
        ...sampleAccount,
        notes: null
      };

      // Existing cloud row has notes = 'Primary salary'
      const selectMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: sampleAccount, // notes: 'Primary salary'
            error: null
          })
        })
      });

      const insertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { code: '23505', message: 'duplicate key value' }
          })
        })
      });

      mockClient.from.mockImplementation(() => ({
        insert: insertMock,
        select: selectMock
      }));

      await expect(repo.insert(accountWithNullNotes)).rejects.toThrow(SyncConflictError);
    });

    it('handles 23505 duplicate key by rejecting with SyncConflictError when user_id differs', async () => {
      const existingOtherUserRow: CloudAccountRow = {
        ...sampleAccount,
        user_id: '00000000-0000-0000-0000-000000000001'
      };

      const insertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { code: '23505', message: 'duplicate key value' }
          })
        })
      });

      const selectMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: existingOtherUserRow,
            error: null
          })
        })
      });

      mockClient.from.mockImplementation(() => ({
        insert: insertMock,
        select: selectMock
      }));

      await expect(repo.insert(sampleAccount)).rejects.toThrow(
        /already exists and belongs to another user/
      );
    });

    it('handles 23505 duplicate key as SyncConflictError when cloud record is not accessible under current RLS (different owner)', async () => {
      const insertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { code: '23505', message: 'duplicate key value' }
          })
        })
      });

      // findById returns null because RLS filters out rows owned by other users
      const selectMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: null,
            error: null
          })
        })
      });

      mockClient.from.mockImplementation(() => ({
        insert: insertMock,
        select: selectMock
      }));

      await expect(repo.insert(sampleAccount)).rejects.toThrow(
        /already exists and belongs to another user/
      );
    });

    it('translates 42501 RLS error into SyncDatabaseError with isRlsError() = true', async () => {
      const insertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { code: '42501', message: 'new row violates row-level security policy' }
          })
        })
      });

      mockClient.from.mockReturnValue({ insert: insertMock });

      const err: any = await repo.insert(sampleAccount).catch((e) => e);
      expect(err).toBeInstanceOf(SyncDatabaseError);
      expect(err.isRlsError()).toBe(true);
      expect(err.pgCode).toBe('42501');
    });

    it('rejects with error when returned row validation fails', async () => {
      const corruptedReturn = {
        ...sampleAccount,
        id: '99999999-9999-9999-9999-999999999999' // Mismatched ID!
      };

      const insertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: corruptedReturn,
            error: null
          })
        })
      });

      mockClient.from.mockReturnValue({ insert: insertMock });

      await expect(repo.insert(sampleAccount)).rejects.toThrow(/Persisted row ID/);
    });

    it('provisions personal borrowings system account via authorized SECURITY DEFINER RPC', async () => {
      const systemAccountRow: CloudAccountRow = {
        ...sampleAccount,
        id: validId,
        user_id: validUserId,
        name: 'Personal Borrowings',
        account_type: 'other',
        opening_balance_paise: 0,
        system_tag: 'personal_borrowings'
      };

      const rpcMock = vi.fn().mockResolvedValue({
        data: systemAccountRow,
        error: null
      });
      mockClient.rpc = rpcMock;

      const result = await repo.insert(systemAccountRow);

      expect(mockClient.rpc).toHaveBeenCalledWith('provision_personal_borrowings_account', {
        p_account_id: validId,
        p_name: 'Personal Borrowings',
        p_currency: 'INR',
        p_color: '#10B981',
        p_icon: 'Landmark',
        p_notes: 'Primary salary'
      });
      expect(result).toEqual(systemAccountRow);
      expect(mockClient.from).not.toHaveBeenCalled();
    });
  });

  describe('updatePartial', () => {
    it('successfully performs version-aware partial update', async () => {
      const updatedRow: CloudAccountRow = {
        ...sampleAccount,
        name: 'Updated Bank',
        version: 2
      };

      const maybeSingleMock = vi.fn().mockResolvedValue({
        data: updatedRow,
        error: null
      });

      const selectMock = vi.fn().mockReturnValue({
        maybeSingle: maybeSingleMock
      });

      const eqVersionMock = vi.fn().mockReturnValue({
        select: selectMock
      });

      const eqUserMock = vi.fn().mockReturnValue({
        eq: eqVersionMock
      });

      const eqIdMock = vi.fn().mockReturnValue({
        eq: eqUserMock
      });

      const updateMock = vi.fn().mockReturnValue({
        eq: eqIdMock
      });

      mockClient.from.mockReturnValue({ update: updateMock });

      const patch = { name: 'Updated Bank', version: 2 };
      const result = await repo.updatePartial(validId, validUserId, patch, 1);

      expect(updateMock).toHaveBeenCalled();
      expect(eqIdMock).toHaveBeenCalledWith('id', validId);
      expect(eqUserMock).toHaveBeenCalledWith('user_id', validUserId);
      expect(eqVersionMock).toHaveBeenCalledWith('version', 1);
      expect(result).toEqual(updatedRow);
    });

    it('strips system_tag from update patch to ensure system-account identity is immutable on cloud updates', async () => {
      const updateMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { ...sampleAccount, name: 'Renamed System Account', version: 2 },
                  error: null
                })
              })
            })
          })
        })
      });

      mockClient.from.mockReturnValue({ update: updateMock });

      const patch = {
        name: 'Renamed System Account',
        system_tag: 'personal_borrowings',
        version: 2
      } as any;

      await repo.updatePartial(validId, validUserId, patch, 1);

      expect(updateMock).toHaveBeenCalled();
      const passedPayload = updateMock.mock.calls[0][0];
      expect(passedPayload).not.toHaveProperty('system_tag');
    });

    it('treats 0 rows updated as idempotent success if cloud version already equals target version with matching data', async () => {
      // 1. Update query returns 0 rows (data: null)
      const updateMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: null,
                  error: null
                })
              })
            })
          })
        })
      });

      // 2. findById reveals that account was already updated to version 2 with identical name
      const alreadyUpdated: CloudAccountRow = {
        ...sampleAccount,
        name: 'Already Applied Name',
        version: 2
      };

      const selectMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: alreadyUpdated,
            error: null
          })
        })
      });

      mockClient.from.mockImplementation(() => ({
        update: updateMock,
        select: selectMock
      }));

      const patch = { name: 'Already Applied Name', version: 2 };
      const result = await repo.updatePartial(validId, validUserId, patch, 1);

      expect(result).toEqual(alreadyUpdated);
    });

    it('treats 0 rows updated as SyncConflictError when cloud version is newer than expected version', async () => {
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

      // Cloud row is already at version 5
      const newerCloudRow: CloudAccountRow = {
        ...sampleAccount,
        version: 5
      };

      const selectMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: newerCloudRow, error: null })
        })
      });

      mockClient.from.mockImplementation(() => ({
        update: updateMock,
        select: selectMock
      }));

      const patch = { name: 'Late Update', version: 2 };
      await expect(repo.updatePartial(validId, validUserId, patch, 1)).rejects.toThrow(
        SyncConflictError
      );
    });

    it('treats 0 rows updated as SyncConflictError when account does not exist or is hidden by RLS', async () => {
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

      // findById returns null
      const selectMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
        })
      });

      mockClient.from.mockImplementation(() => ({
        update: updateMock,
        select: selectMock
      }));

      await expect(repo.updatePartial(validId, validUserId, { version: 2 }, 1)).rejects.toThrow(
        /not found in cloud or is hidden/
      );
    });

    it('rejects with SyncDatabaseError on network or client failure', async () => {
      const updateMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: null,
                  error: { code: 'PGRST000', message: 'Failed to fetch (Network Timeout)' }
                })
              })
            })
          })
        })
      });

      mockClient.from.mockReturnValue({ update: updateMock });

      await expect(
        repo.updatePartial(validId, validUserId, { name: 'Test', version: 2 }, 1)
      ).rejects.toThrow(SyncDatabaseError);
    });
  });

  describe('findById and findAll', () => {
    it('findById returns null when row does not exist', async () => {
      mockClient.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
          })
        })
      });

      const res = await repo.findById(validId);
      expect(res).toBeNull();
    });

    it('findAll returns array of accounts for user', async () => {
      mockClient.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({
              data: [sampleAccount],
              error: null
            })
          })
        })
      });

      const accounts = await repo.findAll(validUserId);
      expect(accounts.length).toBe(1);
      expect(accounts[0].id).toBe(validId);
    });
  });
});

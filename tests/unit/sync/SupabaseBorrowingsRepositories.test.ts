import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SupabaseLenderRepository } from '@/infrastructure/database/cloud/repositories/SupabaseLenderRepository';
import { SupabaseBorrowingRepository } from '@/infrastructure/database/cloud/repositories/SupabaseBorrowingRepository';
import { SupabaseBorrowingRepaymentRepository } from '@/infrastructure/database/cloud/repositories/SupabaseBorrowingRepaymentRepository';
import {
  SyncAuthError,
  SyncConflictError,
  SyncDatabaseError,
  SyncAccountDependencyError,
  SyncTransactionDependencyError,
  SyncLenderDependencyError,
  SyncBorrowingDependencyError
} from '@/infrastructure/sync/errors/SyncErrors';

describe('Supabase Borrowings Cloud Repositories', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const otherUserId = '99999999-9999-4999-8999-999999999999';
  const lenderId = '22222222-2222-4222-8222-222222222222';
  const borrowingId = '33333333-3333-4333-8333-333333333333';
  const repaymentId = '44444444-4444-4444-8444-444444444444';
  const accountId = '55555555-5555-4555-8555-555555555555';
  const transactionId = '66666666-6666-4666-8666-666666666666';

  describe('SupabaseLenderRepository', () => {
    let mockClient: any;
    let repo: SupabaseLenderRepository;

    beforeEach(() => {
      mockClient = {
        from: vi.fn()
      };
      repo = new SupabaseLenderRepository(mockClient);
    });

    it('rejects unauthenticated user with SyncAuthError', async () => {
      await expect(
        repo.insert({
          id: lenderId,
          user_id: '',
          name: 'Lender 1',
          phone: null,
          email: null,
          notes: null,
          is_archived: false
        })
      ).rejects.toBeInstanceOf(SyncAuthError);
    });

    it('inserts lender successfully and returns verified row', async () => {
      const lenderRow = {
        id: lenderId,
        user_id: userId,
        name: 'Rahul',
        phone: null,
        email: null,
        notes: null,
        is_archived: false
      };

      mockClient.from.mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: lenderRow, error: null })
          })
        })
      });

      const res = await repo.insert(lenderRow);
      expect(res.id).toBe(lenderId);
      expect(res.name).toBe('Rahul');
    });

    it('reconciles duplicate insert (23505) idempotently if cloud data matches', async () => {
      const lenderRow = {
        id: lenderId,
        user_id: userId,
        name: 'Rahul',
        phone: null,
        email: null,
        notes: null,
        is_archived: false
      };

      // Insert fails with 23505
      const insertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { code: '23505', message: 'duplicate key' }
          })
        })
      });

      // findById succeeds returning matching row
      const findMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: lenderRow,
                error: null
              })
            })
          })
        })
      });

      mockClient.from.mockImplementation((table: string) => {
        return {
          insert: insertMock,
          select: findMock().select
        };
      });

      const res = await repo.insert(lenderRow);
      expect(res.id).toBe(lenderId);
    });

    it('throws SyncConflictError on duplicate insert (23505) if cloud data differs', async () => {
      const lenderRow = {
        id: lenderId,
        user_id: userId,
        name: 'Rahul',
        phone: null,
        email: null,
        notes: null,
        is_archived: false
      };

      const existingDifferent = {
        ...lenderRow,
        name: 'Different Name'
      };

      mockClient.from.mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { code: '23505', message: 'duplicate key' }
            })
          })
        }),
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: existingDifferent,
                error: null
              })
            })
          })
        })
      });

      await expect(repo.insert(lenderRow)).rejects.toBeInstanceOf(SyncConflictError);
    });
  });

  describe('SupabaseBorrowingRepository', () => {
    let mockClient: any;
    let mockLenderRepo: any;
    let mockAccountRepo: any;
    let mockTxRepo: any;
    let repo: SupabaseBorrowingRepository;

    const validBorrowing = {
      id: borrowingId,
      user_id: userId,
      lender_id: lenderId,
      amount_paise: 500000,
      borrowing_date: '2026-03-01T10:00:00.000Z',
      due_date: null,
      receiving_account_id: accountId,
      transaction_id: transactionId,
      status: 'active' as const,
      notes: null
    };

    beforeEach(() => {
      mockClient = { from: vi.fn() };
      mockLenderRepo = {
        findById: vi.fn().mockResolvedValue({ id: lenderId, user_id: userId })
      };
      mockAccountRepo = {
        findById: vi.fn().mockResolvedValue({ id: accountId, user_id: userId })
      };
      mockTxRepo = {
        findById: vi.fn().mockResolvedValue({ id: transactionId, user_id: userId })
      };

      repo = new SupabaseBorrowingRepository(
        mockClient,
        mockLenderRepo,
        mockAccountRepo,
        mockTxRepo
      );
    });

    it('rejects insert if referenced lender does not exist or belongs to another user', async () => {
      mockLenderRepo.findById.mockResolvedValue(null);

      await expect(repo.insert(validBorrowing)).rejects.toBeInstanceOf(SyncLenderDependencyError);
    });

    it('rejects insert if referenced receiving account does not exist', async () => {
      mockAccountRepo.findById.mockResolvedValue(null);

      await expect(repo.insert(validBorrowing)).rejects.toBeInstanceOf(SyncAccountDependencyError);
    });

    it('rejects insert if referenced transaction does not exist', async () => {
      mockTxRepo.findById.mockResolvedValue(null);

      await expect(repo.insert(validBorrowing)).rejects.toBeInstanceOf(SyncTransactionDependencyError);
    });

    it('inserts borrowing successfully when all dependencies exist', async () => {
      mockClient.from.mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: validBorrowing, error: null })
          })
        })
      });

      const res = await repo.insert(validBorrowing);
      expect(res.id).toBe(borrowingId);
      expect(res.amount_paise).toBe(500000);
    });
  });

  describe('SupabaseBorrowingRepaymentRepository', () => {
    let mockClient: any;
    let mockBorrowingRepo: any;
    let mockLenderRepo: any;
    let mockAccountRepo: any;
    let mockTxRepo: any;
    let repo: SupabaseBorrowingRepaymentRepository;

    const validRepayment = {
      id: repaymentId,
      user_id: userId,
      borrowing_id: borrowingId,
      lender_id: lenderId,
      amount_paise: 200000,
      repayment_date: '2026-03-15T10:00:00.000Z',
      payment_account_id: accountId,
      transaction_id: transactionId,
      notes: null
    };

    beforeEach(() => {
      mockClient = { from: vi.fn() };
      mockBorrowingRepo = {
        findById: vi.fn().mockResolvedValue({ id: borrowingId, user_id: userId })
      };
      mockLenderRepo = {
        findById: vi.fn().mockResolvedValue({ id: lenderId, user_id: userId })
      };
      mockAccountRepo = {
        findById: vi.fn().mockResolvedValue({ id: accountId, user_id: userId })
      };
      mockTxRepo = {
        findById: vi.fn().mockResolvedValue({ id: transactionId, user_id: userId })
      };

      repo = new SupabaseBorrowingRepaymentRepository(
        mockClient,
        mockBorrowingRepo,
        mockLenderRepo,
        mockAccountRepo,
        mockTxRepo
      );
    });

    it('rejects insert if referenced borrowing does not exist', async () => {
      mockBorrowingRepo.findById.mockResolvedValue(null);

      await expect(repo.insert(validRepayment)).rejects.toBeInstanceOf(SyncBorrowingDependencyError);
    });

    it('rejects insert if referenced lender does not exist', async () => {
      mockLenderRepo.findById.mockResolvedValue(null);

      await expect(repo.insert(validRepayment)).rejects.toBeInstanceOf(SyncLenderDependencyError);
    });

    it('rejects insert if referenced payment account does not exist', async () => {
      mockAccountRepo.findById.mockResolvedValue(null);

      await expect(repo.insert(validRepayment)).rejects.toBeInstanceOf(SyncAccountDependencyError);
    });

    it('rejects insert if referenced transaction does not exist', async () => {
      mockTxRepo.findById.mockResolvedValue(null);

      await expect(repo.insert(validRepayment)).rejects.toBeInstanceOf(SyncTransactionDependencyError);
    });

    it('inserts repayment successfully when all dependencies exist', async () => {
      mockClient.from.mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: validRepayment, error: null })
          })
        })
      });

      const res = await repo.insert(validRepayment);
      expect(res.id).toBe(repaymentId);
      expect(res.amount_paise).toBe(200000);
    });
  });
});

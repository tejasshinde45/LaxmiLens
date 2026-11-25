import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LenderSyncDispatcher } from '@/infrastructure/sync/dispatchers/LenderSyncDispatcher';
import { BorrowingSyncDispatcher } from '@/infrastructure/sync/dispatchers/BorrowingSyncDispatcher';
import { BorrowingRepaymentSyncDispatcher } from '@/infrastructure/sync/dispatchers/BorrowingRepaymentSyncDispatcher';
import { LocalOutboxRecord } from '@/infrastructure/database/local/schema';
import {
  SyncAuthError,
  SyncInProgressError
} from '@/infrastructure/sync/errors/SyncErrors';

describe('Personal Borrowings Sync Dispatchers', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const otherUserId = '99999999-9999-4999-8999-999999999999';
  const lenderId = '22222222-2222-4222-8222-222222222222';
  const borrowingId = '33333333-3333-4333-8333-333333333333';
  const repaymentId = '44444444-4444-4444-8444-444444444444';
  const accountId = '55555555-5555-4555-8555-555555555555';
  const transactionId = '66666666-6666-4666-8666-666666666666';

  let mockAuthPort: any;
  let mockOutboxManager: any;

  beforeEach(() => {
    mockAuthPort = {
      getCurrentUser: vi.fn().mockResolvedValue({ id: userId, email: 'user@example.com' })
    };
    mockOutboxManager = {
      markSuccess: vi.fn().mockResolvedValue(undefined),
      markFailure: vi.fn().mockResolvedValue(undefined)
    };
  });

  describe('LenderSyncDispatcher', () => {
    let mockLenderRepo: any;
    let dispatcher: LenderSyncDispatcher;

    beforeEach(() => {
      mockLenderRepo = {
        insert: vi.fn().mockResolvedValue({
          id: lenderId,
          user_id: userId,
          name: 'Rahul',
          phone: null,
          email: null,
          notes: null,
          is_archived: false
        }),
        updatePartial: vi.fn().mockResolvedValue({
          id: lenderId,
          user_id: userId,
          name: 'Rahul Updated',
          phone: null,
          email: null,
          notes: null,
          is_archived: false
        })
      };
      dispatcher = new LenderSyncDispatcher(mockLenderRepo, mockAuthPort, mockOutboxManager);
    });

    it('rejects unsupported entity', async () => {
      const entry: LocalOutboxRecord = {
        id: 1,
        userId,
        entity: 'transactions' as any,
        entityId: lenderId,
        operation: 'INSERT',
        payload: { id: lenderId, user_id: userId, name: 'Rahul' },
        idempotencyKey: 'k-1',
        attempts: 0,
        createdAt: new Date().toISOString()
      };
      await expect(dispatcher.dispatch(entry)).rejects.toThrow(/only processes 'lenders'/);
    });

    it('rejects unauthenticated user', async () => {
      mockAuthPort.getCurrentUser.mockResolvedValue(null);
      const entry: LocalOutboxRecord = {
        id: 1,
        userId,
        entity: 'lenders',
        entityId: lenderId,
        operation: 'INSERT',
        payload: { id: lenderId, user_id: userId, name: 'Rahul' },
        idempotencyKey: 'k-1',
        attempts: 0,
        createdAt: new Date().toISOString()
      };
      await expect(dispatcher.dispatch(entry)).rejects.toBeInstanceOf(SyncAuthError);
    });

    it('rejects mismatched user_id in payload', async () => {
      const entry: LocalOutboxRecord = {
        id: 1,
        userId,
        entity: 'lenders',
        entityId: lenderId,
        operation: 'INSERT',
        payload: { id: lenderId, user_id: otherUserId, name: 'Rahul' },
        idempotencyKey: 'k-1',
        attempts: 0,
        createdAt: new Date().toISOString()
      };
      await expect(dispatcher.dispatch(entry)).rejects.toBeInstanceOf(SyncAuthError);
    });

    it('successfully dispatches INSERT and marks success', async () => {
      const entry: LocalOutboxRecord = {
        id: 10,
        userId,
        entity: 'lenders',
        entityId: lenderId,
        operation: 'INSERT',
        payload: { id: lenderId, user_id: userId, name: 'Rahul' },
        idempotencyKey: 'k-1',
        attempts: 0,
        createdAt: new Date().toISOString()
      };

      await dispatcher.dispatch(entry);

      expect(mockLenderRepo.insert).toHaveBeenCalledTimes(1);
      expect(mockOutboxManager.markSuccess).toHaveBeenCalledWith(10);
      expect(mockOutboxManager.markFailure).not.toHaveBeenCalled();
    });

    it('records failure and retains outbox entry on error', async () => {
      mockLenderRepo.insert.mockRejectedValue(new Error('Network error'));
      const entry: LocalOutboxRecord = {
        id: 11,
        userId,
        entity: 'lenders',
        entityId: lenderId,
        operation: 'INSERT',
        payload: { id: lenderId, user_id: userId, name: 'Rahul' },
        idempotencyKey: 'k-1',
        attempts: 0,
        createdAt: new Date().toISOString()
      };

      await expect(dispatcher.dispatch(entry)).rejects.toThrow('Network error');
      expect(mockOutboxManager.markFailure).toHaveBeenCalledWith(11, 'Network error');
      expect(mockOutboxManager.markSuccess).not.toHaveBeenCalled();
    });
  });

  describe('BorrowingSyncDispatcher', () => {
    let mockBorrowingRepo: any;
    let dispatcher: BorrowingSyncDispatcher;

    beforeEach(() => {
      mockBorrowingRepo = {
        insert: vi.fn().mockResolvedValue({
          id: borrowingId,
          user_id: userId,
          lender_id: lenderId,
          amount_paise: 500000,
          borrowing_date: '2026-03-01T10:00:00.000Z',
          due_date: null,
          receiving_account_id: accountId,
          transaction_id: transactionId,
          status: 'active',
          notes: null
        }),
        updatePartial: vi.fn().mockResolvedValue({
          id: borrowingId,
          user_id: userId,
          lender_id: lenderId,
          amount_paise: 500000,
          borrowing_date: '2026-03-01T10:00:00.000Z',
          due_date: null,
          receiving_account_id: accountId,
          transaction_id: transactionId,
          status: 'repaid',
          notes: null
        })
      };
      dispatcher = new BorrowingSyncDispatcher(mockBorrowingRepo, mockAuthPort, mockOutboxManager);
    });

    it('dispatches INSERT successfully and marks success in outbox', async () => {
      const entry: LocalOutboxRecord = {
        id: 20,
        userId,
        entity: 'borrowings',
        entityId: borrowingId,
        operation: 'INSERT',
        payload: {
          id: borrowingId,
          user_id: userId,
          lender_id: lenderId,
          amount_paise: 500000,
          borrowing_date: '2026-03-01T10:00:00.000Z',
          receiving_account_id: accountId,
          transaction_id: transactionId,
          status: 'active'
        },
        idempotencyKey: 'k-2',
        attempts: 0,
        createdAt: new Date().toISOString()
      };

      await dispatcher.dispatch(entry);

      expect(mockBorrowingRepo.insert).toHaveBeenCalledTimes(1);
      expect(mockOutboxManager.markSuccess).toHaveBeenCalledWith(20);
    });

    it('dispatches UPDATE (status: repaid) successfully and marks success', async () => {
      const entry: LocalOutboxRecord = {
        id: 21,
        userId,
        entity: 'borrowings',
        entityId: borrowingId,
        operation: 'UPDATE',
        payload: {
          id: borrowingId,
          user_id: userId,
          status: 'repaid'
        },
        idempotencyKey: 'k-3',
        attempts: 0,
        createdAt: new Date().toISOString()
      };

      await dispatcher.dispatch(entry);

      expect(mockBorrowingRepo.updatePartial).toHaveBeenCalledTimes(1);
      expect(mockOutboxManager.markSuccess).toHaveBeenCalledWith(21);
    });
  });

  describe('BorrowingRepaymentSyncDispatcher', () => {
    let mockRepaymentRepo: any;
    let dispatcher: BorrowingRepaymentSyncDispatcher;

    beforeEach(() => {
      mockRepaymentRepo = {
        insert: vi.fn().mockResolvedValue({
          id: repaymentId,
          user_id: userId,
          borrowing_id: borrowingId,
          lender_id: lenderId,
          amount_paise: 200000,
          repayment_date: '2026-03-15T10:00:00.000Z',
          payment_account_id: accountId,
          transaction_id: transactionId,
          notes: null
        })
      };
      dispatcher = new BorrowingRepaymentSyncDispatcher(mockRepaymentRepo, mockAuthPort, mockOutboxManager);
    });

    it('rejects UPDATE operation because repayments are immutable events', async () => {
      const entry: LocalOutboxRecord = {
        id: 30,
        userId,
        entity: 'borrowing_repayments',
        entityId: repaymentId,
        operation: 'UPDATE',
        payload: { id: repaymentId, user_id: userId },
        idempotencyKey: 'k-4',
        attempts: 0,
        createdAt: new Date().toISOString()
      };

      await expect(dispatcher.dispatch(entry)).rejects.toThrow(/only processes 'INSERT'/);
    });

    it('dispatches INSERT successfully and marks success', async () => {
      const entry: LocalOutboxRecord = {
        id: 31,
        userId,
        entity: 'borrowing_repayments',
        entityId: repaymentId,
        operation: 'INSERT',
        payload: {
          id: repaymentId,
          user_id: userId,
          borrowing_id: borrowingId,
          lender_id: lenderId,
          amount_paise: 200000,
          repayment_date: '2026-03-15T10:00:00.000Z',
          payment_account_id: accountId,
          transaction_id: transactionId
        },
        idempotencyKey: 'k-5',
        attempts: 0,
        createdAt: new Date().toISOString()
      };

      await dispatcher.dispatch(entry);

      expect(mockRepaymentRepo.insert).toHaveBeenCalledTimes(1);
      expect(mockOutboxManager.markSuccess).toHaveBeenCalledWith(31);
    });
  });
});

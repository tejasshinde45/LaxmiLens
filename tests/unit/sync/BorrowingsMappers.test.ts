import { describe, it, expect } from 'vitest';
import { LenderMapper, CloudLenderRow } from '@/infrastructure/database/cloud/mappers/LenderMapper';
import { BorrowingMapper, CloudBorrowingRow } from '@/infrastructure/database/cloud/mappers/BorrowingMapper';
import { BorrowingRepaymentMapper, CloudBorrowingRepaymentRow } from '@/infrastructure/database/cloud/mappers/BorrowingRepaymentMapper';
import { Lender } from '@/domain/entities/Lender';
import { Borrowing } from '@/domain/entities/Borrowing';
import { BorrowingRepayment } from '@/domain/entities/BorrowingRepayment';
import {
  createLenderId,
  createBorrowingId,
  createRepaymentId,
  createAccountId,
  createTransactionId,
  validateUserId
} from '@/domain/value-objects/Identifiers';

describe('Personal Borrowings Cloud Mappers', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const lenderId = '22222222-2222-4222-8222-222222222222';
  const borrowingId = '33333333-3333-4333-8333-333333333333';
  const repaymentId = '44444444-4444-4444-8444-444444444444';
  const accountId = '55555555-5555-4555-8555-555555555555';
  const transactionId = '66666666-6666-4666-8666-666666666666';

  describe('LenderMapper', () => {
    it('maps domain Lender to CloudLenderRow and back to domain', () => {
      const now = new Date('2026-03-01T10:00:00.000Z');
      const domainLender = new Lender({
        id: createLenderId(lenderId),
        userId: validateUserId(userId),
        name: 'Rahul Sharma',
        phone: '+91 9876543210',
        email: 'rahul@example.com',
        notes: 'Childhood friend',
        isArchived: false,
        createdAt: now,
        updatedAt: now
      });

      const cloudRow = LenderMapper.toCloud(domainLender);
      expect(cloudRow.id).toBe(lenderId);
      expect(cloudRow.user_id).toBe(userId);
      expect(cloudRow.name).toBe('Rahul Sharma');
      expect(cloudRow.phone).toBe('+91 9876543210');
      expect(cloudRow.email).toBe('rahul@example.com');
      expect(cloudRow.notes).toBe('Childhood friend');
      expect(cloudRow.is_archived).toBe(false);

      const reconstructed = LenderMapper.toDomain(cloudRow);
      expect(reconstructed.id).toBe(lenderId);
      expect(reconstructed.userId).toBe(userId);
      expect(reconstructed.name).toBe('Rahul Sharma');
      expect(reconstructed.phone).toBe('+91 9876543210');
      expect(reconstructed.email).toBe('rahul@example.com');
      expect(reconstructed.isArchived).toBe(false);
    });

    it('maps outbox INSERT payload to CloudLenderRow', () => {
      const payload = {
        id: lenderId,
        user_id: userId,
        name: 'Amit Patel',
        phone: '9988776655',
        is_archived: false,
        created_at: '2026-03-01T10:00:00.000Z',
        updated_at: '2026-03-01T10:00:00.000Z'
      };

      const mapped = LenderMapper.mapCreatePayload(payload);
      expect(mapped.id).toBe(lenderId);
      expect(mapped.user_id).toBe(userId);
      expect(mapped.name).toBe('Amit Patel');
      expect(mapped.phone).toBe('9988776655');
      expect(mapped.email).toBeNull();
      expect(mapped.notes).toBeNull();
      expect(mapped.is_archived).toBe(false);
    });

    it('rejects invalid create payload with missing name or invalid UUID', () => {
      expect(() =>
        LenderMapper.mapCreatePayload({
          id: 'invalid-uuid',
          user_id: userId,
          name: 'Amit'
        })
      ).toThrow(/must be a valid UUID/);

      expect(() =>
        LenderMapper.mapCreatePayload({
          id: lenderId,
          user_id: userId,
          name: '   '
        })
      ).toThrow(/must not be empty/);
    });

    it('maps outbox UPDATE payload stripping immutable fields', () => {
      const patch = LenderMapper.mapUpdatePayload({
        id: lenderId,
        user_id: userId,
        name: 'Amit Kumar Patel',
        is_archived: true
      });

      expect((patch as any).id).toBeUndefined();
      expect((patch as any).user_id).toBeUndefined();
      expect(patch.name).toBe('Amit Kumar Patel');
      expect(patch.is_archived).toBe(true);
      expect(patch.updated_at).toBeDefined();
    });
  });

  describe('BorrowingMapper', () => {
    it('maps domain Borrowing to CloudBorrowingRow and back to domain', () => {
      const now = new Date('2026-03-01T10:00:00.000Z');
      const dueDate = new Date('2026-04-01T10:00:00.000Z');

      const domainBorrowing = new Borrowing({
        id: createBorrowingId(borrowingId),
        userId: validateUserId(userId),
        lenderId: createLenderId(lenderId),
        amountPaise: 500000,
        borrowingDate: now,
        dueDate,
        receivingAccountId: createAccountId(accountId),
        transactionId: createTransactionId(transactionId),
        status: 'active',
        notes: 'Emergency medical loan',
        createdAt: now,
        updatedAt: now
      });

      const cloudRow = BorrowingMapper.toCloud(domainBorrowing);
      expect(cloudRow.id).toBe(borrowingId);
      expect(cloudRow.user_id).toBe(userId);
      expect(cloudRow.lender_id).toBe(lenderId);
      expect(cloudRow.amount_paise).toBe(500000);
      expect(cloudRow.due_date).toBe(dueDate.toISOString());
      expect(cloudRow.receiving_account_id).toBe(accountId);
      expect(cloudRow.transaction_id).toBe(transactionId);
      expect(cloudRow.status).toBe('active');

      const reconstructed = BorrowingMapper.toDomain(cloudRow);
      expect(reconstructed.id).toBe(borrowingId);
      expect(reconstructed.amountPaise).toBe(500000);
      expect(reconstructed.status).toBe('active');
    });

    it('maps outbox INSERT payload to CloudBorrowingRow', () => {
      const payload = {
        id: borrowingId,
        user_id: userId,
        lender_id: lenderId,
        amount_paise: 250000,
        borrowing_date: '2026-03-01T10:00:00.000Z',
        due_date: null,
        receiving_account_id: accountId,
        transaction_id: transactionId,
        status: 'active',
        notes: 'Project material'
      };

      const mapped = BorrowingMapper.mapCreatePayload(payload);
      expect(mapped.id).toBe(borrowingId);
      expect(mapped.user_id).toBe(userId);
      expect(mapped.amount_paise).toBe(250000);
      expect(mapped.due_date).toBeNull();
      expect(mapped.status).toBe('active');
    });

    it('rejects invalid create payload with negative or fractional amount', () => {
      expect(() =>
        BorrowingMapper.mapCreatePayload({
          id: borrowingId,
          user_id: userId,
          lender_id: lenderId,
          amount_paise: -100,
          borrowing_date: '2026-03-01T10:00:00.000Z',
          receiving_account_id: accountId,
          transaction_id: transactionId
        })
      ).toThrow();

      expect(() =>
        BorrowingMapper.mapCreatePayload({
          id: borrowingId,
          user_id: userId,
          lender_id: lenderId,
          amount_paise: 100.5,
          borrowing_date: '2026-03-01T10:00:00.000Z',
          receiving_account_id: accountId,
          transaction_id: transactionId
        })
      ).toThrow();
    });

    it('maps outbox UPDATE payload stripping immutable fields', () => {
      const patch = BorrowingMapper.mapUpdatePayload({
        id: borrowingId,
        user_id: userId,
        lender_id: lenderId,
        amount_paise: 999999,
        status: 'repaid'
      });

      expect((patch as any).id).toBeUndefined();
      expect((patch as any).user_id).toBeUndefined();
      expect((patch as any).amount_paise).toBeUndefined();
      expect(patch.status).toBe('repaid');
      expect(patch.updated_at).toBeDefined();
    });
  });

  describe('BorrowingRepaymentMapper', () => {
    it('maps domain BorrowingRepayment to CloudBorrowingRepaymentRow and back to domain', () => {
      const now = new Date('2026-03-15T12:00:00.000Z');
      const domainRepayment = new BorrowingRepayment({
        id: createRepaymentId(repaymentId),
        userId: validateUserId(userId),
        borrowingId: createBorrowingId(borrowingId),
        lenderId: createLenderId(lenderId),
        amountPaise: 200000,
        repaymentDate: now,
        paymentAccountId: createAccountId(accountId),
        transactionId: createTransactionId(transactionId),
        notes: 'First installment',
        createdAt: now,
        updatedAt: now
      });

      const cloudRow = BorrowingRepaymentMapper.toCloud(domainRepayment);
      expect(cloudRow.id).toBe(repaymentId);
      expect(cloudRow.user_id).toBe(userId);
      expect(cloudRow.borrowing_id).toBe(borrowingId);
      expect(cloudRow.lender_id).toBe(lenderId);
      expect(cloudRow.amount_paise).toBe(200000);
      expect(cloudRow.payment_account_id).toBe(accountId);
      expect(cloudRow.transaction_id).toBe(transactionId);
      expect(cloudRow.notes).toBe('First installment');

      const reconstructed = BorrowingRepaymentMapper.toDomain(cloudRow);
      expect(reconstructed.id).toBe(repaymentId);
      expect(reconstructed.amountPaise).toBe(200000);
      expect(reconstructed.notes).toBe('First installment');
    });

    it('maps outbox INSERT payload to CloudBorrowingRepaymentRow', () => {
      const payload = {
        id: repaymentId,
        user_id: userId,
        borrowing_id: borrowingId,
        lender_id: lenderId,
        amount_paise: 500000,
        repayment_date: '2026-03-20T10:00:00.000Z',
        payment_account_id: accountId,
        transaction_id: transactionId,
        notes: 'Full repayment'
      };

      const mapped = BorrowingRepaymentMapper.mapCreatePayload(payload);
      expect(mapped.id).toBe(repaymentId);
      expect(mapped.amount_paise).toBe(500000);
      expect(mapped.borrowing_id).toBe(borrowingId);
    });

    it('rejects invalid repayment create payload', () => {
      expect(() =>
        BorrowingRepaymentMapper.mapCreatePayload({
          id: repaymentId,
          user_id: userId,
          borrowing_id: 'bad-id',
          lender_id: lenderId,
          amount_paise: 1000,
          repayment_date: '2026-03-20T10:00:00.000Z',
          payment_account_id: accountId,
          transaction_id: transactionId
        })
      ).toThrow();
    });
  });
});

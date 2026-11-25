import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DexieLenderRepository } from '@/infrastructure/database/local/repositories/DexieLenderRepository';
import { DexieBorrowingRepository } from '@/infrastructure/database/local/repositories/DexieBorrowingRepository';
import { Lender } from '@/domain/entities/Lender';
import { Borrowing } from '@/domain/entities/Borrowing';
import { BorrowingRepayment } from '@/domain/entities/BorrowingRepayment';
import {
  LocalLenderRecord,
  LocalBorrowingRecord,
  LocalBorrowingRepaymentRecord
} from '@/infrastructure/database/local/schema';
import {
  createLenderId,
  createBorrowingId,
  createRepaymentId,
  createAccountId,
  createTransactionId,
  createUserId
} from '@/domain/value-objects/Identifiers';
import { UnauthorizedEntityAccessError } from '@/domain/errors/DomainErrors';
import { LenderNotFoundError } from '@/domain/errors/BorrowingErrors';

class MockLaxmiLensDB {
  public lendersStorage = new Map<string, LocalLenderRecord>();
  public borrowingsStorage = new Map<string, LocalBorrowingRecord>();
  public repaymentsStorage = new Map<string, LocalBorrowingRepaymentRecord>();

  public lenders = {
    get: vi.fn(async (id: string) => this.lendersStorage.get(id) || null),
    put: vi.fn(async (record: LocalLenderRecord) => {
      this.lendersStorage.set(record.id, { ...record });
      return record.id;
    }),
    update: vi.fn(async (id: string, updates: Partial<LocalLenderRecord>) => {
      const existing = this.lendersStorage.get(id);
      if (existing) {
        this.lendersStorage.set(id, { ...existing, ...updates });
        return 1;
      }
      return 0;
    }),
    where: vi.fn((index: string) => {
      if (index === 'userId') {
        return {
          equals: (val: string) => ({
            toArray: vi.fn(async () =>
              Array.from(this.lendersStorage.values()).filter((l) => l.userId === val)
            )
          })
        };
      }
      if (index === '[userId+id]') {
        return {
          equals: ([uId, id]: [string, string]) => ({
            first: vi.fn(async () => {
              const item = this.lendersStorage.get(id);
              return item && item.userId === uId ? item : null;
            })
          })
        };
      }
      return {
        equals: () => ({ toArray: vi.fn(async () => []) })
      };
    })
  };

  public borrowings = {
    get: vi.fn(async (id: string) => this.borrowingsStorage.get(id) || null),
    put: vi.fn(async (record: LocalBorrowingRecord) => {
      this.borrowingsStorage.set(record.id, { ...record });
      return record.id;
    }),
    where: vi.fn((index: string) => {
      if (index === 'userId') {
        return {
          equals: (val: string) => ({
            toArray: vi.fn(async () =>
              Array.from(this.borrowingsStorage.values()).filter((b) => b.userId === val)
            )
          })
        };
      }
      if (index === '[userId+id]') {
        return {
          equals: ([uId, id]: [string, string]) => ({
            first: vi.fn(async () => {
              const item = this.borrowingsStorage.get(id);
              return item && item.userId === uId ? item : null;
            })
          })
        };
      }
      if (index === '[userId+lenderId]') {
        return {
          equals: ([uId, lId]: [string, string]) => ({
            toArray: vi.fn(async () =>
              Array.from(this.borrowingsStorage.values()).filter(
                (b) => b.userId === uId && b.lenderId === lId
              )
            )
          })
        };
      }
      return {
        equals: () => ({ toArray: vi.fn(async () => []) })
      };
    })
  };

  public borrowingRepayments = {
    get: vi.fn(async (id: string) => this.repaymentsStorage.get(id) || null),
    put: vi.fn(async (record: LocalBorrowingRepaymentRecord) => {
      this.repaymentsStorage.set(record.id, { ...record });
      return record.id;
    }),
    where: vi.fn((index: string) => {
      if (index === 'userId') {
        return {
          equals: (val: string) => ({
            toArray: vi.fn(async () =>
              Array.from(this.repaymentsStorage.values()).filter((r) => r.userId === val)
            )
          })
        };
      }
      if (index === '[userId+id]') {
        return {
          equals: ([uId, id]: [string, string]) => ({
            first: vi.fn(async () => {
              const item = this.repaymentsStorage.get(id);
              return item && item.userId === uId ? item : null;
            })
          })
        };
      }
      if (index === '[userId+borrowingId]') {
        return {
          equals: ([uId, bId]: [string, string]) => ({
            toArray: vi.fn(async () =>
              Array.from(this.repaymentsStorage.values()).filter(
                (r) => r.userId === uId && r.borrowingId === bId
              )
            )
          })
        };
      }
      if (index === '[userId+lenderId]') {
        return {
          equals: ([uId, lId]: [string, string]) => ({
            toArray: vi.fn(async () =>
              Array.from(this.repaymentsStorage.values()).filter(
                (r) => r.userId === uId && r.lenderId === lId
              )
            )
          })
        };
      }
      return {
        equals: () => ({ toArray: vi.fn(async () => []) })
      };
    })
  };
}

describe('Dexie Borrowings Repositories', () => {
  const userIdA = createUserId('11111111-1111-4111-8111-111111111111');
  const userIdB = createUserId('22222222-2222-4222-8222-222222222222');

  let mockDb: MockLaxmiLensDB;
  let lenderRepo: DexieLenderRepository;
  let borrowingRepo: DexieBorrowingRepository;

  beforeEach(() => {
    mockDb = new MockLaxmiLensDB();
    lenderRepo = new DexieLenderRepository(mockDb as any);
    borrowingRepo = new DexieBorrowingRepository(mockDb as any);
  });

  describe('DexieLenderRepository', () => {
    it('should save and find lender by id and name', async () => {
      const lender = new Lender({
        id: createLenderId('55555555-5555-4555-8555-555555555555'),
        userId: userIdA,
        name: 'Rahul Sharma',
        phone: '9876543210'
      });

      await lenderRepo.save(lender);

      const foundById = await lenderRepo.findById(lender.id, userIdA);
      expect(foundById).toBeDefined();
      expect(foundById?.name).toBe('Rahul Sharma');
      expect(foundById?.phone).toBe('9876543210');

      const foundByName = await lenderRepo.findByName('rahul sharma', userIdA);
      expect(foundByName).toBeDefined();
      expect(foundByName?.id).toBe(lender.id);
    });

    it('should archive a lender', async () => {
      const lender = new Lender({
        id: createLenderId('55555555-5555-4555-8555-555555555555'),
        userId: userIdA,
        name: 'Amit Kumar'
      });

      await lenderRepo.save(lender);
      await lenderRepo.archive(lender.id, userIdA);

      const record = mockDb.lendersStorage.get(lender.id);
      expect(record?.isArchived).toBe(true);
    });

    it('should prevent cross-tenant access to lenders', async () => {
      const lender = new Lender({
        id: createLenderId('55555555-5555-4555-8555-555555555555'),
        userId: userIdA,
        name: 'Rahul'
      });

      await lenderRepo.save(lender);

      // User B tries to read User A's lender
      await expect(lenderRepo.findById(lender.id, userIdB)).rejects.toThrow(
        UnauthorizedEntityAccessError
      );

      // User B tries to archive User A's lender
      await expect(lenderRepo.archive(lender.id, userIdB)).rejects.toThrow(
        UnauthorizedEntityAccessError
      );
    });
  });

  describe('DexieBorrowingRepository', () => {
    const lenderId = createLenderId('55555555-5555-4555-8555-555555555555');
    const bankAccountId = createAccountId('33333333-3333-4333-8333-333333333333');
    const transactionId = createTransactionId('77777777-7777-4777-8777-777777777777');

    it('should save and find borrowings by user and lender', async () => {
      const borrowing = new Borrowing({
        id: createBorrowingId('66666666-6666-4666-8666-666666666666'),
        userId: userIdA,
        lenderId,
        amountPaise: 500000,
        borrowingDate: new Date('2026-11-20'),
        receivingAccountId: bankAccountId,
        transactionId,
        status: 'active'
      });

      await borrowingRepo.save(borrowing);

      const found = await borrowingRepo.findById(borrowing.id, userIdA);
      expect(found).toBeDefined();
      expect(found?.amountPaise).toBe(500000);
      expect(found?.status).toBe('active');

      const byLender = await borrowingRepo.findByLenderId(lenderId, userIdA);
      expect(byLender).toHaveLength(1);
      expect(byLender[0].id).toBe(borrowing.id);
    });

    it('should save and find repayments', async () => {
      const borrowingId = createBorrowingId('66666666-6666-4666-8666-666666666666');
      const repayment = new BorrowingRepayment({
        id: createRepaymentId('88888888-8888-4888-8888-888888888888'),
        userId: userIdA,
        borrowingId,
        lenderId,
        amountPaise: 200000,
        repaymentDate: new Date('2026-11-22'),
        paymentAccountId: bankAccountId,
        transactionId
      });

      await borrowingRepo.saveRepayment(repayment);

      const found = await borrowingRepo.findRepaymentById(repayment.id, userIdA);
      expect(found).toBeDefined();
      expect(found?.amountPaise).toBe(200000);

      const byBorrowing = await borrowingRepo.findRepaymentsByBorrowingId(borrowingId, userIdA);
      expect(byBorrowing).toHaveLength(1);

      const byLender = await borrowingRepo.findRepaymentsByLenderId(lenderId, userIdA);
      expect(byLender).toHaveLength(1);
    });

    it('should enforce user isolation on borrowings and repayments', async () => {
      const borrowing = new Borrowing({
        id: createBorrowingId('66666666-6666-4666-8666-666666666666'),
        userId: userIdA,
        lenderId,
        amountPaise: 500000,
        borrowingDate: new Date('2026-11-20'),
        receivingAccountId: bankAccountId,
        transactionId,
        status: 'active'
      });

      await borrowingRepo.save(borrowing);

      // User B cannot access User A's borrowing
      await expect(borrowingRepo.findById(borrowing.id, userIdB)).rejects.toThrow(
        UnauthorizedEntityAccessError
      );
    });
  });
});

import { BorrowingId, LenderId, RepaymentId, UserId } from '../value-objects/Identifiers';
import { Borrowing } from '../entities/Borrowing';
import { BorrowingRepayment } from '../entities/BorrowingRepayment';

export interface BorrowingRepository {
  findById(id: BorrowingId, userId: UserId): Promise<Borrowing | null>;
  findByUserId(userId: UserId): Promise<Borrowing[]>;
  findByLenderId(lenderId: LenderId, userId: UserId): Promise<Borrowing[]>;
  save(borrowing: Borrowing): Promise<void>;
  
  // Repayments
  findRepaymentById(id: RepaymentId, userId: UserId): Promise<BorrowingRepayment | null>;
  findRepaymentsByBorrowingId(borrowingId: BorrowingId, userId: UserId): Promise<BorrowingRepayment[]>;
  findRepaymentsByLenderId(lenderId: LenderId, userId: UserId): Promise<BorrowingRepayment[]>;
  findRepaymentsByUserId(userId: UserId): Promise<BorrowingRepayment[]>;
  saveRepayment(repayment: BorrowingRepayment): Promise<void>;
}

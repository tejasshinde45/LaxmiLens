import { BorrowingRepository } from '@/domain/repositories/BorrowingRepository';
import { LenderRepository } from '@/domain/repositories/LenderRepository';
import { AccountRepository } from '@/domain/repositories/AccountRepository';
import { validateUserId } from '@/domain/value-objects/Identifiers';
import {
  BorrowingDTO,
  BorrowingRepaymentDTO,
  BorrowingsOverviewResponseDTO,
  BorrowingsSummaryDTO,
  LenderDTO
} from '@/application/dto/BorrowingDTO';
import { formatPaiseToINR } from '@/utils/formatters';

export class GetBorrowingsUseCase {
  constructor(
    private readonly borrowingRepo: BorrowingRepository,
    private readonly lenderRepo: LenderRepository,
    private readonly accountRepo: AccountRepository
  ) {}

  public async execute(userIdInput: string): Promise<BorrowingsOverviewResponseDTO> {
    const userId = validateUserId(userIdInput);

    const [lenders, borrowings, repayments, accounts] = await Promise.all([
      this.lenderRepo.findByUserId(userId),
      this.borrowingRepo.findByUserId(userId),
      this.borrowingRepo.findRepaymentsByUserId(userId),
      this.accountRepo.findByUserId(userId)
    ]);

    const accountMap = new Map(accounts.map((a) => [a.id, a.name]));
    const lenderMap = new Map(lenders.map((l) => [l.id, l]));

    // Group repayments by borrowingId and lenderId
    const repaymentsByBorrowingId = new Map<string, typeof repayments>();
    const repaymentsByLenderId = new Map<string, typeof repayments>();

    for (const r of repayments) {
      if (!repaymentsByBorrowingId.has(r.borrowingId)) {
        repaymentsByBorrowingId.set(r.borrowingId, []);
      }
      repaymentsByBorrowingId.get(r.borrowingId)!.push(r);

      if (!repaymentsByLenderId.has(r.lenderId)) {
        repaymentsByLenderId.set(r.lenderId, []);
      }
      repaymentsByLenderId.get(r.lenderId)!.push(r);
    }

    // Map Repayments to DTOs
    const repaymentDTOs: BorrowingRepaymentDTO[] = repayments
      .map((r) => {
        const lender = lenderMap.get(r.lenderId);
        return {
          id: r.id,
          borrowingId: r.borrowingId,
          lenderId: r.lenderId,
          lenderName: lender?.name || 'Unknown Lender',
          amountPaise: r.amountPaise,
          amountFormatted: formatPaiseToINR(r.amountPaise),
          repaymentDate: r.repaymentDate.toISOString(),
          paymentAccountId: r.paymentAccountId,
          paymentAccountName: accountMap.get(r.paymentAccountId) || 'Account',
          transactionId: r.transactionId,
          notes: r.notes,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString()
        };
      })
      .sort((a, b) => new Date(b.repaymentDate).getTime() - new Date(a.repaymentDate).getTime());

    // Map Borrowings to DTOs
    const borrowingDTOs: BorrowingDTO[] = borrowings
      .map((b) => {
        const lender = lenderMap.get(b.lenderId);
        const bRepayments = repaymentsByBorrowingId.get(b.id) || [];
        const repaidPaise = bRepayments.reduce((sum, r) => sum + r.amountPaise, 0);
        const outstandingPaise = Math.max(0, b.amountPaise - repaidPaise);

        const borrowingRepaymentDTOs: BorrowingRepaymentDTO[] = bRepayments.map((r) => ({
          id: r.id,
          borrowingId: r.borrowingId,
          lenderId: r.lenderId,
          lenderName: lender?.name || 'Unknown Lender',
          amountPaise: r.amountPaise,
          amountFormatted: formatPaiseToINR(r.amountPaise),
          repaymentDate: r.repaymentDate.toISOString(),
          paymentAccountId: r.paymentAccountId,
          paymentAccountName: accountMap.get(r.paymentAccountId) || 'Account',
          transactionId: r.transactionId,
          notes: r.notes,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString()
        }));

        return {
          id: b.id,
          lenderId: b.lenderId,
          lenderName: lender?.name || 'Unknown Lender',
          amountPaise: b.amountPaise,
          amountFormatted: formatPaiseToINR(b.amountPaise),
          repaidPaise,
          repaidFormatted: formatPaiseToINR(repaidPaise),
          outstandingPaise,
          outstandingFormatted: formatPaiseToINR(outstandingPaise),
          borrowingDate: b.borrowingDate.toISOString(),
          dueDate: b.dueDate ? b.dueDate.toISOString() : null,
          receivingAccountId: b.receivingAccountId,
          receivingAccountName: accountMap.get(b.receivingAccountId) || 'Account',
          transactionId: b.transactionId,
          status: (outstandingPaise === 0 ? 'repaid' : 'active') as 'active' | 'repaid',
          notes: b.notes,
          repayments: borrowingRepaymentDTOs,
          createdAt: b.createdAt.toISOString(),
          updatedAt: b.updatedAt.toISOString()
        };
      })
      .sort((a, b) => new Date(b.borrowingDate).getTime() - new Date(a.borrowingDate).getTime());

    // Map Lenders to DTOs
    const lenderDTOs: LenderDTO[] = lenders
      .filter((l) => !l.isArchived)
      .map((l) => {
        const lBorrowings = borrowings.filter((b) => b.lenderId === l.id);
        const lRepayments = repaymentsByLenderId.get(l.id) || [];

        const totalBorrowedPaise = lBorrowings.reduce((sum, b) => sum + b.amountPaise, 0);
        const totalRepaidPaise = lRepayments.reduce((sum, r) => sum + r.amountPaise, 0);
        const outstandingPaise = Math.max(0, totalBorrowedPaise - totalRepaidPaise);
        const activeBorrowingsCount = lBorrowings.filter((b) => {
          const bRepaid = (repaymentsByBorrowingId.get(b.id) || []).reduce(
            (sum, r) => sum + r.amountPaise,
            0
          );
          return b.amountPaise > bRepaid;
        }).length;

        return {
          id: l.id,
          name: l.name,
          phone: l.phone,
          email: l.email,
          notes: l.notes,
          isArchived: l.isArchived,
          totalBorrowedPaise,
          totalBorrowedFormatted: formatPaiseToINR(totalBorrowedPaise),
          totalRepaidPaise,
          totalRepaidFormatted: formatPaiseToINR(totalRepaidPaise),
          outstandingPaise,
          outstandingFormatted: formatPaiseToINR(outstandingPaise),
          borrowingsCount: lBorrowings.length,
          repaymentsCount: lRepayments.length,
          activeBorrowingsCount,
          createdAt: l.createdAt.toISOString(),
          updatedAt: l.updatedAt.toISOString()
        };
      })
      .sort((a, b) => b.outstandingPaise - a.outstandingPaise);

    // Compute Overall Summary Metrics
    const totalBorrowedPaise = borrowings.reduce((sum, b) => sum + b.amountPaise, 0);
    const totalRepaidPaise = repayments.reduce((sum, r) => sum + r.amountPaise, 0);
    const totalOutstandingPaise = Math.max(0, totalBorrowedPaise - totalRepaidPaise);

    const activeLendersCount = lenderDTOs.filter((l) => l.outstandingPaise > 0).length;
    const activeBorrowingsCount = borrowingDTOs.filter((b) => b.outstandingPaise > 0).length;

    const summary: BorrowingsSummaryDTO = {
      totalOutstandingPaise,
      totalOutstandingFormatted: formatPaiseToINR(totalOutstandingPaise),
      totalBorrowedPaise,
      totalBorrowedFormatted: formatPaiseToINR(totalBorrowedPaise),
      totalRepaidPaise,
      totalRepaidFormatted: formatPaiseToINR(totalRepaidPaise),
      activeLendersCount,
      totalLendersCount: lenderDTOs.length,
      activeBorrowingsCount,
      totalBorrowingsCount: borrowingDTOs.length
    };

    return {
      summary,
      lenders: lenderDTOs,
      borrowings: borrowingDTOs,
      repayments: repaymentDTOs
    };
  }
}

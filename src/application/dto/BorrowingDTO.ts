export interface LenderDTO {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  notes?: string;
  isArchived: boolean;
  totalBorrowedPaise: number;
  totalBorrowedFormatted: string;
  totalRepaidPaise: number;
  totalRepaidFormatted: string;
  outstandingPaise: number;
  outstandingFormatted: string;
  borrowingsCount: number;
  repaymentsCount: number;
  activeBorrowingsCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface BorrowingRepaymentDTO {
  id: string;
  borrowingId: string;
  lenderId: string;
  lenderName: string;
  amountPaise: number;
  amountFormatted: string;
  repaymentDate: string;
  paymentAccountId: string;
  paymentAccountName?: string;
  transactionId: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BorrowingDTO {
  id: string;
  lenderId: string;
  lenderName: string;
  amountPaise: number;
  amountFormatted: string;
  repaidPaise: number;
  repaidFormatted: string;
  outstandingPaise: number;
  outstandingFormatted: string;
  borrowingDate: string;
  dueDate?: string | null;
  receivingAccountId: string;
  receivingAccountName?: string;
  transactionId: string;
  status: 'active' | 'repaid';
  notes?: string;
  repayments: BorrowingRepaymentDTO[];
  createdAt: string;
  updatedAt: string;
}

export interface BorrowingsSummaryDTO {
  totalOutstandingPaise: number;
  totalOutstandingFormatted: string;
  totalBorrowedPaise: number;
  totalBorrowedFormatted: string;
  totalRepaidPaise: number;
  totalRepaidFormatted: string;
  activeLendersCount: number;
  totalLendersCount: number;
  activeBorrowingsCount: number;
  totalBorrowingsCount: number;
}

export interface BorrowingsOverviewResponseDTO {
  summary: BorrowingsSummaryDTO;
  lenders: LenderDTO[];
  borrowings: BorrowingDTO[];
  repayments: BorrowingRepaymentDTO[];
}

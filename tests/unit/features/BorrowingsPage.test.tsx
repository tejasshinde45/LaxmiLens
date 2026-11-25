import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { BorrowingsPage } from '@/features/borrowings/BorrowingsPage';
import * as useBorrowingsModule from '@/features/borrowings/hooks/useBorrowings';
import * as useAccountsModule from '@/features/accounts/hooks/useAccounts';
import * as useAccountSyncModule from '@/features/accounts/hooks/useAccountSync';
import {
  BorrowingsSummaryDTO,
  LenderDTO,
  BorrowingDTO,
  BorrowingRepaymentDTO
} from '@/application/dto/BorrowingDTO';
import { AccountWithBalanceDTO } from '@/application/dto/AccountDTO';

// Mock Sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn()
  }
}));

describe('BorrowingsPage UI Integration', () => {
  const mockAddBorrowing = vi.fn();
  const mockRecordRepayment = vi.fn();
  const mockSyncNow = vi.fn();

  const sampleSummary: BorrowingsSummaryDTO = {
    totalOutstandingPaise: 1000000,
    totalOutstandingFormatted: '₹10,000.00',
    totalBorrowedPaise: 1000000,
    totalBorrowedFormatted: '₹10,000.00',
    totalRepaidPaise: 0,
    totalRepaidFormatted: '₹0.00',
    activeLendersCount: 3,
    totalLendersCount: 3,
    activeBorrowingsCount: 3,
    totalBorrowingsCount: 3
  };

  const sampleLenders: LenderDTO[] = [
    {
      id: 'lender-1',
      name: 'Rahul',
      totalBorrowedPaise: 500000,
      totalBorrowedFormatted: '₹5,000.00',
      totalRepaidPaise: 0,
      totalRepaidFormatted: '₹0.00',
      outstandingPaise: 500000,
      outstandingFormatted: '₹5,000.00',
      borrowingsCount: 1,
      repaymentsCount: 0,
      activeBorrowingsCount: 1,
      isArchived: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: 'lender-2',
      name: 'Amit',
      totalBorrowedPaise: 300000,
      totalBorrowedFormatted: '₹3,000.00',
      totalRepaidPaise: 0,
      totalRepaidFormatted: '₹0.00',
      outstandingPaise: 300000,
      outstandingFormatted: '₹3,000.00',
      borrowingsCount: 1,
      repaymentsCount: 0,
      activeBorrowingsCount: 1,
      isArchived: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: 'lender-3',
      name: 'Pratik',
      totalBorrowedPaise: 200000,
      totalBorrowedFormatted: '₹2,000.00',
      totalRepaidPaise: 0,
      totalRepaidFormatted: '₹0.00',
      outstandingPaise: 200000,
      outstandingFormatted: '₹2,000.00',
      borrowingsCount: 1,
      repaymentsCount: 0,
      activeBorrowingsCount: 1,
      isArchived: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ];

  const sampleBorrowings: BorrowingDTO[] = [
    {
      id: 'b-1',
      lenderId: 'lender-1',
      lenderName: 'Rahul',
      amountPaise: 500000,
      amountFormatted: '₹5,000.00',
      repaidPaise: 0,
      repaidFormatted: '₹0.00',
      outstandingPaise: 500000,
      outstandingFormatted: '₹5,000.00',
      borrowingDate: '2026-11-20T10:00:00.000Z',
      dueDate: null,
      receivingAccountId: 'acc-bank',
      receivingAccountName: 'HDFC Savings',
      transactionId: 'tx-1',
      status: 'active',
      repayments: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ];

  const sampleRepayments: BorrowingRepaymentDTO[] = [];

  const sampleAccounts: AccountWithBalanceDTO[] = [
    {
      id: 'acc-bank',
      userId: 'user-1',
      name: 'HDFC Savings',
      accountType: 'bank',
      openingBalancePaise: 5000000,
      openingBalanceFormatted: '₹50,000.00',
      currentBalancePaise: 6000000,
      currentBalanceFormatted: '₹60,000.00',
      currency: 'INR',
      isArchived: false,
      isCreditCard: false,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ];

  beforeEach(() => {
    vi.clearAllMocks();

    vi.spyOn(useBorrowingsModule, 'useBorrowings').mockReturnValue({
      summary: sampleSummary,
      lenders: sampleLenders,
      borrowings: sampleBorrowings,
      repayments: sampleRepayments,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      addBorrowing: mockAddBorrowing,
      isAddingBorrowing: false,
      recordRepayment: mockRecordRepayment,
      isRecordingRepayment: false
    });

    vi.spyOn(useAccountsModule, 'useAccounts').mockReturnValue({
      accounts: sampleAccounts,
      summary: {
        totalNetWorthPaise: 5000000,
        totalNetWorthFormatted: '₹50,000.00',
        totalAssetsPaise: 6000000,
        totalAssetsFormatted: '₹60,000.00',
        totalLiabilitiesPaise: 1000000,
        totalLiabilitiesFormatted: '₹10,000.00',
        activeAccountsCount: 2,
        archivedAccountsCount: 0
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      createAccount: vi.fn(),
      isCreating: false,
      updateAccount: vi.fn(),
      isUpdating: false,
      archiveAccount: vi.fn(),
      isArchiving: false,
      restoreAccount: vi.fn()
    });

    vi.spyOn(useAccountSyncModule, 'useAccountSync').mockReturnValue({
      syncNow: mockSyncNow,
      isSyncing: false,
      pendingCount: 0,
      isAuthenticated: true
    });
  });

  it('renders the header and all 4 summary metrics accurately', () => {
    render(
      <MemoryRouter>
        <BorrowingsPage />
      </MemoryRouter>
    );

    // Title
    expect(screen.getByRole('heading', { name: /Personal Borrowings/i })).toBeInTheDocument();
    expect(screen.getByText(/Liability Sub-Ledger/i)).toBeInTheDocument();

    // Summary Metric Cards
    expect(screen.getByText(/Total Outstanding/i)).toBeInTheDocument();
    expect(screen.getAllByText('₹10,000.00')).toHaveLength(2);
    expect(screen.getByText(/Total Borrowed/i)).toBeInTheDocument();
    expect(screen.getByText(/Total Repaid/i)).toBeInTheDocument();
    expect(screen.getByText('Active Lenders')).toBeInTheDocument();
  });

  it('renders list of individual lenders matching the prompt example', () => {
    render(
      <MemoryRouter>
        <BorrowingsPage />
      </MemoryRouter>
    );

    // Rahul: ₹5,000
    expect(screen.getByText('Rahul')).toBeInTheDocument();
    // Amit: ₹3,000
    expect(screen.getByText('Amit')).toBeInTheDocument();
    // Pratik: ₹2,000
    expect(screen.getByText('Pratik')).toBeInTheDocument();
  });

  it('filters lenders based on search input', () => {
    render(
      <MemoryRouter>
        <BorrowingsPage />
      </MemoryRouter>
    );

    const searchInput = screen.getByPlaceholderText(/Search lenders/i);
    fireEvent.change(searchInput, { target: { value: 'Rahul' } });

    expect(screen.getByText('Rahul')).toBeInTheDocument();
    expect(screen.queryByText('Amit')).not.toBeInTheDocument();
    expect(screen.queryByText('Pratik')).not.toBeInTheDocument();
  });

  it('switches between tabs and shows borrowing history', () => {
    render(
      <MemoryRouter>
        <BorrowingsPage />
      </MemoryRouter>
    );

    const historyTab = screen.getByRole('button', { name: /Borrowing History/i });
    fireEvent.click(historyTab);

    expect(screen.getByText('HDFC Savings')).toBeInTheDocument();
  });

  it('opens Add Borrowing modal when clicking Add Borrowing button', async () => {
    render(
      <MemoryRouter>
        <BorrowingsPage />
      </MemoryRouter>
    );

    const addBtn = screen.getByRole('button', { name: /Add Borrowing/i });
    fireEvent.click(addBtn);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Add Personal Borrowing/i })).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/e\.g\. Rahul Sharma/i)).toBeInTheDocument();
    });
  });

  it('opens Record Repayment modal when clicking Repay on a lender', async () => {
    render(
      <MemoryRouter>
        <BorrowingsPage />
      </MemoryRouter>
    );

    const repayButtons = screen.getAllByRole('button', { name: /^Repay$/i });
    fireEvent.click(repayButtons[0]);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Record Repayment/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Repay Full/i })).toBeInTheDocument();
    });
  });

  it('renders empty state when there are no personal borrowings', () => {
    vi.spyOn(useBorrowingsModule, 'useBorrowings').mockReturnValue({
      summary: {
        totalOutstandingPaise: 0,
        totalOutstandingFormatted: '₹0.00',
        totalBorrowedPaise: 0,
        totalBorrowedFormatted: '₹0.00',
        totalRepaidPaise: 0,
        totalRepaidFormatted: '₹0.00',
        activeLendersCount: 0,
        totalLendersCount: 0,
        activeBorrowingsCount: 0,
        totalBorrowingsCount: 0
      },
      lenders: [],
      borrowings: [],
      repayments: [],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      addBorrowing: mockAddBorrowing,
      isAddingBorrowing: false,
      recordRepayment: mockRecordRepayment,
      isRecordingRepayment: false
    });

    render(
      <MemoryRouter>
        <BorrowingsPage />
      </MemoryRouter>
    );

    expect(screen.getByText(/No personal borrowings tracked yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add First Borrowing/i })).toBeInTheDocument();
  });
});

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AccountsPage } from '@/features/accounts/AccountsPage';
import * as useAccountsModule from '@/features/accounts/hooks/useAccounts';
import { AccountWithBalanceDTO } from '@/application/dto/AccountDTO';

// Mock Sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn()
  }
}));

describe('AccountsPage Feature (Milestone 5.1)', () => {
  const mockCreateAccount = vi.fn();
  const mockUpdateAccount = vi.fn();
  const mockArchiveAccount = vi.fn();
  const mockRestoreAccount = vi.fn();
  const mockRefetch = vi.fn();

  const mockSummary: useAccountsModule.AccountsSummary = {
    totalNetWorthPaise: 12500000,
    totalNetWorthFormatted: '₹1,25,000.00',
    totalAssetsPaise: 15000000,
    totalAssetsFormatted: '₹1,50,000.00',
    totalLiabilitiesPaise: 2500000,
    totalLiabilitiesFormatted: '₹25,000.00',
    activeAccountsCount: 3,
    archivedAccountsCount: 1
  };

  const sampleAccounts: AccountWithBalanceDTO[] = [
    {
      id: 'acc-1' as any,
      name: 'HDFC Salary',
      accountType: 'bank',
      openingBalancePaise: 5000000,
      openingBalanceFormatted: '₹50,000.00',
      currentBalancePaise: 8000000,
      currentBalanceFormatted: '₹80,000.00',
      currency: 'INR',
      institutionName: 'HDFC Bank',
      color: '#D6AD60',
      icon: 'landmark',
      isArchived: false,
      isCreditCard: false,
      notes: 'Primary monthly salary',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: 'acc-2' as any,
      name: 'Physical Cash Reserve',
      accountType: 'cash',
      openingBalancePaise: 2000000,
      openingBalanceFormatted: '₹20,000.00',
      currentBalancePaise: 2000000,
      currentBalanceFormatted: '₹20,000.00',
      currency: 'INR',
      institutionName: undefined,
      color: '#72B895',
      icon: 'banknote',
      isArchived: false,
      isCreditCard: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: 'acc-3' as any,
      name: 'Amazon ICICI Card',
      accountType: 'credit_card',
      openingBalancePaise: 0,
      openingBalanceFormatted: '₹0.00',
      currentBalancePaise: -2500000,
      currentBalanceFormatted: '-₹25,000.00',
      currency: 'INR',
      institutionName: 'ICICI Bank',
      color: '#D9827C',
      icon: 'credit-card',
      isArchived: false,
      isCreditCard: true,
      notes: 'Cashback purchases',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: 'acc-4' as any,
      name: 'Old Paytm Wallet',
      accountType: 'wallet',
      openingBalancePaise: 0,
      openingBalanceFormatted: '₹0.00',
      currentBalancePaise: 0,
      currentBalanceFormatted: '₹0.00',
      currency: 'INR',
      institutionName: 'Paytm',
      color: '#82A9CF',
      icon: 'wallet',
      isArchived: true,
      isCreditCard: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders empty state when user has no financial accounts', () => {
    vi.spyOn(useAccountsModule, 'useAccounts').mockReturnValue({
      accounts: [],
      summary: {
        totalNetWorthPaise: 0,
        totalNetWorthFormatted: '₹0.00',
        totalAssetsPaise: 0,
        totalAssetsFormatted: '₹0.00',
        totalLiabilitiesPaise: 0,
        totalLiabilitiesFormatted: '₹0.00',
        activeAccountsCount: 0,
        archivedAccountsCount: 0
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: mockRefetch,
      createAccount: mockCreateAccount,
      isCreating: false,
      updateAccount: mockUpdateAccount,
      isUpdating: false,
      archiveAccount: mockArchiveAccount,
      isArchiving: false,
      restoreAccount: mockRestoreAccount,
      isRestoring: false
    });

    render(<AccountsPage />);

    expect(screen.getByText('No financial accounts registered')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /register first account/i })).toBeInTheDocument();
  });

  it('renders summary metrics and active account cards', () => {
    vi.spyOn(useAccountsModule, 'useAccounts').mockReturnValue({
      accounts: sampleAccounts,
      summary: mockSummary,
      isLoading: false,
      isError: false,
      error: null,
      refetch: mockRefetch,
      createAccount: mockCreateAccount,
      isCreating: false,
      updateAccount: mockUpdateAccount,
      isUpdating: false,
      archiveAccount: mockArchiveAccount,
      isArchiving: false,
      restoreAccount: mockRestoreAccount,
      isRestoring: false
    });

    render(<AccountsPage />);

    // Metric summaries
    expect(screen.getByText('₹1,25,000.00')).toBeInTheDocument(); // Net worth
    expect(screen.getByText('₹1,50,000.00')).toBeInTheDocument(); // Total Assets
    expect(screen.getByText('₹25,000.00')).toBeInTheDocument(); // Total Liabilities

    // Active accounts are rendered
    expect(screen.getByText('HDFC Salary')).toBeInTheDocument();
    expect(screen.getByText('Physical Cash Reserve')).toBeInTheDocument();
    expect(screen.getByText('Amazon ICICI Card')).toBeInTheDocument();

    // Archived account is hidden from default "All Accounts" view
    expect(screen.queryByText('Old Paytm Wallet')).not.toBeInTheDocument();
  });

  it('filters by tab to show archived accounts', () => {
    vi.spyOn(useAccountsModule, 'useAccounts').mockReturnValue({
      accounts: sampleAccounts,
      summary: mockSummary,
      isLoading: false,
      isError: false,
      error: null,
      refetch: mockRefetch,
      createAccount: mockCreateAccount,
      isCreating: false,
      updateAccount: mockUpdateAccount,
      isUpdating: false,
      archiveAccount: mockArchiveAccount,
      isArchiving: false,
      restoreAccount: mockRestoreAccount,
      isRestoring: false
    });

    render(<AccountsPage />);

    // Click Archived tab
    const archivedTab = screen.getByRole('button', { name: /archived/i });
    fireEvent.click(archivedTab);

    // Old Paytm Wallet should now be visible
    expect(screen.getByText('Old Paytm Wallet')).toBeInTheDocument();
    // Active accounts should not be visible
    expect(screen.queryByText('HDFC Salary')).not.toBeInTheDocument();
  });

  it('filters accounts by search query', () => {
    vi.spyOn(useAccountsModule, 'useAccounts').mockReturnValue({
      accounts: sampleAccounts,
      summary: mockSummary,
      isLoading: false,
      isError: false,
      error: null,
      refetch: mockRefetch,
      createAccount: mockCreateAccount,
      isCreating: false,
      updateAccount: mockUpdateAccount,
      isUpdating: false,
      archiveAccount: mockArchiveAccount,
      isArchiving: false,
      restoreAccount: mockRestoreAccount,
      isRestoring: false
    });

    render(<AccountsPage />);

    const searchInput = screen.getByPlaceholderText(/search accounts or bank/i);
    fireEvent.change(searchInput, { target: { value: 'ICICI' } });

    expect(screen.getByText('Amazon ICICI Card')).toBeInTheDocument();
    expect(screen.queryByText('HDFC Salary')).not.toBeInTheDocument();
  });

  it('opens create account modal when New Account is clicked', async () => {
    vi.spyOn(useAccountsModule, 'useAccounts').mockReturnValue({
      accounts: sampleAccounts,
      summary: mockSummary,
      isLoading: false,
      isError: false,
      error: null,
      refetch: mockRefetch,
      createAccount: mockCreateAccount,
      isCreating: false,
      updateAccount: mockUpdateAccount,
      isUpdating: false,
      archiveAccount: mockArchiveAccount,
      isArchiving: false,
      restoreAccount: mockRestoreAccount,
      isRestoring: false
    });

    render(<AccountsPage />);

    const newAccountBtn = screen.getByRole('button', { name: /new account/i });
    fireEvent.click(newAccountBtn);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /register new account/i })).toBeInTheDocument();
      expect(screen.getByLabelText(/account name/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/opening balance/i)).toBeInTheDocument();
    });
  });
});

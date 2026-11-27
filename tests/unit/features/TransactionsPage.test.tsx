import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TransactionsPage } from '@/features/transactions/TransactionsPage';
import * as useTransactionsModule from '@/features/transactions/hooks/useTransactions';
import * as useAccountsModule from '@/features/accounts/hooks/useAccounts';
import * as useCategoriesModule from '@/features/categories/hooks/useCategories';
import * as useAccountSyncModule from '@/features/accounts/hooks/useAccountSync';
import { TransactionResponseDTO } from '@/application/dto/TransactionDTO';
import { AccountWithBalanceDTO } from '@/application/dto/AccountDTO';
import { Category } from '@/domain/entities/Category';
import { createCategoryId, createUserId } from '@/domain/value-objects/Identifiers';
import { TransactionSyncDispatcher } from '@/infrastructure/sync/dispatchers/TransactionSyncDispatcher';
import { SyncUnresolvedCategoryError } from '@/infrastructure/sync/errors/SyncErrors';
import { LocalOutboxRecord } from '@/infrastructure/database/local/schema';

// Mock Sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn()
  }
}));

describe('TransactionsPage Feature (Phase 2D.7.4.1)', () => {
  const mockCreateTransaction = vi.fn();
  const mockUpdateTransaction = vi.fn();
  const mockDeleteTransaction = vi.fn();
  const mockRefetch = vi.fn();
  const mockSyncNow = vi.fn();

  const userId = '11111111-1111-4111-8111-111111111111';

  const sampleAccounts: AccountWithBalanceDTO[] = [
    {
      id: 'acc-1' as any,
      name: 'HDFC Salary',
      accountType: 'bank',
      openingBalancePaise: 5000000,
      openingBalanceFormatted: '₹50,000.00',
      currentBalancePaise: 7500000,
      currentBalanceFormatted: '₹75,000.00',
      currency: 'INR',
      institutionName: 'HDFC Bank',
      color: '#D6AD60',
      icon: 'landmark',
      isArchived: false,
      isCreditCard: false,
      notes: 'Primary account',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: 'acc-2' as any,
      name: 'Cash Reserve',
      accountType: 'cash',
      openingBalancePaise: 1000000,
      openingBalanceFormatted: '₹10,000.00',
      currentBalancePaise: 1000000,
      currentBalanceFormatted: '₹10,000.00',
      currency: 'INR',
      isArchived: false,
      isCreditCard: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: 'acc-archived' as any,
      name: 'Old Bank Account',
      accountType: 'bank',
      openingBalancePaise: 0,
      openingBalanceFormatted: '₹0.00',
      currentBalancePaise: 0,
      currentBalanceFormatted: '₹0.00',
      currency: 'INR',
      isArchived: true,
      isCreditCard: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ];

  const sampleCategories: Category[] = [
    new Category({
      id: createCategoryId('cat-salary'),
      userId: createUserId(userId),
      name: 'Salary & Wages',
      type: 'income',
      icon: 'Briefcase',
      color: '#72B895',
      isDefault: true
    }),
    new Category({
      id: createCategoryId('cat-groceries'),
      userId: createUserId(userId),
      name: 'Groceries & Household',
      type: 'expense',
      icon: 'ShoppingCart',
      color: '#D9827C',
      isDefault: true
    }),
    new Category({
      id: createCategoryId('cat-dining'),
      userId: createUserId(userId),
      name: 'Food & Dining Out',
      type: 'expense',
      icon: 'Utensils',
      color: '#D9827C',
      isDefault: true
    })
  ];

  const sampleTransactions: TransactionResponseDTO[] = [
    {
      id: 'tx-1',
      userId,
      type: 'income',
      amountPaise: 10000000, // ₹1,00,000.00
      amountFormatted: '₹1,00,000.00',
      currency: 'INR',
      accountId: 'acc-1',
      categoryId: 'cat-salary',
      title: 'Monthly Salary Credit',
      note: 'November tech salary',
      transactionDate: '2026-11-01T10:00:00.000Z',
      deletedAt: null,
      isDeleted: false,
      version: 1,
      idempotencyKey: 'idemp-1',
      createdAt: '2026-11-01T10:00:00.000Z',
      updatedAt: '2026-11-01T10:00:00.000Z',
      amountInPaise: 10000000,
      description: 'Monthly Salary Credit',
      notes: 'November tech salary',
      date: '2026-11-01T10:00:00.000Z',
      status: 'cleared'
    },
    {
      id: 'tx-2',
      userId,
      type: 'expense',
      amountPaise: 500000, // ₹5,000.00
      amountFormatted: '₹5,000.00',
      currency: 'INR',
      accountId: 'acc-1',
      categoryId: 'cat-groceries',
      title: 'Weekly Supermarket',
      note: 'Vegetables and dairy',
      transactionDate: '2026-11-10T14:30:00.000Z',
      deletedAt: null,
      isDeleted: false,
      version: 1,
      idempotencyKey: 'idemp-2',
      createdAt: '2026-11-10T14:30:00.000Z',
      updatedAt: '2026-11-10T14:30:00.000Z',
      amountInPaise: 500000,
      description: 'Weekly Supermarket',
      notes: 'Vegetables and dairy',
      date: '2026-11-10T14:30:00.000Z',
      status: 'cleared'
    },
    {
      id: 'tx-3',
      userId,
      type: 'transfer',
      amountPaise: 2000000, // ₹20,000.00
      amountFormatted: '₹20,000.00',
      currency: 'INR',
      accountId: 'acc-1',
      destinationAccountId: 'acc-2',
      title: 'ATM Cash Withdrawal',
      note: 'Emergency cash reserve',
      transactionDate: '2026-11-15T09:15:00.000Z',
      deletedAt: null,
      isDeleted: false,
      version: 1,
      idempotencyKey: 'idemp-3',
      createdAt: '2026-11-15T09:15:00.000Z',
      updatedAt: '2026-11-15T09:15:00.000Z',
      amountInPaise: 2000000,
      targetAccountId: 'acc-2',
      description: 'ATM Cash Withdrawal',
      notes: 'Emergency cash reserve',
      date: '2026-11-15T09:15:00.000Z',
      status: 'cleared'
    }
  ];

  beforeEach(() => {
    vi.clearAllMocks();

    vi.spyOn(useAccountsModule, 'useAccounts').mockReturnValue({
      accounts: sampleAccounts,
      summary: {} as any,
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

    vi.spyOn(useCategoriesModule, 'useCategories').mockReturnValue({
      categories: sampleCategories,
      incomeCategories: sampleCategories.filter((c) => c.type === 'income'),
      expenseCategories: sampleCategories.filter((c) => c.type === 'expense'),
      categoryMap: new Map(sampleCategories.map((c) => [c.id, c])),
      getCategoryById: (id) => sampleCategories.find((c) => c.id === id),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn()
    });

    vi.spyOn(useAccountSyncModule, 'useAccountSync').mockReturnValue({
      syncNow: mockSyncNow,
      isSyncing: false,
      pendingCount: 1,
      isAuthenticated: true
    });

    vi.spyOn(useTransactionsModule, 'useTransactions').mockReturnValue({
      transactions: sampleTransactions,
      summary: useTransactionsModule.computeTransactionSummary(sampleTransactions),
      pendingTxIdSet: new Set(['tx-2']),
      isLoading: false,
      isError: false,
      error: null,
      refetch: mockRefetch,
      isAuthenticated: true,
      createTransaction: mockCreateTransaction,
      isCreating: false,
      updateTransaction: mockUpdateTransaction,
      isUpdating: false,
      deleteTransaction: mockDeleteTransaction,
      isDeleting: false
    });
  });

  it('renders overview metrics calculating cash flow adhering strictly to LedgerRules', () => {
    render(<TransactionsPage />);

    // Total Entries: 3
    expect(screen.getByText('3 entries')).toBeInTheDocument();

    // Total Income: ₹1,00,000.00
    expect(screen.getByText('₹1,00,000.00')).toBeInTheDocument();

    // Total Expenses: ₹5,000.00
    expect(screen.getByText('₹5,000.00')).toBeInTheDocument();

    // Net Cash Flow: ₹1,00,000 - ₹5,000 = ₹95,000.00 (Transfers excluded)
    expect(screen.getByText('₹95,000.00')).toBeInTheDocument();

    // Verify transfer tx-3 (₹20,000) was NOT counted into income or expenses
    const summary = useTransactionsModule.computeTransactionSummary(sampleTransactions);
    expect(summary.totalIncomePaise).toBe(10000000);
    expect(summary.totalExpensePaise).toBe(500000);
    expect(summary.netCashFlowPaise).toBe(9500000);
  });

  it('renders transaction listing with title, type, category, and sync status', () => {
    render(<TransactionsPage />);

    // Transaction Titles (rendered in desktop table and mobile list)
    expect(screen.getAllByText('Monthly Salary Credit').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Weekly Supermarket').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('ATM Cash Withdrawal').length).toBeGreaterThanOrEqual(1);

    // Categories
    expect(screen.getAllByText('Salary & Wages').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Groceries & Household').length).toBeGreaterThanOrEqual(1);

    // Sync status: tx-2 is pending
    expect(screen.getAllByText('Saved Locally').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Synced').length).toBeGreaterThanOrEqual(1);
  });

  it('filters transaction list by transaction type tab', async () => {
    render(<TransactionsPage />);

    // Click Expenses tab
    const expenseTab = screen.getByRole('tab', { name: 'Expenses' });
    fireEvent.click(expenseTab);

    // Only expense transaction should remain
    expect(screen.getAllByText('Weekly Supermarket').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryAllByText('Monthly Salary Credit')).toHaveLength(0);
    expect(screen.queryAllByText('ATM Cash Withdrawal')).toHaveLength(0);

    // Metrics should update specifically for the filtered expense scope
    const filterSubtext = screen.getByText('Matching current view filter');
    expect(filterSubtext.previousElementSibling).toHaveTextContent('1');
  });

  it('filters transaction list by search query on title and note', () => {
    render(<TransactionsPage />);

    const searchInput = screen.getByPlaceholderText('Search by title or note...');
    fireEvent.change(searchInput, { target: { value: 'supermarket' } });

    expect(screen.getAllByText('Weekly Supermarket').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryAllByText('Monthly Salary Credit')).toHaveLength(0);
    expect(screen.queryAllByText('ATM Cash Withdrawal')).toHaveLength(0);
  });

  it('filters transaction list by account dropdown', () => {
    render(<TransactionsPage />);

    // Select Cash Reserve (acc-2), which is only involved in the transfer (tx-3)
    const accountSelect = screen.getByDisplayValue('All Accounts');
    fireEvent.change(accountSelect, { target: { value: 'acc-2' } });

    expect(screen.getAllByText('ATM Cash Withdrawal').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryAllByText('Monthly Salary Credit')).toHaveLength(0);
    expect(screen.queryAllByText('Weekly Supermarket')).toHaveLength(0);
  });

  it('supports sorting transactions by date and amount', () => {
    render(<TransactionsPage />);

    // Select sort by amount
    const sortSelect = screen.getByDisplayValue('Sort by Date');
    fireEvent.change(sortSelect, { target: { value: 'amount' } });

    // Initially amount is sorted descending (highest first)
    expect(screen.getByText('Highest amount')).toBeInTheDocument();

    // Toggle sort direction to ascending (lowest first)
    const toggleButton = screen.getByTitle('Toggle sort order');
    fireEvent.click(toggleButton);

    expect(screen.getByText('Lowest amount')).toBeInTheDocument();
  });

  it('opens Create Transaction modal and enforces active accounts only for selection', () => {
    render(<TransactionsPage />);

    const addButton = screen.getByRole('button', { name: /Add Transaction/i });
    fireEvent.click(addButton);

    // Modal heading
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Record Transaction' })).toBeInTheDocument();

    // Verify archived accounts are NOT options in the source account selector
    const accountSelect = within(dialog).getByLabelText(/Account/i);
    expect(accountSelect).toBeInTheDocument();
    const options = Array.from(accountSelect.querySelectorAll('option')).map((o) => o.textContent);
    expect(options).toContain('HDFC Salary (bank) ');
    expect(options).toContain('Cash Reserve (cash) ');
    expect(options).not.toContain('Old Bank Account (bank) [Archived]');
  });

  it('validates amount precision and required fields in Create Transaction modal', async () => {
    render(<TransactionsPage />);

    const addButton = screen.getByRole('button', { name: /Add Transaction/i });
    fireEvent.click(addButton);

    // Submit with empty amount and title
    const submitBtn = screen.getByRole('button', { name: 'Record Transaction' });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText('Amount is required')).toBeInTheDocument();
      expect(screen.getByText('Title is required')).toBeInTheDocument();
    });

    // Provide zero amount
    const amountInput = screen.getByLabelText(/Amount \(INR\)/i);
    fireEvent.change(amountInput, { target: { value: '0' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText('Amount must be greater than zero')).toBeInTheDocument();
    });

    // Provide invalid fractional amount with > 2 decimal places
    fireEvent.change(amountInput, { target: { value: '150.999' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(
        screen.getByText('Amount must have at most 2 decimal places')
      ).toBeInTheDocument();
    });
  });

  it('submits a valid income transaction and calls createTransaction with correct values', async () => {
    render(<TransactionsPage />);

    const addButton = screen.getByRole('button', { name: /Add Transaction/i });
    fireEvent.click(addButton);

    // Select Income type
    const incomeBtn = screen.getByRole('button', { name: /Income/i });
    fireEvent.click(incomeBtn);

    // Fill form
    const amountInput = screen.getByLabelText(/Amount \(INR\)/i);
    fireEvent.change(amountInput, { target: { value: '45000.50' } });

    const titleInput = screen.getByLabelText(/Title \/ Description/i);
    fireEvent.change(titleInput, { target: { value: 'Freelance Design Payment' } });

    const accountSelect = within(screen.getByRole('dialog')).getByLabelText(/Account/i);
    fireEvent.change(accountSelect, { target: { value: 'acc-1' } });

    const submitBtn = screen.getByRole('button', { name: 'Record Transaction' });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockCreateTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'income',
          amount: '45000.50',
          title: 'Freelance Design Payment',
          accountId: 'acc-1'
        })
      );
    });
  });

  it('validates transfer form requiring distinct source and destination accounts', async () => {
    render(<TransactionsPage />);

    const addButton = screen.getByRole('button', { name: /Add Transaction/i });
    fireEvent.click(addButton);

    // Switch to Transfer
    const transferBtn = screen.getByRole('button', { name: /Transfer/i });
    fireEvent.click(transferBtn);

    // Enter amount
    const amountInput = screen.getByLabelText(/Amount \(INR\)/i);
    fireEvent.change(amountInput, { target: { value: '1000' } });

    // Both source and destination as acc-1
    const fromSelect = screen.getByLabelText(/From Account/i);
    fireEvent.change(fromSelect, { target: { value: 'acc-1' } });

    // Submit
    const submitBtn = screen.getByRole('button', { name: 'Record Transaction' });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      // In destination select, acc-1 is filtered out or validation rejects identical
      expect(mockCreateTransaction).not.toHaveBeenCalled();
    });

    // Pick valid destination
    const toSelect = screen.getByLabelText(/To Account/i);
    fireEvent.change(toSelect, { target: { value: 'acc-2' } });

    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockCreateTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'transfer',
          amount: '1000',
          accountId: 'acc-1',
          destinationAccountId: 'acc-2'
        })
      );
    });
  });

  it('opens Edit modal pre-filled with transaction values and submits updates', async () => {
    render(<TransactionsPage />);

    // Open row detail then click edit
    fireEvent.click(screen.getAllByText('Weekly Supermarket')[0]);

    // Detail modal opens
    expect(screen.getByText('Transaction Amount')).toBeInTheDocument();
    const editBtn = screen.getByRole('button', { name: /Edit/i });
    fireEvent.click(editBtn);

    // Edit modal is open
    expect(screen.getByText('Edit Transaction')).toBeInTheDocument();

    const titleInput = screen.getByLabelText(/Title \/ Description/i);
    expect(titleInput).toHaveValue('Weekly Supermarket');

    fireEvent.change(titleInput, { target: { value: 'Weekly Supermarket - HyperCity' } });

    const saveBtn = screen.getByRole('button', { name: 'Save Changes' });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockUpdateTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'tx-2',
          title: 'Weekly Supermarket - HyperCity'
        })
      );
    });
  });

  it('opens Delete confirmation modal and triggers soft deletion', async () => {
    render(<TransactionsPage />);

    // Open detail of tx-2
    fireEvent.click(screen.getAllByText('Weekly Supermarket')[0]);

    const deleteBtn = screen.getByRole('button', { name: /Delete/i });
    fireEvent.click(deleteBtn);

    // Confirmation dialog opens
    expect(screen.getByText('This action will soft-delete the transaction from your active ledger.')).toBeInTheDocument();

    const confirmDeleteBtn = screen.getByRole('button', { name: 'Delete Transaction' });
    fireEvent.click(confirmDeleteBtn);

    await waitFor(() => {
      expect(mockDeleteTransaction).toHaveBeenCalledWith('tx-2');
    });
  });

  it('preserves effective Category Identity Guard in TransactionSyncDispatcher', async () => {
    // Verify that categorized transactions continue to be blocked from cloud synchronization
    const mockCloudRepo = {
      create: vi.fn(),
      updatePartial: vi.fn(),
      softDelete: vi.fn(),
      findByIdempotencyKey: vi.fn().mockResolvedValue(null)
    };

    const mockAuthPort = {
      getCurrentUser: vi.fn().mockResolvedValue({ id: userId, email: 'test@example.com' })
    };

    const mockOutboxManager = {
      markSuccess: vi.fn(),
      markFailure: vi.fn()
    };

    const dispatcher = new TransactionSyncDispatcher(
      mockCloudRepo as any,
      mockAuthPort as any,
      mockOutboxManager as any
    );

    const categorizedOutboxEntry: LocalOutboxRecord = {
      id: 1,
      userId,
      entity: 'transactions',
      entityId: 'tx-categorized',
      operation: 'INSERT',
      payload: {
        id: 'tx-categorized',
        user_id: userId,
        type: 'expense',
        amount_paise: 5000,
        currency: 'INR',
        account_id: 'acc-1',
        category_id: 'cat-groceries', // Categorized transaction
        title: 'Groceries',
        transaction_date: new Date().toISOString()
      },
      idempotencyKey: 'idemp-cat',
      attempts: 0,
      createdAt: new Date().toISOString()
    };

    // Attempting to dispatch should throw SyncUnresolvedCategoryError
    await expect(dispatcher.dispatch(categorizedOutboxEntry)).rejects.toThrow(
      SyncUnresolvedCategoryError
    );

    // Cloud repository create must NOT have been called
    expect(mockCloudRepo.create).not.toHaveBeenCalled();
  });
});

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { AuthCard } from '@/features/auth/components/AuthCard';
import { PasswordInput } from '@/features/auth/components/PasswordInput';
import { LoginPage } from '@/features/auth/pages/LoginPage';
import { Header } from '@/app/navigation/Header';
import { Sidebar } from '@/app/navigation/Sidebar';
import { BottomNavigation } from '@/app/navigation/BottomNavigation';
import { CommandPalette } from '@/components/overlays/CommandPalette';
import { AccountCard } from '@/features/accounts/components/AccountCard';
import { TransactionFilters } from '@/features/transactions/components/TransactionFilters';
import { TransactionTable } from '@/features/transactions/components/TransactionTable';
import { AddBorrowingModal } from '@/features/borrowings/components/AddBorrowingModal';
import { RecordRepaymentModal } from '@/features/borrowings/components/RecordRepaymentModal';
import { AuthContext, AuthContextType } from '@/features/auth/context/AuthContext';
import * as useNotificationsModule from '@/features/notifications/hooks/useNotifications';
import { AccountWithBalanceDTO } from '@/application/dto/AccountDTO';
import { TransactionResponseDTO } from '@/application/dto/TransactionDTO';
import { BorrowingDTO, LenderDTO } from '@/application/dto/BorrowingDTO';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn()
  }
}));

const sampleAccounts: AccountWithBalanceDTO[] = [
  {
    id: 'acc-1' as any,
    name: 'HDFC Checking',
    accountType: 'bank',
    openingBalancePaise: 500000,
    openingBalanceFormatted: '₹5,000.00',
    currentBalancePaise: 500000,
    currentBalanceFormatted: '₹5,000.00',
    currency: 'INR',
    isArchived: false,
    isCreditCard: false,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z'
  }
];

const sampleTransactions: TransactionResponseDTO[] = [
  {
    id: 'tx-1',
    userId: 'user-1',
    type: 'expense',
    amountPaise: 25000,
    amountFormatted: '₹250.00',
    currency: 'INR',
    accountId: 'acc-1',
    title: 'Coffee Beans',
    transactionDate: '2026-11-20T10:00:00.000Z',
    deletedAt: null,
    isDeleted: false,
    version: 1,
    idempotencyKey: 'idem-1',
    createdAt: '2026-11-20T10:00:00.000Z',
    updatedAt: '2026-11-20T10:00:00.000Z'
  }
];

const sampleLenders: LenderDTO[] = [
  {
    id: 'lender-1',
    name: 'Rohan Mehta',
    isArchived: false,
    totalBorrowedPaise: 100000,
    totalBorrowedFormatted: '₹1,000.00',
    totalRepaidPaise: 0,
    totalRepaidFormatted: '₹0.00',
    outstandingPaise: 100000,
    outstandingFormatted: '₹1,000.00',
    borrowingsCount: 1,
    repaymentsCount: 0,
    activeBorrowingsCount: 1,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z'
  }
];

const sampleBorrowings: BorrowingDTO[] = [
  {
    id: 'bor-1',
    lenderId: 'lender-1',
    lenderName: 'Rohan Mehta',
    amountPaise: 100000,
    amountFormatted: '₹1,000.00',
    repaidPaise: 0,
    repaidFormatted: '₹0.00',
    outstandingPaise: 100000,
    outstandingFormatted: '₹1,000.00',
    borrowingDate: '2026-11-05',
    dueDate: null,
    receivingAccountId: 'acc-1',
    transactionId: 'tx-b1',
    status: 'active',
    repayments: [],
    createdAt: '2026-11-05T00:00:00.000Z',
    updatedAt: '2026-11-05T00:00:00.000Z'
  }
];

function createAuthContextValue(overrides: Partial<AuthContextType> = {}): AuthContextType {
  return {
    user: {
      id: 'user-1' as any,
      email: 'a11y@example.com',
      displayName: 'A11y User'
    },
    isLoading: false,
    isAuthenticated: true,
    signIn: vi.fn().mockResolvedValue(undefined),
    signUp: vi.fn().mockResolvedValue(undefined),
    signInWithGoogle: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
    resetPassword: vi.fn().mockResolvedValue(undefined),
    updatePassword: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

describe('Phase 12 Stage 3A: Accessibility & Interaction Reliability', () => {
  beforeEach(() => {
    vi.spyOn(useNotificationsModule, 'useNotifications').mockReturnValue({
      notifications: [],
      pendingNotificationIdSet: new Set(),
      unreadCount: 2,
      activeNotificationsCount: 2,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      markAsRead: vi.fn(),
      isMarkingRead: false,
      dismissNotification: vi.fn(),
      isDismissing: false,
      markAllAsRead: vi.fn(),
      isMarkingAllRead: false
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('links Input labels and error/helper descriptions automatically and defaults Button type to button', () => {
    render(
      <form>
        <Input label="Account Label" error="Account Label is required" />
        <Input label="Optional Note" helperText="Stored locally first" />
        <Button isLoading>Saving</Button>
        <IconButton aria-label="Close panel">X</IconButton>
      </form>
    );

    const erroredInput = screen.getByLabelText('Account Label');
    expect(erroredInput).toHaveAttribute('aria-invalid', 'true');
    expect(erroredInput).toHaveAccessibleDescription('Account Label is required');

    const helperInput = screen.getByLabelText('Optional Note');
    expect(helperInput).not.toHaveAttribute('aria-invalid');
    expect(helperInput).toHaveAccessibleDescription('Stored locally first');

    const busyBtn = screen.getByRole('button', { name: 'Saving' });
    expect(busyBtn).toHaveAttribute('type', 'button');
    expect(busyBtn).toHaveAttribute('aria-busy', 'true');
    expect(busyBtn).toBeDisabled();

    const iconBtn = screen.getByRole('button', { name: 'Close panel' });
    expect(iconBtn).toHaveAttribute('type', 'button');
  });

  it('renders auth pages inside a main landmark with an h1 heading, aria-pressed toggle, and alert errors', async () => {
    const signIn = vi.fn().mockRejectedValue(new Error('Invalid credentials'));
    render(
      <MemoryRouter>
        <AuthContext.Provider value={createAuthContextValue({ user: null, isAuthenticated: false, signIn })}>
          <LoginPage />
        </AuthContext.Provider>
      </MemoryRouter>
    );

    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Welcome Back' })).toBeInTheDocument();

    const emailInput = screen.getByLabelText('Email Address');
    const passwordInput = screen.getByLabelText('Password');
    expect(emailInput).toHaveAttribute('aria-required', 'true');
    expect(passwordInput).toHaveAttribute('aria-required', 'true');

    const toggleBtn = screen.getByRole('button', { name: 'Show password' });
    expect(toggleBtn).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggleBtn);
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.change(emailInput, { target: { value: 'user@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'Secret123!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Invalid credentials');
    });
  });

  it('also supports standalone AuthCard and PasswordInput accessibility attributes', () => {
    render(
      <AuthCard title="Card Title">
        <PasswordInput label="Secret Key" />
      </AuthCard>
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Card Title' })).toBeInTheDocument();
    expect(screen.getByLabelText('Secret Key')).toHaveAttribute('type', 'password');
  });

  it('provides accessible names in collapsed sidebar navigation, single header landmark, and mobile More dialog', () => {
    const { rerender } = render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <AuthContext.Provider value={createAuthContextValue()}>
          <Header onOpenCommandPalette={vi.fn()} />
          <Sidebar isCollapsed={true} onToggleCollapse={vi.fn()} />
          <BottomNavigation onQuickAdd={vi.fn()} />
        </AuthContext.Provider>
      </MemoryRouter>
    );

    // Header must not emit duplicate h1 alongside PageHeader
    expect(screen.queryAllByRole('heading', { level: 1 })).toHaveLength(0);
    expect(screen.getByRole('link', { name: 'LaxmiLens home' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notifications (2 unread)' })).toBeInTheDocument();

    const expandBtn = screen.getByRole('button', { name: 'Expand sidebar' });
    expect(expandBtn).toHaveAttribute('aria-expanded', 'false');
    expect(expandBtn).toHaveAttribute('aria-controls', 'primary-sidebar-nav');

    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    const overviewLink = within(nav).getByRole('link', { name: 'Overview' });
    const budgetsLink = within(nav).getByRole('link', { name: 'Budgets' });
    const notificationsLink = within(nav).getByRole('link', { name: 'Notifications (2)' });

    expect(overviewLink).toHaveAttribute('aria-current', 'page');
    expect(overviewLink.className).not.toContain('=>');
    expect(overviewLink).toHaveClass('h-10', 'w-10', 'justify-center', 'border-[#D6AD60]/30');

    expect(budgetsLink).not.toHaveAttribute('aria-current');
    expect(budgetsLink.className).not.toContain('=>');
    expect(budgetsLink).toHaveClass('h-10', 'w-10', 'justify-center', 'border-transparent');
    expect(budgetsLink.className).not.toContain('border-[#D6AD60]');
    expect(notificationsLink).toHaveClass('h-10', 'w-10', 'border-transparent');

    // Expand More drawer on Mobile Bottom Navigation -> genuine Radix role="dialog"
    const moreBtn = screen.getByRole('button', { name: 'More Features' });
    expect(moreBtn).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(moreBtn);
    expect(moreBtn).toHaveAttribute('aria-expanded', 'true');

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'More Options' })).toBeInTheDocument();
    expect(within(dialog).getByText(/Explore budgets, reports, and settings/i)).toBeInTheDocument();

    rerender(
      <MemoryRouter initialEntries={['/dashboard']}>
        <AuthContext.Provider value={createAuthContextValue()}>
          <Sidebar isCollapsed={false} onToggleCollapse={vi.fn()} />
        </AuthContext.Provider>
      </MemoryRouter>
    );
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('uses genuine dialog semantics and native option buttons in CommandPalette', () => {
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <CommandPalette isOpen={true} onClose={onClose} onQuickAdd={vi.fn()} />
      </MemoryRouter>
    );

    const dialog = screen.getByRole('dialog');
    const searchInput = within(dialog).getByRole('textbox', {
      name: 'Search commands or destinations'
    });
    expect(searchInput).toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: 'Settings' } });
    const clearBtn = within(dialog).getByRole('button', { name: 'Clear command search' });
    expect(clearBtn).toBeInTheDocument();

    const settingsOption = within(dialog).getByRole('option', { name: /Settings/i });
    expect(settingsOption.tagName).toBe('BUTTON');
    fireEvent.click(settingsOption);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('exposes keyboard-operable AccountCard without nested interactive buttons', () => {
    const onViewDetails = vi.fn();
    render(
      <AccountCard
        account={sampleAccounts[0]!}
        onViewDetails={onViewDetails}
        onEdit={vi.fn()}
        onArchive={vi.fn()}
        onRestore={vi.fn()}
      />
    );

    const viewBtn = screen.getByRole('button', { name: 'View details for HDFC Checking' });
    const menuBtn = screen.getByRole('button', { name: 'Options for HDFC Checking' });
    expect(viewBtn.contains(menuBtn)).toBe(false);

    fireEvent.click(viewBtn);
    expect(onViewDetails).toHaveBeenCalledWith(sampleAccounts[0]);
  });

  it('labels TransactionFilters controls and provides semantic table headers and sort buttons', () => {
    const onSortChange = vi.fn();
    render(
      <>
        <TransactionFilters
          searchQuery=""
          onSearchChange={vi.fn()}
          typeFilter="all"
          onTypeFilterChange={vi.fn()}
          selectedAccountId="all"
          onAccountChange={vi.fn()}
          selectedCategoryId="all"
          onCategoryChange={vi.fn()}
          dateFilter="all"
          onDateFilterChange={vi.fn()}
          sortBy="date"
          onSortByChange={vi.fn()}
          sortDirection="desc"
          onToggleSortDirection={vi.fn()}
          onResetFilters={vi.fn()}
          accounts={sampleAccounts}
          categories={[]}
        />
        <TransactionTable
          transactions={sampleTransactions}
          accounts={sampleAccounts}
          categories={[]}
          pendingTxIdSet={new Set()}
          isLoading={false}
          sortBy="date"
          sortDirection="desc"
          onSortChange={onSortChange}
          onViewDetails={vi.fn()}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
        />
      </>
    );

    expect(screen.getByRole('tablist', { name: 'Filter transactions by type' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Filter by account' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Filter by category' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Filter by date range' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Sort transactions by' })).toBeInTheDocument();

    const headers = screen.getAllByRole('columnheader');
    for (const th of headers) {
      expect(th).toHaveAttribute('scope', 'col');
    }

    const amountHeader = screen.getByRole('columnheader', { name: 'Amount' });
    expect(amountHeader).toHaveAttribute('aria-sort', 'none');
    fireEvent.click(within(amountHeader).getByRole('button', { name: 'Amount' }));
    expect(onSortChange).toHaveBeenCalledWith('amount');

    expect(screen.getByRole('button', { name: 'Actions for Coffee Beans' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Coffee Beans' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Coffee Beans' })).toBeInTheDocument();
  });

  it('associates all Borrowing and Repayment modal fields with labels and accessible validation errors', async () => {
    const { rerender } = render(
      <AddBorrowingModal
        isOpen={true}
        onClose={vi.fn()}
        accounts={sampleAccounts}
        existingLenders={sampleLenders}
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getByLabelText(/Lender Name/i)).toHaveAttribute('aria-required', 'true');
    expect(screen.getByLabelText(/Amount \(₹\)/i)).toHaveAttribute('aria-required', 'true');
    expect(screen.getByLabelText(/Receiving Account/i)).toHaveAttribute('aria-required', 'true');
    expect(screen.getByLabelText(/Borrowing Date/i)).toHaveAttribute('aria-required', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Add Borrowing' }));
    await waitFor(() => {
      const lenderInput = screen.getByLabelText(/Lender Name/i);
      expect(lenderInput).toHaveAttribute('aria-invalid', 'true');
      expect(lenderInput).toHaveAttribute('aria-describedby', 'borrowing-lender-name-error');
    });

    rerender(
      <RecordRepaymentModal
        isOpen={true}
        onClose={vi.fn()}
        accounts={sampleAccounts}
        lenders={sampleLenders}
        borrowings={sampleBorrowings}
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getByLabelText(/^Lender/i)).toHaveAttribute('aria-required', 'true');
    expect(screen.getByLabelText(/Repayment Amount \(₹\)/i)).toHaveAttribute('aria-required', 'true');
    expect(screen.getByLabelText(/Payment Account/i)).toHaveAttribute('aria-required', 'true');
    expect(screen.getByLabelText(/Repayment Date/i)).toHaveAttribute('aria-required', 'true');
  });
});

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationsPage } from '@/features/notifications/NotificationsPage';
import { Header } from '@/app/navigation/Header';
import { Sidebar } from '@/app/navigation/Sidebar';
import { CommandPalette } from '@/components/overlays/CommandPalette';
import * as useNotificationsModule from '@/features/notifications/hooks/useNotifications';
import * as useAccountSyncModule from '@/features/accounts/hooks/useAccountSync';
import * as useAuthModule from '@/features/auth/hooks/useAuth';
import { NotificationDTO } from '@/application';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn()
  }
}));

const USER_ID = '11111111-1111-4111-8111-111111111111';

const sampleNotifications: NotificationDTO[] = [
  {
    id: 'aaaa1111-1111-4111-8111-111111111111',
    userId: USER_ID,
    category: 'recurring_payment',
    severity: 'critical',
    status: 'unread',
    dedupeKey: 'recurring_payment:rule1:2026-05-10',
    title: 'Overdue payment: Internet Bill',
    message: 'Internet Bill (₹999.00) was due 2 days ago (2026-05-10).',
    entityType: 'recurring_rule',
    entityId: '33333333-3333-4333-8333-333333333333',
    triggerDate: '2026-05-10',
    actionRoute: '/recurring',
    metadata: { amountPaise: 99900, daysUntilDue: -2 },
    version: 2,
    createdAt: '2026-05-08T08:00:00.000Z',
    updatedAt: '2026-05-12T08:00:00.000Z'
  },
  {
    id: 'bbbb2222-2222-4222-8222-222222222222',
    userId: USER_ID,
    category: 'budget_warning',
    severity: 'warning',
    status: 'unread',
    dedupeKey: 'budget_alert:b1:2026-05',
    title: 'Budget approaching limit: Food',
    message: 'Food budget for 2026-05 is 85% used (₹8,500.00 of ₹10,000.00).',
    entityType: 'budget',
    entityId: '44444444-4444-4444-8444-444444444444',
    triggerDate: '2026-05-11',
    actionRoute: '/budgets',
    metadata: { limitPaise: 1000000, spentPaise: 850000, utilizationPercentage: 85 },
    version: 1,
    createdAt: '2026-05-11T08:00:00.000Z',
    updatedAt: '2026-05-11T08:00:00.000Z'
  },
  {
    id: 'cccc3333-3333-4333-8333-333333333333',
    userId: USER_ID,
    category: 'budget_exceeded',
    severity: 'critical',
    status: 'read',
    dedupeKey: 'budget_alert:b2:2026-05',
    title: 'Budget exceeded: Shopping',
    message: 'Shopping exceeded its 2026-05 budget of ₹5,000.00 (₹6,200.00 spent).',
    entityType: 'budget',
    entityId: '55555555-5555-4555-8555-555555555555',
    triggerDate: '2026-05-09',
    actionRoute: '/budgets',
    metadata: { limitPaise: 500000, spentPaise: 620000, utilizationPercentage: 124 },
    readAt: '2026-05-09T12:00:00.000Z',
    version: 2,
    createdAt: '2026-05-09T08:00:00.000Z',
    updatedAt: '2026-05-09T12:00:00.000Z'
  },
  {
    id: 'dddd4444-4444-4444-8444-444444444444',
    userId: USER_ID,
    category: 'recurring_payment',
    severity: 'info',
    status: 'dismissed',
    dedupeKey: 'recurring_payment:rule2:2026-05-20',
    title: 'Upcoming payment: Streaming',
    message: 'Streaming (₹499.00) is due in 2 days.',
    entityType: 'recurring_rule',
    entityId: '66666666-6666-4666-8666-666666666666',
    triggerDate: '2026-05-20',
    actionRoute: '/recurring',
    metadata: { amountPaise: 49900, daysUntilDue: 2 },
    dismissedAt: '2026-05-18T10:00:00.000Z',
    version: 2,
    createdAt: '2026-05-18T08:00:00.000Z',
    updatedAt: '2026-05-18T10:00:00.000Z'
  }
];

describe('Phase 9 Stage 5: Notifications Center & Navigation UI', () => {
  const mockMarkAsRead = vi.fn();
  const mockMarkAllAsRead = vi.fn();
  const mockDismissNotification = vi.fn();
  const mockRefetch = vi.fn();
  const mockSyncNow = vi.fn();

  const setupMocks = (
    overrides?: Partial<ReturnType<typeof useNotificationsModule.useNotifications>>
  ) => {
    vi.spyOn(useNotificationsModule, 'useNotifications').mockReturnValue({
      notifications: sampleNotifications,
      allNotifications: sampleNotifications,
      unreadCount: 2,
      totalCount: 4,
      pendingNotificationIdSet: new Set(['aaaa1111-1111-4111-8111-111111111111']),
      isLoading: false,
      isError: false,
      error: null,
      refetch: mockRefetch,
      isAuthenticated: true,
      markAsRead: mockMarkAsRead,
      isMarkingRead: false,
      markAllAsRead: mockMarkAllAsRead,
      isMarkingAllRead: false,
      dismissNotification: mockDismissNotification,
      isDismissing: false,
      ...overrides
    });

    vi.spyOn(useAccountSyncModule, 'useAccountSync').mockReturnValue({
      syncNow: mockSyncNow,
      isSyncing: false,
      lastResult: null,
      pendingCount: 1,
      isAuthenticated: true
    } as unknown as ReturnType<typeof useAccountSyncModule.useAccountSync>);

    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
      user: { id: USER_ID, email: 'test@laxmilens.local', displayName: 'Test User' },
      isAuthenticated: true,
      isLoading: false,
      signOut: vi.fn()
    } as unknown as ReturnType<typeof useAuthModule.useAuth>);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockMarkAsRead.mockResolvedValue(sampleNotifications[0]);
    mockMarkAllAsRead.mockResolvedValue({ updatedCount: 2 });
    mockDismissNotification.mockResolvedValue(sampleNotifications[3]);
    mockSyncNow.mockResolvedValue({});
  });

  it('renders notifications, unread count, categories, severities, read/unread state, and supports All/Unread/History + Category filtering', () => {
    setupMocks();
    render(
      <MemoryRouter>
        <NotificationsPage />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.getByText('2 Unread')).toBeInTheDocument();
    // Active tab shows unread + read (excludes dismissed until History tab)
    expect(screen.getByText('Overdue payment: Internet Bill')).toBeInTheDocument();
    expect(screen.getByText('Budget approaching limit: Food')).toBeInTheDocument();
    expect(screen.getByText('Budget exceeded: Shopping')).toBeInTheDocument();
    expect(screen.queryByText('Upcoming payment: Streaming')).not.toBeInTheDocument();
    expect(screen.getByText('Pending Sync')).toBeInTheDocument();

    // Unread filter hides already-read item
    fireEvent.click(screen.getByRole('tab', { name: /Unread/i }));
    expect(screen.getByText('Overdue payment: Internet Bill')).toBeInTheDocument();
    expect(screen.queryByText('Budget exceeded: Shopping')).not.toBeInTheDocument();

    // Category filter narrows down cleanly
    fireEvent.click(screen.getByRole('button', { name: 'Budget Warning' }));
    expect(screen.getByText('Budget approaching limit: Food')).toBeInTheDocument();
    expect(screen.queryByText('Overdue payment: Internet Bill')).not.toBeInTheDocument();

    // Reset category filter and inspect History tab (includes read + dismissed)
    fireEvent.click(screen.getByRole('button', { name: 'All Categories' }));
    fireEvent.click(screen.getByRole('tab', { name: /History/i }));
    expect(screen.getByText('Budget exceeded: Shopping')).toBeInTheDocument();
    expect(screen.getByText('Upcoming payment: Streaming')).toBeInTheDocument();
  });

  it('executes Mark as Read, Mark All as Read, Dismiss, and route navigation actions', async () => {
    setupMocks();
    render(
      <MemoryRouter initialEntries={['/notifications']}>
        <Routes>
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/recurring" element={<div>Recurring Target View</div>} />
          <Route path="/budgets" element={<div>Budgets Target View</div>} />
        </Routes>
      </MemoryRouter>
    );

    const markReadBtns = screen.getAllByRole('button', { name: 'Mark as Read' });
    fireEvent.click(markReadBtns[0]!);
    await waitFor(() => {
      expect(mockMarkAsRead).toHaveBeenCalledWith(sampleNotifications[0]!.id);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Mark All as Read' }));
    await waitFor(() => {
      expect(mockMarkAllAsRead).toHaveBeenCalledTimes(1);
    });

    const dismissBtns = screen.getAllByRole('button', { name: 'Dismiss' });
    fireEvent.click(dismissBtns[0]!);
    await waitFor(() => {
      expect(mockDismissNotification).toHaveBeenCalledWith(sampleNotifications[0]!.id);
    });

    fireEvent.click(screen.getByRole('button', { name: /Open Recurring/i }));
    expect(screen.getByText('Recurring Target View')).toBeInTheDocument();
  });

  it('renders loading, error with retry, and empty states cleanly', () => {
    setupMocks({ isLoading: true });
    const { rerender } = render(
      <MemoryRouter>
        <NotificationsPage />
      </MemoryRouter>
    );
    expect(screen.getByLabelText('Loading notifications')).toBeInTheDocument();

    setupMocks({
      isLoading: false,
      isError: true,
      error: new Error('IndexedDB unavailable')
    });
    rerender(
      <MemoryRouter>
        <NotificationsPage />
      </MemoryRouter>
    );
    expect(screen.getByText('Unable to load notifications')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Try Again/i }));
    expect(mockRefetch).toHaveBeenCalledTimes(1);

    setupMocks({
      notifications: [],
      allNotifications: [],
      unreadCount: 0,
      totalCount: 0,
      isLoading: false,
      isError: false
    });
    rerender(
      <MemoryRouter>
        <NotificationsPage />
      </MemoryRouter>
    );
    expect(screen.getByText('No notifications to show')).toBeInTheDocument();
  });

  it('integrates live unread badge into Header Bell and navigates cleanly to /notifications without static dialog', () => {
    setupMocks();
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <Header onOpenCommandPalette={vi.fn()} />
                <Routes>
                  <Route path="/dashboard" element={<div>Dashboard Route</div>} />
                  <Route path="/notifications" element={<NotificationsPage />} />
                </Routes>
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByTestId('header-unread-badge')).toHaveTextContent('2');
    expect(
      screen.queryByText(/Offline-First Local Storage Active/i)
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Notifications \(2 unread\)/i }));
    expect(
      screen.getAllByRole('heading', { name: 'Notifications', level: 1 }).length
    ).toBeGreaterThanOrEqual(2);
    expect(
      screen.getByText(/Monitor upcoming and overdue recurring payments/i)
    ).toBeInTheDocument();
  });

  it('includes Notifications navigation with unread count in Sidebar and CommandPalette', () => {
    setupMocks();
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Sidebar isCollapsed={false} onToggleCollapse={vi.fn()} />
        <CommandPalette isOpen={true} onClose={vi.fn()} onQuickAdd={vi.fn()} />
      </MemoryRouter>
    );

    const sidebarLink = screen.getByRole('link', { name: /Notifications/i });
    expect(sidebarLink).toHaveAttribute('href', '/notifications');
    expect(sidebarLink).toHaveTextContent('2');
    expect(
      screen.getByText('View payment alerts, budget warnings, and alert history')
    ).toBeInTheDocument();
  });
});

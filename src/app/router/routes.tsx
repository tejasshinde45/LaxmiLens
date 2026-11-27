import React, { ComponentType, LazyExoticComponent, Suspense, lazy } from 'react';
import { createBrowserRouter, Navigate, RouteObject } from 'react-router-dom';
import { RouteErrorFallback } from '@/components/feedback/RouteErrorFallback';
import { RouteLoadingFallback } from '@/components/feedback/RouteLoadingFallback';
import { AppLayout } from '../layouts/AppLayout';
import { ProtectedRoute } from './ProtectedRoute';
import { GuestRoute } from './GuestRoute';

function lazyNamed<TModule extends Record<string, unknown>, TKey extends keyof TModule>(
  loader: () => Promise<TModule>,
  exportName: TKey
): LazyExoticComponent<ComponentType<Record<string, never>>> {
  return lazy(async () => {
    const mod = await loader();
    return {
      default: mod[exportName] as ComponentType<Record<string, never>>
    };
  });
}

function withRouteSuspense(
  LazyComponent: LazyExoticComponent<ComponentType<Record<string, never>>>,
  options: { fullScreen?: boolean; label?: string } = {}
): React.ReactElement {
  return (
    <Suspense
      fallback={
        <RouteLoadingFallback
          fullScreen={options.fullScreen ?? false}
          label={options.label}
        />
      }
    >
      <LazyComponent />
    </Suspense>
  );
}

// Lazy-loaded authentication routes
const AuthCallbackPage = lazyNamed(
  () => import('@/features/auth/pages/AuthCallbackPage'),
  'AuthCallbackPage'
);
const LoginPage = lazyNamed(
  () => import('@/features/auth/pages/LoginPage'),
  'LoginPage'
);
const RegisterPage = lazyNamed(
  () => import('@/features/auth/pages/RegisterPage'),
  'RegisterPage'
);
const ForgotPasswordPage = lazyNamed(
  () => import('@/features/auth/pages/ForgotPasswordPage'),
  'ForgotPasswordPage'
);
const ResetPasswordPage = lazyNamed(
  () => import('@/features/auth/pages/ResetPasswordPage'),
  'ResetPasswordPage'
);

// Lazy-loaded application feature routes (including Recharts/D3-heavy Analytics & Reports)
const DashboardPage = lazyNamed(
  () => import('@/features/dashboard/DashboardPage'),
  'DashboardPage'
);
const TransactionsPage = lazyNamed(
  () => import('@/features/transactions/TransactionsPage'),
  'TransactionsPage'
);
const AccountsPage = lazyNamed(
  () => import('@/features/accounts/AccountsPage'),
  'AccountsPage'
);
const BorrowingsPage = lazyNamed(
  () => import('@/features/borrowings/BorrowingsPage'),
  'BorrowingsPage'
);
const BudgetsPage = lazyNamed(
  () => import('@/features/budgets/BudgetsPage'),
  'BudgetsPage'
);
const RecurringPage = lazyNamed(
  () => import('@/features/recurring/RecurringPage'),
  'RecurringPage'
);
const AnalyticsPage = lazyNamed(
  () => import('@/features/analytics/AnalyticsPage'),
  'AnalyticsPage'
);
const CalendarPage = lazyNamed(
  () => import('@/features/calendar/CalendarPage'),
  'CalendarPage'
);
const ReportsPage = lazyNamed(
  () => import('@/features/reports/ReportsPage'),
  'ReportsPage'
);
const NotificationsPage = lazyNamed(
  () => import('@/features/notifications/NotificationsPage'),
  'NotificationsPage'
);
const SettingsPage = lazyNamed(
  () => import('@/features/settings/SettingsPage'),
  'SettingsPage'
);

export const appRoutes: RouteObject[] = [
  {
    errorElement: <RouteErrorFallback homePath="/dashboard" homeLabel="Back to Dashboard" />,
    children: [
      // Dedicated OAuth Callback Route
      {
        path: '/auth/callback',
        element: withRouteSuspense(AuthCallbackPage, {
          fullScreen: true,
          label: 'Completing sign-in...'
        }),
        errorElement: <RouteErrorFallback homePath="/login" homeLabel="Back to Sign In" />
      },

      // Guest-only Authentication Routes
      {
        element: <GuestRoute />,
        errorElement: <RouteErrorFallback homePath="/login" homeLabel="Back to Sign In" />,
        children: [
          {
            path: '/login',
            element: withRouteSuspense(LoginPage, { fullScreen: true, label: 'Loading sign-in...' })
          },
          {
            path: '/register',
            element: withRouteSuspense(RegisterPage, {
              fullScreen: true,
              label: 'Loading registration...'
            })
          },
          {
            path: '/forgot-password',
            element: withRouteSuspense(ForgotPasswordPage, {
              fullScreen: true,
              label: 'Loading recovery...'
            })
          },
          {
            path: '/reset-password',
            element: withRouteSuspense(ResetPasswordPage, {
              fullScreen: true,
              label: 'Loading password reset...'
            })
          }
        ]
      },

      // Protected Application Routes
      {
        path: '/',
        element: <ProtectedRoute />,
        errorElement: <RouteErrorFallback homePath="/dashboard" homeLabel="Back to Dashboard" />,
        children: [
          {
            element: <AppLayout />,
            errorElement: <RouteErrorFallback homePath="/dashboard" homeLabel="Back to Dashboard" />,
            children: [
              {
                errorElement: (
                  <RouteErrorFallback
                    embedded
                    homePath="/dashboard"
                    homeLabel="Back to Dashboard"
                  />
                ),
                children: [
                  {
                    index: true,
                    element: <Navigate to="/dashboard" replace />
                  },
                  {
                    path: 'dashboard',
                    element: withRouteSuspense(DashboardPage, { label: 'Loading overview...' })
                  },
                  {
                    path: 'transactions',
                    element: withRouteSuspense(TransactionsPage, { label: 'Loading ledger...' })
                  },
                  {
                    path: 'accounts',
                    element: withRouteSuspense(AccountsPage, { label: 'Loading accounts...' })
                  },
                  {
                    path: 'borrowings',
                    element: withRouteSuspense(BorrowingsPage, { label: 'Loading borrowings...' })
                  },
                  {
                    path: 'budgets',
                    element: withRouteSuspense(BudgetsPage, { label: 'Loading budgets...' })
                  },
                  {
                    path: 'recurring',
                    element: withRouteSuspense(RecurringPage, { label: 'Loading recurring...' })
                  },
                  {
                    path: 'analytics',
                    element: withRouteSuspense(AnalyticsPage, { label: 'Loading analytics...' })
                  },
                  {
                    path: 'calendar',
                    element: withRouteSuspense(CalendarPage, { label: 'Loading calendar...' })
                  },
                  {
                    path: 'reports',
                    element: withRouteSuspense(ReportsPage, { label: 'Loading reports...' })
                  },
                  {
                    path: 'notifications',
                    element: withRouteSuspense(NotificationsPage, {
                      label: 'Loading notifications...'
                    })
                  },
                  {
                    path: 'settings',
                    element: withRouteSuspense(SettingsPage, { label: 'Loading settings...' })
                  },
                  {
                    path: '*',
                    element: <Navigate to="/dashboard" replace />
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  }
];

export const router = createBrowserRouter(appRoutes);

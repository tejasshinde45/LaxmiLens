import React from 'react';
import { createBrowserRouter } from 'react-router-dom';
import { AppLayout } from '../layouts/AppLayout';
import { Card } from '@/components/ui/Card';

const PlaceholderView: React.FC<{ title: string; description: string }> = ({
  title,
  description
}) => (
  <div className="space-y-4">
    <h1 className="text-2xl font-bold tracking-tight text-[#F5F1E8]">{title}</h1>
    <Card>
      <p className="text-sm text-[#B9B4AA]">{description}</p>
    </Card>
  </div>
);

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      {
        index: true,
        element: (
          <PlaceholderView
            title="Dashboard"
            description="Architectural foundation active. Dashboard view will render financial summaries, cashflow trends, and recent ledger entries."
          />
        )
      },
      {
        path: 'transactions',
        element: (
          <PlaceholderView
            title="Transactions"
            description="Transactional ledger view for offline capture, filtering, and reconciliation."
          />
        )
      },
      {
        path: 'accounts',
        element: (
          <PlaceholderView
            title="Accounts"
            description="Manage Bank, Cash, UPI, Wallet, and Credit Card accounts with strict derived balances."
          />
        )
      },
      {
        path: 'analytics',
        element: (
          <PlaceholderView
            title="Analytics"
            description="Spending analytics, monthly budget breakdown, and net worth historical trajectories."
          />
        )
      },
      {
        path: 'settings',
        element: (
          <PlaceholderView
            title="Settings"
            description="Application settings, sync status, and data export configuration."
          />
        )
      }
    ]
  }
]);

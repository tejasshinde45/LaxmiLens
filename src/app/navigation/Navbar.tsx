import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  ArrowLeftRight,
  Wallet,
  PieChart,
  Settings,
  Cloud,
  CloudOff,
  RefreshCw
} from 'lucide-react';
import { useSyncStatus } from '@/hooks/useSyncStatus';
import { cn } from '@/utils/cn';

export const Navbar: React.FC = () => {
  const syncStatus = useSyncStatus();

  const navItems = [
    { label: 'Dashboard', path: '/', icon: LayoutDashboard },
    { label: 'Transactions', path: '/transactions', icon: ArrowLeftRight },
    { label: 'Accounts', path: '/accounts', icon: Wallet },
    { label: 'Analytics', path: '/analytics', icon: PieChart },
    { label: 'Settings', path: '/settings', icon: Settings }
  ];

  return (
    <>
      {/* Top Header */}
      <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-[#303030] bg-[#1B1B1B]/80 px-4 md:px-8 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#D6AD60] font-bold text-[#101010]">
            LL
          </div>
          <span className="text-lg font-bold tracking-tight text-[#F5F1E8]">
            Laxmi<span className="text-[#D6AD60]">Lens</span>
          </span>
        </div>

        {/* Sync Status Indicator */}
        <div className="flex items-center gap-2 rounded-full border border-[#303030] bg-[#101010] px-3 py-1 text-xs">
          {!syncStatus.isOnline ? (
            <span className="flex items-center gap-1.5 text-[#E4B66D]">
              <CloudOff className="h-3.5 w-3.5" />
              <span>Offline ({syncStatus.pendingOutboxCount})</span>
            </span>
          ) : syncStatus.isSyncing ? (
            <span className="flex items-center gap-1.5 text-[#D6AD60]">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              <span>Syncing...</span>
            </span>
          ) : syncStatus.pendingOutboxCount > 0 ? (
            <span className="flex items-center gap-1.5 text-[#E4B66D]">
              <Cloud className="h-3.5 w-3.5" />
              <span>Pending ({syncStatus.pendingOutboxCount})</span>
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-[#72B895]">
              <Cloud className="h-3.5 w-3.5" />
              <span>Synced</span>
            </span>
          )}
        </div>
      </header>

      {/* Mobile Bottom Navigation Bar (PWA optimized) */}
      <nav className="fixed bottom-0 left-0 z-30 flex h-16 w-full items-center justify-around border-t border-[#303030] bg-[#1B1B1B] md:hidden">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                cn(
                  'flex flex-col items-center gap-1 text-xs font-medium transition-colors',
                  isActive ? 'text-[#D6AD60]' : 'text-[#858078] hover:text-[#B9B4AA]'
                )
              }
            >
              <Icon className="h-5 w-5" />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>
    </>
  );
};

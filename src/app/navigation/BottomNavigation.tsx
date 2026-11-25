import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  ArrowLeftRight,
  Plus,
  Wallet,
  Menu,
  PiggyBank,
  PieChart,
  CalendarDays,
  FileText,
  Settings,
  X,
  HandCoins,
  Repeat,
  Bell
} from 'lucide-react';
import { Dialog, DialogPortal, DialogOverlay } from '@/components/ui/Dialog';
import { useNotifications } from '@/features/notifications/hooks/useNotifications';
import { cn } from '@/utils/cn';

export interface BottomNavigationProps {
  onQuickAdd: () => void;
  className?: string;
}

export const BottomNavigation: React.FC<BottomNavigationProps> = ({
  onQuickAdd,
  className
}) => {
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const navigate = useNavigate();
  const { unreadCount } = useNotifications();

  const handleMoreNavigation = (path: string) => {
    setIsMoreOpen(false);
    navigate(path);
  };

  const moreItems = [
    { label: 'Borrowings', path: '/borrowings', icon: HandCoins, desc: 'Personal debts & repayments' },
    { label: 'Budgets', path: '/budgets', icon: PiggyBank, desc: 'Monthly category limits' },
    { label: 'Recurring', path: '/recurring', icon: Repeat, desc: 'Recurring bills & reminders' },
    { label: 'Analytics', path: '/analytics', icon: PieChart, desc: 'Spending trends & breakdown' },
    { label: 'Calendar', path: '/calendar', icon: CalendarDays, desc: 'Upcoming scheduled events' },
    { label: 'Reports', path: '/reports', icon: FileText, desc: 'Financial summaries & exports' },
    {
      label: 'Notifications',
      path: '/notifications',
      icon: Bell,
      desc: 'Payment alerts & budget warnings',
      badge: unreadCount > 0 ? unreadCount : undefined
    },
    { label: 'Settings', path: '/settings', icon: Settings, desc: 'Preferences, sync & security' }
  ];

  return (
    <>
      <nav
        aria-label="Mobile Bottom Navigation"
        className={cn(
          'fixed bottom-0 left-0 right-0 z-40 flex h-16 items-center justify-around border-t border-[#303030] bg-[#101010]/95 px-2 backdrop-blur-lg lg:hidden pb-safe select-none print:hidden',
          className
        )}
      >
        {/* 1. Home */}
        <NavLink
          to="/dashboard"
          className={({ isActive }) =>
            cn(
              'flex flex-1 flex-col items-center justify-center gap-1 py-1 text-[11px] font-medium transition-colors min-h-[44px] min-w-[44px] cursor-pointer',
              isActive ? 'text-[#D6AD60] font-semibold' : 'text-[#858078] hover:text-[#B9B4AA]'
            )
          }
        >
          {({ isActive }) => (
            <>
              <LayoutDashboard className={cn('h-5 w-5', isActive && 'text-[#D6AD60]')} />
              <span>Home</span>
            </>
          )}
        </NavLink>

        {/* 2. Transactions */}
        <NavLink
          to="/transactions"
          className={({ isActive }) =>
            cn(
              'flex flex-1 flex-col items-center justify-center gap-1 py-1 text-[11px] font-medium transition-colors min-h-[44px] min-w-[44px] cursor-pointer',
              isActive ? 'text-[#D6AD60] font-semibold' : 'text-[#858078] hover:text-[#B9B4AA]'
            )
          }
        >
          {({ isActive }) => (
            <>
              <ArrowLeftRight className={cn('h-5 w-5', isActive && 'text-[#D6AD60]')} />
              <span>History</span>
            </>
          )}
        </NavLink>

        {/* 3. Center Add FAB */}
        <div className="flex flex-1 items-center justify-center">
          <button
            type="button"
            onClick={onQuickAdd}
            aria-label="Quick Add Transaction"
            className="flex h-11 w-11 items-center justify-center rounded-full bg-[#D6AD60] text-[#101010] shadow-lg shadow-[#D6AD60]/20 hover:bg-[#E2BE7D] active:scale-95 transition-transform cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D6AD60] focus-visible:ring-offset-2 focus-visible:ring-offset-[#101010]"
          >
            <Plus className="h-6 w-6 stroke-[2.5]" />
          </button>
        </div>

        {/* 4. Accounts */}
        <NavLink
          to="/accounts"
          className={({ isActive }) =>
            cn(
              'flex flex-1 flex-col items-center justify-center gap-1 py-1 text-[11px] font-medium transition-colors min-h-[44px] min-w-[44px] cursor-pointer',
              isActive ? 'text-[#D6AD60] font-semibold' : 'text-[#858078] hover:text-[#B9B4AA]'
            )
          }
        >
          {({ isActive }) => (
            <>
              <Wallet className={cn('h-5 w-5', isActive && 'text-[#D6AD60]')} />
              <span>Accounts</span>
            </>
          )}
        </NavLink>

        {/* 5. More */}
        <button
          type="button"
          onClick={() => setIsMoreOpen(true)}
          aria-label="More Features"
          className={cn(
            'flex flex-1 flex-col items-center justify-center gap-1 py-1 text-[11px] font-medium transition-colors min-h-[44px] min-w-[44px] cursor-pointer text-[#858078] hover:text-[#B9B4AA]',
            isMoreOpen && 'text-[#D6AD60]'
          )}
        >
          <Menu className="h-5 w-5" />
          <span>More</span>
        </button>
      </nav>

      {/* Mobile "More" Slide-up Sheet */}
      <Dialog open={isMoreOpen} onOpenChange={setIsMoreOpen}>
        <DialogPortal>
          <DialogOverlay />
          <div className="fixed inset-x-0 bottom-0 z-50 flex max-h-[80vh] flex-col rounded-t-[22px] border-t border-[#303030] bg-[#1B1B1B] p-5 shadow-2xl shadow-black/80 animate-in slide-in-from-bottom duration-200">
            <div className="mx-auto -mt-2 mb-3 h-1 w-10 rounded-full bg-[#303030]" />
            <div className="flex items-center justify-between pb-3 border-b border-[#303030]/60">
              <div>
                <h3 className="font-display text-base font-bold text-[#F5F1E8]">More Options</h3>
                <p className="text-xs text-[#858078]">Explore budgets, reports, and settings</p>
              </div>
              <button
                type="button"
                onClick={() => setIsMoreOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-[#858078] hover:bg-[#242424] hover:text-[#F5F1E8]"
                aria-label="Close menu"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="divide-y divide-[#303030]/50 py-2 overflow-y-auto">
              {moreItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.path}
                    type="button"
                    onClick={() => handleMoreNavigation(item.path)}
                    className="flex w-full items-center gap-3.5 py-3 text-left transition-colors hover:text-[#D6AD60] cursor-pointer"
                  >
                    <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#242424] text-[#D6AD60]">
                      <Icon className="h-4.5 w-4.5" />
                    </div>
                    <div className="flex flex-col flex-1">
                      <span className="text-sm font-medium text-[#F5F1E8]">{item.label}</span>
                      <span className="text-xs text-[#858078]">{item.desc}</span>
                    </div>
                    {item.badge !== undefined && (
                      <span className="rounded-full bg-[#D6AD60]/20 px-2 py-0.5 text-[11px] font-bold font-tabular text-[#D6AD60]">
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </DialogPortal>
      </Dialog>
    </>
  );
};

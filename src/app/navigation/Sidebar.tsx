import {
  LayoutDashboard,
  ArrowLeftRight,
  Wallet,
  PiggyBank,
  PieChart,
  CalendarDays,
  FileText,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  Sparkles,
  HandCoins
} from 'lucide-react';
import { NavigationItem } from './NavigationItem';
import { IconButton } from '@/components/ui/IconButton';
import { Separator } from '@/components/ui/Separator';
import { cn } from '@/utils/cn';

export interface SidebarProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  className?: string;
}

export const Sidebar: React.FC<SidebarProps> = ({
  isCollapsed,
  onToggleCollapse,
  className
}) => {
  const mainMenuItems = [
    { label: 'Overview', to: '/dashboard', icon: LayoutDashboard },
    { label: 'Transactions', to: '/transactions', icon: ArrowLeftRight },
    { label: 'Accounts', to: '/accounts', icon: Wallet },
    { label: 'Borrowings', to: '/borrowings', icon: HandCoins },
    { label: 'Budgets', to: '/budgets', icon: PiggyBank },
    { label: 'Analytics', to: '/analytics', icon: PieChart }
  ];

  const manageItems = [
    { label: 'Calendar', to: '/calendar', icon: CalendarDays },
    { label: 'Reports', to: '/reports', icon: FileText }
  ];

  const preferenceItems = [
    { label: 'Settings', to: '/settings', icon: Settings }
  ];

  return (
    <aside
      className={cn(
        'sticky top-0 h-screen shrink-0 border-r border-[#303030] bg-[#101010] flex flex-col justify-between transition-all duration-200 z-30 select-none',
        isCollapsed ? 'w-[68px] px-2.5 py-4' : 'w-64 px-4 py-4',
        className
      )}
    >
      <div className="flex flex-col gap-5 overflow-y-auto overflow-x-hidden">
        {/* BRAND Section */}
        <div className="flex items-center justify-between min-h-[44px]">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-br from-[#D6AD60] to-[#B88E46] font-display font-bold text-[#101010] shadow-sm shadow-[#D6AD60]/20">
              LL
            </div>
            {!isCollapsed && (
              <div className="flex flex-col overflow-hidden">
                <span className="font-display text-base font-bold tracking-tight text-[#F5F1E8] truncate leading-tight">
                  Laxmi<span className="text-[#D6AD60]">Lens</span>
                </span>
                <span className="text-[10px] font-medium text-[#858078] truncate leading-none mt-0.5">
                  See Your Money Clearly
                </span>
              </div>
            )}
          </div>

          <IconButton
            onClick={onToggleCollapse}
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            size="sm"
            className="hidden lg:flex text-[#858078] hover:text-[#F5F1E8]"
          >
            {isCollapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </IconButton>
        </div>

        <Separator />

        {/* MAIN MENU Section */}
        <div className="space-y-1">
          {!isCollapsed && (
            <p className="px-3 text-[10px] font-bold uppercase tracking-wider text-[#858078] mb-1.5 font-display">
              Main Menu
            </p>
          )}
          {mainMenuItems.map((item) => (
            <NavigationItem
              key={item.to}
              label={item.label}
              to={item.to}
              icon={item.icon}
              isCollapsed={isCollapsed}
            />
          ))}
        </div>

        {/* MANAGE Section */}
        <div className="space-y-1">
          {!isCollapsed && (
            <p className="px-3 text-[10px] font-bold uppercase tracking-wider text-[#858078] mb-1.5 font-display">
              Manage
            </p>
          )}
          {manageItems.map((item) => (
            <NavigationItem
              key={item.to}
              label={item.label}
              to={item.to}
              icon={item.icon}
              isCollapsed={isCollapsed}
            />
          ))}
        </div>

        {/* PREFERENCES Section */}
        <div className="space-y-1">
          {!isCollapsed && (
            <p className="px-3 text-[10px] font-bold uppercase tracking-wider text-[#858078] mb-1.5 font-display">
              Preferences
            </p>
          )}
          {preferenceItems.map((item) => (
            <NavigationItem
              key={item.to}
              label={item.label}
              to={item.to}
              icon={item.icon}
              isCollapsed={isCollapsed}
            />
          ))}
        </div>
      </div>

      {/* Sidebar Footer: System Status */}
      <div className="pt-3 border-t border-[#303030]/60">
        {!isCollapsed ? (
          <div className="rounded-[10px] bg-[#1B1B1B] p-2.5 border border-[#303030] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-[#72B895] animate-pulse" />
              <div className="flex flex-col">
                <span className="text-[11px] font-medium text-[#F5F1E8]">Offline-First</span>
                <span className="text-[10px] text-[#858078]">Local Store Ready</span>
              </div>
            </div>
            <Sparkles className="h-3.5 w-3.5 text-[#D6AD60]" />
          </div>
        ) : (
          <div className="flex justify-center py-1">
            <span
              className="h-2 w-2 rounded-full bg-[#72B895]"
              title="Offline-First Local Storage Active"
            />
          </div>
        )}
      </div>
    </aside>
  );
};

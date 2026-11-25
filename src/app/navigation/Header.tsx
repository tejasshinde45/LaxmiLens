import { useLocation, useNavigate, Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Search,
  Bell,
  HardDrive,
  User,
  Settings,
  LogOut,
  ShieldCheck
} from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { IconButton } from '@/components/ui/IconButton';
import { Badge } from '@/components/ui/Badge';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { useNotifications } from '@/features/notifications/hooks/useNotifications';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut
} from '@/components/ui/DropdownMenu';
import { cn } from '@/utils/cn';

export interface HeaderProps {
  onOpenCommandPalette: () => void;
  className?: string;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenCommandPalette,
  className
}) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { unreadCount } = useNotifications();

  const handleSignOut = async () => {
    try {
      await signOut();
      toast.success('Signed out successfully');
    } catch {
      toast.error('Sign out failed');
    }
  };

  // Derive human-readable page title
  const getPageTitle = (pathname: string): string => {
    switch (pathname) {
      case '/':
      case '/dashboard':
        return 'Overview';
      case '/transactions':
        return 'Transactions';
      case '/accounts':
        return 'Accounts';
      case '/borrowings':
        return 'Borrowings';
      case '/budgets':
        return 'Budgets';
      case '/recurring':
        return 'Recurring & Reminders';
      case '/analytics':
        return 'Analytics';
      case '/calendar':
        return 'Calendar';
      case '/reports':
        return 'Reports';
      case '/notifications':
        return 'Notifications';
      case '/settings':
        return 'Settings';
      default:
        return 'LaxmiLens';
    }
  };

  const pageTitle = getPageTitle(location.pathname);

  return (
    <header
      className={cn(
        'sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-[#303030] bg-[#101010]/85 px-4 md:px-8 backdrop-blur-md select-none',
        className
      )}
    >
      {/* Left: Mobile Brand & Desktop Breadcrumb/Title */}
      <div className="flex items-center gap-3">
        {/* Mobile-only logo */}
        <Link to="/dashboard" className="flex items-center gap-2 lg:hidden">
          <div className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-gradient-to-br from-[#D6AD60] to-[#B88E46] text-xs font-bold text-[#101010] shadow-sm shadow-[#D6AD60]/20 font-display">
            LL
          </div>
        </Link>

        {/* Current Page Title */}
        <div className="flex flex-col">
          <h1 className="text-base font-bold tracking-tight text-[#F5F1E8] font-display">
            {pageTitle}
          </h1>
        </div>
      </div>

      {/* Center: Command Palette Trigger (Desktop) */}
      <div className="hidden md:flex flex-1 max-w-md mx-6">
        <button
          type="button"
          onClick={onOpenCommandPalette}
          className="group flex h-9.5 w-full items-center justify-between rounded-[10px] border border-[#303030] bg-[#1B1B1B] px-3.5 text-xs text-[#858078] transition-colors hover:border-[#454545] hover:text-[#B9B4AA] cursor-pointer"
        >
          <span className="flex items-center gap-2">
            <Search className="h-3.5 w-3.5 text-[#858078] group-hover:text-[#D6AD60] transition-colors" />
            <span>Search accounts, tools, or press</span>
          </span>
          <kbd className="inline-flex items-center gap-0.5 rounded border border-[#303030] bg-[#242424] px-1.5 py-0.5 text-[10px] font-medium text-[#858078]">
            Ctrl K
          </kbd>
        </button>
      </div>

      {/* Right: Actions, Sync Status, Notifications, Profile */}
      <div className="flex items-center gap-2.5">
        {/* Mobile search trigger */}
        <IconButton
          onClick={onOpenCommandPalette}
          aria-label="Search and command palette"
          size="sm"
          className="md:hidden"
        >
          <Search className="h-4 w-4" />
        </IconButton>

        {/* Honest Sync Status Indicator */}
        <div className="hidden sm:flex items-center">
          <Badge variant="outline" size="sm" className="gap-1.5 border-[#303030] bg-[#1B1B1B]">
            <HardDrive className="h-3 w-3 text-[#72B895]" />
            <span className="text-[11px] text-[#B9B4AA]">Local Store</span>
          </Badge>
        </div>

        {/* Notifications Center Trigger */}
        <IconButton
          onClick={() => navigate('/notifications')}
          aria-label={
            unreadCount > 0
              ? `Notifications (${unreadCount} unread)`
              : 'Notifications'
          }
          size="sm"
          className="relative"
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <>
              <span
                className="absolute top-1 right-1 h-2 w-2 rounded-full bg-[#D6AD60]"
                aria-hidden="true"
              />
              <span
                data-testid="header-unread-badge"
                className="absolute -top-1.5 -right-1.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#D6AD60] px-1 text-[10px] font-bold font-tabular text-[#101010] leading-none"
              >
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            </>
          )}
        </IconButton>

        {/* Profile Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="User account menu"
              className="flex items-center gap-2 rounded-full p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D6AD60] cursor-pointer"
            >
              <Avatar name={user?.displayName || user?.email || 'User'} size="sm" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col space-y-0.5">
                <span className="text-xs font-semibold text-[#F5F1E8]">
                  {user?.displayName || 'Personal Account'}
                </span>
                <span className="text-[10px] text-[#858078] lowercase truncate">
                  {user?.email || 'authenticated user'}
                </span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/settings" className="w-full flex items-center gap-2">
                <User className="h-3.5 w-3.5 text-[#858078]" />
                <span>Profile Overview</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/settings" className="w-full flex items-center gap-2">
                <Settings className="h-3.5 w-3.5 text-[#858078]" />
                <span>Preferences</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/settings" className="w-full flex items-center gap-2">
                <ShieldCheck className="h-3.5 w-3.5 text-[#858078]" />
                <span>Security & Backup</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="danger" onClick={handleSignOut} className="cursor-pointer">
              <LogOut className="h-3.5 w-3.5" />
              <span>Sign Out</span>
              <DropdownMenuShortcut>⇧Q</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
};

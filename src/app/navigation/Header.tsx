import { useState } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Search,
  Bell,
  HardDrive,
  User,
  Settings,
  LogOut,
  ShieldCheck,
  CheckCircle2
} from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { IconButton } from '@/components/ui/IconButton';
import { Badge } from '@/components/ui/Badge';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { useRecurring } from '@/features/recurring/hooks/useRecurring';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut
} from '@/components/ui/DropdownMenu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/Dialog';
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
  const { user, signOut } = useAuth();
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const { overdue, dueToday } = useRecurring();
  const urgentReminders = [...overdue, ...dueToday];

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
      case '/settings':
        return 'Settings';
      default:
        return 'LaxmiLens';
    }
  };

  const pageTitle = getPageTitle(location.pathname);

  return (
    <>
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

          {/* Notifications Trigger */}
          <IconButton
            onClick={() => setIsNotificationsOpen(true)}
            aria-label="View notifications"
            size="sm"
            className="relative"
          >
            <Bell className="h-4 w-4" />
            {urgentReminders.length > 0 && (
              <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-[#D6AD60]" />
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

      {/* Notifications Dialog */}
      <Dialog open={isNotificationsOpen} onOpenChange={setIsNotificationsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Notifications</DialogTitle>
            <DialogDescription>
              System updates, recurring transaction alerts, and sync reports.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            {urgentReminders.length > 0 && (
              <div className="space-y-2">
                {urgentReminders.slice(0, 4).map((rem) => (
                  <Link
                    key={`${rem.recurringRuleId}:${rem.occurrenceDate}`}
                    to="/recurring"
                    onClick={() => setIsNotificationsOpen(false)}
                    className="flex items-center justify-between gap-3 rounded-[10px] border border-[#D6AD60]/30 bg-[#1B1B1B] p-3 hover:border-[#D6AD60]/60 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-[#F5F1E8] truncate">
                        {rem.title}
                      </p>
                      <p className="text-[11px] text-[#858078]">
                        {rem.bucket === 'overdue'
                          ? `${Math.abs(rem.daysUntilDue)} day(s) overdue`
                          : 'Due today'}{' '}
                        · {rem.accountName}
                      </p>
                    </div>
                    <Badge
                      variant={rem.bucket === 'overdue' ? 'expense' : 'gold'}
                      size="sm"
                      className="shrink-0"
                    >
                      {rem.amountFormatted}
                    </Badge>
                  </Link>
                ))}
              </div>
            )}

            <div className="flex items-start gap-3 rounded-[10px] border border-[#303030] bg-[#242424] p-3">
              <CheckCircle2 className="h-4 w-4 text-[#72B895] shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <p className="text-xs font-semibold text-[#F5F1E8]">
                  Offline-First Local Storage Active
                </p>
                <p className="text-[11px] text-[#858078]">
                  Transactions are safely queued to your device's IndexedDB. Cloud sync will be available once connected.
                </p>
                <span className="text-[10px] text-[#858078]/80 block pt-1">Today</span>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

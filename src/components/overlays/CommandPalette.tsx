import { useState, useEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  LayoutDashboard,
  ArrowLeftRight,
  Wallet,
  PiggyBank,
  PieChart,
  CalendarDays,
  FileText,
  Settings,
  PlusCircle,
  X,
  HandCoins,
  Repeat
} from 'lucide-react';
import { Dialog, DialogPortal, DialogOverlay } from '@/components/ui/Dialog';
import { cn } from '@/utils/cn';

export interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onQuickAdd: () => void;
}

interface CommandItem {
  id: string;
  title: string;
  description: string;
  category: 'Navigation' | 'Actions';
  icon: typeof LayoutDashboard;
  action: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  onQuickAdd
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  const commands: CommandItem[] = useMemo(
    () => [
      {
        id: 'action-quick-add',
        title: 'Quick Add Transaction',
        description: 'Record an income, expense, or account transfer',
        category: 'Actions',
        icon: PlusCircle,
        action: () => {
          onClose();
          onQuickAdd();
        }
      },
      {
        id: 'nav-dashboard',
        title: 'Overview',
        description: 'View financial health, accounts, and recent ledger activity',
        category: 'Navigation',
        icon: LayoutDashboard,
        action: () => {
          onClose();
          navigate('/dashboard');
        }
      },
      {
        id: 'nav-transactions',
        title: 'Transactions',
        description: 'Explore, filter, and inspect ledger transactions',
        category: 'Navigation',
        icon: ArrowLeftRight,
        action: () => {
          onClose();
          navigate('/transactions');
        }
      },
      {
        id: 'nav-accounts',
        title: 'Accounts',
        description: 'Manage bank accounts, cash, UPI, and credit cards',
        category: 'Navigation',
        icon: Wallet,
        action: () => {
          onClose();
          navigate('/accounts');
        }
      },
      {
        id: 'nav-borrowings',
        title: 'Personal Borrowings',
        description: 'Track money borrowed from friends, relatives, and repayments',
        category: 'Navigation',
        icon: HandCoins,
        action: () => {
          onClose();
          navigate('/borrowings');
        }
      },
      {
        id: 'nav-budgets',
        title: 'Budgets',
        description: 'Set monthly category targets and review spending caps',
        category: 'Navigation',
        icon: PiggyBank,
        action: () => {
          onClose();
          navigate('/budgets');
        }
      },
      {
        id: 'nav-recurring',
        title: 'Recurring & Reminders',
        description: 'Manage recurring income/expenses and confirm due payments',
        category: 'Navigation',
        icon: Repeat,
        action: () => {
          onClose();
          navigate('/recurring');
        }
      },
      {
        id: 'nav-analytics',
        title: 'Analytics',
        description: 'Analyze cashflow, category breakdown, and net worth',
        category: 'Navigation',
        icon: PieChart,
        action: () => {
          onClose();
          navigate('/analytics');
        }
      },
      {
        id: 'nav-calendar',
        title: 'Calendar',
        description: 'Upcoming bills, recurring schedules, and payment dates',
        category: 'Navigation',
        icon: CalendarDays,
        action: () => {
          onClose();
          navigate('/calendar');
        }
      },
      {
        id: 'nav-reports',
        title: 'Reports',
        description: 'Financial statements, summaries, and data export',
        category: 'Navigation',
        icon: FileText,
        action: () => {
          onClose();
          navigate('/reports');
        }
      },
      {
        id: 'nav-settings',
        title: 'Settings',
        description: 'Application preferences, theme, and security settings',
        category: 'Navigation',
        icon: Settings,
        action: () => {
          onClose();
          navigate('/settings');
        }
      }
    ],
    [navigate, onClose, onQuickAdd]
  );

  const filteredCommands = useMemo(() => {
    if (!query.trim()) return commands;
    const q = query.toLowerCase();
    return commands.filter(
      (cmd) =>
        cmd.title.toLowerCase().includes(q) ||
        cmd.description.toLowerCase().includes(q) ||
        cmd.category.toLowerCase().includes(q)
    );
  }, [commands, query]);

  // Reset selected index when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Focus input on open
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredCommands.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) =>
        prev === 0 ? filteredCommands.length - 1 : prev - 1
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredCommands[selectedIndex]) {
        filteredCommands[selectedIndex].action();
      }
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogPortal>
        <DialogOverlay />
        <div className="fixed left-[50%] top-[20%] z-50 w-full max-w-xl translate-x-[-50%] px-4 sm:px-0">
          <div className="overflow-hidden rounded-[16px] border border-[#303030] bg-[#1B1B1B] shadow-2xl shadow-black/80">
            {/* Search Input Bar */}
            <div className="flex items-center border-b border-[#303030] px-4 py-3">
              <Search className="h-4.5 w-4.5 text-[#858078] shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a command or search destination..."
                className="ml-3 flex-1 bg-transparent text-sm text-[#F5F1E8] placeholder:text-[#858078] outline-none"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="rounded-full p-1 text-[#858078] hover:text-[#F5F1E8]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
              <kbd className="ml-2 select-none rounded border border-[#303030] bg-[#242424] px-1.5 py-0.5 text-[10px] text-[#858078]">
                ESC
              </kbd>
            </div>

            {/* Command Results List */}
            <div className="max-h-80 overflow-y-auto p-2">
              {filteredCommands.length > 0 ? (
                <div className="space-y-1">
                  {filteredCommands.map((cmd, index) => {
                    const Icon = cmd.icon;
                    const isSelected = index === selectedIndex;
                    return (
                      <div
                        key={cmd.id}
                        role="button"
                        tabIndex={0}
                        onClick={cmd.action}
                        onMouseEnter={() => setSelectedIndex(index)}
                        className={cn(
                          'flex items-center justify-between rounded-[10px] px-3 py-2.5 text-xs transition-colors cursor-pointer select-none',
                          isSelected
                            ? 'bg-[#242424] text-[#D6AD60]'
                            : 'text-[#B9B4AA] hover:bg-[#242424]/60'
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={cn(
                              'flex h-7 w-7 items-center justify-center rounded-[8px]',
                              isSelected
                                ? 'bg-[#D6AD60]/15 text-[#D6AD60]'
                                : 'bg-[#101010] text-[#858078]'
                            )}
                          >
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="flex flex-col">
                            <span className={cn('font-semibold', isSelected ? 'text-[#F5F1E8]' : 'text-[#B9B4AA]')}>
                              {cmd.title}
                            </span>
                            <span className="text-[11px] text-[#858078]">{cmd.description}</span>
                          </div>
                        </div>

                        <span className="text-[10px] font-medium text-[#858078] bg-[#101010] px-2 py-0.5 rounded-[6px] border border-[#303030]/60">
                          {cmd.category}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="py-10 text-center">
                  <p className="text-xs text-[#858078]">No commands found matching "{query}"</p>
                </div>
              )}
            </div>

            {/* Footer Navigation Hints */}
            <div className="flex items-center justify-between border-t border-[#303030] bg-[#101010]/50 px-4 py-2 text-[11px] text-[#858078]">
              <span>Navigate with arrows</span>
              <span>Press ↵ to select</span>
            </div>
          </div>
        </div>
      </DialogPortal>
    </Dialog>
  );
};

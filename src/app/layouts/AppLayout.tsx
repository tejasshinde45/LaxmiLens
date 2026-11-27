import { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from '../navigation/Sidebar';
import { Header } from '../navigation/Header';
import { BottomNavigation } from '../navigation/BottomNavigation';
import { CommandPalette } from '@/components/overlays/CommandPalette';
import { QuickAddModal } from '@/components/forms/QuickAddModal';
import { useInitialFinancialAlertEvaluation } from '@/features/notifications/hooks/useInitialFinancialAlertEvaluation';

export const AppLayout: React.FC = () => {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);

  useInitialFinancialAlertEvaluation();

  // Global Ctrl+K / Cmd+K keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="min-h-screen bg-[#101010] text-[#F5F1E8] flex overflow-x-hidden print:block print:min-h-0 print:bg-white print:text-[#111111] print:overflow-visible">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:rounded-[8px] focus:bg-[#D6AD60] focus:px-3.5 focus:py-2 focus:text-xs focus:font-semibold focus:text-[#101010] focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-[#F5F1E8]"
      >
        Skip to main content
      </a>

      {/* Desktop Left Sidebar (visible on lg screens >= 1024px) */}
      <Sidebar
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
        className="hidden lg:flex print:hidden"
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 print:block">
        <Header
          onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
          className="print:hidden"
        />

        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 md:px-8 py-6 pb-24 lg:pb-12 focus:outline-none print:max-w-none print:px-0 print:py-0 print:pb-0"
        >
          <Outlet />
        </main>
      </div>

      {/* Mobile Bottom Navigation (visible on mobile/tablet < 1024px) */}
      <BottomNavigation
        onQuickAdd={() => setIsQuickAddOpen(true)}
        className="print:hidden"
      />

      {/* Global Command Palette */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onQuickAdd={() => setIsQuickAddOpen(true)}
      />

      {/* Quick Add Transaction Modal */}
      <QuickAddModal
        isOpen={isQuickAddOpen}
        onClose={() => setIsQuickAddOpen(false)}
      />
    </div>
  );
};

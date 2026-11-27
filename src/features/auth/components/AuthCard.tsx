import React from 'react';
import { Card } from '@/components/ui/Card';

export interface AuthCardProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export const AuthCard: React.FC<AuthCardProps> = ({
  title,
  subtitle,
  children,
  footer
}) => {
  return (
    <main className="min-h-screen w-full flex flex-col items-center justify-center bg-[#101010] text-[#F5F1E8] px-4 py-8 relative overflow-hidden">
      {/* Subtle ambient gold background gradient */}
      <div
        aria-hidden="true"
        className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-[#D6AD60]/5 rounded-full blur-3xl pointer-events-none"
      />

      <div className="w-full max-w-md space-y-6 relative z-10">
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center space-y-2">
          <div className="flex items-center gap-2.5">
            <div
              aria-hidden="true"
              className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-gradient-to-br from-[#D6AD60] to-[#B88E46] text-sm font-bold text-[#101010] shadow-md shadow-[#D6AD60]/20 font-display"
            >
              LL
            </div>
            <span className="text-xl font-bold tracking-tight text-[#F5F1E8] font-display">
              LaxmiLens
            </span>
          </div>
          <p className="text-xs text-[#858078] tracking-wide font-medium">
            See Your Money Clearly
          </p>
        </div>

        {/* Main Content Card */}
        <Card className="border-[#303030] bg-[#1B1B1B] p-6 sm:p-8 shadow-xl shadow-black/50">
          <div className="space-y-1.5 mb-6 text-center">
            <h1 className="text-lg font-semibold tracking-tight text-[#F5F1E8] font-display">
              {title}
            </h1>
            {subtitle && (
              <p className="text-xs text-[#B9B4AA] leading-relaxed">
                {subtitle}
              </p>
            )}
          </div>

          {children}

          {footer && (
            <div className="mt-6 pt-5 border-t border-[#303030] text-center text-xs text-[#858078]">
              {footer}
            </div>
          )}
        </Card>
      </div>
    </main>
  );
};

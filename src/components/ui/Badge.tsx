import React, { HTMLAttributes } from 'react';
import { cn } from '@/utils/cn';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'income' | 'expense' | 'transfer' | 'gold' | 'neutral' | 'warning';
}

export const Badge: React.FC<BadgeProps> = ({
  className,
  variant = 'neutral',
  children,
  ...props
}) => {
  const variants = {
    income: 'bg-[#72B895]/15 text-[#72B895] border-[#72B895]/30',
    expense: 'bg-[#D9827C]/15 text-[#D9827C] border-[#D9827C]/30',
    transfer: 'bg-[#82A9CF]/15 text-[#82A9CF] border-[#82A9CF]/30',
    gold: 'bg-[#D6AD60]/15 text-[#D6AD60] border-[#D6AD60]/30',
    neutral: 'bg-[#242424] text-[#B9B4AA] border-[#303030]',
    warning: 'bg-[#E4B66D]/15 text-[#E4B66D] border-[#E4B66D]/30'
  };

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium font-tabular transition-colors',
        variants[variant],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
};

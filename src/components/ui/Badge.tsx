import { type HTMLAttributes } from 'react';
import { cn } from '@/utils/cn';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'income' | 'expense' | 'transfer' | 'gold' | 'neutral' | 'warning' | 'outline';
  size?: 'sm' | 'md';
  dot?: boolean;
}

export const Badge: React.FC<BadgeProps> = ({
  className,
  variant = 'neutral',
  size = 'md',
  dot = false,
  children,
  ...props
}) => {
  const variants = {
    income: 'bg-[#72B895]/15 text-[#72B895] border-[#72B895]/30',
    expense: 'bg-[#D9827C]/15 text-[#D9827C] border-[#D9827C]/30',
    transfer: 'bg-[#82A9CF]/15 text-[#82A9CF] border-[#82A9CF]/30',
    gold: 'bg-[#D6AD60]/15 text-[#D6AD60] border-[#D6AD60]/30',
    neutral: 'bg-[#242424] text-[#B9B4AA] border-[#303030]',
    warning: 'bg-[#E4B66D]/15 text-[#E4B66D] border-[#E4B66D]/30',
    outline: 'bg-transparent text-[#B9B4AA] border-[#303030]'
  };

  const dotColors = {
    income: 'bg-[#72B895]',
    expense: 'bg-[#D9827C]',
    transfer: 'bg-[#82A9CF]',
    gold: 'bg-[#D6AD60]',
    neutral: 'bg-[#858078]',
    warning: 'bg-[#E4B66D]',
    outline: 'bg-[#B9B4AA]'
  };

  const sizes = {
    sm: 'px-2 py-0.5 text-[11px] gap-1',
    md: 'px-2.5 py-1 text-xs gap-1.5'
  };

  return (
    <span
      className={cn(
        'inline-flex items-center font-medium font-tabular rounded-full border transition-colors select-none',
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {dot && (
        <span
          className={cn('h-1.5 w-1.5 rounded-full shrink-0', dotColors[variant])}
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  );
};

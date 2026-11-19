import { type HTMLAttributes, forwardRef } from 'react';
import { cn } from '@/utils/cn';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'surface' | 'elevated' | 'interactive';
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant = 'surface', children, ...props }, ref) => {
    const variants = {
      surface: 'bg-[#1B1B1B] border-[#303030]',
      elevated: 'bg-[#242424] border-[#303030] shadow-lg shadow-black/40',
      interactive: 'bg-[#1B1B1B] border-[#303030] hover:bg-[#2A2A2A] hover:border-[#454545] transition-all cursor-pointer'
    };

    return (
      <div
        ref={ref}
        className={cn('rounded-xl border p-5 text-[#F5F1E8]', variants[variant], className)}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Card.displayName = 'Card';

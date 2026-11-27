import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from '@/utils/cn';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  'aria-label': string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    { className, variant = 'ghost', size = 'md', type = 'button', 'aria-label': ariaLabel, children, ...props },
    ref
  ) => {
    const baseStyles =
      'inline-flex items-center justify-center transition-colors select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D6AD60] focus-visible:ring-offset-2 focus-visible:ring-offset-[#101010] disabled:opacity-50 disabled:pointer-events-none rounded-[10px] cursor-pointer active:scale-95 shrink-0';

    const variants = {
      primary: 'bg-[#D6AD60] text-[#101010] hover:bg-[#E2BE7D] active:bg-[#B88E46]',
      secondary: 'bg-[#242424] text-[#F5F1E8] hover:bg-[#2A2A2A] border border-[#303030]',
      outline: 'border border-[#303030] text-[#B9B4AA] hover:border-[#D6AD60] hover:text-[#D6AD60] bg-transparent',
      ghost: 'text-[#B9B4AA] hover:text-[#F5F1E8] hover:bg-[#242424]',
      danger: 'text-[#D9827C] hover:bg-[#D9827C]/15'
    };

    const sizes = {
      sm: 'h-8 w-8 min-h-[32px] min-w-[32px] text-sm',
      md: 'h-10 w-10 min-h-[40px] min-w-[40px] text-base',
      lg: 'h-11 w-11 min-h-[44px] min-w-[44px] text-lg'
    };

    return (
      <button
        ref={ref}
        type={type}
        aria-label={ariaLabel}
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        {...props}
      >
        {children}
      </button>
    );
  }
);

IconButton.displayName = 'IconButton';

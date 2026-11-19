import { type ButtonHTMLAttributes, type ReactNode, forwardRef } from 'react';
import { cn } from '@/utils/cn';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'gold-subtle';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'primary',
      size = 'md',
      isLoading = false,
      disabled,
      leftIcon,
      rightIcon,
      children,
      ...props
    },
    ref
  ) => {
    const baseStyles =
      'inline-flex items-center justify-center font-medium transition-colors select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D6AD60] focus-visible:ring-offset-2 focus-visible:ring-offset-[#101010] disabled:opacity-50 disabled:pointer-events-none rounded-[10px] cursor-pointer active:scale-[0.98]';

    const variants = {
      primary: 'bg-[#D6AD60] text-[#101010] hover:bg-[#E2BE7D] active:bg-[#B88E46] font-semibold shadow-sm shadow-[#D6AD60]/10',
      secondary: 'bg-[#242424] text-[#F5F1E8] hover:bg-[#2A2A2A] border border-[#303030]',
      outline: 'border border-[#303030] text-[#F5F1E8] hover:border-[#D6AD60] hover:text-[#D6AD60] bg-transparent',
      ghost: 'text-[#B9B4AA] hover:text-[#F5F1E8] hover:bg-[#242424]',
      danger: 'bg-[#D9827C]/15 text-[#D9827C] border border-[#D9827C]/30 hover:bg-[#D9827C]/25',
      'gold-subtle': 'bg-[#D6AD60]/10 text-[#D6AD60] border border-[#D6AD60]/20 hover:bg-[#D6AD60]/20'
    };

    const sizes = {
      sm: 'h-8 px-3 text-xs gap-1.5',
      md: 'h-10 px-4 text-sm gap-2',
      lg: 'h-12 px-6 text-base gap-2.5'
    };

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        {...props}
      >
        {isLoading ? (
          <svg
            className="animate-spin -ml-1 mr-2 h-4 w-4 text-current"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        ) : (
          leftIcon
        )}
        {children}
        {!isLoading && rightIcon}
      </button>
    );
  }
);

Button.displayName = 'Button';

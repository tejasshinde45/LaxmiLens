import { type InputHTMLAttributes, type ReactNode, forwardRef } from 'react';
import { cn } from '@/utils/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: string;
  label?: string;
  helperText?: string;
  prefixIcon?: ReactNode;
  suffixIcon?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      error,
      label,
      helperText,
      prefixIcon,
      suffixIcon,
      id,
      disabled,
      ...props
    },
    ref
  ) => {
    return (
      <div className="w-full space-y-1.5">
        {label && (
          <label htmlFor={id} className="block text-xs font-medium text-[#B9B4AA]">
            {label}
          </label>
        )}
        <div className="relative flex items-center">
          {prefixIcon && (
            <div className="pointer-events-none absolute left-3 flex items-center text-[#858078]">
              {prefixIcon}
            </div>
          )}
          <input
            id={id}
            ref={ref}
            disabled={disabled}
            className={cn(
              'flex h-10 w-full rounded-[10px] border border-[#303030] bg-[#1B1B1B] px-3.5 py-2 text-sm text-[#F5F1E8] placeholder:text-[#858078] transition-colors focus-visible:outline-none focus-visible:border-[#D6AD60] focus-visible:ring-1 focus-visible:ring-[#D6AD60] disabled:cursor-not-allowed disabled:opacity-50',
              prefixIcon && 'pl-9',
              suffixIcon && 'pr-9',
              error && 'border-[#D9827C] focus-visible:border-[#D9827C] focus-visible:ring-[#D9827C]',
              className
            )}
            {...props}
          />
          {suffixIcon && (
            <div className="absolute right-3 flex items-center text-[#858078]">
              {suffixIcon}
            </div>
          )}
        </div>
        {error ? (
          <p className="text-xs text-[#D9827C]">{error}</p>
        ) : helperText ? (
          <p className="text-xs text-[#858078]">{helperText}</p>
        ) : null}
      </div>
    );
  }
);

Input.displayName = 'Input';

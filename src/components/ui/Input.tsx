import { type InputHTMLAttributes, forwardRef } from 'react';
import { cn } from '@/utils/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: string;
  label?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, label, id, ...props }, ref) => {
    return (
      <div className="w-full space-y-1.5">
        {label && (
          <label htmlFor={id} className="text-xs font-medium text-[#B9B4AA]">
            {label}
          </label>
        )}
        <input
          id={id}
          ref={ref}
          className={cn(
            'flex h-10 w-full rounded-lg border border-[#303030] bg-[#1B1B1B] px-3 py-2 text-sm text-[#F5F1E8] placeholder:text-[#858078] focus-visible:outline-none focus-visible:border-[#D6AD60] focus-visible:ring-1 focus-visible:ring-[#D6AD60] disabled:cursor-not-allowed disabled:opacity-50 transition-colors',
            error && 'border-[#D9827C] focus-visible:border-[#D9827C] focus-visible:ring-[#D9827C]',
            className
          )}
          {...props}
        />
        {error && <p className="text-xs text-[#D9827C]">{error}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';

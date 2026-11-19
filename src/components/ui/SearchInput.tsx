import { type InputHTMLAttributes, forwardRef } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/utils/cn';

export interface SearchInputProps extends InputHTMLAttributes<HTMLInputElement> {
  onClear?: () => void;
  shortcutBadge?: string;
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  ({ className, value, onChange, onClear, shortcutBadge, ...props }, ref) => {
    const hasValue = value !== undefined && value !== '';

    return (
      <div className="relative flex w-full items-center">
        <Search className="pointer-events-none absolute left-3.5 h-4 w-4 text-[#858078]" />
        <input
          ref={ref}
          type="text"
          value={value}
          onChange={onChange}
          className={cn(
            'flex h-10 w-full rounded-[10px] border border-[#303030] bg-[#1B1B1B] pl-9.5 pr-12 py-2 text-sm text-[#F5F1E8] placeholder:text-[#858078] transition-colors focus-visible:outline-none focus-visible:border-[#D6AD60] focus-visible:ring-1 focus-visible:ring-[#D6AD60]',
            className
          )}
          {...props}
        />
        <div className="absolute right-3 flex items-center gap-1.5">
          {hasValue && onClear && (
            <button
              type="button"
              onClick={onClear}
              className="flex h-5 w-5 items-center justify-center rounded-full text-[#858078] hover:bg-[#242424] hover:text-[#F5F1E8]"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          {shortcutBadge && !hasValue && (
            <kbd className="pointer-events-none hidden select-none rounded border border-[#303030] bg-[#242424] px-1.5 py-0.5 text-[10px] font-medium text-[#858078] sm:inline-block">
              {shortcutBadge}
            </kbd>
          )}
        </div>
      </div>
    );
  }
);

SearchInput.displayName = 'SearchInput';

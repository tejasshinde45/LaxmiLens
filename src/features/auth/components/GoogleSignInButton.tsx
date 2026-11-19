import React from 'react';
import { Button } from '@/components/ui/Button';

export interface GoogleSignInButtonProps {
  onClick: () => void;
  isLoading?: boolean;
  disabled?: boolean;
  className?: string;
  label?: string;
}

export const GoogleSignInButton: React.FC<GoogleSignInButtonProps> = ({
  onClick,
  isLoading = false,
  disabled = false,
  className,
  label = 'Continue with Google'
}) => {
  return (
    <Button
      type="button"
      variant="secondary"
      onClick={onClick}
      disabled={disabled || isLoading}
      isLoading={isLoading}
      className={`w-full bg-[#1B1B1B] hover:bg-[#242424] active:bg-[#2A2A2A] text-[#F5F1E8] border border-[#303030] hover:border-[#454545] font-medium h-11 transition-all ${
        className || ''
      }`}
    >
      {!isLoading && (
        <svg className="h-4 w-4 mr-2.5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="#EA4335"
            d="M12 5c1.6 0 3 .6 4.1 1.6l3.1-3.1C17.3 1.7 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.4 9 5 12 5z"
          />
          <path
            fill="#4285F4"
            d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.8z"
          />
          <path
            fill="#FBBC05"
            d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.3s.2-1.6.4-2.3L1.9 7.3C.7 9.7 0 12.3 0 15.2s.7 5.5 1.9 7.9l3.7-2.9c-.2-.7-.4-1.5-.4-2.4z"
          />
          <path
            fill="#34A853"
            d="M12 23.5c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2-6.4-4.8L1.9 16.9C3.7 20.6 7.5 23.5 12 23.5z"
          />
        </svg>
      )}
      <span>{label}</span>
    </Button>
  );
};

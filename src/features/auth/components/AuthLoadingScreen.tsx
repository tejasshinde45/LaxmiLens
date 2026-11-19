import React from 'react';

export interface AuthLoadingScreenProps {
  message?: string;
}

export const AuthLoadingScreen: React.FC<AuthLoadingScreenProps> = ({
  message = 'Securing session...'
}) => {
  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-[#101010] text-[#F5F1E8] px-4">
      <div className="flex flex-col items-center space-y-4">
        {/* Brand Icon */}
        <div className="flex h-12 w-12 items-center justify-center rounded-[12px] bg-gradient-to-br from-[#D6AD60] to-[#B88E46] text-lg font-bold text-[#101010] shadow-lg shadow-[#D6AD60]/20 font-display">
          LL
        </div>

        {/* Loading Spinner */}
        <div className="relative flex items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#303030] border-t-[#D6AD60]" />
        </div>

        <p className="text-xs font-medium tracking-wide text-[#858078] uppercase">
          {message}
        </p>
      </div>
    </div>
  );
};

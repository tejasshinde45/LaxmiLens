import { useState } from 'react';
import { Eye, EyeOff, Lock, ShieldAlert } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { cn } from '@/utils/cn';
import {
  evaluatePassphraseStrength,
  PassphraseStrengthEvaluation
} from '../utils/passphraseStrength';

interface PassphraseStrengthFieldPairProps {
  idPrefix: string;
  passphrase: string;
  confirmPassphrase: string;
  onPassphraseChange: (value: string) => void;
  onConfirmPassphraseChange: (value: string) => void;
  disabled?: boolean;
  passphraseLabel?: string;
  confirmLabel?: string;
}

const STRENGTH_BAR_COLORS: Record<PassphraseStrengthEvaluation['level'], string> = {
  empty: 'bg-[#303030]',
  too_short: 'bg-[#D9827C]',
  fair: 'bg-[#D6AD60]',
  strong: 'bg-[#72B895]',
  excellent: 'bg-[#72B895]'
};

const STRENGTH_TEXT_COLORS: Record<PassphraseStrengthEvaluation['level'], string> = {
  empty: 'text-[#858078]',
  too_short: 'text-[#D9827C]',
  fair: 'text-[#D6AD60]',
  strong: 'text-[#72B895]',
  excellent: 'text-[#72B895]'
};

export const PassphraseStrengthFieldPair: React.FC<PassphraseStrengthFieldPairProps> = ({
  idPrefix,
  passphrase,
  confirmPassphrase,
  onPassphraseChange,
  onConfirmPassphraseChange,
  disabled = false,
  passphraseLabel = 'Encryption Passphrase',
  confirmLabel = 'Confirm Passphrase'
}) => {
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const strength = evaluatePassphraseStrength(passphrase);
  const passphraseError =
    passphrase.length > 0 && !strength.meetsMinimum
      ? `Passphrase must be at least 12 characters long.`
      : undefined;

  const confirmError =
    confirmPassphrase.length > 0 && confirmPassphrase !== passphrase
      ? 'Passphrases do not match.'
      : undefined;

  return (
    <div className="space-y-3">
      <Input
        id={`${idPrefix}-passphrase`}
        type={showPassphrase ? 'text' : 'password'}
        autoComplete="new-password"
        label={passphraseLabel}
        placeholder="Minimum 12 characters"
        value={passphrase}
        disabled={disabled}
        error={passphraseError}
        prefixIcon={<Lock className="h-3.5 w-3.5" />}
        onChange={(e) => onPassphraseChange(e.target.value)}
        suffixIcon={
          <button
            type="button"
            disabled={disabled}
            onClick={() => setShowPassphrase((prev) => !prev)}
            aria-label={showPassphrase ? 'Hide passphrase' : 'Show passphrase'}
            className="rounded p-0.5 text-[#858078] hover:text-[#F5F1E8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D6AD60] cursor-pointer disabled:opacity-50"
          >
            {showPassphrase ? (
              <EyeOff className="h-3.5 w-3.5" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
          </button>
        }
      />

      {/* Strength Indicator */}
      <div className="space-y-1.5" aria-live="polite">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-[#858078]">Passphrase Strength</span>
          <span className={cn('font-medium', STRENGTH_TEXT_COLORS[strength.level])}>
            {strength.label}
          </span>
        </div>
        <div className="grid grid-cols-4 gap-1.5" aria-hidden="true">
          {[1, 2, 3, 4].map((segment) => (
            <div
              key={segment}
              className={cn(
                'h-1.5 rounded-full transition-colors',
                strength.score >= segment ? STRENGTH_BAR_COLORS[strength.level] : 'bg-[#2A2A2A]'
              )}
            />
          ))}
        </div>
        <p className="text-[11px] text-[#858078] leading-relaxed">{strength.guidance}</p>
      </div>

      <Input
        id={`${idPrefix}-confirm-passphrase`}
        type={showConfirm ? 'text' : 'password'}
        autoComplete="new-password"
        label={confirmLabel}
        placeholder="Re-enter your passphrase"
        value={confirmPassphrase}
        disabled={disabled}
        error={confirmError}
        prefixIcon={<Lock className="h-3.5 w-3.5" />}
        onChange={(e) => onConfirmPassphraseChange(e.target.value)}
        suffixIcon={
          <button
            type="button"
            disabled={disabled}
            onClick={() => setShowConfirm((prev) => !prev)}
            aria-label={showConfirm ? 'Hide confirm passphrase' : 'Show confirm passphrase'}
            className="rounded p-0.5 text-[#858078] hover:text-[#F5F1E8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D6AD60] cursor-pointer disabled:opacity-50"
          >
            {showConfirm ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        }
      />

      <div className="flex items-start gap-2 rounded-[10px] border border-[#D6AD60]/25 bg-[#D6AD60]/5 px-3 py-2 text-[11px] text-[#B9B4AA] leading-relaxed">
        <ShieldAlert className="h-3.5 w-3.5 text-[#D6AD60] shrink-0 mt-0.5" />
        <span>
          Your passphrase encrypts this file locally and is never transmitted or stored. LaxmiLens
          cannot reset or recover a forgotten backup passphrase.
        </span>
      </div>
    </div>
  );
};

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { AuthCard } from '../components/AuthCard';
import { AuthLoadingScreen } from '../components/AuthLoadingScreen';
import { PasswordInput } from '../components/PasswordInput';
import { resetPasswordSchema, ResetPasswordFormValues } from '../schemas/authSchemas';
import { getRecoveryUrlError } from '../utils/recoveryUrl';
import { zodResolver } from '@/utils/zodResolver';
import { useAuth } from '../hooks/useAuth';

export const ResetPasswordPage: React.FC = () => {
  const {
    isAuthenticated,
    isLoading,
    updatePassword,
    clearPasswordRecovery,
    signOut
  } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const effectiveSearch =
    location.search || (typeof window !== 'undefined' ? window.location.search : '');
  const effectiveHash =
    location.hash || (typeof window !== 'undefined' ? window.location.hash : '');
  const urlError = getRecoveryUrlError(effectiveSearch, effectiveHash);

  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      password: '',
      confirmPassword: ''
    }
  });

  const navigateLeavingRecovery = async (destination: '/login' | '/forgot-password') => {
    clearPasswordRecovery?.();
    if (isAuthenticated) {
      await signOut();
    }
    navigate(destination, { replace: true });
  };

  const handleContinueToApp = () => {
    clearPasswordRecovery?.();
    navigate(isAuthenticated ? '/dashboard' : '/login', { replace: true });
  };

  const onSubmit = async (values: ResetPasswordFormValues) => {
    try {
      setFormError(null);
      setIsSubmitting(true);
      await updatePassword(values.password);
      toast.success('Your password has been updated successfully!');
      setIsSuccess(true);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not update password. Please try again.';
      setFormError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading && !urlError) {
    return <AuthLoadingScreen message="Verifying password reset link..." />;
  }

  if (isSuccess) {
    return (
      <AuthCard
        title="Password Updated"
        subtitle="Your LaxmiLens account password has been reset successfully"
      >
        <div className="space-y-4">
          <div
            role="status"
            className="flex items-start gap-2.5 p-3.5 rounded-[10px] bg-[#7CA982]/10 border border-[#7CA982]/30 text-[#7CA982] text-xs leading-relaxed"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              Your new password is now active. You can continue directly to your dashboard or
              return to sign in.
            </span>
          </div>

          <Button
            type="button"
            variant="primary"
            onClick={handleContinueToApp}
            className="w-full h-11 text-sm font-semibold tracking-wide"
          >
            {isAuthenticated ? 'Continue to Dashboard' : 'Continue to Sign In'}
          </Button>

          {isAuthenticated && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => void navigateLeavingRecovery('/login')}
              className="w-full h-10 text-xs font-medium"
            >
              Return to Sign In
            </Button>
          )}
        </div>
      </AuthCard>
    );
  }

  if (urlError || !isAuthenticated) {
    const safeErrorMessage =
      urlError ||
      'This password reset link is invalid, expired, or has already been used. Please request a new password reset email.';

    return (
      <AuthCard
        title="Reset Link Invalid or Expired"
        subtitle="We could not verify a valid password recovery session"
        footer={
          <button
            type="button"
            onClick={() => void navigateLeavingRecovery('/login')}
            className="text-[#D6AD60] hover:text-[#E2BE7D] font-medium transition-colors rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D6AD60]"
          >
            Back to Sign In
          </button>
        }
      >
        <div className="space-y-4">
          <div
            role="alert"
            className="flex items-start gap-2.5 p-3.5 rounded-[10px] bg-[#D9827C]/10 border border-[#D9827C]/30 text-[#D9827C] text-xs leading-relaxed"
          >
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{safeErrorMessage}</span>
          </div>

          <Button
            type="button"
            variant="primary"
            onClick={() => void navigateLeavingRecovery('/forgot-password')}
            className="w-full h-11 text-sm font-semibold tracking-wide"
          >
            Request New Reset Link
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Set New Password"
      subtitle="Create a strong, unique password for your account"
      footer={
        <button
          type="button"
          onClick={() => void navigateLeavingRecovery('/login')}
          className="text-[#D6AD60] hover:text-[#E2BE7D] font-medium transition-colors rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D6AD60]"
        >
          Cancel and return to Sign In
        </button>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {formError && (
          <div
            role="alert"
            className="flex items-center gap-2.5 p-3 rounded-[10px] bg-[#D9827C]/10 border border-[#D9827C]/30 text-[#D9827C] text-xs"
          >
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{formError}</span>
          </div>
        )}

        {/* New Password */}
        <PasswordInput
          id="password"
          label="New Password"
          placeholder="Min 8 characters, letters & numbers"
          autoComplete="new-password"
          disabled={isSubmitting}
          error={errors.password?.message}
          {...register('password')}
        />

        {/* Confirm Password */}
        <PasswordInput
          id="confirmPassword"
          label="Confirm New Password"
          placeholder="Repeat your new password"
          autoComplete="new-password"
          disabled={isSubmitting}
          error={errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />

        {/* Submit Button */}
        <Button
          type="submit"
          variant="primary"
          isLoading={isSubmitting}
          disabled={isSubmitting}
          className="w-full h-11 text-sm font-semibold tracking-wide"
        >
          Update Password
        </Button>
      </form>
    </AuthCard>
  );
};

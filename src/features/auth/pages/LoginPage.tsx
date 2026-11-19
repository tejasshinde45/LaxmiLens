import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Mail, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { AuthCard } from '../components/AuthCard';
import { PasswordInput } from '../components/PasswordInput';
import { GoogleSignInButton } from '../components/GoogleSignInButton';
import { loginSchema, LoginFormValues } from '../schemas/authSchemas';
import { zodResolver } from '@/utils/zodResolver';
import { useAuth } from '../hooks/useAuth';
import { getSafeRedirectUrl } from '../utils/redirects';

export const LoginPage: React.FC = () => {
  const { signIn, signInWithGoogle } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);

  // Determine post-login redirect path
  const targetLocation = (location.state as { from?: { pathname?: string } })?.from?.pathname;
  const safeRedirect = getSafeRedirectUrl(targetLocation, '/dashboard');

  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
      rememberMe: true
    }
  });

  const onSubmit = async (values: LoginFormValues) => {
    try {
      setFormError(null);
      setIsSubmitting(true);
      await signIn(values.email, values.password);
      toast.success('Welcome back to LaxmiLens');
      navigate(safeRedirect, { replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign in failed. Please try again.';
      setFormError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      setFormError(null);
      setIsGoogleLoading(true);
      const redirectTarget = `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeRedirect)}`;
      await signInWithGoogle(redirectTarget);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Google sign-in could not be initiated.';
      setFormError(message);
      toast.error(message);
      setIsGoogleLoading(false);
    }
  };

  return (
    <AuthCard
      title="Welcome Back"
      subtitle="Sign in to your financial command center"
      footer={
        <p>
          Don't have an account?{' '}
          <Link
            to="/register"
            className="text-[#D6AD60] hover:text-[#E2BE7D] font-medium transition-colors ml-1 focus-visible:underline"
          >
            Create an account
          </Link>
        </p>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {formError && (
          <div className="flex items-center gap-2.5 p-3 rounded-[10px] bg-[#D9827C]/10 border border-[#D9827C]/30 text-[#D9827C] text-xs">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        {/* Email Field */}
        <Input
          id="email"
          label="Email Address"
          type="email"
          placeholder="name@example.com"
          autoComplete="email"
          disabled={isSubmitting || isGoogleLoading}
          error={errors.email?.message}
          prefixIcon={<Mail className="h-4 w-4 text-[#858078]" />}
          {...register('email')}
        />

        {/* Password Field */}
        <div className="space-y-1">
          <PasswordInput
            id="password"
            label="Password"
            placeholder="••••••••"
            autoComplete="current-password"
            disabled={isSubmitting || isGoogleLoading}
            error={errors.password?.message}
            {...register('password')}
          />
          <div className="flex justify-end pt-1">
            <Link
              to="/forgot-password"
              className="text-xs text-[#858078] hover:text-[#D6AD60] transition-colors focus-visible:underline"
            >
              Forgot password?
            </Link>
          </div>
        </div>

        {/* Submit Button */}
        <Button
          type="submit"
          variant="primary"
          isLoading={isSubmitting}
          disabled={isSubmitting || isGoogleLoading}
          className="w-full h-11 text-sm font-semibold tracking-wide"
        >
          Sign In
        </Button>

        {/* Divider */}
        <div className="relative my-4 flex items-center justify-center">
          <div className="w-full border-t border-[#303030]" />
          <span className="absolute bg-[#1B1B1B] px-3 text-[11px] uppercase tracking-wider text-[#858078]">
            or continue with
          </span>
        </div>

        {/* Google OAuth Button */}
        <GoogleSignInButton
          onClick={handleGoogleSignIn}
          isLoading={isGoogleLoading}
          disabled={isSubmitting || isGoogleLoading}
        />
      </form>
    </AuthCard>
  );
};

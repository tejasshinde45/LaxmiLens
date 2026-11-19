import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, User, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { AuthCard } from '../components/AuthCard';
import { PasswordInput } from '../components/PasswordInput';
import { GoogleSignInButton } from '../components/GoogleSignInButton';
import { registerSchema, RegisterFormValues } from '../schemas/authSchemas';
import { zodResolver } from '@/utils/zodResolver';
import { useAuth } from '../hooks/useAuth';

export const RegisterPage: React.FC = () => {
  const { signUp, signInWithGoogle } = useAuth();
  const navigate = useNavigate();

  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      fullName: '',
      email: '',
      password: '',
      confirmPassword: ''
    }
  });

  const onSubmit = async (values: RegisterFormValues) => {
    try {
      setFormError(null);
      setIsSubmitting(true);
      await signUp({
        email: values.email,
        password: values.password,
        fullName: values.fullName
      });
      toast.success('Account created successfully! Welcome to LaxmiLens.');
      navigate('/dashboard', { replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Registration failed. Please try again.';
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
      const redirectTarget = `${window.location.origin}/auth/callback?next=/dashboard`;
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
      title="Create Account"
      subtitle="Take control of your personal wealth"
      footer={
        <p>
          Already have an account?{' '}
          <Link
            to="/login"
            className="text-[#D6AD60] hover:text-[#E2BE7D] font-medium transition-colors ml-1 focus-visible:underline"
          >
            Sign in
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

        {/* Full Name */}
        <Input
          id="fullName"
          label="Full Name"
          type="text"
          placeholder="e.g. Rahul Sharma"
          autoComplete="name"
          disabled={isSubmitting || isGoogleLoading}
          error={errors.fullName?.message}
          prefixIcon={<User className="h-4 w-4 text-[#858078]" />}
          {...register('fullName')}
        />

        {/* Email */}
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

        {/* Password */}
        <PasswordInput
          id="password"
          label="Password"
          placeholder="Min 8 characters, letters & numbers"
          autoComplete="new-password"
          disabled={isSubmitting || isGoogleLoading}
          error={errors.password?.message}
          {...register('password')}
        />

        {/* Confirm Password */}
        <PasswordInput
          id="confirmPassword"
          label="Confirm Password"
          placeholder="Repeat your password"
          autoComplete="new-password"
          disabled={isSubmitting || isGoogleLoading}
          error={errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />

        {/* Submit Button */}
        <Button
          type="submit"
          variant="primary"
          isLoading={isSubmitting}
          disabled={isSubmitting || isGoogleLoading}
          className="w-full h-11 text-sm font-semibold tracking-wide"
        >
          Create Account
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

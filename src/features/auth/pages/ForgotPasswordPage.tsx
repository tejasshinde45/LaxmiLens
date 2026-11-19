import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { Mail, ArrowLeft, CheckCircle2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { AuthCard } from '../components/AuthCard';
import { forgotPasswordSchema, ForgotPasswordFormValues } from '../schemas/authSchemas';
import { zodResolver } from '@/utils/zodResolver';
import { useAuth } from '../hooks/useAuth';

export const ForgotPasswordPage: React.FC = () => {
  const { resetPassword } = useAuth();

  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: {
      email: ''
    }
  });

  const onSubmit = async (values: ForgotPasswordFormValues) => {
    try {
      setFormError(null);
      setIsSubmitting(true);
      await resetPassword(values.email);
      setSubmittedEmail(values.email);
      setIsSuccess(true);
      toast.success('Password reset email sent');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not send reset email. Please try again.';
      setFormError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSuccess) {
    return (
      <AuthCard
        title="Check Your Inbox"
        subtitle={`We've sent a recovery link to ${submittedEmail}`}
        footer={
          <Link
            to="/login"
            className="inline-flex items-center gap-1.5 text-xs text-[#D6AD60] hover:text-[#E2BE7D] font-medium transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Return to sign in</span>
          </Link>
        }
      >
        <div className="space-y-4 py-2">
          <div className="flex items-start gap-3 p-4 rounded-[10px] bg-[#72B895]/10 border border-[#72B895]/30 text-[#72B895]">
            <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5" />
            <div className="space-y-1 text-xs text-[#F5F1E8]">
              <p className="font-semibold text-[#72B895]">Password reset link sent</p>
              <p className="text-[#B9B4AA] leading-relaxed">
                Click the link in the email to set a new password. If you don't receive an email within a few minutes, check your spam folder.
              </p>
            </div>
          </div>

          <Button
            type="button"
            variant="secondary"
            onClick={() => setIsSuccess(false)}
            className="w-full h-11"
          >
            Send again
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Reset Password"
      subtitle="Enter your email to receive recovery instructions"
      footer={
        <Link
          to="/login"
          className="inline-flex items-center gap-1.5 text-xs text-[#858078] hover:text-[#F5F1E8] transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to sign in</span>
        </Link>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {formError && (
          <div className="flex items-center gap-2.5 p-3 rounded-[10px] bg-[#D9827C]/10 border border-[#D9827C]/30 text-[#D9827C] text-xs">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        {/* Email */}
        <Input
          id="email"
          label="Email Address"
          type="email"
          placeholder="name@example.com"
          autoComplete="email"
          disabled={isSubmitting}
          error={errors.email?.message}
          prefixIcon={<Mail className="h-4 w-4 text-[#858078]" />}
          {...register('email')}
        />

        {/* Submit Button */}
        <Button
          type="submit"
          variant="primary"
          isLoading={isSubmitting}
          disabled={isSubmitting}
          className="w-full h-11 text-sm font-semibold tracking-wide"
        >
          Send Reset Link
        </Button>
      </form>
    </AuthCard>
  );
};

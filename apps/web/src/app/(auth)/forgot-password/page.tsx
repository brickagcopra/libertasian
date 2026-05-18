'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { forgotPasswordSchema, type ForgotPasswordFormData } from '@/features/auth/schemas';
import { useForgotPassword } from '@/features/auth/hooks/use-auth';
import { ApiClientError } from '@/lib/api-client';
import { Wordmark } from '@/components/brand/wordmark';
import { ROUTES } from '@/lib/constants';

export default function ForgotPasswordPage() {
  const forgotPassword = useForgotPassword();
  const [emailSent, setEmailSent] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<ForgotPasswordFormData>({
    resolver: zodResolver(forgotPasswordSchema),
  });

  const onSubmit = async (data: ForgotPasswordFormData) => {
    try {
      await forgotPassword.mutateAsync(data);
      setEmailSent(true);
    } catch (error) {
      if (error instanceof ApiClientError) {
        setError('root', { message: error.message });
      } else {
        setError('root', { message: 'An unexpected error occurred' });
      }
    }
  };

  return (
    <div className="w-full max-w-md">
      <div className="rounded-2xl border border-warm-ink/10 bg-warm-surface p-8 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
        <div className="mb-6 flex flex-col items-center text-center">
          <Wordmark size={36} />
          <p className="mt-3 text-sm text-warm-ink-mid">Reset your password</p>
        </div>

        {emailSent ? (
          <div className="space-y-4">
            <Alert>
              <AlertDescription>
                If an account exists with that email, we&apos;ve sent password reset instructions.
                Please check your inbox.
              </AlertDescription>
            </Alert>
            <p className="text-center text-sm text-warm-ink-mid">
              <Link href={ROUTES.LOGIN} className="font-medium text-warm-ink hover:underline">
                Back to sign in
              </Link>
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            {errors.root && (
              <Alert variant="destructive">
                <AlertDescription>{errors.root.message}</AlertDescription>
              </Alert>
            )}

            <div className="grid gap-2">
              <Label htmlFor="email">Email address</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                {...register('email')}
              />
              {errors.email && (
                <p className="text-destructive text-xs">{errors.email.message}</p>
              )}
            </div>

            <Button
              type="submit"
              className="h-12 w-full rounded-full bg-warm-ink text-warm-cream hover:bg-warm-ink/90"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Sending...' : 'Send reset instructions'}
            </Button>

            <p className="text-center text-sm text-warm-ink-mid">
              Remember your password?{' '}
              <Link href={ROUTES.LOGIN} className="font-medium text-warm-ink hover:underline">
                Sign in
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

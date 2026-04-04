'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { forgotPasswordSchema, type ForgotPasswordFormData } from '@/features/auth/schemas';
import { useForgotPassword } from '@/features/auth/hooks/use-auth';
import { ApiClientError } from '@/lib/api-client';
import { APP_NAME, ROUTES } from '@/lib/constants';

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
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl font-bold tracking-tight">
            {APP_NAME}
          </CardTitle>
          <CardDescription>Reset your password</CardDescription>
        </CardHeader>

        <CardContent>
          {emailSent ? (
            <div className="space-y-4">
              <Alert>
                <AlertDescription>
                  If an account exists with that email, we&apos;ve sent password reset instructions.
                  Please check your inbox.
                </AlertDescription>
              </Alert>
              <p className="text-muted-foreground text-center text-sm">
                <Link href={ROUTES.LOGIN} className="text-foreground font-medium hover:underline">
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

              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? 'Sending...' : 'Send reset instructions'}
              </Button>

              <p className="text-muted-foreground text-center text-sm">
                Remember your password?{' '}
                <Link href={ROUTES.LOGIN} className="text-foreground font-medium hover:underline">
                  Sign in
                </Link>
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

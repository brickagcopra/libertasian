'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { resetPasswordSchema, type ResetPasswordFormData } from '@/features/auth/schemas';
import { useResetPassword } from '@/features/auth/hooks/use-auth';
import { ApiClientError } from '@/lib/api-client';
import { APP_NAME, ROUTES } from '@/lib/constants';

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const resetPassword = useResetPassword();
  const [resetDone, setResetDone] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<ResetPasswordFormData>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { token },
  });

  const onSubmit = async (data: ResetPasswordFormData) => {
    try {
      await resetPassword.mutateAsync({
        token: data.token,
        newPassword: data.newPassword,
      });
      setResetDone(true);
    } catch (error) {
      if (error instanceof ApiClientError) {
        if (error.statusCode === 400) {
          setError('root', { message: 'Invalid or expired reset token. Please request a new one.' });
        } else {
          setError('root', { message: error.message });
        }
      } else {
        setError('root', { message: 'An unexpected error occurred' });
      }
    }
  };

  if (!token) {
    return (
      <div className="space-y-4">
        <Alert>
          <AlertDescription>
            No reset token found. Please use the link from your email.
          </AlertDescription>
        </Alert>
        <p className="text-muted-foreground text-center text-sm">
          <Link href={ROUTES.FORGOT_PASSWORD} className="text-foreground font-medium hover:underline">
            Request a new reset link
          </Link>
        </p>
      </div>
    );
  }

  if (resetDone) {
    return (
      <div className="space-y-4">
        <Alert>
          <AlertDescription>
            Your password has been reset successfully. You can now sign in with your new password.
          </AlertDescription>
        </Alert>
        <div className="text-center">
          <Button asChild>
            <Link href={ROUTES.LOGIN}>Sign in</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {errors.root && (
        <Alert variant="destructive">
          <AlertDescription>{errors.root.message}</AlertDescription>
        </Alert>
      )}

      <input type="hidden" {...register('token')} />

      <div className="grid gap-2">
        <Label htmlFor="newPassword">New password</Label>
        <Input
          id="newPassword"
          type="password"
          autoComplete="new-password"
          {...register('newPassword')}
        />
        {errors.newPassword ? (
          <p className="text-destructive text-xs">{errors.newPassword.message}</p>
        ) : (
          <p className="text-muted-foreground text-xs">Minimum 10 characters</p>
        )}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="confirmPassword">Confirm new password</Label>
        <Input
          id="confirmPassword"
          type="password"
          autoComplete="new-password"
          {...register('confirmPassword')}
        />
        {errors.confirmPassword && (
          <p className="text-destructive text-xs">{errors.confirmPassword.message}</p>
        )}
      </div>

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? 'Resetting...' : 'Reset password'}
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl font-bold tracking-tight">
            {APP_NAME}
          </CardTitle>
          <CardDescription>Set your new password</CardDescription>
        </CardHeader>

        <CardContent>
          <Suspense fallback={
            <div className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          }>
            <ResetPasswordForm />
          </Suspense>
        </CardContent>
      </Card>
    </main>
  );
}

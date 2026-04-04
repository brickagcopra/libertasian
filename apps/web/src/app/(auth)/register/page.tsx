'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { registerSchema, type RegisterFormData } from '@/features/auth/schemas';
import { useRegister } from '@/features/auth/hooks/use-auth';
import { ApiClientError } from '@/lib/api-client';
import { APP_NAME, ROUTES } from '@/lib/constants';

export default function RegisterPage() {
  const router = useRouter();
  const registerMutation = useRegister();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
  });

  const onSubmit = async (data: RegisterFormData) => {
    try {
      await registerMutation.mutateAsync({
        email: data.email,
        password: data.password,
        fullName: data.fullName,
      });
      router.push(`${ROUTES.LOGIN}?registered=true`);
    } catch (error) {
      if (error instanceof ApiClientError) {
        if (error.statusCode === 409) {
          setError('email', { message: 'An account with this email already exists' });
        } else {
          setError('root', { message: error.message });
        }
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
          <CardDescription>Create your account</CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            {errors.root && (
              <Alert variant="destructive">
                <AlertDescription>{errors.root.message}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="fullName">Full name</Label>
                <Input
                  id="fullName"
                  type="text"
                  autoComplete="name"
                  placeholder="Juan Dela Cruz"
                  {...register('fullName')}
                />
                {errors.fullName && (
                  <p className="text-destructive text-xs">{errors.fullName.message}</p>
                )}
              </div>

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

              <div className="grid gap-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  {...register('password')}
                />
                {errors.password ? (
                  <p className="text-destructive text-xs">{errors.password.message}</p>
                ) : (
                  <p className="text-muted-foreground text-xs">Minimum 10 characters</p>
                )}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="confirmPassword">Confirm password</Label>
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
            </div>

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Creating account...' : 'Create account'}
            </Button>

            <p className="text-muted-foreground text-center text-sm">
              Already have an account?{' '}
              <Link href={ROUTES.LOGIN} className="text-foreground font-medium hover:underline">
                Sign in
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

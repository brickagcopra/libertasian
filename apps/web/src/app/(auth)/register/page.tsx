'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { registerSchema, type RegisterFormData } from '@/features/auth/schemas';
import { useRegister } from '@/features/auth/hooks/use-auth';
import { ApiClientError } from '@/lib/api-client';
import { Wordmark } from '@/components/brand/wordmark';
import { Owl } from '@/components/brand/owl';
import { ROUTES } from '@/lib/constants';

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
      // Carry checkout intent (?plan=&coupon= from the pricing page) through
      // the verify-email step so the post-auth redirect can reach billing.
      // Read from window to avoid Next's useSearchParams Suspense requirement.
      const search =
        typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search)
          : new URLSearchParams();
      const params = new URLSearchParams({ email: data.email });
      const plan = search.get('plan');
      const coupon = search.get('coupon');
      if (plan) params.set('plan', plan);
      if (coupon) params.set('coupon', coupon);
      router.push(`${ROUTES.VERIFY_EMAIL}?${params.toString()}`);
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
    <div className="relative w-full max-w-md">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-10 -right-6 z-10 hidden sm:block"
      >
        <Owl size={88} />
      </div>

      <div className="rounded-2xl border border-warm-ink/10 bg-warm-surface p-8 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
        <div className="mb-6 flex flex-col items-center text-center">
          <Wordmark size={36} />
          <p className="mt-3 text-sm text-warm-ink-mid">Create your account</p>
        </div>

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
                <p className="text-warm-ink-mid text-xs">Minimum 10 characters</p>
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

          <Button
            type="submit"
            className="h-12 w-full rounded-full bg-warm-ink text-warm-cream hover:bg-warm-ink/90"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Creating account...' : 'Create account'}
          </Button>

          {process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === 'true' && (
            <>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <Separator />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="bg-warm-surface px-2 text-warm-ink-mid">
                    Or continue with
                  </span>
                </div>
              </div>

              <Button variant="outline" className="w-full rounded-full" asChild>
                <a
                  href={`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'}/auth/google`}
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24">
                    <path
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                      fill="#4285F4"
                    />
                    <path
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      fill="#34A853"
                    />
                    <path
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      fill="#FBBC05"
                    />
                    <path
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      fill="#EA4335"
                    />
                  </svg>
                  Sign in with Google
                </a>
              </Button>
            </>
          )}

          <p className="text-center text-sm text-warm-ink-mid">
            Already have an account?{' '}
            <Link href={ROUTES.LOGIN} className="font-medium text-warm-ink hover:underline">
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}

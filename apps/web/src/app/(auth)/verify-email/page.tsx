'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import { useVerifyEmail } from '@/features/auth/hooks/use-auth';
import { ApiClientError } from '@/lib/api-client';
import { APP_NAME, ROUTES } from '@/lib/constants';

type VerifyState = 'verifying' | 'success' | 'error' | 'no-token';

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const verifyEmail = useVerifyEmail();
  const [state, setState] = useState<VerifyState>(token ? 'verifying' : 'no-token');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!token) return;

    let cancelled = false;
    verifyEmail.mutateAsync({ token }).then(() => {
      if (!cancelled) setState('success');
    }).catch((error: unknown) => {
      if (cancelled) return;
      setState('error');
      if (error instanceof ApiClientError) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage('Failed to verify email. The link may be expired or invalid.');
      }
    });

    return () => { cancelled = true; };
    // Run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (state === 'no-token') {
    return (
      <div className="space-y-4">
        <div className="rounded-md bg-yellow-50 p-4 text-sm text-yellow-700">
          No verification token found. Please use the link from your email.
        </div>
        <p className="text-center text-sm text-gray-600">
          <Link href={ROUTES.LOGIN} className="font-medium text-gray-900 hover:text-gray-700">
            Go to sign in
          </Link>
        </p>
      </div>
    );
  }

  if (state === 'verifying') {
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-gray-800" />
        <p className="text-sm text-gray-600">Verifying your email...</p>
      </div>
    );
  }

  if (state === 'success') {
    return (
      <div className="space-y-4">
        <div className="rounded-md bg-green-50 p-4 text-sm text-green-700">
          Your email has been verified successfully. You can now access all features.
        </div>
        <p className="text-center">
          <Link
            href={ROUTES.LOGIN}
            className="inline-flex rounded-md bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-gray-800"
          >
            Sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
        {errorMessage}
      </div>
      <p className="text-center text-sm text-gray-600">
        <Link href={ROUTES.LOGIN} className="font-medium text-gray-900 hover:text-gray-700">
          Go to sign in
        </Link>
      </p>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">
            {APP_NAME}
          </h1>
          <p className="mt-2 text-sm text-gray-600">
            Email verification
          </p>
        </div>
        <Suspense fallback={
          <div className="flex justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-gray-800" />
          </div>
        }>
          <VerifyEmailContent />
        </Suspense>
      </div>
    </main>
  );
}

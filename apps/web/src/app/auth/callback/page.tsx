'use client';

import { Suspense, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/stores/auth-store';
import { ROUTES } from '@/lib/constants';

function OAuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setTokens } = useAuthStore();
  const processed = useRef(false);

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;

    const accessToken = searchParams.get('accessToken');
    const refreshToken = searchParams.get('refreshToken');

    if (accessToken && refreshToken) {
      // Store tokens — the AuthProvider will pick them up and configure the apiClient
      setTokens(accessToken, refreshToken);
      router.replace(ROUTES.SEARCH);
    } else {
      router.replace(ROUTES.LOGIN);
    }
  }, [searchParams, setTokens, router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-blue-600" />
        <p className="text-sm text-gray-500">Signing you in...</p>
      </div>
    </div>
  );
}

export default function OAuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-blue-600" />
        </div>
      }
    >
      <OAuthCallbackContent />
    </Suspense>
  );
}

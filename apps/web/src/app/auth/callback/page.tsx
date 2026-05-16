'use client';

import { Suspense, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { useAuthStore, type User } from '@/stores/auth-store';
import { ROUTES } from '@/lib/constants';

function OAuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setAccessToken, setUser } = useAuthStore();
  const processed = useRef(false);

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;

    const accessToken = searchParams.get('accessToken');

    if (!accessToken) {
      router.replace(ROUTES.LOGIN);
      return;
    }

    // Store access token in memory — refresh token is already in httpOnly cookie
    setAccessToken(accessToken);

    (async () => {
      try {
        const res = await apiClient.get<{ success: boolean; data: User }>('/users/me');
        setUser(res.data);
        router.replace(ROUTES.SEARCH);
      } catch {
        useAuthStore.getState().logout();
        router.replace(`${ROUTES.LOGIN}?error=auth_failed`);
      }
    })();
  }, [searchParams, setAccessToken, setUser, router]);

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

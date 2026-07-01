'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { useAuthStore } from '@/stores/auth-store';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const isAuthReady = useAuthStore((s) => s.isAuthReady);
  const isAdmin = user?.isPlatformAdmin === true;

  useEffect(() => {
    if (isAuthReady && !isAdmin) router.replace('/search');
  }, [isAuthReady, isAdmin, router]);

  // Fail closed: render nothing until auth state is confirmed and the
  // user is a platform admin.
  if (!isAuthReady || !isAdmin) return null;

  return <>{children}</>;
}

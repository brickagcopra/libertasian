'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';

import { useAuthStore } from '@/stores/auth-store';
import { useHasPermission } from '@/features/settings/hooks/use-rbac';
import {
  isReviewerRoute,
  REVIEW_PERMISSION,
  REVIEWER_HOME,
} from '@/features/admin/review-access';

/**
 * Admission to /admin.
 *
 * `isPlatformAdmin` is unchanged and still admits platform admins to
 * everything. It is derived from holding any `admin:*` permission, though, and
 * a platform `reviewer` holds none — so a person granted `reviewer` in
 * Admin → Staff could be assigned a digest by the API and then be redirected
 * to /search when they tried to open the queue to work it.
 *
 * Holders of `digests:review` are now admitted to the review surfaces only.
 * Everything else under /admin stays admin-only; a reviewer who lands on one
 * is sent to the queue rather than out of the admin shell entirely.
 *
 * The server is the real control — DigestsAdminController enforces the same
 * permission through PlatformPermissionsGuard. This only decides what is
 * rendered.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const isAuthReady = useAuthStore((s) => s.isAuthReady);
  const isAdmin = user?.isPlatformAdmin === true;

  // Resolved from GET /rbac/me/permissions, which merges the caller's tenant
  // and PLATFORM permissions. A grant with no organization is visible here.
  const { hasPermission: canReview, isLoading: permissionsLoading } =
    useHasPermission(REVIEW_PERMISSION);

  const reviewerOnly = !isAdmin && canReview;
  const allowed = isAdmin || (canReview && isReviewerRoute(pathname));
  const ready = isAuthReady && !permissionsLoading;

  useEffect(() => {
    if (!ready || allowed) return;
    // A reviewer who wandered onto an admin-only page keeps their access to
    // the queue instead of being ejected from /admin altogether.
    router.replace(reviewerOnly ? REVIEWER_HOME : '/search');
  }, [ready, allowed, reviewerOnly, router]);

  // Fail closed: render nothing until auth AND permissions are confirmed.
  if (!ready || !allowed) return null;

  return <>{children}</>;
}

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

/**
 * Admission to /admin.
 *
 * `isPlatformAdmin` is "holds any admin:* permission". A platform `reviewer`
 * holds none, so the API fix was invisible without this: someone granted
 * `reviewer` in Admin → Staff could be assigned a digest and was then
 * redirected to /search when they tried to open the queue to work it.
 */

let mockUser: { isPlatformAdmin?: boolean } | null = null;
let mockAuthReady = true;
let mockCanReview = { hasPermission: false, isLoading: false };
let mockPathname = '/admin/review';
const replace = vi.fn();

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: mockUser, isAuthReady: mockAuthReady }),
}));

vi.mock('@/features/settings/hooks/use-rbac', () => ({
  useHasPermission: () => mockCanReview,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => mockPathname,
}));

import AdminLayout from './layout';

function renderLayout() {
  return render(
    <AdminLayout>
      <div>admin content</div>
    </AdminLayout>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUser = null;
  mockAuthReady = true;
  mockCanReview = { hasPermission: false, isLoading: false };
  mockPathname = '/admin/review';
});

describe('AdminLayout — platform admins', () => {
  it('admits a platform admin to any admin route', async () => {
    mockUser = { isPlatformAdmin: true };
    mockPathname = '/admin/plans';

    renderLayout();

    expect(screen.getByText('admin content')).toBeInTheDocument();
    await waitFor(() => expect(replace).not.toHaveBeenCalled());
  });
});

describe('AdminLayout — platform reviewers', () => {
  it('admits a reviewer to the review queue', async () => {
    mockUser = { isPlatformAdmin: false };
    mockCanReview = { hasPermission: true, isLoading: false };
    mockPathname = '/admin/review';

    renderLayout();

    expect(screen.getByText('admin content')).toBeInTheDocument();
    await waitFor(() => expect(replace).not.toHaveBeenCalled());
  });

  it('admits a reviewer to a digest detail page, where the review form lives', () => {
    mockUser = { isPlatformAdmin: false };
    mockCanReview = { hasPermission: true, isLoading: false };
    mockPathname = '/admin/digests/11111111-1111-4111-8111-111111111111';

    renderLayout();

    expect(screen.getByText('admin content')).toBeInTheDocument();
  });

  it('sends a reviewer on an admin-only route to the queue, not out of /admin', async () => {
    mockUser = { isPlatformAdmin: false };
    mockCanReview = { hasPermission: true, isLoading: false };
    mockPathname = '/admin/plans';

    renderLayout();

    expect(screen.queryByText('admin content')).not.toBeInTheDocument();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/admin/review'));
  });

  it('does not widen the rest of the admin shell to reviewers', () => {
    mockUser = { isPlatformAdmin: false };
    mockCanReview = { hasPermission: true, isLoading: false };

    for (const route of ['/admin', '/admin/staff', '/admin/sources', '/admin/users']) {
      mockPathname = route;
      const { unmount } = renderLayout();
      expect(screen.queryByText('admin content')).not.toBeInTheDocument();
      unmount();
    }
  });
});

describe('AdminLayout — everyone else', () => {
  it('redirects a user with neither signal to /search', async () => {
    mockUser = { isPlatformAdmin: false };

    renderLayout();

    expect(screen.queryByText('admin content')).not.toBeInTheDocument();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/search'));
  });

  it('fails closed while auth is still resolving', () => {
    mockUser = { isPlatformAdmin: true };
    mockAuthReady = false;

    renderLayout();

    expect(screen.queryByText('admin content')).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('fails closed while permissions are still loading', () => {
    // Rendering the queue and then yanking it away is worse than a beat of
    // nothing, and redirecting on an unresolved permission would eject a
    // reviewer who is in fact allowed.
    mockUser = { isPlatformAdmin: false };
    mockCanReview = { hasPermission: false, isLoading: true };

    renderLayout();

    expect(screen.queryByText('admin content')).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});

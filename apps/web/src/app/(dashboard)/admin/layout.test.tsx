import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockReplace = vi.fn();

let mockAuthReady = true;
let mockQuery: {
  data:
    | {
        permissions: string[];
        platformPermissions: string[];
        platformMember: boolean;
        isPlatformAdmin: boolean;
      }
    | undefined;
  isLoading: boolean;
  isError: boolean;
} = { data: undefined, isLoading: false, isError: false };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ isAuthReady: mockAuthReady }),
  ),
}));

vi.mock('@/features/settings/hooks/use-rbac', () => ({
  useMyPermissions: () => mockQuery,
}));

import AdminLayout from './layout';

function me(platformPermissions: string[]) {
  return {
    permissions: [],
    platformPermissions,
    platformMember: platformPermissions.length > 0,
    isPlatformAdmin: platformPermissions.some((c) => c.startsWith('admin:')),
  };
}

/**
 * The /admin route gate.
 *
 * It used to redirect anyone without `isPlatformAdmin` to /search. That flag
 * is true only for holders of some `admin:*` code, so `reviewer` — which holds
 * `digests:review` and no `admin:*` — could not open the review queue at all.
 * Granting reviewer an `admin:*` code to fix it is NOT an option:
 * subscription.guard.ts treats `isPlatformAdmin === true` as a complete
 * subscription bypass.
 */
describe('AdminLayout', () => {
  beforeEach(() => {
    mockReplace.mockClear();
    mockAuthReady = true;
    mockQuery = { data: undefined, isLoading: false, isError: false };
  });

  it('admits a full platform admin', () => {
    mockQuery = {
      data: me(['admin:dashboard', 'admin:users', 'admin:billing']),
      isLoading: false,
      isError: false,
    };
    render(
      <AdminLayout>
        <p>admin content</p>
      </AdminLayout>,
    );
    expect(screen.getByText('admin content')).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('admits a reviewer via digests:review, holding NO admin:* code', () => {
    // The change this gate exists for. `reviewer` holds digests:review and no
    // admin:* code, so the old isPlatformAdmin check bounced them off the one
    // surface they exist to work — and granting them an admin:* code to fix it
    // would trip the subscription.guard paywall bypass.
    mockQuery = {
      data: me(['digests:review', 'digests:approve']),
      isLoading: false,
      isError: false,
    };
    render(
      <AdminLayout>
        <p>admin content</p>
      </AdminLayout>,
    );
    expect(screen.getByText('admin content')).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('admits without requiring isPlatformAdmin', () => {
    // Entry is earned by holding a visible entry, not by the paywall-bypassing
    // admin flag.
    const data = me(['digests:review']);
    expect(data.isPlatformAdmin).toBe(false);
    mockQuery = { data, isLoading: false, isError: false };
    render(
      <AdminLayout>
        <p>admin content</p>
      </AdminLayout>,
    );
    expect(screen.getByText('admin content')).toBeInTheDocument();
  });

  it('redirects a personal-workspace owner to /search', () => {
    mockQuery = { data: me([]), isLoading: false, isError: false };
    render(
      <AdminLayout>
        <p>admin content</p>
      </AdminLayout>,
    );
    expect(screen.queryByText('admin content')).not.toBeInTheDocument();
    expect(mockReplace).toHaveBeenCalledWith('/search');
  });

  it('ignores platform codes that match no nav entry', () => {
    // Entry comes from the nav list, so an unrelated platform permission
    // cannot smuggle anyone in.
    mockQuery = {
      data: me(['uploads:read']),
      isLoading: false,
      isError: false,
    };
    render(
      <AdminLayout>
        <p>admin content</p>
      </AdminLayout>,
    );
    expect(mockReplace).toHaveBeenCalledWith('/search');
  });

  it('waits for the permission fetch instead of bouncing on a hard refresh', () => {
    mockQuery = { data: undefined, isLoading: true, isError: false };
    render(
      <AdminLayout>
        <p>admin content</p>
      </AdminLayout>,
    );
    expect(screen.queryByText('admin content')).not.toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('waits for auth to settle', () => {
    mockAuthReady = false;
    mockQuery = {
      data: me(['admin:dashboard']),
      isLoading: false,
      isError: false,
    };
    render(
      <AdminLayout>
        <p>admin content</p>
      </AdminLayout>,
    );
    expect(screen.queryByText('admin content')).not.toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('fails closed when the permission fetch errors', () => {
    mockQuery = { data: undefined, isLoading: false, isError: true };
    render(
      <AdminLayout>
        <p>admin content</p>
      </AdminLayout>,
    );
    expect(screen.queryByText('admin content')).not.toBeInTheDocument();
    expect(mockReplace).toHaveBeenCalledWith('/search');
  });
});

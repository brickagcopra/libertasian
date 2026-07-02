import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockState: {
  user: { isPlatformAdmin?: boolean } | null;
  isAuthReady: boolean;
} = { user: null, isAuthReady: true };
const replace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: typeof mockState) => unknown) => selector(mockState),
}));

import { PlatformAdminGate } from './platform-admin-gate';

describe('PlatformAdminGate', () => {
  beforeEach(() => {
    replace.mockClear();
  });

  it('renders children for platform admins', () => {
    mockState.user = { isPlatformAdmin: true };
    mockState.isAuthReady = true;
    render(
      <PlatformAdminGate>
        <div>admin-only content</div>
      </PlatformAdminGate>,
    );
    expect(screen.getByText('admin-only content')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('renders nothing and redirects non-admins to /search', () => {
    mockState.user = { isPlatformAdmin: false };
    mockState.isAuthReady = true;
    render(
      <PlatformAdminGate>
        <div>admin-only content</div>
      </PlatformAdminGate>,
    );
    expect(screen.queryByText('admin-only content')).not.toBeInTheDocument();
    expect(replace).toHaveBeenCalledWith('/search');
  });

  it('fails closed (no render, no redirect) until auth is ready', () => {
    mockState.user = null;
    mockState.isAuthReady = false;
    render(
      <PlatformAdminGate>
        <div>admin-only content</div>
      </PlatformAdminGate>,
    );
    expect(screen.queryByText('admin-only content')).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});

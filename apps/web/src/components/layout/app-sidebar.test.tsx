import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

let mockUser: unknown = {
  fullName: 'Juan Cruz',
  email: 'juan@example.com',
  role: 'member',
};
let mockSubscription: unknown = { planCode: 'free' };
// Override the global useCanAccessPaidFeature mock so individual tests can
// flip between the free/admin paths and verify the tier-lock behavior.
let mockAccess: { canAccess: boolean; reason: string } = {
  canAccess: false,
  reason: 'free',
};
vi.mock('@/hooks/useCanAccessPaidFeature', () => ({
  useCanAccessPaidFeature: () => mockAccess,
}));

vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => <a {...props}>{children}</a>,
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ user: mockUser }),
  ),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/search',
}));

vi.mock('@/features/billing/hooks/use-subscription', () => ({
  useSubscription: () => ({ data: mockSubscription }),
  meetsMinimumTier: (current: string | undefined, required: string) => {
    const tiers = ['free', 'edu', 'pro', 'team', 'enterprise'];
    if (!current) return false;
    return tiers.indexOf(current) >= tiers.indexOf(required);
  },
}));

vi.mock('@/components/brand/wordmark', () => ({
  Wordmark: () => <div>libertasian</div>,
}));

import { AppSidebar, SidebarContent } from './app-sidebar';

describe('SidebarContent', () => {
  beforeEach(() => {
    mockUser = {
      fullName: 'Juan Cruz',
      email: 'juan@example.com',
      role: 'member',
    };
    mockSubscription = { planCode: 'free' };
    mockAccess = { canAccess: false, reason: 'free' };
  });

  it('renders the warm-editorial wordmark', () => {
    render(<SidebarContent />);
    expect(screen.getByText('libertasian')).toBeInTheDocument();
  });

  it('renders main navigation items', () => {
    render(<SidebarContent />);
    expect(screen.getByText('Search')).toBeInTheDocument();
    expect(screen.getByText('Digests')).toBeInTheDocument();
    expect(screen.getByText('Scans')).toBeInTheDocument();
    expect(screen.getByText('Study')).toBeInTheDocument();
    expect(screen.getByText('Community')).toBeInTheDocument();
  });

  it('renders workspace section', () => {
    render(<SidebarContent />);
    expect(screen.getByText('Workspace')).toBeInTheDocument();
    expect(screen.getByText('Bookmarks')).toBeInTheDocument();
    expect(screen.getByText('Matters')).toBeInTheDocument();
    expect(screen.getByText('Tasks')).toBeInTheDocument();
    expect(screen.getByText('Notes')).toBeInTheDocument();
  });

  it('renders settings link', () => {
    render(<SidebarContent />);
    const settingsLinks = screen.getAllByText('Settings');
    expect(settingsLinks.length).toBeGreaterThanOrEqual(1);
  });

  it('does not render admin section for non-admin users', () => {
    mockUser = { fullName: 'Student', role: 'student', isPlatformAdmin: false };
    render(<SidebarContent />);
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
  });

  it('does not render admin section for workspace owners without platform admin', () => {
    // Regression: every self-registered user is 'owner' of their own
    // workspace, so gating on the org role showed admin nav to everyone.
    mockUser = { fullName: 'Owner', role: 'owner', isPlatformAdmin: false };
    render(<SidebarContent />);
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
  });

  it('renders admin section for platform admins', () => {
    mockUser = { fullName: 'Admin User', role: 'admin', isPlatformAdmin: true };
    render(<SidebarContent />);
    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(screen.getByText('Review Queue')).toBeInTheDocument();
    expect(screen.getByText('Sources')).toBeInTheDocument();
    expect(screen.getByText('Doctrines')).toBeInTheDocument();
  });

  it('renders admin section for platform-admin editors', () => {
    mockUser = { fullName: 'Editor User', role: 'editor', isPlatformAdmin: true };
    render(<SidebarContent />);
    expect(screen.getByText('Admin')).toBeInTheDocument();
  });

  it('renders admin section for platform-admin owners', () => {
    mockUser = { fullName: 'Owner User', role: 'owner', isPlatformAdmin: true };
    render(<SidebarContent />);
    expect(screen.getByText('Admin')).toBeInTheDocument();
  });

  it('hides admin-only settings links for non-platform admins', () => {
    // Regression: these were gated on tenant perms (members:read etc.) that
    // every workspace owner has — or not gated at all (Org Analytics).
    mockUser = { fullName: 'Owner', role: 'owner', isPlatformAdmin: false };
    render(<SidebarContent />);
    expect(screen.getAllByText('Settings').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Usage & Quotas')).toBeInTheDocument();
    expect(screen.queryByText('Members & Roles')).not.toBeInTheDocument();
    expect(screen.queryByText('Roles & Permissions')).not.toBeInTheDocument();
    expect(screen.queryByText('Audit Logs')).not.toBeInTheDocument();
    expect(screen.queryByText('Org Analytics')).not.toBeInTheDocument();
  });

  it('shows admin-only settings links for platform admins', () => {
    mockUser = { fullName: 'Admin User', role: 'admin', isPlatformAdmin: true };
    render(<SidebarContent />);
    expect(screen.getByText('Members & Roles')).toBeInTheDocument();
    expect(screen.getByText('Roles & Permissions')).toBeInTheDocument();
    expect(screen.getByText('Audit Logs')).toBeInTheDocument();
    expect(screen.getByText('Org Analytics')).toBeInTheDocument();
  });

  it('shows lock styling for pro-tier features on free plan', () => {
    mockSubscription = { planCode: 'free' };
    render(<SidebarContent />);
    // Memos requires pro - locked items get opacity-50 class
    const memosLink = screen.getByText('Memos').closest('a');
    expect(memosLink).toHaveClass('opacity-50');
  });

  it('does not lock pro features on pro plan', () => {
    mockSubscription = { planCode: 'pro' };
    render(<SidebarContent />);
    const memosLink = screen.getByText('Memos').closest('a');
    expect(memosLink).not.toHaveClass('opacity-50');
  });

  it('does not lock pro features for platform admins on the free plan', () => {
    // Regression: admins were seeing locked icons on tier-gated nav even
    // though the backend gives them full access. The hook now short-
    // circuits the tier check.
    mockSubscription = { planCode: 'free' };
    mockAccess = { canAccess: true, reason: 'admin' };
    render(<SidebarContent />);
    const memosLink = screen.getByText('Memos').closest('a');
    expect(memosLink).not.toHaveClass('opacity-50');
  });
});

describe('AppSidebar', () => {
  it('renders aside element', () => {
    render(<AppSidebar />);
    expect(screen.getByText('libertasian')).toBeInTheDocument();
  });
});

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

/**
 * Admin nav is now permission-driven, not a single isPlatformAdmin flag.
 * `permissions` are the caller's codes in their CURRENT org (what the settings
 * links gate on); `platformPermissions` are their platform-staff codes (what
 * the admin nav gates on). Keeping them apart in the mock is the point — a
 * personal workspace must never light up an admin entry.
 */
let mockMe: {
  permissions: string[];
  platformPermissions: string[];
  platformMember: boolean;
  isPlatformAdmin: boolean;
} = {
  permissions: [],
  platformPermissions: [],
  platformMember: false,
  isPlatformAdmin: false,
};

vi.mock('@/features/settings/hooks/use-rbac', () => ({
  useMyPermissions: () => ({ data: mockMe, isLoading: false, isError: false }),
  // Mirrors the real hook: PermissionGate sees tenant + platform codes merged,
  // for rendering only. Every surface it reveals still has a server guard.
  useHasPermission: (permissions: string | string[], mode: 'all' | 'any' = 'all') => {
    const held = new Set([...mockMe.permissions, ...mockMe.platformPermissions]);
    const codes = Array.isArray(permissions) ? permissions : [permissions];
    return {
      hasPermission:
        mode === 'all'
          ? codes.every((c) => held.has(c))
          : codes.some((c) => held.has(c)),
      isLoading: false,
    };
  },
}));

/** Every code a full platform admin holds, per the admin nav's declarations. */
const ALL_ADMIN_CODES = [
  'admin:dashboard',
  'admin:ingestion',
  'admin:ai-settings',
  'admin:documents',
  'admin:review-queue',
  'admin:duplicates',
  'admin:corpus-health',
  'admin:settings',
  'admin:knowledge-graph',
  'admin:plans',
  'admin:billing',
  'admin:users',
];

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
    mockMe = {
      permissions: [],
      platformPermissions: [],
      platformMember: false,
      isPlatformAdmin: false,
    };
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

  it('does not render admin section for non-staff users', () => {
    mockUser = { fullName: 'Student', role: 'student' };
    render(<SidebarContent />);
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
  });

  it('does not render admin section for workspace owners', () => {
    // Regression: every self-registered user is 'owner' of their own
    // workspace. Owning a workspace confers no platform capability, so even a
    // full tenant permission set must light up nothing here.
    mockUser = { fullName: 'Owner', role: 'owner' };
    mockMe = {
      permissions: ['members:read', 'roles:read', 'documents:read'],
      platformPermissions: [],
      platformMember: false,
      isPlatformAdmin: false,
    };
    render(<SidebarContent />);
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
  });

  it('renders the full admin section for a platform admin', () => {
    mockUser = { fullName: 'Admin User', role: 'admin' };
    mockMe = {
      permissions: [],
      platformPermissions: ALL_ADMIN_CODES,
      platformMember: true,
      isPlatformAdmin: true,
    };
    render(<SidebarContent />);
    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(screen.getByText('Review Queue')).toBeInTheDocument();
    expect(screen.getByText('Sources')).toBeInTheDocument();
    expect(screen.getByText('Doctrines')).toBeInTheDocument();
  });

  it('renders ONLY the entries a reviewer holds', () => {
    // The change this PR exists for: `reviewer` holds no admin:* code beyond
    // the review queue, and used to see nothing at all — the admin layout
    // bounced them to /search. They must now see the queue, and only it.
    mockUser = { fullName: 'Rey Reviewer', role: 'member' };
    mockMe = {
      permissions: [],
      platformPermissions: ['admin:review-queue', 'digests:review'],
      platformMember: true,
      isPlatformAdmin: false,
    };
    render(<SidebarContent />);
    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(screen.getByText('Review Queue')).toBeInTheDocument();
    expect(screen.queryByText('Sources')).not.toBeInTheDocument();
    expect(screen.queryByText('Subscriptions')).not.toBeInTheDocument();
    expect(screen.queryByText('Users')).not.toBeInTheDocument();
  });

  it('renders the editorial subset for a platform editor', () => {
    mockUser = { fullName: 'Edd Editor', role: 'member' };
    mockMe = {
      permissions: [],
      platformPermissions: [
        'admin:dashboard',
        'admin:corpus-health',
        'admin:ingestion',
        'admin:review-queue',
        'admin:duplicates',
        'admin:knowledge-graph',
      ],
      platformMember: true,
      isPlatformAdmin: false,
    };
    render(<SidebarContent />);
    expect(screen.getByText('Review Queue')).toBeInTheDocument();
    expect(screen.getByText('Ingestion')).toBeInTheDocument();
    // Billing surfaces are not editorial capability.
    expect(screen.queryByText('Coupons')).not.toBeInTheDocument();
    expect(screen.queryByText('Plans')).not.toBeInTheDocument();
  });

  it('labels staff by standing, not by the legacy role column', () => {
    // The badge used to print organization_members.role, which reads 'owner'
    // for platform staff and explains nothing about why they are here.
    mockUser = { fullName: 'Rey Reviewer', role: 'owner' };
    mockMe = {
      permissions: [],
      platformPermissions: ['admin:review-queue'],
      platformMember: true,
      isPlatformAdmin: false,
    };
    render(<SidebarContent />);
    expect(screen.getByText('platform staff')).toBeInTheDocument();
    expect(screen.queryByText('owner')).not.toBeInTheDocument();
  });

  it('hides settings links the caller lacks the permission for', () => {
    mockUser = { fullName: 'Plain', role: 'member' };
    render(<SidebarContent />);
    expect(screen.getAllByText('Settings').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Usage & Quotas')).toBeInTheDocument();
    expect(screen.queryByText('Members & Roles')).not.toBeInTheDocument();
    expect(screen.queryByText('Roles & Permissions')).not.toBeInTheDocument();
    expect(screen.queryByText('Audit Logs')).not.toBeInTheDocument();
    expect(screen.queryByText('Org Analytics')).not.toBeInTheDocument();
  });

  it('hides settings links from an org owner with tenant rights but no platform standing', () => {
    // The /settings/* pages are wrapped in <PlatformAdminGate>, so the link
    // must key on the same signal or it becomes a link that bounces you.
    mockUser = { fullName: 'Owner', role: 'owner' };
    mockMe = {
      permissions: ['members:read', 'roles:read', 'audit-logs:read', 'analytics:read'],
      platformPermissions: [],
      platformMember: false,
      isPlatformAdmin: false,
    };
    render(<SidebarContent />);
    expect(screen.queryByText('Members & Roles')).not.toBeInTheDocument();
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
  });

  it('shows settings links to a platform admin', () => {
    mockUser = { fullName: 'Admin User', role: 'admin' };
    mockMe = {
      permissions: [],
      platformPermissions: ALL_ADMIN_CODES,
      platformMember: true,
      isPlatformAdmin: true,
    };
    render(<SidebarContent />);
    expect(screen.getByText('Members & Roles')).toBeInTheDocument();
    expect(screen.getByText('Roles & Permissions')).toBeInTheDocument();
    expect(screen.getByText('Audit Logs')).toBeInTheDocument();
    expect(screen.getByText('Org Analytics')).toBeInTheDocument();
  });

  it('hides settings links from non-admin platform staff', () => {
    mockUser = { fullName: 'Rey Reviewer', role: 'member' };
    mockMe = {
      permissions: [],
      platformPermissions: ['digests:review'],
      platformMember: true,
      isPlatformAdmin: false,
    };
    render(<SidebarContent />);
    expect(screen.getByText('Review Queue')).toBeInTheDocument();
    expect(screen.queryByText('Members & Roles')).not.toBeInTheDocument();
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

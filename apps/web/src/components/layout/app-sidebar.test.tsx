import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

let mockUser: unknown = {
  fullName: 'Juan Cruz',
  email: 'juan@example.com',
  role: 'member',
};
let mockSubscription: unknown = { planCode: 'free' };

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

vi.mock('@/features/settings/hooks/use-rbac', () => ({
  useHasPermission: () => ({ hasPermission: false, isLoading: false }),
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
    mockUser = { fullName: 'Student', role: 'student' };
    render(<SidebarContent />);
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
  });

  it('renders admin section for admin role', () => {
    mockUser = { fullName: 'Admin User', role: 'admin' };
    render(<SidebarContent />);
    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(screen.getByText('Review Queue')).toBeInTheDocument();
    expect(screen.getByText('Sources')).toBeInTheDocument();
    expect(screen.getByText('Doctrines')).toBeInTheDocument();
  });

  it('renders admin section for editor role', () => {
    mockUser = { fullName: 'Editor User', role: 'editor' };
    render(<SidebarContent />);
    expect(screen.getByText('Admin')).toBeInTheDocument();
  });

  it('renders admin section for owner role', () => {
    mockUser = { fullName: 'Owner User', role: 'owner' };
    render(<SidebarContent />);
    expect(screen.getByText('Admin')).toBeInTheDocument();
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
});

describe('AppSidebar', () => {
  it('renders aside element', () => {
    render(<AppSidebar />);
    expect(screen.getByText('libertasian')).toBeInTheDocument();
  });
});

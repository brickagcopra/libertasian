import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

type AuthUser = { fullName: string; email: string; role: string } | null;
let mockUser: AuthUser = null;
const mockMutate = vi.fn();
let mockIsPending = false;

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ user: mockUser, isAuthenticated: !!mockUser }),
  ),
}));

vi.mock('@/features/auth/hooks/use-auth', () => ({
  useLogout: () => ({ mutate: mockMutate, isPending: mockIsPending }),
}));

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    asChild?: boolean;
  }) => (
    <div onClick={onClick} data-disabled={disabled || undefined}>
      {children}
    </div>
  ),
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
}));

import { PublicHeader } from './public-header';

describe('PublicHeader', () => {
  beforeEach(() => {
    mockUser = null;
    mockMutate.mockReset();
    mockIsPending = false;
  });

  it('renders the animated Logo (LIBERTASIAN aria-label)', () => {
    render(<PublicHeader />);
    expect(screen.getByLabelText('LIBERTASIAN')).toBeInTheDocument();
  });

  it('renders the 4 public nav links: Features, Bar Exams, Blog, Pricing', () => {
    render(<PublicHeader />);
    expect(screen.getByRole('link', { name: 'Features' })).toHaveAttribute('href', '/#features');
    expect(screen.getByRole('link', { name: 'Bar Exams' })).toHaveAttribute('href', '/bar-exams');
    expect(screen.getByRole('link', { name: 'Blog' })).toHaveAttribute('href', '/blog');
    expect(screen.getByRole('link', { name: 'Pricing' })).toHaveAttribute('href', '/pricing');
  });

  describe('when user is not authenticated', () => {
    it('renders auth CTAs (Log in + Get Started)', () => {
      render(<PublicHeader />);
      expect(screen.getByRole('link', { name: 'Log in' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Get Started' })).toBeInTheDocument();
    });

    it('does not render the user dropdown', () => {
      render(<PublicHeader />);
      expect(screen.queryByText('Sign out')).not.toBeInTheDocument();
    });
  });

  describe('when user is authenticated', () => {
    beforeEach(() => {
      mockUser = { fullName: 'Juan Cruz', email: 'juan@example.com', role: 'member' };
    });

    it('does not render Log in / Get Started CTAs', () => {
      render(<PublicHeader />);
      expect(screen.queryByRole('link', { name: 'Log in' })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Get Started' })).not.toBeInTheDocument();
    });

    it('renders user name and initials', () => {
      render(<PublicHeader />);
      const nameTexts = screen.getAllByText('Juan Cruz');
      expect(nameTexts.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('JC')).toBeInTheDocument();
    });

    it('renders user email in dropdown', () => {
      render(<PublicHeader />);
      expect(screen.getByText('juan@example.com')).toBeInTheDocument();
    });

    it('renders Dashboard link pointing to /search', () => {
      render(<PublicHeader />);
      const dashboardLink = screen.getByText('Dashboard').closest('a');
      expect(dashboardLink).toHaveAttribute('href', '/search');
    });

    it('renders Profile and Settings links pointing to /settings', () => {
      render(<PublicHeader />);
      const profileLink = screen.getByText('Profile').closest('a');
      expect(profileLink).toHaveAttribute('href', '/settings');
      const settingsLinks = screen.getAllByText('Settings');
      expect(settingsLinks.length).toBeGreaterThanOrEqual(1);
    });

    it('calls logout.mutate when Sign out is clicked', () => {
      render(<PublicHeader />);
      const signOut = screen.getByText('Sign out');
      fireEvent.click(signOut);
      expect(mockMutate).toHaveBeenCalledOnce();
    });

    it('disables Sign out and shows pending label while logging out', () => {
      mockIsPending = true;
      render(<PublicHeader />);
      const item = screen.getByText('Signing out...').closest('div');
      expect(item).toHaveAttribute('data-disabled', 'true');
    });
  });
});

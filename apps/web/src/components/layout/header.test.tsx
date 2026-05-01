import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock dependencies
const mockMutate = vi.fn();
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      user: { fullName: 'Juan Cruz', email: 'juan@example.com', role: 'member' },
      isAuthenticated: true,
    }),
  ),
}));

vi.mock('@/features/auth/hooks/use-auth', () => ({
  useLogout: () => ({ mutate: mockMutate, isPending: false }),
}));

let mockPathname = '/admin';
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

vi.mock('@/components/layout/notification-bell', () => ({
  NotificationBell: () => <div data-testid="notification-bell">Bell</div>,
}));

// Mock Radix dropdown to render inline (avoids portal rendering issues in happy-dom)
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; asChild?: boolean }) => <div onClick={onClick} data-disabled={disabled || undefined}>{children}</div>,
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
}));

import { Header } from './header';

describe('Header', () => {
  beforeEach(() => {
    mockMutate.mockReset();
    mockPathname = '/admin';
  });

  it('renders Dashboard label on the admin root', () => {
    mockPathname = '/admin';
    render(<Header />);
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it('renders dynamic page title from the current pathname', () => {
    mockPathname = '/admin/duplicates';
    render(<Header />);
    expect(screen.getByText('Duplicates')).toBeInTheDocument();
  });

  it('respects title overrides for hyphenated slugs', () => {
    mockPathname = '/admin/analytics/realtime';
    render(<Header />);
    expect(screen.getByText('Real-time')).toBeInTheDocument();
  });

  it('renders user name and initials', () => {
    render(<Header />);
    // Juan Cruz appears in both the trigger button and the dropdown label
    const nameTexts = screen.getAllByText('Juan Cruz');
    expect(nameTexts.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('JC')).toBeInTheDocument();
  });

  it('renders notification bell when user is logged in', () => {
    render(<Header />);
    expect(screen.getByTestId('notification-bell')).toBeInTheDocument();
  });

  it('renders menu button when onMenuClick is provided', () => {
    const onMenuClick = vi.fn();
    render(<Header onMenuClick={onMenuClick} />);
    const menuButton = screen.getByLabelText('Open menu');
    expect(menuButton).toBeInTheDocument();
    fireEvent.click(menuButton);
    expect(onMenuClick).toHaveBeenCalledOnce();
  });

  it('does not render menu button when onMenuClick is not provided', () => {
    render(<Header />);
    expect(screen.queryByLabelText('Open menu')).not.toBeInTheDocument();
  });

  it('renders Profile and Settings links in dropdown', () => {
    render(<Header />);
    // Dropdown items should exist (both link to /settings)
    const profileLink = screen.getByText('Profile').closest('a');
    expect(profileLink).toHaveAttribute('href', '/settings');
    const settingsLinks = screen.getAllByText('Settings');
    expect(settingsLinks.length).toBeGreaterThanOrEqual(1);
  });

  it('renders Sign out button', () => {
    render(<Header />);
    expect(screen.getByText('Sign out')).toBeInTheDocument();
  });

  it('renders user email in dropdown', () => {
    render(<Header />);
    expect(screen.getByText('juan@example.com')).toBeInTheDocument();
  });
});

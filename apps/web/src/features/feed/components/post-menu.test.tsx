import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockDeleteMutate = vi.fn();

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: vi.fn((selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: { id: 'user-1' } }),
  ),
}));

vi.mock('../hooks/use-delete-post', () => ({
  useDeletePost: () => ({ mutate: mockDeleteMutate }),
}));

vi.mock('./report-dialog', () => ({
  ReportDialog: (props: { open: boolean }) =>
    props.open ? <div data-testid="report-dialog" /> : null,
}));

// Mock Radix dropdown to render inline (avoids portal rendering issues in happy-dom)
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children, asChild }: { children: React.ReactNode; asChild?: boolean }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick, className }: { children: React.ReactNode; onClick?: () => void; className?: string }) => (
    <div role="menuitem" onClick={onClick} className={className}>{children}</div>
  ),
  DropdownMenuSeparator: () => <hr />,
}));

import { PostMenu } from './post-menu';

describe('PostMenu', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders a menu trigger button', () => {
    render(<PostMenu postId="post-1" authorId="user-1" />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('shows delete option for post owner', () => {
    render(<PostMenu postId="post-1" authorId="user-1" />);
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('shows report option for non-owner', () => {
    render(<PostMenu postId="post-1" authorId="other-user" />);
    expect(screen.getByText('Report')).toBeInTheDocument();
  });

  it('calls deletePost with confirm on delete click', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<PostMenu postId="post-1" authorId="user-1" />);
    fireEvent.click(screen.getByText('Delete'));
    expect(mockDeleteMutate).toHaveBeenCalledWith('post-1');
  });

  it('does not delete when confirm is cancelled', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<PostMenu postId="post-1" authorId="user-1" />);
    fireEvent.click(screen.getByText('Delete'));
    expect(mockDeleteMutate).not.toHaveBeenCalled();
  });
});

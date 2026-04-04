import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

let mockShares: unknown[] = [];
let mockLoadingShares = false;
const mockCreateMutateAsync = vi.fn();
const mockRevokeMutate = vi.fn();

vi.mock('../hooks/use-shares', () => ({
  useShares: () => ({
    data: { data: mockShares },
    isLoading: mockLoadingShares,
  }),
  useCreateShare: () => ({
    mutateAsync: mockCreateMutateAsync,
    isPending: false,
    error: null,
  }),
  useUpdateShare: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
    error: null,
  }),
  useRevokeShare: () => ({
    mutate: mockRevokeMutate,
    isPending: false,
  }),
}));

import { ShareDialog } from './share-dialog';

describe('ShareDialog', () => {
  const defaultProps = {
    entityType: 'matter' as const,
    entityId: 'm1',
    entityTitle: 'Test Matter',
    onClose: vi.fn(),
  };

  beforeEach(() => {
    mockShares = [];
    mockLoadingShares = false;
    mockCreateMutateAsync.mockReset();
    mockRevokeMutate.mockReset();
    defaultProps.onClose.mockReset();
  });

  it('renders dialog with title', () => {
    render(<ShareDialog {...defaultProps} />);
    expect(screen.getByText('Share')).toBeInTheDocument();
    expect(screen.getByText('Test Matter')).toBeInTheDocument();
  });

  it('renders Create Share Link button', () => {
    render(<ShareDialog {...defaultProps} />);
    expect(screen.getByText('+ Create Share Link')).toBeInTheDocument();
  });

  it('shows Active Links header with count', () => {
    render(<ShareDialog {...defaultProps} />);
    expect(screen.getByText(/Active Links/)).toBeInTheDocument();
    expect(screen.getByText(/\(0\)/)).toBeInTheDocument();
  });

  it('shows empty state for shares', () => {
    render(<ShareDialog {...defaultProps} />);
    expect(screen.getByText('No share links yet.')).toBeInTheDocument();
  });

  it('shows loading state for shares', () => {
    mockLoadingShares = true;
    const { container } = render(<ShareDialog {...defaultProps} />);
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('shows create form when Create Share Link is clicked', () => {
    render(<ShareDialog {...defaultProps} />);
    fireEvent.click(screen.getByText('+ Create Share Link'));
    expect(screen.getByText('New Share Link')).toBeInTheDocument();
    expect(screen.getByText('Permission Level')).toBeInTheDocument();
  });

  it('renders permission buttons in create form', () => {
    render(<ShareDialog {...defaultProps} />);
    fireEvent.click(screen.getByText('+ Create Share Link'));
    expect(screen.getByText('view')).toBeInTheDocument();
    expect(screen.getByText('comment')).toBeInTheDocument();
    expect(screen.getByText('edit')).toBeInTheDocument();
  });

  it('renders share entries when shares exist', () => {
    mockShares = [
      {
        id: 's1',
        label: 'Client link',
        permission: 'view',
        isPasswordProtected: false,
        isActive: true,
        accessCount: 5,
        createdAt: '2026-03-01',
        createdBy: { fullName: 'Juan' },
        expiresAt: null,
        lastAccessedAt: null,
      },
    ];
    render(<ShareDialog {...defaultProps} />);
    expect(screen.getByText('Client link')).toBeInTheDocument();
    expect(screen.getByText('5 accesses')).toBeInTheDocument();
  });

  it('shows Revoke button on share entries', () => {
    mockShares = [
      {
        id: 's1',
        label: 'Link',
        permission: 'edit',
        isPasswordProtected: false,
        isActive: true,
        accessCount: 0,
        createdAt: '2026-03-01',
        createdBy: { fullName: 'Juan' },
        expiresAt: null,
        lastAccessedAt: null,
      },
    ];
    render(<ShareDialog {...defaultProps} />);
    expect(screen.getByText('Revoke')).toBeInTheDocument();
  });

  it('calls onClose when backdrop is clicked', () => {
    const { container } = render(<ShareDialog {...defaultProps} />);
    const backdrop = container.querySelector('.fixed.inset-0.z-50');
    if (backdrop) fireEvent.click(backdrop);
    expect(defaultProps.onClose).toHaveBeenCalled();
  });
});

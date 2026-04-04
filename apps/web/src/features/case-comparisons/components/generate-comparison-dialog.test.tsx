import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockMutateAsync = vi.fn();
const mockReset = vi.fn();
const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('../hooks/use-case-comparisons', () => ({
  useGenerateComparison: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
    error: null,
    reset: mockReset,
  }),
}));

vi.mock('../types', () => ({
  COMPARISON_TYPE_LABELS: {
    full: 'Full Comparison',
    facts: 'Facts Only',
    ruling: 'Ruling Only',
  },
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: vi.fn() },
}));

import { GenerateComparisonDialog } from './generate-comparison-dialog';

describe('GenerateComparisonDialog', () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
  };

  beforeEach(() => {
    mockMutateAsync.mockReset();
    mockReset.mockReset();
    mockPush.mockReset();
    defaultProps.onClose.mockReset();
  });

  it('renders nothing when open is false', () => {
    const { container } = render(
      <GenerateComparisonDialog open={false} onClose={vi.fn()} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders dialog title', () => {
    render(<GenerateComparisonDialog {...defaultProps} />);
    expect(screen.getByRole('heading', { name: 'Compare Cases' })).toBeInTheDocument();
  });

  it('renders document search input', () => {
    render(<GenerateComparisonDialog {...defaultProps} />);
    expect(
      screen.getByPlaceholderText(/Search by title, G.R. No./),
    ).toBeInTheDocument();
  });

  it('renders selected documents count (0/5)', () => {
    render(<GenerateComparisonDialog {...defaultProps} />);
    expect(screen.getByText('Selected Documents (0/5)')).toBeInTheDocument();
  });

  it('shows empty state for selected documents', () => {
    render(<GenerateComparisonDialog {...defaultProps} />);
    expect(
      screen.getByText(/Search and select at least 2 documents/),
    ).toBeInTheDocument();
  });

  it('renders comparison type select', () => {
    render(<GenerateComparisonDialog {...defaultProps} />);
    expect(screen.getByLabelText('Comparison Type')).toBeInTheDocument();
  });

  it('disables submit when less than 2 docs selected', () => {
    render(<GenerateComparisonDialog {...defaultProps} />);
    const submitBtn = screen.getByRole('button', { name: 'Compare Cases' });
    expect(submitBtn).toBeDisabled();
  });

  it('renders Search button', () => {
    render(<GenerateComparisonDialog {...defaultProps} />);
    expect(screen.getByText('Search')).toBeInTheDocument();
  });

  it('renders Cancel button', () => {
    render(<GenerateComparisonDialog {...defaultProps} />);
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('renders matter select when matters provided', () => {
    render(
      <GenerateComparisonDialog
        {...defaultProps}
        matters={[{ id: 'm1', title: 'My Matter' }]}
      />,
    );
    expect(screen.getByText('My Matter')).toBeInTheDocument();
  });
});

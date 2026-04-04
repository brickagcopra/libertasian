import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockMutateAsync = vi.fn();
const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('../hooks/use-hearing-prep', () => ({
  useGenerateHearingPrep: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: vi.fn() },
}));

import { GenerateHearingPrepDialog } from './generate-hearing-prep-dialog';

describe('GenerateHearingPrepDialog', () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
  };

  beforeEach(() => {
    mockMutateAsync.mockReset();
    mockPush.mockReset();
    defaultProps.onClose.mockReset();
  });

  it('renders nothing when open is false', () => {
    const { container } = render(
      <GenerateHearingPrepDialog open={false} onClose={vi.fn()} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders dialog title and description', () => {
    render(<GenerateHearingPrepDialog {...defaultProps} />);
    expect(screen.getByRole('heading', { name: 'Generate Hearing Prep Pack' })).toBeInTheDocument();
    expect(screen.getByText(/Compile relevant cases/)).toBeInTheDocument();
  });

  it('renders hearing topic input', () => {
    render(<GenerateHearingPrepDialog {...defaultProps} />);
    expect(screen.getByText('Hearing Topic *')).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/Constructive dismissal/),
    ).toBeInTheDocument();
  });

  it('renders optional issue textarea', () => {
    render(<GenerateHearingPrepDialog {...defaultProps} />);
    expect(screen.getByText('Specific Legal Issue (optional)')).toBeInTheDocument();
  });

  it('renders optional documents search', () => {
    render(<GenerateHearingPrepDialog {...defaultProps} />);
    expect(screen.getByText('Related Documents (optional)')).toBeInTheDocument();
  });

  it('disables submit when topic is too short', () => {
    render(<GenerateHearingPrepDialog {...defaultProps} />);
    const submitBtn = screen.getByRole('button', { name: 'Generate Pack' });
    expect(submitBtn).toBeDisabled();
  });

  it('enables submit when topic is long enough', () => {
    render(<GenerateHearingPrepDialog {...defaultProps} />);
    const input = screen.getByPlaceholderText(/Constructive dismissal/);
    fireEvent.change(input, {
      target: { value: 'Constructive dismissal under Labor Code' },
    });
    const submitBtn = screen.getByRole('button', { name: 'Generate Pack' });
    expect(submitBtn).not.toBeDisabled();
  });

  it('renders Cancel button', () => {
    render(<GenerateHearingPrepDialog {...defaultProps} />);
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('renders matter select when matters provided', () => {
    render(
      <GenerateHearingPrepDialog
        {...defaultProps}
        matters={[{ id: 'm1', title: 'Labor Case' }]}
      />,
    );
    expect(screen.getByText('Labor Case')).toBeInTheDocument();
  });
});

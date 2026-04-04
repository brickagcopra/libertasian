import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockMutateAsync = vi.fn();
const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('../hooks/use-timelines', () => ({
  useGenerateTimeline: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: vi.fn() },
}));

import { GenerateTimelineDialog } from './generate-timeline-dialog';

describe('GenerateTimelineDialog', () => {
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
      <GenerateTimelineDialog open={false} onClose={vi.fn()} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders dialog title and description', () => {
    render(<GenerateTimelineDialog {...defaultProps} />);
    expect(screen.getByRole('heading', { name: 'Generate Timeline' })).toBeInTheDocument();
    expect(screen.getByText(/Extract chronological events/)).toBeInTheDocument();
  });

  it('renders title input', () => {
    render(<GenerateTimelineDialog {...defaultProps} />);
    expect(
      screen.getByPlaceholderText(/Reyes v. Santos/),
    ).toBeInTheDocument();
  });

  it('renders document search input', () => {
    render(<GenerateTimelineDialog {...defaultProps} />);
    expect(
      screen.getByPlaceholderText('Search for legal documents...'),
    ).toBeInTheDocument();
  });

  it('disables submit when title is too short', () => {
    render(<GenerateTimelineDialog {...defaultProps} />);
    const submitBtn = screen.getByRole('button', { name: 'Generate Timeline' });
    expect(submitBtn).toBeDisabled();
  });

  it('renders Cancel button', () => {
    render(<GenerateTimelineDialog {...defaultProps} />);
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('renders matter select when matters are provided', () => {
    render(
      <GenerateTimelineDialog
        {...defaultProps}
        matters={[{ id: 'm1', title: 'Matter A' }]}
      />,
    );
    expect(screen.getByText('Matter A')).toBeInTheDocument();
  });

  it('renders Timeline Title label', () => {
    render(<GenerateTimelineDialog {...defaultProps} />);
    expect(screen.getByText('Timeline Title *')).toBeInTheDocument();
  });

  it('renders Documents label', () => {
    render(<GenerateTimelineDialog {...defaultProps} />);
    expect(screen.getByText('Documents (1-10) *')).toBeInTheDocument();
  });
});

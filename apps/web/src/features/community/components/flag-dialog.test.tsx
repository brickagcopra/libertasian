import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockCreateMutate = vi.fn();

vi.mock('../hooks/use-community-flags', () => ({
  useCreateFlag: () => ({
    mutate: mockCreateMutate,
    isPending: false,
  }),
}));

import { FlagDialog } from './flag-dialog';

describe('FlagDialog', () => {
  const defaultProps = {
    entityType: 'digest' as const,
    entityId: 'd1',
  };

  beforeEach(() => {
    mockCreateMutate.mockReset();
  });

  it('renders Report button trigger', () => {
    render(<FlagDialog {...defaultProps} />);
    expect(screen.getByText('Report')).toBeInTheDocument();
  });

  it('opens dialog when Report is clicked', () => {
    render(<FlagDialog {...defaultProps} />);
    fireEvent.click(screen.getByText('Report'));
    expect(screen.getByText('Report Content')).toBeInTheDocument();
    expect(
      screen.getByText(/Help us keep the community safe/),
    ).toBeInTheDocument();
  });

  it('renders reason select and details textarea in dialog', () => {
    render(<FlagDialog {...defaultProps} />);
    fireEvent.click(screen.getByText('Report'));
    expect(screen.getByText('Reason')).toBeInTheDocument();
    expect(screen.getByText('Details (optional)')).toBeInTheDocument();
  });

  it('renders Cancel and Submit Report buttons in dialog', () => {
    render(<FlagDialog {...defaultProps} />);
    fireEvent.click(screen.getByText('Report'));
    expect(screen.getByText('Cancel')).toBeInTheDocument();
    expect(screen.getByText('Submit Report')).toBeInTheDocument();
  });

  it('disables submit when no reason selected', () => {
    render(<FlagDialog {...defaultProps} />);
    fireEvent.click(screen.getByText('Report'));
    const submitBtn = screen.getByText('Submit Report');
    expect(submitBtn).toBeDisabled();
  });

  it('renders details placeholder text', () => {
    render(<FlagDialog {...defaultProps} />);
    fireEvent.click(screen.getByText('Report'));
    expect(
      screen.getByPlaceholderText('Provide additional context...'),
    ).toBeInTheDocument();
  });
});

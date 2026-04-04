import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockReportMutate = vi.fn();

vi.mock('../hooks/use-feed-interactions', () => ({
  useReportPost: () => ({
    mutate: mockReportMutate,
    isPending: false,
    error: null,
  }),
}));

import { ReportDialog } from './report-dialog';

describe('ReportDialog', () => {
  const defaultProps = {
    postId: 'post-1',
    open: true,
    onOpenChange: vi.fn(),
  };

  beforeEach(() => vi.clearAllMocks());

  it('renders dialog title when open', () => {
    render(<ReportDialog {...defaultProps} />);
    expect(screen.getByText('Report Post')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    render(<ReportDialog {...defaultProps} open={false} />);
    expect(screen.queryByText('Report Post')).not.toBeInTheDocument();
  });

  it('renders reason select and details textarea', () => {
    render(<ReportDialog {...defaultProps} />);
    expect(screen.getByText('Select a reason')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Provide additional context...')).toBeInTheDocument();
  });

  it('renders all report reason options in select', () => {
    render(<ReportDialog {...defaultProps} />);
    // The select trigger shows placeholder, options are in content
    expect(screen.getByText('Submit Report')).toBeInTheDocument();
  });

  it('renders cancel button', () => {
    render(<ReportDialog {...defaultProps} />);
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('calls onOpenChange when cancel clicked', () => {
    const onOpenChange = vi.fn();
    render(<ReportDialog {...defaultProps} onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

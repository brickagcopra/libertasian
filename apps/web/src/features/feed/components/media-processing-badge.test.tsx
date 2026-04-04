import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { MediaProcessingBadge } from './media-processing-badge';
import type { FeedMediaProcessingStatus } from '@libertasian/types';

describe('MediaProcessingBadge', () => {
  const statuses: { status: FeedMediaProcessingStatus; label: string }[] = [
    { status: 'pending', label: 'Pending' },
    { status: 'uploading', label: 'Uploading...' },
    { status: 'processing', label: 'Processing...' },
    { status: 'ready', label: 'Ready' },
    { status: 'failed', label: 'Failed' },
    { status: 'quarantined', label: 'Rejected' },
  ];

  it.each(statuses)('renders "$label" for status "$status"', ({ status, label }) => {
    render(<MediaProcessingBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('sets title attribute from failureReason', () => {
    render(<MediaProcessingBadge status="failed" failureReason="ClamAV detected malware" />);
    const badge = screen.getByText('Failed').closest('[title]');
    expect(badge).toHaveAttribute('title', 'ClamAV detected malware');
  });

  it('applies animate-spin class for in-progress statuses', () => {
    const { container } = render(<MediaProcessingBadge status="processing" />);
    const spinner = container.querySelector('.animate-spin');
    expect(spinner).toBeTruthy();
  });

  it('does not apply animate-spin for completed statuses', () => {
    const { container } = render(<MediaProcessingBadge status="ready" />);
    const spinner = container.querySelector('.animate-spin');
    expect(spinner).toBeFalsy();
  });
});

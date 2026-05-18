import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => (
    <a {...props}>{children}</a>
  ),
}));

import { Wordmark } from './wordmark';

describe('Wordmark', () => {
  it('renders the "L" badge and "libertasian" wordmark by default', () => {
    render(<Wordmark />);
    expect(screen.getByText('L')).toBeInTheDocument();
    expect(screen.getByText('libertasian')).toBeInTheDocument();
  });

  it('wraps the wordmark in a link to "/" when asLink is true (default)', () => {
    render(<Wordmark />);
    const link = screen.getByLabelText('LIBERTASIAN');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', '/');
  });

  it('omits the surrounding link when asLink is false', () => {
    render(<Wordmark asLink={false} />);
    expect(screen.queryByLabelText('LIBERTASIAN')).not.toBeInTheDocument();
    // Wordmark + badge text still present
    expect(screen.getByText('libertasian')).toBeInTheDocument();
    expect(screen.getByText('L')).toBeInTheDocument();
  });

  it('honors a custom label override', () => {
    render(<Wordmark label="alt-brand" asLink={false} />);
    expect(screen.getByText('alt-brand')).toBeInTheDocument();
    expect(screen.queryByText('libertasian')).not.toBeInTheDocument();
  });
});

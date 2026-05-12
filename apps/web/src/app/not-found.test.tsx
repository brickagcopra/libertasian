import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// React Testing Library can't synchronously render the real async <PublicFooter />.
// We test that not-found.tsx renders the shared-chrome components themselves;
// PublicHeader/PublicFooter behavior is covered by their own dedicated tests.
vi.mock('@/components/layout/public-header', () => ({
  PublicHeader: () => <div data-testid="public-header" aria-label="LIBERTASIAN" />,
}));
vi.mock('@/components/layout/public-footer', () => ({
  PublicFooter: () => <div data-testid="public-footer" />,
}));

import NotFound from './not-found';

describe('NotFound page', () => {
  it('renders the 404 copy', () => {
    render(<NotFound />);
    expect(screen.getByRole('heading', { level: 1, name: '404' })).toBeInTheDocument();
    expect(screen.getByText('Page not found')).toBeInTheDocument();
  });

  it('wraps content with the shared public chrome (Logo header + footer)', () => {
    render(<NotFound />);
    // PublicHeader is mocked with the LIBERTASIAN aria-label that the real Logo carries.
    expect(screen.getByLabelText('LIBERTASIAN')).toBeInTheDocument();
    expect(screen.getByTestId('public-header')).toBeInTheDocument();
    expect(screen.getByTestId('public-footer')).toBeInTheDocument();
  });
});

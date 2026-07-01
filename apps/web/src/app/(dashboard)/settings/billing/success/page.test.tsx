import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import CheckoutSuccessPage from './page';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

describe('CheckoutSuccessPage', () => {
  it('confirms a recurring subscription (not a one-time purchase)', () => {
    render(<CheckoutSuccessPage />, { wrapper });

    expect(
      screen.getByRole('heading', { name: /subscription active/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/renews automatically/i)).toBeInTheDocument();
    // Should not read like a one-off receipt.
    expect(screen.queryByText(/payment successful/i)).not.toBeInTheDocument();
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';

import MobileBillingSuccessPage from './success/page';
import MobileBillingCancelPage from './cancel/page';

describe('mobile billing bounce pages', () => {
  beforeEach(() => {
    cleanup();
    window.location.href = 'https://libertasian.com/billing/mobile/success';
  });

  it('success page renders brand copy and a deep-link button', () => {
    render(<MobileBillingSuccessPage />);

    expect(screen.getByText('Payment complete')).toBeTruthy();
    expect(
      screen.getByText('Payment complete — return to the LIBERTASIAN app to continue.'),
    ).toBeTruthy();

    const link = screen.getByRole('link', { name: 'Return to the LIBERTASIAN app' });
    expect(link.getAttribute('href')).toBe('libertasian://billing/success');
  });

  it('success page auto-attempts the app scheme redirect once', () => {
    render(<MobileBillingSuccessPage />);
    expect(window.location.href).toBe('libertasian://billing/success');
  });

  it('cancel page renders cancelled copy and a deep-link button', () => {
    render(<MobileBillingCancelPage />);

    expect(screen.getByText('Payment cancelled')).toBeTruthy();
    expect(
      screen.getByText('No charges were made — return to the LIBERTASIAN app to try again.'),
    ).toBeTruthy();

    const link = screen.getByRole('link', { name: 'Return to the LIBERTASIAN app' });
    expect(link.getAttribute('href')).toBe('libertasian://billing/cancel');
  });
});

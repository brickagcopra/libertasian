import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/hooks/use-analytics', () => ({ useTrack: () => vi.fn() }));

import { AbstainedCard, DeepResearchErrorCard } from './error-cards';

describe('DeepResearchErrorCard', () => {
  it('subscription_required shows the shared upgrade surface and a pricing link', () => {
    render(<DeepResearchErrorCard error={{ code: 'subscription_required', message: '' }} />);
    expect(screen.getByTestId('upgrade-banner-modal')).toBeInTheDocument();
    expect(screen.getByTestId('dr-error-subscription')).toBeInTheDocument();
    expect(screen.getAllByRole('link').some((a) => a.getAttribute('href') === '/pricing')).toBe(true);
  });

  it('quota_exceeded shows the reset date, the limit and an upgrade link', () => {
    render(
      <DeepResearchErrorCard
        error={{
          code: 'quota_exceeded',
          message: '',
          resetAt: '2026-10-01T00:00:00.000Z',
          limit: 20,
        }}
      />,
    );
    const card = screen.getByTestId('dr-error-quota');
    expect(card).toHaveTextContent('All 20 runs');
    expect(card).toHaveTextContent('resets on');
    expect(card).toHaveTextContent('2026');
    expect(screen.getByText('Upgrade for more runs').closest('a')).toHaveAttribute('href', '/pricing');
  });

  it('budget_exhausted reads as temporarily unavailable, with no retry', () => {
    render(<DeepResearchErrorCard error={{ code: 'budget_exhausted', message: '' }} onRetry={vi.fn()} />);
    expect(screen.getByText('Deep Research is temporarily unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Try again')).not.toBeInTheDocument();
  });

  it('internal shows the message and retries', () => {
    const onRetry = vi.fn();
    render(<DeepResearchErrorCard error={{ code: 'internal', message: 'Boom.' }} onRetry={onRetry} />);
    expect(screen.getByTestId('dr-error-generic')).toHaveTextContent('Boom.');
    fireEvent.click(screen.getByText('Try again'));
    expect(onRetry).toHaveBeenCalled();
  });
});

describe('AbstainedCard', () => {
  it('shows the friendly not-enough-authority card with reason copy and tips', () => {
    render(<AbstainedCard reason="insufficient_passages" />);
    const card = screen.getByTestId('dr-abstained');
    expect(card).toHaveTextContent('Not enough authority found');
    expect(card).toHaveTextContent('Too few relevant sources');
    expect(card).toHaveTextContent('Tips');
    expect(card).not.toHaveTextContent('insufficient_passages');
  });
});

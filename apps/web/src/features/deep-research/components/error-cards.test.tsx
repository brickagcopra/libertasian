import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/hooks/use-analytics', () => ({ useTrack: () => vi.fn() }));

import {
  ABSTAINED_TITLE_FALLBACK,
  AbstainedCard,
  abstainedTitle,
  DeepResearchErrorCard,
} from './error-cards';

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

  it.each([
    ['out_of_scope', 'outside Philippine law'],
    ['ranking_unavailable', "couldn't be ranked"],
  ])('maps the Deep Research-only reason %s to copy, never the raw value', (reason, copy) => {
    render(<AbstainedCard reason={reason} />);
    const card = screen.getByTestId('dr-abstained');
    expect(card).toHaveTextContent(copy);
    expect(card).not.toHaveTextContent(reason);
  });

  it.each([
    ['out_of_scope', 'Outside Philippine law'],
    ['ranking_unavailable', 'Ranking unavailable — try again'],
  ])('gives %s its own title instead of "Not enough authority found"', (reason, title) => {
    render(<AbstainedCard reason={reason} />);
    const card = screen.getByTestId('dr-abstained');
    expect(card).toHaveTextContent(title);
    expect(card).not.toHaveTextContent('Not enough authority found');
  });

  it.each([['insufficient_passages'], ['low_relevance'], ['no_results'], ['validation_failed']])(
    'keeps the default title for %s',
    (reason) => {
      expect(abstainedTitle(reason)).toBe(ABSTAINED_TITLE_FALLBACK);
    },
  );

  it('falls back to the default title for a missing or unknown reason', () => {
    expect(abstainedTitle(undefined)).toBe(ABSTAINED_TITLE_FALLBACK);
    expect(abstainedTitle(null)).toBe(ABSTAINED_TITLE_FALLBACK);
    expect(abstainedTitle('some_future_reason')).toBe(ABSTAINED_TITLE_FALLBACK);
    render(<AbstainedCard reason="some_future_reason" />);
    expect(screen.getByTestId('dr-abstained')).toHaveTextContent('Not enough authority found');
  });
});

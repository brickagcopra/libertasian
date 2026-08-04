import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// Mock child components to isolate SearchTabs logic
vi.mock('./full-text-results', () => ({
  FullTextResults: ({ results, isLoading }: { results: unknown[]; isLoading: boolean }) => (
    <div data-testid="full-text-results">
      {isLoading ? 'Loading...' : `${(results as unknown[]).length} results`}
    </div>
  ),
}));

vi.mock('./ai-summary-results', () => ({
  AiSummaryResults: ({ query }: { query: string | null }) => (
    <div data-testid="ai-summary-results">AI for: {query}</div>
  ),
}));

vi.mock('./digests-results', () => ({
  DigestsResults: ({ query }: { query: string | null }) => (
    <div data-testid="digests-results">Digests for: {query}</div>
  ),
}));

let mockDigestCount: number | undefined = undefined;
vi.mock('../hooks/use-digest-count', () => ({
  useDigestCount: () => ({ data: mockDigestCount, isLoading: false, error: null }),
}));

import { SearchTabs } from './search-tabs';
import type { SearchMeta, SearchResultItem } from '../types';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

const defaultProps = {
  query: 'test query',
  results: [] as SearchResultItem[],
  meta: { total: 0, maxScore: null, page: 1, limit: 20, timedOut: false } as SearchMeta,
  isLoading: false,
  error: null,
  page: 1,
  onPageChange: vi.fn(),
};

describe('SearchTabs', () => {
  it('renders all three tab triggers', () => {
    render(<SearchTabs {...defaultProps} />, { wrapper: createWrapper() });

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(screen.getByText('Full Text')).toBeDefined();
    expect(screen.getByText('AI Summary')).toBeDefined();
    expect(screen.getByText('Digests')).toBeDefined();
  });

  it('shows Full Text tab content by default', () => {
    render(<SearchTabs {...defaultProps} />, { wrapper: createWrapper() });

    expect(screen.getByTestId('full-text-results')).toBeDefined();
  });

  it('shows result count badge when meta has results', () => {
    const propsWithResults = {
      ...defaultProps,
      meta: { ...defaultProps.meta, total: 42 },
    };
    render(<SearchTabs {...propsWithResults} />, { wrapper: createWrapper() });

    expect(screen.getByText('42')).toBeDefined();
  });

  it('does not show count badge when total is 0', () => {
    render(<SearchTabs {...defaultProps} />, { wrapper: createWrapper() });

    // There should be no numeric badge for 0 results
    const fullTextTab = screen.getByText('Full Text').closest('[role="tab"]');
    expect(fullTextTab?.textContent).not.toContain('0');
  });

  it('switches to AI Summary tab on click', async () => {
    const user = userEvent.setup();
    render(<SearchTabs {...defaultProps} />, { wrapper: createWrapper() });

    const aiTab = screen.getByRole('tab', { name: /AI Summary/ });
    await user.click(aiTab);

    expect(screen.getByTestId('ai-summary-results')).toBeDefined();
    expect(screen.getByText('AI for: test query')).toBeDefined();
  });

  it('switches to Digests tab on click', async () => {
    const user = userEvent.setup();
    render(<SearchTabs {...defaultProps} />, { wrapper: createWrapper() });

    const digestsTab = screen.getByRole('tab', { name: /Digests/ });
    await user.click(digestsTab);

    expect(screen.getByTestId('digests-results')).toBeDefined();
    // The tab is driven by the query string now, not by the ids the full-text
    // arm happened to return.
    expect(screen.getByText('Digests for: test query')).toBeDefined();
  });

  it('lazy-loads AI Summary only when tab is active', async () => {
    const user = userEvent.setup();
    render(<SearchTabs {...defaultProps} />, { wrapper: createWrapper() });

    // AI tab not active — should not render
    expect(screen.queryByTestId('ai-summary-results')).toBeNull();

    // Switch to AI tab
    await user.click(screen.getByRole('tab', { name: /AI Summary/ }));
    expect(screen.getByTestId('ai-summary-results')).toBeDefined();

    // Switch back to Full Text
    await user.click(screen.getByRole('tab', { name: /Full Text/ }));
    expect(screen.queryByTestId('ai-summary-results')).toBeNull();
  });

  it('lazy-loads Digests only when tab is active', async () => {
    const user = userEvent.setup();
    render(<SearchTabs {...defaultProps} />, { wrapper: createWrapper() });

    expect(screen.queryByTestId('digests-results')).toBeNull();

    await user.click(screen.getByRole('tab', { name: /Digests/ }));
    expect(screen.getByTestId('digests-results')).toBeDefined();
  });

  it('passes loading state to FullTextResults', () => {
    render(
      <SearchTabs {...defaultProps} isLoading={true} />,
      { wrapper: createWrapper() },
    );

    expect(screen.getByText('Loading...')).toBeDefined();
  });

  it('passes null query to AI Summary when query is null', async () => {
    const user = userEvent.setup();
    render(
      <SearchTabs {...defaultProps} query={null} />,
      { wrapper: createWrapper() },
    );

    await user.click(screen.getByRole('tab', { name: /AI Summary/ }));
    expect(screen.getByText('AI for:')).toBeDefined();
  });

  it('shows digest count badge when digests are available', () => {
    mockDigestCount = 7;
    render(<SearchTabs {...defaultProps} />, { wrapper: createWrapper() });

    const digestsTab = screen.getByRole('tab', { name: /Digests/ });
    expect(digestsTab.textContent).toContain('7');
    mockDigestCount = undefined;
  });

  it('does not show digest count badge when count is 0', () => {
    mockDigestCount = 0;
    render(<SearchTabs {...defaultProps} />, { wrapper: createWrapper() });

    const digestsTab = screen.getByRole('tab', { name: /Digests/ });
    expect(digestsTab.textContent).not.toContain('0');
    mockDigestCount = undefined;
  });

  it('does not show digest count badge when count is undefined', () => {
    mockDigestCount = undefined;
    render(<SearchTabs {...defaultProps} />, { wrapper: createWrapper() });

    const digestsTab = screen.getByRole('tab', { name: /Digests/ });
    // Should just be "Digests" text, no badge
    expect(digestsTab.textContent?.trim()).toMatch(/^Digests$/);
  });
});

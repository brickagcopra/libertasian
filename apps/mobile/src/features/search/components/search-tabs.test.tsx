import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('@expo/vector-icons', () => {
  const { View } = jest.requireActual('react-native') as typeof import('react-native');
  const MockReact = jest.requireActual('react') as typeof import('react');
  return {
    Ionicons: (props: Record<string, unknown>) =>
      MockReact.createElement(View, { testID: `icon-${props['name'] as string}` }),
  };
});

jest.mock('../hooks/use-search-digests', () => ({
  useDigestCount: jest.fn().mockReturnValue({ data: undefined, isLoading: false, error: null }),
}));

import { SearchTabBar } from './search-tabs';
import { useDigestCount } from '../hooks/use-search-digests';
import type { SearchTab } from '../types';

const mockedUseDigestCount = useDigestCount as jest.MockedFunction<typeof useDigestCount>;

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

describe('SearchTabBar', () => {
  const onTabChange = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseDigestCount.mockReturnValue({ data: undefined, isLoading: false, error: null } as ReturnType<typeof useDigestCount>);
  });

  it('renders all three tabs', () => {
    render(
      <SearchTabBar
        activeTab="fulltext"
        onTabChange={onTabChange}
        query={null}
      />,
      { wrapper: createWrapper() },
    );

    expect(screen.getByText('Full Text')).toBeTruthy();
    expect(screen.getByText('AI Summary')).toBeTruthy();
    expect(screen.getByText('Digests')).toBeTruthy();
  });

  it('calls onTabChange when tab is pressed', () => {
    render(
      <SearchTabBar
        activeTab="fulltext"
        onTabChange={onTabChange}
        query={null}
      />,
      { wrapper: createWrapper() },
    );

    fireEvent.press(screen.getByText('AI Summary'));
    expect(onTabChange).toHaveBeenCalledWith('ai-summary');
  });

  it('shows result count badge on Full Text tab', () => {
    render(
      <SearchTabBar
        activeTab="fulltext"
        onTabChange={onTabChange}
        resultCount={42}
        query={null}
      />,
      { wrapper: createWrapper() },
    );

    expect(screen.getByText('42')).toBeTruthy();
  });

  it('does not show badge when resultCount is 0', () => {
    render(
      <SearchTabBar
        activeTab="fulltext"
        onTabChange={onTabChange}
        resultCount={0}
        query={null}
      />,
      { wrapper: createWrapper() },
    );

    expect(screen.queryByText('0')).toBeNull();
  });

  it('shows digest count badge when available', () => {
    mockedUseDigestCount.mockReturnValue({ data: 7, isLoading: false, error: null } as ReturnType<typeof useDigestCount>);

    render(
      <SearchTabBar
        activeTab="fulltext"
        onTabChange={onTabChange}
        query="estafa"
      />,
      { wrapper: createWrapper() },
    );

    expect(screen.getByText('7')).toBeTruthy();
  });

  it('caps large badge counts at 999+', () => {
    mockedUseDigestCount.mockReturnValue({ data: 1500, isLoading: false, error: null } as ReturnType<typeof useDigestCount>);

    render(
      <SearchTabBar
        activeTab="fulltext"
        onTabChange={onTabChange}
        query="estafa"
      />,
      { wrapper: createWrapper() },
    );

    expect(screen.getByText('999+')).toBeTruthy();
  });

  it('switches to digests tab', () => {
    render(
      <SearchTabBar
        activeTab="fulltext"
        onTabChange={onTabChange}
        query={null}
      />,
      { wrapper: createWrapper() },
    );

    fireEvent.press(screen.getByText('Digests'));
    expect(onTabChange).toHaveBeenCalledWith('digests');
  });
});

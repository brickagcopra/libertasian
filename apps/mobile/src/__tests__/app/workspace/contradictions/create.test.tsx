import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { SearchResultItem } from '@/features/search/types';

jest.mock('expo-router', () => {
  const MockReact = require('react');
  return {
    // Render headerRight so the "Analyze" action is pressable in tests.
    Stack: {
      Screen: ({ options }: { options?: { headerRight?: () => React.ReactNode } }) =>
        options?.headerRight ? MockReact.createElement(MockReact.Fragment, null, options.headerRight()) : null,
    },
    router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
  };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: ({ name }: { name: string }) => { const { Text } = require('react-native'); return <Text>{name}</Text>; } }));
const mockGenerateContradiction = jest.fn().mockResolvedValue({ id: 'cd-1' });
jest.mock('@/features/contradictions/hooks/use-contradictions', () => ({ useGenerateContradiction: () => ({ mutateAsync: mockGenerateContradiction, isPending: false }) }));
jest.mock('@/features/contradictions/types', () => ({ ContradictionScope: {} }));
const mockUseSearch = jest.fn();
jest.mock('@/features/search/hooks/use-search', () => ({ useSearch: (...args: unknown[]) => mockUseSearch(...args) }));

import CreateContradictionScreen from '@/app/workspace/contradictions/create';

/**
 * The API sets the OpenSearch `_id` to `section_id ?? document_id`
 * (opensearch.service.ts:511), so `item.id` is usually a SECTION uuid. Only
 * `source.document_id` is a legal document id.
 */
function sectionHit(suffix: string, title: string): SearchResultItem {
  return {
    id: `section-${suffix}`,
    score: 5,
    source: {
      document_id: `doc-${suffix}`,
      title,
      document_type: 'decision',
      is_official: true,
      is_published: true,
      created_at: '2024-01-01T00:00:00Z',
      section_id: `section-${suffix}`,
    },
  };
}

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('CreateContradictionScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseSearch.mockReturnValue({ data: null, isLoading: false });
  });

  it('renders scope selection options', () => {
    const { getByText } = render(<CreateContradictionScreen />, { wrapper: createWrapper() });
    expect(getByText('Selected Documents')).toBeTruthy();
    expect(getByText('Topic-Based')).toBeTruthy();
  });

  it('renders analysis scope label', () => {
    const { getByText } = render(<CreateContradictionScreen />, { wrapper: createWrapper() });
    expect(getByText('Analysis Scope')).toBeTruthy();
  });

  it('submits legal document ids, not OpenSearch section ids', () => {
    mockUseSearch.mockReturnValue({
      data: { data: [sectionHit('aaa', 'People v. Reyes'), sectionHit('bbb', 'Agabon v. NLRC')] },
      isLoading: false,
    });

    const { getByPlaceholderText, getByText } = render(<CreateContradictionScreen />, {
      wrapper: createWrapper(),
    });

    // Picking a document clears the query, so re-type before the second pick.
    fireEvent.changeText(getByPlaceholderText(/Search cases/i), 'reyes');
    fireEvent.press(getByText('People v. Reyes'));
    fireEvent.changeText(getByPlaceholderText(/Search cases/i), 'agabon');
    fireEvent.press(getByText('Agabon v. NLRC'));
    fireEvent.press(getByText('Analyze'));

    expect(mockGenerateContradiction).toHaveBeenCalledWith(
      expect.objectContaining({ documentIds: ['doc-aaa', 'doc-bbb'] }),
    );
  });
});

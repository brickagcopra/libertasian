import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { SearchResultItem } from '@/features/search/types';

jest.mock('expo-router', () => {
  const MockReact = require('react');
  return {
    // Render headerRight so the "Generate" action is pressable in tests.
    Stack: {
      Screen: ({ options }: { options?: { headerRight?: () => React.ReactNode } }) =>
        options?.headerRight ? MockReact.createElement(MockReact.Fragment, null, options.headerRight()) : null,
    },
    router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
  };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: ({ name }: { name: string }) => { const { Text } = require('react-native'); return <Text>{name}</Text>; } }));
const mockGeneratePrep = jest.fn().mockResolvedValue({ id: 'hp-1' });
jest.mock('@/features/hearing-prep/hooks/use-hearing-prep', () => ({ useGenerateHearingPrep: () => ({ mutateAsync: mockGeneratePrep, isPending: false }) }));
const mockUseSearch = jest.fn();
jest.mock('@/features/search/hooks/use-search', () => ({ useSearch: (...args: unknown[]) => mockUseSearch(...args) }));

import CreateHearingPrepScreen from '@/app/workspace/hearing-prep/create';

/**
 * The API sets the OpenSearch `_id` to `section_id ?? document_id`
 * (opensearch.service.ts:511), so `item.id` is usually a SECTION uuid. Only
 * `source.document_id` is a legal document id.
 */
const sectionHit: SearchResultItem = {
  id: 'section-aaa',
  score: 5,
  source: {
    document_id: 'doc-aaa',
    title: 'People v. Reyes',
    citation_text: 'G.R. No. 123456',
    document_type: 'decision',
    is_official: true,
    is_published: true,
    created_at: '2024-01-01T00:00:00Z',
    section_id: 'section-aaa',
  },
};

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('CreateHearingPrepScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseSearch.mockReturnValue({ data: null, isLoading: false });
  });

  it('renders topic input', () => {
    const { getByText } = render(<CreateHearingPrepScreen />, { wrapper: createWrapper() });
    expect(getByText('Hearing Topic *')).toBeTruthy();
  });

  it('renders legal issue input', () => {
    const { getByText } = render(<CreateHearingPrepScreen />, { wrapper: createWrapper() });
    expect(getByText('Legal Issue (Optional)')).toBeTruthy();
  });

  it('submits the legal document id, not the OpenSearch section id', async () => {
    mockUseSearch.mockReturnValue({ data: { data: [sectionHit] }, isLoading: false });

    const { getByPlaceholderText, getByText } = render(<CreateHearingPrepScreen />, {
      wrapper: createWrapper(),
    });

    fireEvent.changeText(
      getByPlaceholderText(/Reyes v. ABC Corp/i),
      'Dismissal hearing',
    );
    fireEvent.changeText(getByPlaceholderText(/Search cases/i), 'reyes');
    fireEvent.press(getByText('People v. Reyes'));
    fireEvent.press(getByText('Generate'));

    expect(mockGeneratePrep).toHaveBeenCalledWith(
      expect.objectContaining({ documentIds: ['doc-aaa'] }),
    );
  });
});

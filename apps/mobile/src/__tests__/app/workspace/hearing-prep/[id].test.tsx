import React from 'react';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null }, useLocalSearchParams: jest.fn(() => ({ id: 'hp-1' })), router: { back: jest.fn(), push: jest.fn() } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: ({ name }: { name: string }) => { const { Text } = require('react-native'); return <Text>{name}</Text>; } }));

const mockUseHearingPrep = jest.fn();
jest.mock('@/features/hearing-prep/hooks/use-hearing-prep', () => ({
  useHearingPrep: (...args: unknown[]) => mockUseHearingPrep(...args),
  useDeleteHearingPrep: () => ({ mutate: jest.fn() }),
}));

jest.mock('@/features/hearing-prep/types', () => ({
  HEARING_PREP_STATUS_LABELS: { pending: 'Pending', generating: 'Generating...', completed: 'Completed', failed: 'Failed' },
  ARGUMENT_STRENGTH_LABELS: { strong: 'Strong', moderate: 'Moderate', weak: 'Weak' },
}));

import HearingPrepDetailScreen from '@/app/workspace/hearing-prep/[id]';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('HearingPrepDetailScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows loading state', () => {
    mockUseHearingPrep.mockReturnValue({ data: undefined, isLoading: true, error: null });
    const { UNSAFE_root } = render(<HearingPrepDetailScreen />, { wrapper: createWrapper() });
    expect(UNSAFE_root).toBeTruthy();
  });

  it('renders completed hearing prep', () => {
    mockUseHearingPrep.mockReturnValue({
      data: {
          id: 'hp-1',
          topic: 'Cross-exam strategy',
          issue: 'Credibility',
          status: 'completed',
          createdAt: '2024-03-01T00:00:00Z',
          updatedAt: '2024-03-01T00:00:00Z',
          matterId: null,
          matter: null,
          documentIds: ['d1'],
          inputContext: null,
          modelRunId: null,
          userId: 'u1',
          organizationId: 'org1',
          packJson: {
            cases: [{ documentId: 'd1', title: 'People v. Smith', citationText: null, relevance: 'High', keyHoldings: ['Holding 1'] }],
            provisions: [{ documentId: 'd2', sectionId: null, title: 'Evidence Rule', sectionLabel: 'Rule 132 Section 10', text: 'Text of provision', relevance: 'Relevant' }],
            arguments: [{ position: 'Argue inconsistency', supportingCases: [], supportingProvisions: [], strength: 'strong' }],
            counterArguments: [{ position: 'Defense may claim...', supportingCases: [], supportingProvisions: [], strength: 'moderate' }],
            suggestedQuestions: ['Did you see the accused?'],
          },
        },
      isLoading: false,
      error: null,
    });
    const { getByText } = render(<HearingPrepDetailScreen />, { wrapper: createWrapper() });
    expect(getByText('Cross-exam strategy')).toBeTruthy();
  });
});

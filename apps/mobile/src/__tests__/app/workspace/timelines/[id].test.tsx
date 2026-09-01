import React from 'react';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null }, useLocalSearchParams: jest.fn(() => ({ id: 'tl-1' })), router: { back: jest.fn(), push: jest.fn() } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: ({ name }: { name: string }) => { const { Text } = require('react-native'); return <Text>{name}</Text>; } }));

const mockUseTimeline = jest.fn();
jest.mock('@/features/timelines/hooks/use-timelines', () => ({
  useTimeline: (...args: unknown[]) => mockUseTimeline(...args),
  useDeleteTimeline: () => ({ mutate: jest.fn() }),
}));

jest.mock('@/features/timelines/types', () => ({
  TIMELINE_STATUS_LABELS: { pending: 'Pending', generating: 'Generating...', completed: 'Completed', failed: 'Failed' },
  EVENT_TYPE_LABELS: { filing: 'Filing', decision: 'Decision', legislation: 'Legislation', amendment: 'Amendment', enforcement: 'Enforcement', other: 'Other' },
}));

import TimelineDetailScreen from '@/app/workspace/timelines/[id]';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('TimelineDetailScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows loading state', () => {
    mockUseTimeline.mockReturnValue({ data: undefined, isLoading: true, error: null });
    const { UNSAFE_root } = render(<TimelineDetailScreen />, { wrapper: createWrapper() });
    expect(UNSAFE_root).toBeTruthy();
  });

  it('renders completed timeline with events', () => {
    mockUseTimeline.mockReturnValue({
      data: {
          id: 'tl-1',
          title: 'Case Timeline',
          status: 'completed',
          documentIds: ['d1'],
          createdAt: '2024-03-01T00:00:00Z',
          updatedAt: '2024-03-01T00:00:00Z',
          matterId: null,
          matter: null,
          modelRunId: null,
          userId: 'u1',
          organizationId: 'org1',
          timelineJson: {
            summary: 'Overview of case events',
            events: [{
              date: '2024-01-15',
              label: 'Complaint Filed',
              description: 'Complaint filed',
              sourceDocumentId: 'd1',
              sourceSectionId: null,
              eventType: 'filing',
            }],
          },
        },
      isLoading: false,
      error: null,
    });
    const { getByText } = render(<TimelineDetailScreen />, { wrapper: createWrapper() });
    expect(getByText('Complaint filed')).toBeTruthy();
  });
});

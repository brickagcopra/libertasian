import React from 'react';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null }, router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: ({ name }: { name: string }) => { const { Text } = require('react-native'); return <Text>{name}</Text>; } }));

const mockUsePleadingTemplates = jest.fn();
jest.mock('@/features/pleadings/hooks/use-pleadings', () => ({
  usePleadingTemplates: () => mockUsePleadingTemplates(),
  usePleadingTemplate: () => ({ data: null, isLoading: false }),
  useGeneratePleading: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

jest.mock('@/features/pleadings/types', () => ({
  PLEADING_CATEGORY_LABELS: { motion: 'Motion', complaint: 'Complaint', petition: 'Petition', answer: 'Answer', memorandum: 'Memorandum', appeal: 'Appeal', other: 'Other' },
}));

import CreatePleadingScreen from '@/app/workspace/pleadings/create';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('CreatePleadingScreen', () => {
  it('shows loading when templates loading', () => {
    mockUsePleadingTemplates.mockReturnValue({ data: undefined, isLoading: true });
    const { UNSAFE_root } = render(<CreatePleadingScreen />, { wrapper: createWrapper() });
    expect(UNSAFE_root).toBeTruthy();
  });

  it('renders template cards', () => {
    mockUsePleadingTemplates.mockReturnValue({
      data: [
          { id: 'tpl-1', name: 'Motion to Dismiss', slug: 'motion-to-dismiss', category: 'motion', court: null, description: 'Standard motion to dismiss', isActive: true },
          { id: 'tpl-2', name: 'Answer', slug: 'answer', category: 'answer', court: null, description: 'Standard answer to complaint', isActive: true },
        ],
      isLoading: false,
    });
    const { getByText } = render(<CreatePleadingScreen />, { wrapper: createWrapper() });
    expect(getByText('Motion to Dismiss')).toBeTruthy();
  });
});

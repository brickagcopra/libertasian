import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: jest.fn(() => ({})),
}));

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name }: { name: string }) => <Text>{name}</Text>,
  };
});

import { router, useLocalSearchParams } from 'expo-router';

const mockUseSubjectsByType = jest.fn();
jest.mock('@/features/derivatives/hooks/use-derivatives', () => ({
  useDerivativeSubjectsByType: (...args: unknown[]) =>
    mockUseSubjectsByType(...args),
}));

import LibraryTypeScreen from '@/app/(tabs)/library/[type]/index';

describe('LibraryTypeScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useLocalSearchParams as jest.Mock).mockReturnValue({ type: 'digests' });
  });

  it('renders subject tiles with counts from useDerivativeSubjectsByType', () => {
    mockUseSubjectsByType.mockReturnValue({
      data: [
        {
          subjectCode: 'criminal_law',
          subjectName: 'Criminal Law',
          taxonomyVersion: 'study_8',
          totalCount: 12,
          approvedCount: 10,
        },
      ],
      isLoading: false,
    });

    const { queryByText, queryAllByText } = render(<LibraryTypeScreen />);
    expect(queryByText('Case Digests')).toBeTruthy();
    expect(queryByText('Criminal Law')).toBeTruthy();
    expect(queryByText('12')).toBeTruthy();
    expect(queryAllByText('case digests').length).toBeGreaterThan(0);
  });

  it('navigates to the subject route on tile press', () => {
    mockUseSubjectsByType.mockReturnValue({ data: [], isLoading: false });
    const { getByLabelText } = render(<LibraryTypeScreen />);
    fireEvent.press(getByLabelText(/Criminal Law, 0 case digests/));
    expect(router.push).toHaveBeenCalledWith('/library/digests/criminal-law');
  });

  it('renders a missing-type fallback for an unknown type slug', () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ type: 'not-real' });
    mockUseSubjectsByType.mockReturnValue({ data: [], isLoading: false });
    const { queryByText } = render(<LibraryTypeScreen />);
    expect(queryByText(/Unknown library type/i)).toBeTruthy();
  });
});

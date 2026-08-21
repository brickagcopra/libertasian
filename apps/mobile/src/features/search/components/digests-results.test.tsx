import { render, screen, fireEvent } from '@testing-library/react-native';
import { router } from 'expo-router';

jest.mock('@expo/vector-icons', () => {
  const { View } = jest.requireActual('react-native') as typeof import('react-native');
  const MockReact = jest.requireActual('react') as typeof import('react');
  return {
    Ionicons: (props: Record<string, unknown>) =>
      MockReact.createElement(View, { testID: `icon-${props['name'] as string}` }),
  };
});

const mockUseSearchDigests = jest.fn();
jest.mock('../hooks/use-search-digests', () => ({
  useSearchDigests: () => mockUseSearchDigests(),
}));

import { DigestsResults } from './digests-results';
import type { SearchDigestItem } from '../types';

const DIGEST: SearchDigestItem = {
  id: 'd-42',
  title: 'People v. Dela Cruz',
  summary: 'Conviction affirmed.',
  digestType: 'case_digest',
  confidenceScore: 0.91,
  reviewStatus: 'approved',
  visibility: 'public_editorial',
  createdAt: '2026-01-05T00:00:00.000Z',
  legalDocument: null,
};

function resultsOf(digests: SearchDigestItem[]) {
  mockUseSearchDigests.mockReturnValue({
    data: { data: digests },
    isLoading: false,
    error: null,
  });
}

describe('DigestsResults navigation', () => {
  afterEach(() => {
    mockUseSearchDigests.mockReset();
    (router.push as jest.Mock).mockClear();
  });

  // The Expo Router route is src/app/digest/[id].tsx — singular. Pushing the
  // plural `/digests/<id>` (the web path) lands on Unmatched Route, so this
  // asserts the exact string, not just that a push happened.
  it('pushes the singular /digest/<id> route when a card is tapped', () => {
    resultsOf([DIGEST]);

    render(<DigestsResults query="dela cruz" />);
    fireEvent.press(screen.getByText('People v. Dela Cruz'));

    expect(router.push).toHaveBeenCalledWith('/digest/d-42');
  });

  it('routes each card to its own id', () => {
    resultsOf([DIGEST, { ...DIGEST, id: 'd-43', title: 'Marcos v. Manglapus' }]);

    render(<DigestsResults query="marcos" />);
    fireEvent.press(screen.getByText('Marcos v. Manglapus'));

    expect(router.push).toHaveBeenCalledWith('/digest/d-43');
  });
});

import { render } from '@testing-library/react-native';

/**
 * app/community/* lives OUTSIDE the (tabs) group, and (tabs)/_layout.tsx sets
 * tabBarStyle: { display: 'none' } on all eight tabs. Before this suite, these
 * five screens rendered no navigation at all beyond the Stack back button.
 *
 * Each test asserts the TabBar's own labels are present, which is only true if
 * the screen actually mounts <TabBar>.
 */

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text testID={`icon-${name}`}>{name}</Text>;
  },
}));

/**
 * The marketplace LIST endpoints send `{ success, data, meta }`; the `meta`
 * sibling stops `apiClient` unwrapping them, so these hooks really do resolve
 * with the envelope. Contrast `mockEmptyFeatured` below.
 */
const mockEmptyList = {
  data: { success: true, data: { items: [], hasNext: false, nextCursor: null } },
  isLoading: false,
  isFetching: false,
  error: null,
  refetch: jest.fn(),
};

/**
 * useMarketplaceFeatured returns three named buckets, not a list — and
 * `GET /community/marketplace/featured` is a bare { success, data } envelope,
 * so `apiClient` strips it and the hook resolves with the buckets themselves.
 */
const mockEmptyFeatured = {
  data: { flashcardSets: [], reviewerPacks: [], digests: [] },
  isLoading: false,
  isFetching: false,
  error: null,
  refetch: jest.fn(),
};

jest.mock('@/features/community/hooks/use-marketplace', () => ({
  useMarketplaceFeatured: () => mockEmptyFeatured,
  useMarketplaceDigests: () => mockEmptyList,
  useMarketplaceFlashcardSets: () => mockEmptyList,
  useMarketplaceReviewerPacks: () => mockEmptyList,
  // Bare { success, data } envelope — already unwrapped by `apiClient`.
  useContributorProfile: () => ({
    isLoading: false,
    error: null,
    data: {
      user: { id: 'u1', fullName: 'Atty. Maria Santos' },
      stats: {
        totalItems: 3,
        totalDownloads: 12,
        averageRating: 4.5,
        totalRatings: 4,
      },
      isExpert: false,
    },
  }),
}));

import CommunityIndex from '@/app/community/index';
import CommunityDigests from '@/app/community/digests/index';
import CommunityFlashcardSets from '@/app/community/flashcard-sets/index';
import CommunityReviewerPacks from '@/app/community/reviewer-packs/index';
import ContributorProfile from '@/app/community/contributors/[userId]';
import { setEntitled, setFreeTier } from '@/features/entitlements/test-helpers';

/** Labels unique to the shared TabBar. */
const TAB_LABELS = ['Read', 'Search', 'Digests', 'Study', 'Feed', 'Work', 'Me'];

const SCREENS: Array<[string, React.ComponentType]> = [
  ['community/index', CommunityIndex],
  ['community/digests', CommunityDigests],
  ['community/flashcard-sets', CommunityFlashcardSets],
  ['community/reviewer-packs', CommunityReviewerPacks],
  ['community/contributors/[userId]', ContributorProfile],
];

describe('community screens render the TabBar', () => {
  // TAB_LABELS includes Study, which the bar now filters out for a free
  // account. These cases are about whether the screens mount the bar at all,
  // so they stand in an entitled account and get the full set.
  beforeEach(() => {
    setEntitled();
  });

  // Matched on accessibilityRole="tab", which only TabBar sets — the
  // contributor screen has its own "Digests" stat card, so a plain text query
  // would collide with screen content.
  it.each(SCREENS)('%s mounts the TabBar', (_name, Screen) => {
    const { getByRole } = render(<Screen />);
    for (const label of TAB_LABELS) {
      expect(getByRole('tab', { name: label })).toBeTruthy();
    }
  });

  it.each(SCREENS)('%s marks Feed as the active tab', (_name, Screen) => {
    const { getByRole } = render(<Screen />);
    expect(
      getByRole('tab', { name: 'Feed' }).props.accessibilityState.selected,
    ).toBe(true);
  });

  // These screens live outside (tabs), so they were the likeliest place for the
  // Study slot to survive the gate and hand a free account a way in.
  it.each(SCREENS)('%s shows no Study tab to a free account', (_name, Screen) => {
    setFreeTier();
    const { queryByRole, getByRole } = render(<Screen />);

    expect(queryByRole('tab', { name: 'Study' })).toBeNull();
    expect(getByRole('tab', { name: 'Feed' })).toBeTruthy();
  });
});

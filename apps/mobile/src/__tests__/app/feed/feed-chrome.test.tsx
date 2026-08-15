import { KeyboardAvoidingView, StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

/**
 * Two chrome regressions on the feed, both from hardcoded offsets:
 *
 * (a) `feed/index.tsx` renders a bare <View> and `headerShown` is false for
 *     this route in BOTH (tabs)/_layout.tsx and feed/_layout.tsx, so the
 *     "My Org" / "Public" chip row started at y=0 and sat under the Dynamic
 *     Island.
 * (b) `create-post-form.tsx` hardcoded keyboardVerticalOffset={88}. The screen
 *     is presentation: 'modal', so that constant never matched the real header
 *     height and the Post button slid under the keyboard.
 */

// The 17 Pro Max reports a 62pt top inset. Overrides the global mock in
// src/test/setup.ts, which uses 44.
const INSET_TOP = 62;
const INSET_BOTTOM = 34;
const HEADER_HEIGHT = 56;

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  const insets = { top: INSET_TOP, bottom: INSET_BOTTOM, left: 0, right: 0 };
  return {
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
    SafeAreaView: ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement(View, props, children),
    SafeAreaInsetsContext: React.createContext(insets),
    useSafeAreaInsets: () => insets,
    useSafeAreaFrame: () => ({ x: 0, y: 0, width: 440, height: 956 }),
    initialWindowMetrics: { frame: { x: 0, y: 0, width: 440, height: 956 }, insets },
  };
});

jest.mock('@react-navigation/elements', () => ({
  useHeaderHeight: () => HEADER_HEIGHT,
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text testID={`icon-${name}`}>{name}</Text>;
  },
}));

const mockEmptyFeed = {
  data: { pages: [] },
  isLoading: false,
  isFetchingNextPage: false,
  hasNextPage: false,
  isRefetching: false,
  fetchNextPage: jest.fn(),
  refetch: jest.fn(),
};

jest.mock('@/features/feed/hooks/use-feed', () => ({
  usePublicFeed: () => mockEmptyFeed,
  useOrganizationFeed: () => mockEmptyFeed,
  useBookmarkedPosts: () => mockEmptyFeed,
  useUserProfileFeed: () => mockEmptyFeed,
  usePostDetail: () => ({ data: undefined, isLoading: false }),
}));

jest.mock('@/features/feed/hooks/use-create-post', () => ({
  useCreatePost: () => ({ mutate: jest.fn(), isPending: false }),
  useUpdatePost: () => ({ mutate: jest.fn(), isPending: false }),
  useDeletePost: () => ({ mutate: jest.fn() }),
}));

jest.mock('@/features/feed/hooks/use-feed-media', () => ({
  useUploadFeedMedia: () => ({ mutate: jest.fn(), isPending: false }),
  useFeedMediaStatus: () => ({ data: undefined }),
  useDeleteFeedMedia: () => ({ mutate: jest.fn() }),
}));

jest.mock('@/features/feed/hooks/use-image-picker', () => ({
  useImagePicker: () => ({
    pickedImage: null,
    isLoading: false,
    pickFromLibrary: jest.fn(),
    takePhoto: jest.fn(),
    clear: jest.fn(),
  }),
}));

import FeedIndexScreen from '@/app/(tabs)/feed/index';
import { CreatePostForm } from '@/features/feed/components/create-post-form';

function flat(node: { props: { style?: unknown } }) {
  return StyleSheet.flatten(node.props.style as never) as Record<string, number>;
}

describe('feed index — top inset', () => {
  it('pads the chip row past the Dynamic Island', () => {
    const { getByTestId } = render(<FeedIndexScreen />);
    const style = flat(getByTestId('feed-chip-row') as never);

    expect(style['paddingTop']).toBeGreaterThanOrEqual(INSET_TOP);
  });

  it('does not regress to the bare design padding', () => {
    const { getByTestId } = render(<FeedIndexScreen />);
    const style = flat(getByTestId('feed-chip-row') as never);

    // The old value was paddingVertical: 8, which put the row under the notch.
    expect(style['paddingTop']).not.toBe(8);
  });
});

describe('create post — toolbar clears the keyboard', () => {
  it('offsets the keyboard avoider by the real header height, not 88', () => {
    const kav = render(<CreatePostForm />).UNSAFE_getByType(
      KeyboardAvoidingView,
    );

    expect(kav.props.keyboardVerticalOffset).toBe(HEADER_HEIGHT);
    expect(kav.props.keyboardVerticalOffset).not.toBe(88);
  });

  it('keeps the toolbar above the home indicator when the keyboard is down', () => {
    const { getByTestId } = render(<CreatePostForm />);
    const style = flat(getByTestId('create-post-toolbar') as never);

    expect(style['paddingBottom']).toBeGreaterThanOrEqual(INSET_BOTTOM);
  });

  it('renders all three visibility labels on one line each', () => {
    const { getByText } = render(<CreatePostForm />);

    for (const label of ['Organization', 'Public', 'Draft']) {
      const node = getByText(label);
      expect(node.props.numberOfLines).toBe(1);
    }
  });

  it('lets the chip row wrap instead of overflowing', () => {
    const { getByTestId } = render(<CreatePostForm />);

    // Yoga defaults flexShrink to 0, so without wrap the third chip is pushed
    // off-screen at large Dynamic Type rather than moving to a second line.
    expect(flat(getByTestId('visibility-row') as never)['flexWrap']).toBe('wrap');
  });
});

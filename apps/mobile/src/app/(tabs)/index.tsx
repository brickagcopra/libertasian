import { useMemo } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { router } from 'expo-router';
import { HomeScreen, type HomeFeedItem } from '@/components/screens/HomeScreen';
import { useHomeFeed } from '@/features/home/hooks/use-home-feed';
import { useAuth } from '@/providers/auth-provider';
import { useTheme } from '@/providers/theme-provider';
import type { HomeFeedItem as ApiHomeFeedItem } from '@/features/home/types';

function formatGreetingDate(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function firstNameFrom(fullName?: string | null): string | undefined {
  if (!fullName) return undefined;
  const first = fullName.trim().split(/\s+/)[0];
  return first && first.length > 0 ? first : undefined;
}

/** API → screen-prop mapper. The shapes match today, but we keep the seam
 *  so a server-side rename doesn't reach into the screen component. */
function toScreenItem(item: ApiHomeFeedItem): HomeFeedItem {
  return {
    id: item.id,
    category: item.category,
    headline: item.headline,
    minutes: item.minutes,
    ...(item.byline ? { byline: item.byline } : {}),
  };
}

function routeForItem(item: ApiHomeFeedItem): string {
  return item.kind === 'digest' ? `/digest/${item.id}` : `/reader/${item.id}`;
}

export default function HomeRoute() {
  const { user } = useAuth();
  const { theme } = useTheme();
  const { data, isLoading, isError } = useHomeFeed();

  const greetingDate = useMemo(() => formatGreetingDate(new Date()), []);
  const firstName = firstNameFrom(user?.fullName);
  const greetingName = firstName ? `Hi, ${firstName}.` : 'Welcome back.';

  // Build a kind→item lookup once per render so feed-item taps can route
  // to the right surface (digest vs document) without an extra request.
  const itemIndex = useMemo(() => {
    const map = new Map<string, ApiHomeFeedItem>();
    for (const item of data?.todaysBrief ?? []) map.set(item.id, item);
    for (const item of data?.forYou ?? []) map.set(item.id, item);
    return map;
  }, [data]);

  const feedItems = useMemo<HomeFeedItem[] | undefined>(() => {
    if (!data) return undefined;
    return data.forYou.map(toScreenItem);
  }, [data]);

  const briefItem = data?.todaysBrief[0];
  const briefProp = briefItem
    ? {
        eyebrow: `Today's brief · ${briefItem.minutes} min`,
        title: briefItem.headline,
        onRead: () => router.push(routeForItem(briefItem)),
      }
    : undefined;

  const handleFeedItemPress = (id: string) => {
    const item = itemIndex.get(id);
    if (!item) return;
    router.push(routeForItem(item));
  };

  // Loading: render the chrome with a centred spinner so the launch
  // transition stays smooth instead of flashing fixtures.
  if (isLoading && !data) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  // Error: keep the screen mounted with an empty feed array so the user can
  // still navigate. The bottom tabs and greeting remain interactive.
  const errorEmptyFeed = isError && !data ? [] : undefined;

  return (
    <HomeScreen
      greetingDate={greetingDate}
      greetingName={greetingName}
      {...(briefProp ? { brief: briefProp } : {})}
      feed={errorEmptyFeed ?? feedItems ?? []}
      onProfilePress={() => router.push('/settings')}
      onPressFeedItem={handleFeedItemPress}
      onSeeAllFeed={() => router.push('/(tabs)/digests')}
      activeTab="home"
      onTabPress={(id) => {
        if (id === 'docs') router.push('/documents');
        else if (id === 'search') router.push('/(tabs)/search');
        else if (id === 'me') router.push('/settings');
      }}
    />
  );
}

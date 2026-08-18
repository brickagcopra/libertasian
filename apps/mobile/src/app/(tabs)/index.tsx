import { useMemo } from 'react';
import { router } from 'expo-router';
import { HomeScreen, type HomeFeedItem } from '@/components/screens/HomeScreen';
import { useTabBarNav } from '@/features/navigation/use-tab-bar-nav';
import { useHomeFeed } from '@/features/home/hooks/use-home-feed';
import { useAuth } from '@/providers/auth-provider';
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
  const navigate = useTabBarNav();
  const { user } = useAuth();
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

  // NEVER return early from this screen. Every one of the 8 tab routes sets
  // `tabBarStyle: { display: 'none' }`, so HomeScreen's own TabBar is the only
  // navigation in the app — any branch that renders something else (a bare
  // spinner, an error card) is a dead end the user cannot leave. That is how
  // build 19 read as "unresponsive" to App Store review (2.1(a)).
  //
  // Loading and error therefore both render the full screen with an empty
  // feed; the chrome, greeting and tabs stay interactive throughout.
  const feed = isLoading || isError ? [] : (feedItems ?? []);

  return (
    <HomeScreen
      greetingDate={greetingDate}
      greetingName={greetingName}
      {...(briefProp ? { brief: briefProp } : {})}
      feed={feed}
      onProfilePress={() => router.push('/settings')}
      onPressFeedItem={handleFeedItemPress}
      onSeeAllFeed={() => router.push('/(tabs)/digests')}
      onSearchPress={() => router.push('/(tabs)/search')}
      activeTab="home"
      onTabPress={navigate}
    />
  );
}

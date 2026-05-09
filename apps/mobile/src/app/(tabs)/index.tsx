import { useMemo } from 'react';
import { router } from 'expo-router';
import { HomeScreen } from '@/components/screens/HomeScreen';
import { useAuth } from '@/providers/auth-provider';

function formatGreetingDate(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function firstNameFrom(fullName?: string | null): string | undefined {
  if (!fullName) return undefined;
  const first = fullName.trim().split(/\s+/)[0];
  return first && first.length > 0 ? first : undefined;
}

export default function HomeRoute() {
  const { user } = useAuth();

  const greetingDate = useMemo(() => formatGreetingDate(new Date()), []);
  const firstName = firstNameFrom(user?.fullName);
  const greetingName = firstName ? `Hi, ${firstName}.` : 'Welcome back.';

  return (
    <HomeScreen
      greetingDate={greetingDate}
      greetingName={greetingName}
      onProfilePress={() => router.push('/settings')}
      onPressFeedItem={(id) => router.push(`/digest/${id}`)}
      onSeeAllFeed={() => router.push('/(tabs)/feed')}
      activeTab="home"
      onTabPress={(id) => {
        if (id === 'docs') router.push('/documents');
        else if (id === 'search') router.push('/(tabs)/search');
        else if (id === 'me') router.push('/settings');
      }}
    />
  );
}

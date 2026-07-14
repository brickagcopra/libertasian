import { Tabs, router } from 'expo-router';
import { TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/providers/theme-provider';

function SettingsButton() {
  const { theme } = useTheme();
  return (
    <TouchableOpacity
      onPress={() => router.push('/settings')}
      style={{ marginRight: 16 }}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Ionicons name="settings-outline" size={22} color={theme.inkSoft} />
    </TouchableOpacity>
  );
}

export default function TabsLayout() {
  const { theme } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.inkFaint,
        tabBarLabelStyle: { fontSize: 12, fontWeight: '500' },
        tabBarStyle: {
          borderTopColor: 'transparent',
          backgroundColor: theme.surface,
        },
        headerStyle: { backgroundColor: theme.surface },
        headerTitleStyle: { fontSize: 17, fontWeight: '600', color: theme.ink },
        headerRight: () => <SettingsButton />,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          headerShown: false,
          tabBarStyle: { display: 'none' },
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: 'Search',
          headerShown: false,
          tabBarStyle: { display: 'none' },
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="search-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="digests"
        options={{
          title: 'Digests',
          tabBarStyle: { display: 'none' },
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="document-text-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          title: 'Library',
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="library-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="study"
        options={{
          title: 'Study',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="school-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: 'Scan',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="camera-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="feed"
        options={{
          title: 'Feed',
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="newspaper-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="workspace"
        options={{
          title: 'Workspace',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="briefcase-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

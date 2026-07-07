import { Alert, View } from 'react-native';
import { router } from 'expo-router';
import { ProfileScreen } from '../../components/screens/ProfileScreen';
import { useAuth } from '../../providers/auth-provider';
import { useProfile } from '../../features/auth/hooks/use-auth';
import { useTheme } from '../../providers/theme-provider';
import type { ProfileRow } from '../../components/screens/ProfileScreen';
import type { OrganizationRole } from '../../features/auth/types';

const ADMIN_ROLES: OrganizationRole[] = ['admin', 'editor', 'reviewer'];

export default function SettingsRoute() {
  const { theme } = useTheme();
  const { user, signOut } = useAuth();
  const { data: profile } = useProfile();
  const displayUser = profile ?? user;

  function handleLogout() {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => signOut() },
    ]);
  }

  // Drawer-replacement entries: routes that used to live as bottom tabs but
  // now reach users via this profile surface (Phase 2 IA: 4 tabs + Scan FAB).
  const drawerRows: ProfileRow[] = [
    {
      id: 'digests',
      icon: 'document-text-outline',
      label: 'Digests',
      sub: 'Auto-generated case digests',
      onPress: () => router.push('/(tabs)/digests'),
    },
    {
      id: 'study',
      icon: 'school-outline',
      label: 'Study',
      sub: 'Bar reviewer & flashcards',
      onPress: () => router.push('/(tabs)/study'),
    },
    {
      id: 'feed',
      icon: 'newspaper-outline',
      label: 'Feed',
      sub: 'Community posts & updates',
      onPress: () => router.push('/(tabs)/feed'),
    },
    {
      id: 'workspace',
      icon: 'briefcase-outline',
      label: 'Workspace',
      sub: 'Matters, notes, comparisons',
      onPress: () => router.push('/(tabs)/workspace'),
    },
  ];

  const billingRows: ProfileRow[] = [
    {
      id: 'subscription',
      icon: 'card-outline',
      label: 'Subscription',
      sub: 'Manage plan and billing',
      onPress: () => router.push('/settings/subscription'),
    },
    {
      id: 'plans',
      icon: 'pricetags-outline',
      label: 'Plans',
      sub: 'View plans and upgrade',
      onPress: () => router.push('/settings/plans'),
    },
    {
      id: 'usage',
      icon: 'bar-chart-outline',
      label: 'Usage & quotas',
      sub: 'Track feature limits',
      onPress: () => router.push('/settings/usage'),
    },
  ];

  const adminRows: ProfileRow[] =
    displayUser?.organizationRole && ADMIN_ROLES.includes(displayUser.organizationRole)
      ? [
          {
            id: 'admin',
            icon: 'shield-outline',
            label: 'Admin dashboard',
            sub: 'Review queue & editorial',
            onPress: () => router.push('/admin'),
          },
        ]
      : [];

  const developerRows: ProfileRow[] = displayUser
    ? [
        {
          id: 'api-keys',
          icon: 'key-outline',
          label: 'API keys',
          sub: 'Integrations (Enterprise)',
          onPress: () => router.push('/settings/api-keys'),
        },
      ]
    : [];

  const accountRows: ProfileRow[] = [
    {
      id: 'security',
      icon: 'lock-closed-outline',
      label: 'Security',
      sub: 'Password & two-factor authentication',
      onPress: () => router.push('/settings/security'),
    },
    {
      id: 'notifications',
      icon: 'notifications-outline',
      label: 'Notifications',
      onPress: () => router.push('/notifications'),
    },
    {
      id: 'sign-out',
      icon: 'log-out-outline',
      label: 'Sign out',
      onPress: handleLogout,
    },
  ];

  const allRows = [
    ...drawerRows,
    ...billingRows,
    ...adminRows,
    ...developerRows,
    ...accountRows,
  ];

  const name = displayUser?.fullName ?? 'Account';
  const initial = displayUser?.fullName
    ? displayUser.fullName
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : 'L';

  const memberSince = displayUser
    ? new Date(displayUser.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short' })
    : '';

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ProfileScreen
        identity={{
          name,
          initial,
          subtitle: displayUser?.email ?? undefined,
        }}
        stats={[
          { value: displayUser?.emailVerified ? 'Yes' : 'No', label: 'Verified' },
          { value: displayUser?.mfaEnabled ? 'On' : 'Off', label: 'MFA' },
          { value: memberSince || '—', label: 'Member' },
        ]}
        rows={allRows}
        onSettingsPress={() => router.push('/settings/security')}
        onTabPress={(id) => {
          if (id === 'home') router.push('/(tabs)');
          else if (id === 'docs') router.push('/documents');
          else if (id === 'search') router.push('/(tabs)/search');
        }}
      />
    </View>
  );
}

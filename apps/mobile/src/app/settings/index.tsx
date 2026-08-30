import { Alert, View } from 'react-native';
import { router } from 'expo-router';
import { useTabBarNav } from '@/features/navigation/use-tab-bar-nav';
import { PURCHASE_ROUTE } from '@/features/purchase';
import { ProfileScreen } from '../../components/screens/ProfileScreen';
import { useAuth } from '../../providers/auth-provider';
import { useProfile } from '../../features/auth/hooks/use-auth';
import { useFreemiumSurfaces } from '../../features/entitlements/use-freemium-surfaces';
import { useTheme } from '../../providers/theme-provider';
import type { ProfileRow } from '../../components/screens/ProfileScreen';
import type { OrganizationRole } from '../../features/auth/types';

const ADMIN_ROLES: OrganizationRole[] = ['admin', 'editor', 'reviewer'];

export default function SettingsRoute() {
  const navigate = useTabBarNav();
  const { theme } = useTheme();
  const { user, signOut } = useAuth();
  const { data: profile } = useProfile();
  const surfaces = useFreemiumSurfaces();
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
    // Study is the same paid surface the TabBar filters out; this profile
    // surface is its other entry point, so it has to drop the row too. A row
    // left here would be a tap straight into a refusal.
    ...(surfaces.study
      ? ([
          {
            id: 'study',
            icon: 'school-outline',
            label: 'Study',
            sub: 'Bar reviewer & flashcards',
            onPress: () => router.push('/(tabs)/study'),
          },
        ] as ProfileRow[])
      : []),
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

  // Usage & quotas only. The subscription and plan rows are gone with their
  // screens: naming or managing a purchasable tier in-app is what App Review
  // rejected build 20 for (Guideline 2.1(b)). The API-keys row went with its
  // screen for a related reason — API keys are an enterprise-gated developer
  // surface the API deliberately leaves closed, so it is the one row that
  // would still 403 with tier wording, and it has no place in a phone app.
  const billingRows: ProfileRow[] = [
    // The ONLY door into the purchase surface, and the only file outside
    // `app/purchase/` and `features/purchase/` permitted to import from it —
    // `no-purchase-copy.test.ts` pins this list as
    // PERMITTED_PURCHASE_ENTRY_POINTS and fails if a second one appears.
    //
    // The label names nothing purchasable, because this row is NOT part of the
    // purchase surface: it sits on a settings screen that the FORBIDDEN word
    // list still applies to in full. The plan names and prices live one tap
    // away, on the screen that is allowed to show them.
    {
      id: 'plans',
      icon: 'card-outline',
      label: 'Manage account access',
      sub: 'Options for your account',
      onPress: () => router.push(PURCHASE_ROUTE),
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
      id: 'blocked-users',
      icon: 'person-remove-outline',
      label: 'Blocked users',
      sub: "Manage people you've blocked",
      onPress: () => router.push('/settings/blocked-users'),
    },
    {
      id: 'help',
      icon: 'chatbubble-ellipses-outline',
      label: 'Help & FAQ',
      sub: 'Chat with the LIBERTASIAN assistant',
      onPress: () => router.push('/help'),
    },
    {
      id: 'sign-out',
      icon: 'log-out-outline',
      label: 'Sign out',
      onPress: handleLogout,
    },
    // Danger zone. Apple 5.1.1(v) and Google Play both require this to be
    // reachable in-app, not only by emailing support.
    {
      id: 'delete-account',
      icon: 'trash-outline',
      label: 'Delete account',
      sub: 'Permanently delete your account and data',
      destructive: true,
      onPress: () => router.push('/settings/delete-account'),
    },
  ];

  const allRows = [
    ...drawerRows,
    ...billingRows,
    ...adminRows,
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
        contentTopPadding={12}
        onSettingsPress={() => router.push('/settings/security')}
        onTabPress={navigate}
      />
    </View>
  );
}

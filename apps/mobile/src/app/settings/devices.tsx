import { Alert, ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  type DeviceSession,
  describeDeviceLimits,
  deviceLabel,
  sortDevices,
  useDeviceLimits,
  useDevices,
  useSignOutDevice,
  useSignOutOtherDevices,
} from '@/features/devices/hooks/use-devices';
import { useAuth } from '@/providers/auth-provider';
import { useTheme } from '@/providers/theme-provider';

/** The destructive red used across the app. */
const DESTRUCTIVE = '#dc2626';

/**
 * "Your devices": every device signed in to this account, which one this is,
 * which are in use right now, and the account's caps. This device signs out
 * through the normal sign-out; others individually or all at once.
 */
export default function DevicesScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { signOut } = useAuth();
  const { data, isLoading, isError, refetch } = useDevices();
  const { data: limits } = useDeviceLimits();
  const signOutDevice = useSignOutDevice();
  const signOutOthers = useSignOutOtherDevices();

  const devices = sortDevices(data ?? []);
  const others = devices.filter((d) => !d.isCurrent);
  const limitText = describeDeviceLimits(limits);

  const confirmSignOut = (device: DeviceSession) => {
    const name = deviceLabel(device);
    Alert.alert(
      device.isCurrent ? 'Sign out of this device?' : `Sign out ${name}?`,
      device.isCurrent
        ? 'You will need to sign in again to use LIBERTASIAN here.'
        : 'That device will need to sign in again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: () => {
            if (device.isCurrent) void signOut();
            else signOutDevice.mutate(device.familyId);
          },
        },
      ],
    );
  };

  const confirmSignOutOthers = () => {
    Alert.alert(
      'Sign out all other devices?',
      'Every device except this one will need to sign in again.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: () => signOutOthers.mutate() },
      ],
    );
  };

  if (isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        <ActivityIndicator color={theme.ink} />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        <Text style={[styles.body, { color: theme.inkSoft }]}>Could not load your devices.</Text>
        <TouchableOpacity accessibilityRole="button" onPress={() => void refetch()}>
          <Text style={[styles.link, { color: theme.ink }]}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.flex, { backgroundColor: theme.bg }]}>
      <FlatList
        data={devices}
        keyExtractor={(d) => d.familyId}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }]}
        ListHeaderComponent={
          limitText ? (
            <Text style={[styles.body, styles.header, { color: theme.inkSoft }]}>{limitText}</Text>
          ) : undefined
        }
        renderItem={({ item }) => (
          <View
            style={[styles.row, { backgroundColor: theme.surface, borderRadius: theme.radius }]}
          >
            <Ionicons
              name={item.isCurrent ? 'phone-portrait-outline' : 'desktop-outline'}
              size={22}
              color={theme.inkSoft}
            />
            <View style={styles.rowText}>
              <Text style={[styles.name, { color: theme.ink }]} numberOfLines={1}>
                {deviceLabel(item)}
              </Text>
              <Text style={[styles.meta, { color: theme.inkSoft }]}>
                {item.isCurrent
                  ? 'This device'
                  : item.inUse
                    ? 'In use now'
                    : `Last active ${new Date(item.lastUsedAt).toLocaleString()}`}
              </Text>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={`Sign out ${deviceLabel(item)}`}
              onPress={() => confirmSignOut(item)}
              disabled={signOutDevice.isPending}
            >
              <Text style={styles.signOut}>Sign out</Text>
            </TouchableOpacity>
          </View>
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListFooterComponent={
          others.length > 0 ? (
            <TouchableOpacity
              accessibilityRole="button"
              onPress={confirmSignOutOthers}
              disabled={signOutOthers.isPending}
              style={styles.footer}
            >
              <Text style={styles.signOut}>Sign out all other devices</Text>
            </TouchableOpacity>
          ) : undefined
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  list: { padding: 16 },
  header: { marginBottom: 16 },
  body: { fontSize: 13, lineHeight: 19 },
  link: { fontSize: 15, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  rowText: { flex: 1, minWidth: 0 },
  name: { fontSize: 15, fontWeight: '600' },
  meta: { fontSize: 13, marginTop: 2 },
  signOut: { color: DESTRUCTIVE, fontSize: 14, fontWeight: '600' },
  separator: { height: 8 },
  footer: { alignItems: 'center', paddingVertical: 16, marginTop: 8 },
});

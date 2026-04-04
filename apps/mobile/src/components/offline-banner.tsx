import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface OfflineBannerProps {
  /** Custom message override. Defaults to "You are offline — showing cached data" */
  message?: string;
  /** Whether the banner can be dismissed by the user */
  dismissible?: boolean;
}

/**
 * A top-of-screen banner shown when the device is offline.
 * Indicates to the user that they're seeing cached/stale data.
 */
export function OfflineBanner({
  message = 'You are offline \u2014 showing cached data',
  dismissible = true,
}: OfflineBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <View style={styles.container} testID="offline-banner">
      <Ionicons name="cloud-offline-outline" size={16} color="#92400e" />
      <Text style={styles.text}>{message}</Text>
      {dismissible ? (
        <TouchableOpacity
          onPress={() => setDismissed(true)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          testID="offline-banner-dismiss"
        >
          <Ionicons name="close" size={16} color="#92400e" />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fffbeb',
    borderBottomWidth: 1,
    borderBottomColor: '#fde68a',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  text: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    color: '#92400e',
  },
});

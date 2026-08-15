import {
  ActivityIndicator,
  Alert,
  FlatList,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useBlockedUsers,
  useUnblockUser,
} from '@/features/feed/hooks/use-user-blocks';
import { useTheme } from '@/providers/theme-provider';
import type { FeedBlockedUser } from '@libertasian/types';

/** The destructive red used across the app. */
const DESTRUCTIVE = '#dc2626';

export default function BlockedUsersScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useBlockedUsers();
  const unblockUser = useUnblockUser();

  const items: FeedBlockedUser[] = data?.pages.flatMap((p) => p.data) ?? [];

  const confirmUnblock = (row: FeedBlockedUser) => {
    Alert.alert(
      `Unblock ${row.user.fullName}?`,
      'You will see their posts and comments again, and they will see yours.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unblock',
          onPress: () =>
            unblockUser.mutate(row.user.id, {
              onError: () =>
                Alert.alert(
                  'Could not unblock',
                  'Something went wrong. Please try again.',
                ),
            }),
        },
      ],
    );
  };

  if (isLoading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.bg,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ActivityIndicator color={theme.ink} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{
          padding: 16,
          paddingBottom: insets.bottom + 24,
          flexGrow: 1,
        }}
        ListHeaderComponent={
          items.length > 0 ? (
            <Text
              style={{
                color: theme.inkSoft,
                fontSize: 13,
                lineHeight: 19,
                marginBottom: 16,
              }}
            >
              You will not see posts or comments from these people, and they
              will not see yours.
            </Text>
          ) : null
        }
        ListEmptyComponent={
          <View
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              paddingHorizontal: 24,
            }}
          >
            <Ionicons
              name="person-remove-outline"
              size={32}
              color={theme.inkSoft}
            />
            <Text
              style={{
                color: theme.ink,
                fontSize: 16,
                fontWeight: '600',
                textAlign: 'center',
              }}
            >
              No blocked users
            </Text>
            <Text
              style={{
                color: theme.inkSoft,
                fontSize: 13,
                lineHeight: 19,
                textAlign: 'center',
              }}
            >
              You can block someone from the options menu on any of their
              posts in the feed.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              paddingVertical: 14,
              borderBottomWidth: 1,
              borderBottomColor: theme.line,
            }}
          >
            <Text
              style={{ color: theme.ink, fontSize: 15, flexShrink: 1 }}
              numberOfLines={1}
            >
              {item.user.fullName}
            </Text>
            <TouchableOpacity
              onPress={() => confirmUnblock(item)}
              disabled={unblockUser.isPending}
              accessibilityRole="button"
              accessibilityLabel={`Unblock ${item.user.fullName}`}
              style={{ paddingVertical: 6, paddingHorizontal: 12 }}
            >
              <Text
                style={{
                  color: DESTRUCTIVE,
                  fontSize: 15,
                  fontWeight: '600',
                }}
              >
                Unblock
              </Text>
            </TouchableOpacity>
          </View>
        )}
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
        }}
        onEndReachedThreshold={0.4}
        ListFooterComponent={
          isFetchingNextPage ? (
            <ActivityIndicator style={{ marginTop: 16 }} color={theme.ink} />
          ) : null
        }
      />
    </View>
  );
}

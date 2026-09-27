import { memo, useCallback, useMemo, useRef } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { Theme } from '@/lib/design-tokens';

import type { DeepResearchRunListItem, DeepResearchRunStatus } from '../types';

/** How far the row slides to reveal Delete. */
const ACTION_WIDTH = 88;

const STATUS_LABEL: Record<DeepResearchRunStatus, string> = {
  running: 'In progress',
  completed: 'Verified',
  abstained: 'No answer',
  failed: 'Failed',
};

export function makeHistoryStyles(theme: Theme) {
  return StyleSheet.create({
    container: { borderRadius: 14, overflow: 'hidden', backgroundColor: '#dc2626' },
    deleteAction: {
      position: 'absolute',
      right: 0,
      top: 0,
      bottom: 0,
      width: ACTION_WIDTH,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
    },
    deleteText: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: '#fff' },
    row: {
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.line,
      borderRadius: 14,
      padding: 14,
      gap: 6,
    },
    question: { fontFamily: 'Inter_600SemiBold', fontSize: 15, lineHeight: 21, color: theme.ink },
    meta: { flexDirection: 'row', gap: 8, alignItems: 'center' },
    metaText: { fontFamily: 'Inter_400Regular', fontSize: 12, color: theme.inkSoft },
    badge: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 999,
      backgroundColor: theme.surfaceMuted,
    },
    badgeText: { fontFamily: 'Inter_500Medium', fontSize: 11, color: theme.inkSoft },
    skeleton: {
      height: 72,
      borderRadius: 14,
      backgroundColor: theme.surfaceMuted,
    },
  });
}

export type HistoryStyles = ReturnType<typeof makeHistoryStyles>;

function formatDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * One past run. Swipe left to reveal Delete — built on `PanResponder` +
 * `Animated` from react-native core, because react-native-gesture-handler is
 * not a dependency and adding it would need a native rebuild. A long press
 * offers the same delete, for users (and screen readers) who do not swipe.
 */
export const HistoryRow = memo(function HistoryRow({
  item,
  styles,
  onOpen,
  onDelete,
}: {
  item: DeepResearchRunListItem;
  styles: HistoryStyles;
  onOpen: (id: string) => void;
  onDelete: (item: DeepResearchRunListItem) => void;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const openRef = useRef(false);

  const snap = useCallback(
    (open: boolean) => {
      openRef.current = open;
      Animated.spring(translateX, {
        toValue: open ? -ACTION_WIDTH : 0,
        useNativeDriver: true,
        bounciness: 0,
      }).start();
    },
    [translateX],
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        // Only claim clearly horizontal drags, so the list still scrolls.
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderMove: (_e, g) => {
          const base = openRef.current ? -ACTION_WIDTH : 0;
          translateX.setValue(Math.min(0, Math.max(-ACTION_WIDTH * 1.3, base + g.dx)));
        },
        onPanResponderRelease: (_e, g) => {
          const base = openRef.current ? -ACTION_WIDTH : 0;
          snap(base + g.dx < -ACTION_WIDTH / 2);
        },
        onPanResponderTerminate: () => snap(openRef.current),
      }),
    [snap, translateX],
  );

  const handleOpen = useCallback(() => {
    if (openRef.current) {
      snap(false);
      return;
    }
    onOpen(item.id);
  }, [item.id, onOpen, snap]);

  const handleDelete = useCallback(() => {
    snap(false);
    onDelete(item);
  }, [item, onDelete, snap]);

  const animatedStyle = useMemo(() => ({ transform: [{ translateX }] }), [translateX]);

  return (
    <View style={styles.container}>
      <Pressable
        style={styles.deleteAction}
        onPress={handleDelete}
        accessibilityRole="button"
        accessibilityLabel="Delete run"
        testID={`deep-research-delete-${item.id}`}
      >
        <Ionicons name="trash-outline" size={18} color="#fff" />
        <Text style={styles.deleteText}>Delete</Text>
      </Pressable>
      <Animated.View style={animatedStyle} {...panResponder.panHandlers}>
        <Pressable
          style={styles.row}
          onPress={handleOpen}
          onLongPress={handleDelete}
          accessibilityRole="button"
          accessibilityHint="Swipe left or long press to delete"
          testID={`deep-research-run-${item.id}`}
        >
          <Text style={styles.question} numberOfLines={2}>
            {item.question}
          </Text>
          <View style={styles.meta}>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{STATUS_LABEL[item.status]}</Text>
            </View>
            <Text style={styles.metaText}>{formatDate(item.createdAt)}</Text>
          </View>
        </Pressable>
      </Animated.View>
    </View>
  );
});

export function HistorySkeleton({ styles }: { styles: HistoryStyles }) {
  return (
    <View testID="deep-research-history-skeleton">
      <View style={styles.skeleton} />
    </View>
  );
}

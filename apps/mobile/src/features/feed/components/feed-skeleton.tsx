import React from 'react';
import { View, StyleSheet } from 'react-native';

function SkeletonBox({ width, height, style }: { width: number | string; height: number; style?: object }) {
  return (
    <View style={[styles.skeleton, { width, height }, style]} />
  );
}

function PostSkeleton() {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <SkeletonBox width={36} height={36} style={styles.avatarSkeleton} />
        <View style={styles.headerText}>
          <SkeletonBox width={120} height={14} />
          <SkeletonBox width={80} height={10} style={styles.mt4} />
        </View>
      </View>
      <SkeletonBox width="100%" height={14} style={styles.mt12} />
      <SkeletonBox width="85%" height={14} style={styles.mt6} />
      <SkeletonBox width="60%" height={14} style={styles.mt6} />
      <View style={styles.actions}>
        <SkeletonBox width={60} height={24} />
        <SkeletonBox width={60} height={24} />
        <SkeletonBox width={60} height={24} />
      </View>
    </View>
  );
}

export function FeedSkeleton({ count = 3 }: { count?: number }) {
  return (
    <View style={styles.container}>
      {Array.from({ length: count }).map((_, i) => (
        <PostSkeleton key={i} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 12,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  skeleton: {
    backgroundColor: '#e5e7eb',
    borderRadius: 6,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarSkeleton: {
    borderRadius: 18,
  },
  headerText: {
    marginLeft: 10,
    flex: 1,
  },
  mt4: { marginTop: 4 },
  mt6: { marginTop: 6 },
  mt12: { marginTop: 12 },
  actions: {
    flexDirection: 'row',
    marginTop: 14,
    gap: 16,
  },
});

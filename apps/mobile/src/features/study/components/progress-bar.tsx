import { View, Text, StyleSheet } from 'react-native';

interface ProgressBarProps {
  current: number;
  total: number;
  showLabel?: boolean;
  height?: number;
  color?: string;
}

export function ProgressBar({
  current,
  total,
  showLabel = true,
  height = 6,
  color = '#1a56db',
}: ProgressBarProps) {
  const pct = total > 0 ? Math.min((current / total) * 100, 100) : 0;

  return (
    <View style={styles.container}>
      <View style={[styles.track, { height }]}>
        <View
          style={[
            styles.fill,
            { width: `${pct}%`, backgroundColor: color, height },
          ]}
        />
      </View>
      {showLabel ? (
        <Text style={styles.label}>
          {current}/{total}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  track: {
    flex: 1,
    backgroundColor: '#e5e7eb',
    borderRadius: 3,
    overflow: 'hidden',
  },
  fill: {
    borderRadius: 3,
  },
  label: {
    fontSize: 12,
    color: '#6b7280',
    fontWeight: '500',
    minWidth: 36,
    textAlign: 'right',
  },
});

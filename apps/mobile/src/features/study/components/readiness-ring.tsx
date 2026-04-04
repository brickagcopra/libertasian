import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

interface ReadinessRingProps {
  pct: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  bgColor?: string;
  label?: string;
}

export function ReadinessRing({
  pct,
  size = 80,
  strokeWidth = 8,
  color = '#4f46e5',
  bgColor = '#e0e7ff',
  label,
}: ReadinessRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (pct / 100) * circumference;

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Svg width={size} height={size} style={styles.svg}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={bgColor}
          strokeWidth={strokeWidth}
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${circumference}`}
          strokeDashoffset={strokeDashoffset}
          rotation={-90}
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <View style={styles.labelContainer}>
        <Text style={[styles.pctText, { fontSize: size * 0.22 }]}>{pct}%</Text>
        {label && (
          <Text style={[styles.labelText, { fontSize: size * 0.1 }]} numberOfLines={1}>
            {label}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  svg: {
    position: 'absolute',
  },
  labelContainer: {
    alignItems: 'center',
  },
  pctText: {
    fontWeight: '700',
    color: '#312e81',
  },
  labelText: {
    color: '#6366f1',
    marginTop: 1,
  },
});

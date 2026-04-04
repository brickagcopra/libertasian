import { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// ─── Read-Only Display ──────────────────────────────────────────────────

interface StarRatingDisplayProps {
  value: number | null;
  count?: number;
  size?: 'sm' | 'md';
}

export function StarRatingDisplay({
  value,
  count,
  size = 'sm',
}: StarRatingDisplayProps) {
  const stars = value ?? 0;
  const iconSize = size === 'sm' ? 14 : 18;

  return (
    <View style={styles.displayRow}>
      <View style={styles.starsRow}>
        {[1, 2, 3, 4, 5].map((star) => (
          <Ionicons
            key={star}
            name={star <= Math.round(stars) ? 'star' : 'star-outline'}
            size={iconSize}
            color={star <= Math.round(stars) ? '#f59e0b' : '#d1d5db'}
          />
        ))}
      </View>
      {value != null && (
        <Text style={[styles.ratingText, size === 'sm' ? styles.textSm : styles.textMd]}>
          {value.toFixed(1)}
        </Text>
      )}
      {count != null && (
        <Text style={[styles.ratingText, size === 'sm' ? styles.textSm : styles.textMd]}>
          ({count})
        </Text>
      )}
    </View>
  );
}

// ─── Interactive Input ──────────────────────────────────────────────────

interface StarRatingInputProps {
  value: number;
  onChange: (value: number) => void;
  size?: 'sm' | 'md';
}

export function StarRatingInput({
  value,
  onChange,
  size = 'md',
}: StarRatingInputProps) {
  const [tempValue, setTempValue] = useState(0);
  const iconSize = size === 'sm' ? 24 : 32;
  const activeValue = tempValue || value;

  const handlePress = useCallback(
    (star: number) => {
      onChange(star);
      setTempValue(0);
    },
    [onChange],
  );

  return (
    <View style={styles.inputRow}>
      {[1, 2, 3, 4, 5].map((star) => (
        <TouchableOpacity
          key={star}
          onPress={() => handlePress(star)}
          onPressIn={() => setTempValue(star)}
          onPressOut={() => setTempValue(0)}
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          activeOpacity={0.7}
        >
          <Ionicons
            name={star <= activeValue ? 'star' : 'star-outline'}
            size={iconSize}
            color={star <= activeValue ? '#f59e0b' : '#d1d5db'}
          />
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  displayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  starsRow: {
    flexDirection: 'row',
    gap: 1,
  },
  ratingText: {
    color: '#6b7280',
  },
  textSm: {
    fontSize: 11,
  },
  textMd: {
    fontSize: 13,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 4,
  },
});

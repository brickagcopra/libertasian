import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text } from 'react-native';

import { useTheme } from '@/providers/theme-provider';

interface SectionListenButtonProps {
  sectionId: string;
  /** Accessible label, e.g. "Listen to Article 1156". */
  label: string;
  /** True when this section is the one loaded into the screen's player. */
  isActive: boolean;
  onPlay: (sectionId: string) => void;
}

/**
 * Per-section play control. Deliberately INERT: a Pressable and nothing else.
 *
 * The Civil Code has 2,533 sections. This renders once per section, so it must
 * not call `useAudioRendition` and must not mount an `AudioPlayerBar` — 2,533
 * `expo-av` sounds is a memory problem even though none of them would fetch.
 * Tapping hands the id to the ONE screen-level player, which is the only
 * component that ever touches the audio endpoint.
 *
 * Mirrors apps/web/src/features/audio/components/section-listen-button.tsx.
 */
export function SectionListenButton({
  sectionId,
  label,
  isActive,
  onPlay,
}: SectionListenButtonProps) {
  const { theme } = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: isActive }}
      testID={`section-listen-${sectionId}`}
      onPress={() => onPlay(sectionId)}
      style={[
        styles.button,
        { borderColor: isActive ? theme.accent : theme.line, backgroundColor: theme.surface },
      ]}
    >
      <Ionicons
        name="volume-medium-outline"
        size={13}
        color={isActive ? theme.accent : theme.inkSoft}
      />
      <Text style={[styles.label, { color: isActive ? theme.accent : theme.inkSoft }]}>
        Listen
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  label: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
  },
});

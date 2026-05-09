import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, Text, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/providers/theme-provider';

export interface ListItemProps extends Omit<PressableProps, 'children' | 'style'> {
  title: string;
  subtitle?: string;
  /** Ionicons name, drawn in a small surfaceMuted tile on the left. */
  leadingIcon?: keyof typeof Ionicons.glyphMap;
  /** Custom leading node (e.g. thumbnail). Wins over leadingIcon. */
  leading?: ReactNode;
  trailing?: ReactNode;
  showChevron?: boolean;
  /** Use serif font for the title (matches design's library/list rows). */
  serifTitle?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function ListItem({
  title,
  subtitle,
  leadingIcon,
  leading,
  trailing,
  showChevron = true,
  serifTitle = false,
  style,
  ...rest
}: ListItemProps) {
  const { theme } = useTheme();

  const leadingNode =
    leading ??
    (leadingIcon ? (
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          backgroundColor: theme.surfaceMuted,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={leadingIcon} size={16} color={theme.ink} />
      </View>
    ) : null);

  return (
    <Pressable
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingVertical: 14,
          paddingHorizontal: 16,
        },
        style,
      ]}
      {...rest}
    >
      {leadingNode}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={{
            fontFamily: serifTitle ? theme.serif : 'Inter_500Medium',
            fontSize: serifTitle ? 16 : 14,
            color: theme.ink,
            letterSpacing: serifTitle ? -0.2 : 0,
          }}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            numberOfLines={1}
            style={{
              fontFamily: 'Inter_400Regular',
              fontSize: 12,
              color: theme.inkSoft,
              marginTop: 2,
            }}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing ? <View style={{ marginLeft: 4 }}>{trailing}</View> : null}
      {!trailing && showChevron ? (
        <Ionicons name="chevron-forward" size={14} color={theme.inkFaint} />
      ) : null}
    </Pressable>
  );
}

import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, Text, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/providers/theme-provider';
import { Badge } from './Badge';

export interface DrawerItemProps extends Omit<PressableProps, 'children' | 'style'> {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  trailingChip?: string;
  collapsible?: boolean;
  defaultExpanded?: boolean;
  onToggle?: (expanded: boolean) => void;
  active?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function DrawerItem({
  icon,
  label,
  trailingChip,
  collapsible = false,
  defaultExpanded = false,
  onToggle,
  active = false,
  style,
  onPress,
  ...rest
}: DrawerItemProps) {
  const { theme } = useTheme();
  const [expanded, setExpanded] = useState(defaultExpanded);

  const handlePress = (e: Parameters<NonNullable<PressableProps['onPress']>>[0]) => {
    if (collapsible) {
      const next = !expanded;
      setExpanded(next);
      onToggle?.(next);
    }
    onPress?.(e);
  };

  return (
    <Pressable
      onPress={handlePress}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderRadius: 12,
          backgroundColor: active ? theme.accentSoft : 'transparent',
        },
        style,
      ]}
      {...rest}
    >
      <Ionicons name={icon} size={20} color={active ? theme.accent : theme.inkSoft} />
      <Text
        style={{
          flex: 1,
          marginLeft: 12,
          fontFamily: 'Inter_500Medium',
          fontSize: 14,
          color: active ? theme.accent : theme.ink,
        }}
      >
        {label}
      </Text>
      {trailingChip ? (
        <View style={{ marginRight: 8 }}>
          <Badge label={trailingChip} tone="accent-soft" />
        </View>
      ) : null}
      {collapsible ? (
        <Ionicons
          name={expanded ? 'chevron-down' : 'chevron-forward'}
          size={16}
          color={theme.inkFaint}
        />
      ) : null}
    </Pressable>
  );
}

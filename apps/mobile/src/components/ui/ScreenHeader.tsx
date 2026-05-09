import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/providers/theme-provider';

export interface ScreenHeaderProps {
  title: string;
  showBack?: boolean;
  onBack?: () => void;
  rightAction?: ReactNode;
  /** Use serif font for the title. Defaults true to match design language. */
  serif?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function ScreenHeader({
  title,
  showBack = true,
  onBack,
  rightAction,
  serif = true,
  style,
}: ScreenHeaderProps) {
  const { theme } = useTheme();

  const handleBack = () => {
    if (onBack) {
      onBack();
      return;
    }
    if (router.canGoBack()) {
      router.back();
    }
  };

  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: 'transparent',
          paddingHorizontal: 16,
          paddingVertical: 12,
        },
        style,
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
        {showBack ? (
          <Pressable
            accessibilityLabel="Go back"
            onPress={handleBack}
            hitSlop={12}
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: theme.surface,
              borderWidth: 1,
              borderColor: theme.line,
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: 12,
            }}
          >
            <Ionicons name="chevron-back" size={18} color={theme.ink} />
          </Pressable>
        ) : null}
        <Text
          numberOfLines={1}
          style={{
            flex: 1,
            fontFamily: serif ? theme.serif : 'Inter_600SemiBold',
            fontSize: serif ? 28 : 20,
            color: theme.ink,
            letterSpacing: serif ? -0.6 : -0.2,
          }}
        >
          {title}
        </Text>
      </View>
      {rightAction ? <View style={{ marginLeft: 8 }}>{rightAction}</View> : null}
    </View>
  );
}

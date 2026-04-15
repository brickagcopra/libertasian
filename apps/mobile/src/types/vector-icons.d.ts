/**
 * Override @expo/vector-icons types to prevent TS2786 in pnpm monorepos
 * where @types/react 18 (mobile) and 19 (web) coexist.
 *
 * The Ionicons class component type from @expo/vector-icons is sometimes
 * resolved against the wrong @types/react version in CI, causing
 * "Property 'refs' is missing" errors. This re-declares Ionicons as a
 * function component, which is compatible with both React 18 and 19.
 */
declare module '@expo/vector-icons' {
  import type { TextStyle, OpaqueColorValue } from 'react-native';

  interface IconProps {
    name: string;
    size?: number;
    color?: string | OpaqueColorValue;
    style?: TextStyle;
    testID?: string;
    accessibilityLabel?: string;
  }

  export const Ionicons: React.FC<IconProps> & {
    glyphMap: Record<string, number>;
  };

  export const MaterialIcons: React.FC<IconProps> & {
    glyphMap: Record<string, number>;
  };

  export const MaterialCommunityIcons: React.FC<IconProps> & {
    glyphMap: Record<string, number>;
  };

  export const FontAwesome: React.FC<IconProps> & {
    glyphMap: Record<string, number>;
  };

  export const Feather: React.FC<IconProps> & {
    glyphMap: Record<string, number>;
  };
}

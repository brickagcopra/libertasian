import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/providers/theme-provider';

export type ChatRole = 'bot' | 'user';

export interface ChatMessageData {
  id: string;
  role: ChatRole;
  text: string;
}

interface ChatMessageProps {
  message: ChatMessageData;
}

/**
 * Single chat bubble — mobile port of the web `chat-message.tsx`. Bot
 * messages carry a sparkles avatar and a surface bubble; user messages sit
 * flush right on the high-contrast pill palette (pillBg/pillInk keeps text
 * at readable contrast in both themes, mirroring web's accent-deep/white).
 */
export function ChatMessage({ message }: ChatMessageProps) {
  const { theme } = useTheme();
  const isUser = message.role === 'user';

  return (
    <View style={[styles.row, isUser ? styles.rowUser : styles.rowBot]}>
      {!isUser && (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={[styles.avatar, { backgroundColor: theme.accentSoft }]}
        >
          <Ionicons name="sparkles" size={14} color={theme.ink} />
        </View>
      )}
      <View
        style={[
          styles.bubble,
          isUser
            ? { backgroundColor: theme.pillBg }
            : {
                backgroundColor: theme.surface,
                borderWidth: 1,
                borderColor: theme.line,
              },
        ]}
      >
        <Text style={[styles.text, { color: isUser ? theme.pillInk : theme.ink }]}>
          {message.text}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  rowBot: {
    justifyContent: 'flex-start',
  },
  rowUser: {
    justifyContent: 'flex-end',
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  bubble: {
    maxWidth: '78%',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  text: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 21,
  },
});

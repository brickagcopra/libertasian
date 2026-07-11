import { View } from 'react-native';
import { ChatScreen } from '@/features/chat/components/ChatScreen';
import { useTheme } from '@/providers/theme-provider';

export default function HelpRoute() {
  const { theme } = useTheme();

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ChatScreen />
    </View>
  );
}

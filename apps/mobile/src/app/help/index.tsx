import { View } from 'react-native';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ChatScreen } from '@/features/chat/components/ChatScreen';
import { useTheme } from '@/providers/theme-provider';

export default function HelpRoute() {
  const { theme } = useTheme();

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScreenHeader title="Help & FAQ" style={{ paddingTop: 60 }} />
      <ChatScreen />
    </View>
  );
}

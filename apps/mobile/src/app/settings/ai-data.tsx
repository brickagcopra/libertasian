import { ScrollView, Switch, Text, View } from 'react-native';

import { AI_DISCLOSURE_POINTS, setAiConsent, useAiConsent } from '@/features/ai-consent';
import { useTheme } from '@/providers/theme-provider';

/**
 * Settings > AI data sharing. Shows the same disclosure the consent sheet
 * shows and lets the user grant or withdraw consent (Apple 5.1.2(i)).
 */
export default function AiDataSettingsScreen() {
  const { theme } = useTheme();
  const { granted } = useAiConsent();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.bg }}
      contentContainerStyle={{ padding: 20, paddingBottom: 48 }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: theme.surface,
          borderRadius: theme.radius,
          padding: 16,
          marginBottom: 24,
        }}
      >
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={{ fontFamily: theme.sans, fontSize: 16, fontWeight: '600', color: theme.ink }}>
            Allow AI processing
          </Text>
          <Text style={{ fontFamily: theme.sans, fontSize: 13, color: theme.inkSoft, marginTop: 2 }}>
            {granted
              ? 'AI features are on.'
              : 'AI features will ask for permission before sending anything.'}
          </Text>
        </View>
        <Switch
          accessibilityLabel="Allow AI processing"
          value={granted}
          onValueChange={setAiConsent}
          trackColor={{ true: theme.accent }}
        />
      </View>

      {AI_DISCLOSURE_POINTS.map((point) => (
        <View key={point.heading} style={{ marginBottom: 18 }}>
          <Text
            style={{ fontFamily: theme.serif, fontSize: 18, color: theme.ink, marginBottom: 4 }}
          >
            {point.heading}
          </Text>
          <Text style={{ fontFamily: theme.sans, fontSize: 15, lineHeight: 22, color: theme.inkSoft }}>
            {point.body}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

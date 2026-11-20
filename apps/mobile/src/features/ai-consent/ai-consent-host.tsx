import { useSyncExternalStore } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/providers/theme-provider';

import { answerAiConsent, getAiConsentSnapshot, subscribeAiConsent } from './ai-consent';

/**
 * The disclosure every AI consent surface shows. Exported so Settings shows
 * the same words the user agreed to.
 */
export const AI_DISCLOSURE_POINTS: readonly { heading: string; body: string }[] = [
  {
    heading: 'Who receives it',
    body: 'OpenAI, a third-party AI provider, processes the content on our behalf to generate the result.',
  },
  {
    heading: 'What is sent',
    body: 'Your question or instructions, the text of any document or scan you ask the AI to work on, and the legal sources used to answer. Your name and email are not sent.',
  },
  {
    heading: 'Which features',
    body: 'AI answers and document chat, Deep Research, and AI-generated digests, memos, pleadings, hearing prep, timelines and study materials. Search, reading and the rest of the app work without it.',
  },
  {
    heading: 'How it is used',
    body: 'Only to produce your result. It is not sold or shared with advertisers, and it is not used to train AI models.',
  },
];

export function useAiConsent() {
  return useSyncExternalStore(subscribeAiConsent, getAiConsentSnapshot);
}

/** Mounted once at the app root; shows the consent sheet when a request asks. */
export function AiConsentHost() {
  const { theme } = useTheme();
  const { prompting } = useAiConsent();

  return (
    <Modal
      visible={prompting}
      animationType="slide"
      transparent
      onRequestClose={() => answerAiConsent(false)}
    >
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: theme.surface }]}>
          <ScrollView contentContainerStyle={styles.content}>
            <Text
              accessibilityRole="header"
              style={[styles.title, { color: theme.ink, fontFamily: theme.serif }]}
            >
              Allow AI processing?
            </Text>
            <Text style={[styles.lead, { color: theme.inkSoft, fontFamily: theme.sans }]}>
              To use this feature, LIBERTASIAN needs to send your content to a third-party AI
              provider.
            </Text>
            {AI_DISCLOSURE_POINTS.map((point) => (
              <View key={point.heading} style={styles.point}>
                <Text style={[styles.pointHeading, { color: theme.ink, fontFamily: theme.sans }]}>
                  {point.heading}
                </Text>
                <Text style={[styles.pointBody, { color: theme.inkSoft, fontFamily: theme.sans }]}>
                  {point.body}
                </Text>
              </View>
            ))}
            <Text style={[styles.footnote, { color: theme.inkFaint, fontFamily: theme.sans }]}>
              You can withdraw this at any time in Settings &gt; AI data sharing.
            </Text>
          </ScrollView>
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              onPress={() => answerAiConsent(true)}
              style={[styles.primary, { backgroundColor: theme.accent, borderRadius: theme.radius }]}
            >
              <Text style={[styles.primaryText, { color: theme.accentInk, fontFamily: theme.sans }]}>
                Allow
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => answerAiConsent(false)}
              style={styles.secondary}
            >
              <Text style={[styles.secondaryText, { color: theme.inkSoft, fontFamily: theme.sans }]}>
                Not now
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    maxHeight: '88%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 28,
  },
  content: { padding: 24, paddingBottom: 8 },
  title: { fontSize: 22, marginBottom: 8 },
  lead: { fontSize: 15, lineHeight: 22, marginBottom: 16 },
  point: { marginBottom: 12 },
  pointHeading: { fontSize: 14, fontWeight: '600', marginBottom: 2 },
  pointBody: { fontSize: 14, lineHeight: 20 },
  footnote: { fontSize: 13, lineHeight: 18, marginTop: 4 },
  actions: { paddingHorizontal: 24, paddingTop: 12, gap: 4 },
  primary: { paddingVertical: 14, alignItems: 'center' },
  primaryText: { fontSize: 16, fontWeight: '600' },
  secondary: { paddingVertical: 12, alignItems: 'center' },
  secondaryText: { fontSize: 15 },
});

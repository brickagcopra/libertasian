import { useSyncExternalStore } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { useTheme } from '@/providers/theme-provider';

import {
  answerCommunityAgreement,
  getCommunityAgreementSnapshot,
  subscribeCommunityAgreement,
} from './community-agreement';

/** The rules every agreement surface shows, in the words the user accepts. */
export const COMMUNITY_GUIDELINE_POINTS: readonly { heading: string; body: string }[] = [
  {
    heading: 'Zero tolerance',
    body: 'LIBERTASIAN has zero tolerance for objectionable content or abusive users. That includes harassment, hate speech, threats, sexually explicit material, spam and unlawful content.',
  },
  {
    heading: 'Enforcement',
    body: 'Objectionable content is removed, and the people who post it may be suspended or banned.',
  },
  {
    heading: 'Reporting and blocking',
    body: 'You can report any post, comment or community item, and block any user. Our moderators review reports within 24 hours.',
  },
];

export function useCommunityAgreement() {
  return useSyncExternalStore(subscribeCommunityAgreement, getCommunityAgreementSnapshot);
}

/** Mounted once at the app root; shows the agreement sheet when a submit asks. */
export function CommunityAgreementHost() {
  const { theme } = useTheme();
  const { prompting } = useCommunityAgreement();

  const openTerms = () => {
    // The sheet would sit on top of the Terms screen, so this submit is
    // cancelled; the user's draft stays put and the next submit asks again.
    answerCommunityAgreement(false);
    router.push('/purchase/terms');
  };

  return (
    <Modal
      visible={prompting}
      animationType="slide"
      transparent
      onRequestClose={() => answerCommunityAgreement(false)}
    >
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: theme.surface }]}>
          <ScrollView contentContainerStyle={styles.content}>
            <Text
              accessibilityRole="header"
              style={[styles.title, { color: theme.ink, fontFamily: theme.serif }]}
            >
              Community Guidelines
            </Text>
            <Text style={[styles.lead, { color: theme.inkSoft, fontFamily: theme.sans }]}>
              Before you post or comment for the first time, please read and agree to these rules.
            </Text>
            {COMMUNITY_GUIDELINE_POINTS.map((point) => (
              <View key={point.heading} style={styles.point}>
                <Text style={[styles.pointHeading, { color: theme.ink, fontFamily: theme.sans }]}>
                  {point.heading}
                </Text>
                <Text style={[styles.pointBody, { color: theme.inkSoft, fontFamily: theme.sans }]}>
                  {point.body}
                </Text>
              </View>
            ))}
            <Text style={[styles.footnote, { color: theme.inkSoft, fontFamily: theme.sans }]}>
              By continuing you agree to the{' '}
              <Text
                accessibilityRole="link"
                onPress={openTerms}
                style={[styles.link, { color: theme.accent }]}
              >
                Terms of Use
              </Text>{' '}
              and these Community Guidelines.
            </Text>
          </ScrollView>
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              onPress={() => answerCommunityAgreement(true)}
              style={[styles.primary, { backgroundColor: theme.accent, borderRadius: theme.radius }]}
            >
              <Text style={[styles.primaryText, { color: theme.accentInk, fontFamily: theme.sans }]}>
                I agree
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => answerCommunityAgreement(false)}
              style={styles.secondary}
            >
              <Text style={[styles.secondaryText, { color: theme.inkSoft, fontFamily: theme.sans }]}>
                Cancel
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
  link: { fontWeight: '600', textDecorationLine: 'underline' },
  actions: { paddingHorizontal: 24, paddingTop: 12, gap: 4 },
  primary: { paddingVertical: 14, alignItems: 'center' },
  primaryText: { fontSize: 16, fontWeight: '600' },
  secondary: { paddingVertical: 12, alignItems: 'center' },
  secondaryText: { fontSize: 15 },
});

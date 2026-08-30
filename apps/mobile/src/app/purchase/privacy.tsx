import { ScrollView, Text, View } from 'react-native';

import { useTheme } from '@/providers/theme-provider';

/**
 * Privacy Policy, in-app.
 *
 * Same reason as `terms.tsx`: the purchase surface must link to it, and the
 * link must not leave the app.
 *
 * The purchase-specific point worth stating plainly is the third section. The
 * server identifies a subscriber to the store conduit by ORGANIZATION ID — a
 * uuid — and never by email, which is why a store webhook payload carries no
 * personal data at all. That is a real property of the implementation, not a
 * reassurance.
 */
const SECTIONS: { heading: string; body: string }[] = [
  {
    heading: 'What we collect',
    body: 'Your name and email address for the account, the documents and notes you create, and the searches and questions you run so we can return results. Camera scans and uploads are private to your account by default.',
  },
  {
    heading: 'What we never do',
    body: 'Your documents, scans, notes and questions are never used to train models, and are never sold or shared with advertisers.',
  },
  {
    heading: 'Purchases',
    body: 'When you subscribe, the store tells us that a purchase happened and which option it was. We identify your account to the store using an opaque account identifier — never your email address — so the purchase record we receive carries no personal information. Your payment details go to the store and never reach us.',
  },
  {
    heading: 'Retention',
    body: 'Account and billing records are kept for the period required by Philippine law. You can delete your account at any time from Settings, which removes your documents, notes and scans.',
  },
  {
    heading: 'Your rights',
    body: 'Under the Philippine Data Privacy Act you may access, correct, or request deletion of your personal information, and object to its processing. Account deletion is available in-app from Settings.',
  },
  {
    heading: 'Security',
    body: 'Data is encrypted in transit and at rest. Access to production systems is limited and audited, and every change to your account is written to an append-only audit log.',
  },
];

export default function PurchasePrivacyScreen() {
  const { theme } = useTheme();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.bg }}
      contentContainerStyle={{ padding: 20, paddingBottom: 48 }}
    >
      {SECTIONS.map((section) => (
        <View key={section.heading} style={{ marginBottom: 24 }}>
          <Text
            style={{
              fontFamily: theme.serif,
              fontSize: 18,
              color: theme.ink,
              marginBottom: 6,
            }}
          >
            {section.heading}
          </Text>
          <Text
            style={{
              fontFamily: theme.sans,
              fontSize: 15,
              lineHeight: 22,
              color: theme.inkSoft,
            }}
          >
            {section.body}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

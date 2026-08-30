import { ScrollView, Text, View } from 'react-native';

import { useTheme } from '@/providers/theme-provider';

/**
 * Terms of Use, in-app.
 *
 * Guideline 3.1.2 requires a functional link to these from the purchase
 * surface. It lives here rather than behind a URL so the purchase surface
 * carries no off-app destination at all (3.1.1).
 *
 * The text below deliberately describes only what the STORE controls —
 * auto-renewal, where to cancel, what a subscription grants. It names no price
 * and no period length: both are shown on the plan card, from the store's own
 * localized offering, and repeating them in prose is how a terms screen goes
 * stale against a price change nobody remembers to mirror here.
 */
const SECTIONS: { heading: string; body: string }[] = [
  {
    heading: 'What a subscription includes',
    body: 'A subscription unlocks the full research library, unlimited search, AI-assisted answers, case digests, document scanning and the matter workspace, on every device signed in to your account.',
  },
  {
    heading: 'Automatic renewal',
    body: 'Subscriptions renew automatically at the end of each period unless auto-renew is turned off at least 24 hours beforehand. Your account is charged for renewal within 24 hours of the end of the current period, at the amount shown before you subscribed.',
  },
  {
    heading: 'Managing and cancelling',
    body: 'You can turn off auto-renew, change your option, or cancel at any time from your device account settings. Cancelling stops future renewals; access continues until the end of the period you have already paid for.',
  },
  {
    heading: 'Refunds',
    body: 'Refunds are handled by the store your purchase was made through, under its own policy. We are told about a refund after it happens and adjust your account to match.',
  },
  {
    heading: 'Restoring',
    body: 'If you reinstall the app or sign in on another device, use Restore Purchases on the plans screen to reconnect a subscription bought with the same store account.',
  },
  {
    heading: 'Acceptable use',
    body: 'LIBERTASIAN provides legal research assistance. It is not legal advice and does not create a lawyer-client relationship. Verify every authority against its official source before relying on it. Accounts are for one person; sharing credentials or redistributing generated content in bulk is not permitted.',
  },
  {
    heading: 'Changes',
    body: 'We may update these terms. Material changes take effect at the start of your next period, and you can cancel before then if you do not agree.',
  },
];

export default function PurchaseTermsScreen() {
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

import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface GatedNoticeProps {
  /** What is gated, e.g. "Model Answer". Rendered as a plain statement. */
  typeLabel: string;
}

/**
 * The single gated-content notice for the whole app.
 *
 * Every paywalled surface routes through here, which is why it is the only
 * place the wording has to be right. Apple Guideline 3.1.1 and Google Play's
 * Payments policy forbid selling digital content outside the store — and
 * equally forbid steering users to buy elsewhere. So this notice:
 *
 * - states that the content is not included, and nothing more;
 * - names no plan or tier (naming what to buy is steering);
 * - shows no price;
 * - has no button, no deep link, and no outbound URL.
 *
 * It deliberately takes no `upgradeTier` prop. The API still returns one; not
 * accepting it is what stops a future caller from quietly reintroducing
 * "available on the pro plan" here.
 */
export function GatedNotice({ typeLabel }: GatedNoticeProps) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Ionicons name="lock-closed" size={16} color="#92400e" />
        <Text style={styles.title} accessibilityRole="header">
          Not included in your plan
        </Text>
      </View>
      <Text style={styles.body}>{typeLabel} is not included in your plan.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fef3c7',
    borderColor: '#fde68a',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 14, fontWeight: '700', color: '#92400e' },
  body: { fontSize: 13, color: '#78350f', lineHeight: 19 },
});

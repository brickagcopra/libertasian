import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { Theme } from '@/lib/design-tokens';
import { useTheme } from '@/providers/theme-provider';

import { abstentionCopy } from '../../search/components/abstention-copy';
import { formatResetDate, type DeepResearchAccess } from '../access';

/**
 * The friendly, non-refusal outcomes: exhausted, AI budget spent, abstained,
 * failed, plus the quota chip. None names a tier, a price or another place to
 * pay (see `features/entitlements/no-purchase-copy.test.ts`).
 */

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    card: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      padding: 14,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.line,
      backgroundColor: theme.surface,
    },
    body: { flex: 1, gap: 4 },
    title: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: theme.ink },
    text: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, color: theme.inkSoft },
    chip: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 999,
      backgroundColor: theme.accentSoft,
    },
    chipText: { fontFamily: 'Inter_500Medium', fontSize: 12, color: theme.ink },
  });
}

function useStyles() {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  return { theme, styles };
}

interface NoticeProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  text: string;
  testID: string;
}

function Notice({ icon, title, text, testID }: NoticeProps) {
  const { theme, styles } = useStyles();
  return (
    <View style={styles.card} testID={testID}>
      <Ionicons name={icon} size={20} color={theme.accent} />
      <View style={styles.body}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.text}>{text}</Text>
      </View>
    </View>
  );
}

export function exhaustedText(resetsAt: string | null | undefined): string {
  const date = formatResetDate(resetsAt);
  return date
    ? `You've used this month's Deep Research runs. They reset on ${date}.`
    : "You've used this month's Deep Research runs. They reset at the start of next month.";
}

export function ExhaustedCard({ resetsAt }: { resetsAt: string | null | undefined }) {
  return (
    <Notice
      icon="hourglass-outline"
      title="Monthly runs used"
      text={exhaustedText(resetsAt)}
      testID="deep-research-exhausted"
    />
  );
}

export function BudgetExhaustedCard() {
  return (
    <Notice
      icon="cloud-offline-outline"
      title="Deep Research is resting"
      text="It has reached its usage limit for now. This run was not counted — please try again later."
      testID="deep-research-budget"
    />
  );
}

export function AbstainedCard({ reason }: { reason: string | null | undefined }) {
  return (
    <Notice
      icon="shield-checkmark-outline"
      title="No verified answer"
      text={`${abstentionCopy(reason)} Rather than guess, Deep Research returned nothing. This run was not counted.`}
      testID="deep-research-abstained"
    />
  );
}

export function FailedCard({ message }: { message: string }) {
  return (
    <Notice
      icon="alert-circle-outline"
      title="Something went wrong"
      text={message || 'Deep Research failed. Please try again.'}
      testID="deep-research-failed"
    />
  );
}

/** "3 of 20 left this month" / "Unlimited this month". Ready state only. */
export function QuotaChip({ access }: { access: DeepResearchAccess }) {
  const { theme, styles } = useStyles();
  if (access.kind !== 'ready') return null;
  let label: string;
  if (access.unlimited) label = 'Unlimited this month';
  else if (access.remaining !== null && access.limit !== null)
    label = `${access.remaining} of ${access.limit} left this month`;
  else return null;
  return (
    <View style={styles.chip} testID="deep-research-quota-chip">
      <Ionicons name="sparkles-outline" size={12} color={theme.accent} />
      <Text style={styles.chipText}>{label}</Text>
    </View>
  );
}

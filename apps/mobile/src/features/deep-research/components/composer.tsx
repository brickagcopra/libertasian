import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';

import type { Theme } from '@/lib/design-tokens';
import { useTheme } from '@/providers/theme-provider';

import { EntitlementRefusal } from '../../entitlements/surface-guard';
import type { DeepResearchAccess } from '../access';
import { MAX_QUESTION_LENGTH, MIN_QUESTION_LENGTH, newRunHref } from '../navigation';
import { ExhaustedCard, QuotaChip } from './status-cards';

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    card: {
      backgroundColor: theme.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.line,
      padding: 14,
      gap: 10,
    },
    title: { fontFamily: theme.serif, fontSize: 24, lineHeight: 28, color: theme.ink },
    subtitle: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19, color: theme.inkSoft },
    input: {
      minHeight: 88,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.line,
      backgroundColor: theme.bg,
      padding: 12,
      fontFamily: 'Inter_400Regular',
      fontSize: 15,
      lineHeight: 21,
      color: theme.ink,
      textAlignVertical: 'top',
    },
    footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
    hint: { fontFamily: 'Inter_400Regular', fontSize: 12, color: theme.inkFaint },
    submit: {
      paddingVertical: 11,
      paddingHorizontal: 18,
      borderRadius: theme.radius,
      backgroundColor: theme.accent,
    },
    submitText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: theme.accentInk },
    skeleton: { height: 40, borderRadius: theme.radius, backgroundColor: theme.surfaceMuted },
  });
}

/**
 * The question box at the top of the history screen.
 *
 * What sits under the input is decided by `access` BEFORE any tap: a submit
 * button only when a run can actually start, a skeleton while the quota is
 * loading, the reset date when this month's runs are spent, and the refusal
 * (purchase entry point or neutral line) when the limit is 0. There is never a
 * disabled "Research" button that fails on press.
 */
export function Composer({
  access,
  initialQuestion,
}: {
  access: DeepResearchAccess;
  initialQuestion?: string;
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [question, setQuestion] = useState(initialQuestion ?? '');

  const valid = question.trim().length >= MIN_QUESTION_LENGTH;

  const submit = useCallback(() => {
    if (!valid) return;
    router.push(newRunHref(question));
    setQuestion('');
  }, [question, valid]);

  if (access.kind === 'purchase' || access.kind === 'unavailable') {
    return <EntitlementRefusal surface="deepResearch" />;
  }

  return (
    <View style={styles.card} testID="deep-research-composer">
      <Text style={styles.title}>Deep Research</Text>
      <Text style={styles.subtitle}>
        Verified multi-source answers. Every statement is checked against a quoted source.
      </Text>

      {access.kind === 'exhausted' ? (
        <ExhaustedCard resetsAt={access.resetsAt} />
      ) : (
        <TextInput
          style={styles.input}
          value={question}
          onChangeText={setQuestion}
          placeholder="Ask a legal research question"
          placeholderTextColor={theme.inkFaint}
          multiline
          maxLength={MAX_QUESTION_LENGTH}
          testID="deep-research-input"
        />
      )}

      {access.kind === 'loading' ? (
        <View style={styles.skeleton} testID="deep-research-composer-skeleton" />
      ) : null}

      {access.kind === 'ready' ? (
        <View style={styles.footer}>
          <QuotaChip access={access} />
          {valid ? (
            <Pressable
              style={styles.submit}
              onPress={submit}
              accessibilityRole="button"
              testID="deep-research-submit"
            >
              <Text style={styles.submitText}>Research</Text>
            </Pressable>
          ) : (
            <Text style={styles.hint}>{`At least ${MIN_QUESTION_LENGTH} characters`}</Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

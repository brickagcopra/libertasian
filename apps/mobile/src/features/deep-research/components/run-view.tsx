import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import type { Theme } from '@/lib/design-tokens';
import { useTheme } from '@/providers/theme-provider';

import { EntitlementRefusal } from '../../entitlements/surface-guard';
import { buildShareText } from '../citations';
import { useDeepResearchRun } from '../hooks/use-deep-research';
import { useDeepResearchStream } from '../hooks/use-deep-research-stream';
import { newRunHref, MAX_QUESTION_LENGTH, MIN_QUESTION_LENGTH } from '../navigation';
import { fromRunDetail, type DeepResearchRunState } from '../stream-reducer';
import { RunResult } from './run-result';
import { StageStepper } from './stage-stepper';
import {
  AbstainedCard,
  BudgetExhaustedCard,
  ExhaustedCard,
  FailedCard,
} from './status-cards';

export type RunViewProps =
  | { mode: 'live'; question: string; token: string }
  | { mode: 'past'; id: string };

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.bg },
    content: { padding: 16, gap: 14, paddingBottom: 48 },
    question: { fontFamily: theme.serif, fontSize: 24, lineHeight: 30, color: theme.ink },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
    muted: { fontFamily: 'Inter_400Regular', fontSize: 14, color: theme.inkSoft, textAlign: 'center' },
    actions: { flexDirection: 'row', gap: 10 },
    action: {
      flex: 1,
      flexDirection: 'row',
      gap: 6,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 12,
      borderRadius: theme.radius,
      borderWidth: 1,
      borderColor: theme.line,
      backgroundColor: theme.surface,
    },
    actionText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: theme.ink },
    followUp: {
      backgroundColor: theme.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.line,
      padding: 12,
      gap: 10,
    },
    input: {
      minHeight: 64,
      fontFamily: 'Inter_400Regular',
      fontSize: 15,
      color: theme.ink,
      textAlignVertical: 'top',
    },
    primary: {
      alignItems: 'center',
      paddingVertical: 12,
      borderRadius: theme.radius,
      backgroundColor: theme.accent,
    },
    primaryText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: theme.accentInk },
    link: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: theme.accent },
  });
}

type Styles = ReturnType<typeof makeStyles>;

/** The follow-up question, carrying the original so the planner has context. */
export function composeFollowUp(original: string, followUp: string): string {
  const text = `Follow-up to "${original.trim()}": ${followUp.trim()}`;
  return text.length > MAX_QUESTION_LENGTH ? text.slice(0, MAX_QUESTION_LENGTH) : text;
}

function RunBody({
  question,
  state,
  styles,
  theme,
}: {
  question: string;
  state: DeepResearchRunState;
  styles: Styles;
  theme: Theme;
}) {
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [followUp, setFollowUp] = useState('');

  const result = state.result;
  const answered = state.phase === 'done' && result !== null && !result.abstained;

  const handleShare = useCallback(() => {
    if (!result) return;
    void Share.share({ message: buildShareText(question, result, state.sources) }).catch(() => undefined);
  }, [question, result, state.sources]);

  const toggleFollowUp = useCallback(() => setFollowUpOpen((v) => !v), []);

  const submitFollowUp = useCallback(() => {
    if (followUp.trim().length < MIN_QUESTION_LENGTH) return;
    router.push(newRunHref(composeFollowUp(question, followUp)));
    setFollowUp('');
    setFollowUpOpen(false);
  }, [followUp, question]);

  const error = state.error;

  return (
    <>
      <Text style={styles.question} testID="deep-research-question">
        {question}
      </Text>

      <StageStepper state={state} />

      {error?.code === 'quota_exceeded' ? <ExhaustedCard resetsAt={error.resetAt ?? null} /> : null}
      {error?.code === 'subscription_required' ? <EntitlementRefusal surface="deepResearch" /> : null}
      {error?.code === 'budget_exhausted' ? <BudgetExhaustedCard /> : null}
      {error?.code === 'internal' ? <FailedCard message={error.message} /> : null}

      {result?.abstained ? <AbstainedCard reason={result.abstainReason} /> : null}
      {result && !result.abstained ? <RunResult result={result} sources={state.sources} /> : null}

      {answered ? (
        <View style={styles.actions}>
          <Pressable
            style={styles.action}
            onPress={handleShare}
            accessibilityRole="button"
            testID="deep-research-share"
          >
            <Ionicons name="share-outline" size={16} color={theme.ink} />
            <Text style={styles.actionText}>Share</Text>
          </Pressable>
          <Pressable
            style={styles.action}
            onPress={toggleFollowUp}
            accessibilityRole="button"
            testID="deep-research-follow-up"
          >
            <Ionicons name="return-down-forward-outline" size={16} color={theme.ink} />
            <Text style={styles.actionText}>Follow-up</Text>
          </Pressable>
        </View>
      ) : null}

      {answered && followUpOpen ? (
        <View style={styles.followUp}>
          <TextInput
            style={styles.input}
            value={followUp}
            onChangeText={setFollowUp}
            placeholder="Ask a follow-up question"
            placeholderTextColor={theme.inkFaint}
            multiline
            maxLength={MAX_QUESTION_LENGTH}
            autoFocus
            testID="deep-research-follow-up-input"
          />
          {followUp.trim().length >= MIN_QUESTION_LENGTH ? (
            <Pressable
              style={styles.primary}
              onPress={submitFollowUp}
              accessibilityRole="button"
              testID="deep-research-follow-up-submit"
            >
              <Text style={styles.primaryText}>Research follow-up</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </>
  );
}

function LiveRun({ question, token, styles, theme }: { question: string; token: string; styles: Styles; theme: Theme }) {
  const { state, alreadyStarted } = useDeepResearchStream(question, token);
  const goHistory = useCallback(() => router.replace('/research'), []);

  if (alreadyStarted) {
    return (
      <View style={styles.center} testID="deep-research-already-started">
        <Text style={styles.muted}>This run was already started. It will appear in your history.</Text>
        <Pressable onPress={goHistory} accessibilityRole="button">
          <Text style={styles.link}>Go to history</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <RunBody question={question} state={state} styles={styles} theme={theme} />
    </ScrollView>
  );
}

function PastRun({ id, styles, theme }: { id: string; styles: Styles; theme: Theme }) {
  const { data, isLoading, isError, refetch } = useDeepResearchRun(id);
  const state = useMemo(() => (data ? fromRunDetail(data) : null), [data]);
  const retry = useCallback(() => void refetch(), [refetch]);

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }
  if (isError || !data || !state) {
    return (
      <View style={styles.center} testID="deep-research-load-error">
        <Text style={styles.muted}>This run could not be loaded.</Text>
        <Pressable onPress={retry} accessibilityRole="button">
          <Text style={styles.link}>Try again</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <RunBody question={data.question} state={state} styles={styles} theme={theme} />
    </ScrollView>
  );
}

/**
 * One Deep Research run. Default export so the route can `React.lazy` it: the
 * stepper, result renderer and citation sheet load only when a run is opened.
 */
export default function RunView(props: RunViewProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  if (props.mode === 'live') {
    return <LiveRun question={props.question} token={props.token} styles={styles} theme={theme} />;
  }
  return <PastRun id={props.id} styles={styles} theme={theme} />;
}

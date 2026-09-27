import { memo, useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { Theme } from '@/lib/design-tokens';
import { useTheme } from '@/providers/theme-provider';

import { stepStatuses, type DeepResearchRunState, type StepStatus } from '../stream-reducer';
import { DEEP_RESEARCH_STAGES, type DeepResearchStage } from '../types';

const STAGE_LABELS: Record<DeepResearchStage, string> = {
  planning: 'Planning',
  searching: 'Searching',
  ranking: 'Ranking',
  writing: 'Writing',
  verifying: 'Verifying',
};

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    wrap: {
      backgroundColor: theme.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.line,
      padding: 12,
      gap: 10,
    },
    row: { flexDirection: 'row', justifyContent: 'space-between' },
    step: { alignItems: 'center', flex: 1, gap: 4 },
    dot: {
      width: 22,
      height: 22,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
    },
    dotPending: { borderColor: theme.line, backgroundColor: theme.surfaceMuted },
    dotActive: { borderColor: theme.accent, backgroundColor: theme.accentSoft },
    dotComplete: { borderColor: theme.accent, backgroundColor: theme.accent },
    dotFailed: { borderColor: '#dc2626', backgroundColor: '#fef2f2' },
    label: { fontFamily: 'Inter_500Medium', fontSize: 11, color: theme.inkFaint },
    labelActive: { color: theme.ink },
    detail: { fontFamily: 'Inter_400Regular', fontSize: 12, color: theme.inkSoft },
    subQueries: { gap: 4 },
    subQueriesTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: theme.inkSoft },
    subQuery: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, color: theme.ink },
  });
}

type Styles = ReturnType<typeof makeStyles>;

const DOT_STYLE: Record<StepStatus, 'dotPending' | 'dotActive' | 'dotComplete' | 'dotFailed'> = {
  pending: 'dotPending',
  active: 'dotActive',
  complete: 'dotComplete',
  failed: 'dotFailed',
};

const Step = memo(function Step({
  stage,
  status,
  styles,
  theme,
}: {
  stage: DeepResearchStage;
  status: StepStatus;
  styles: Styles;
  theme: Theme;
}) {
  return (
    <View
      style={styles.step}
      testID={`stage-${stage}`}
      accessibilityLabel={`${STAGE_LABELS[stage]}: ${status}`}
    >
      <View style={[styles.dot, styles[DOT_STYLE[status]]]}>
        {status === 'complete' ? (
          <Ionicons name="checkmark" size={13} color={theme.accentInk} />
        ) : status === 'active' ? (
          <ActivityIndicator size="small" color={theme.accent} />
        ) : status === 'failed' ? (
          <Ionicons name="close" size={13} color="#dc2626" />
        ) : null}
      </View>
      <Text style={[styles.label, status !== 'pending' && styles.labelActive]}>
        {STAGE_LABELS[stage]}
      </Text>
    </View>
  );
});

/**
 * Planning → Searching → Ranking → Writing → Verifying, with the planner's
 * sub-queries underneath once `plan` arrives.
 */
export function StageStepper({ state }: { state: DeepResearchRunState }) {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const statuses = useMemo(() => stepStatuses(state), [state]);

  return (
    <View style={styles.wrap} testID="deep-research-stepper">
      <View style={styles.row}>
        {DEEP_RESEARCH_STAGES.map((stage) => (
          <Step key={stage} stage={stage} status={statuses[stage]} styles={styles} theme={theme} />
        ))}
      </View>
      {state.phase === 'streaming' && state.stageDetail ? (
        <Text style={styles.detail}>{state.stageDetail}</Text>
      ) : null}
      {state.subQueries.length > 0 ? (
        <View style={styles.subQueries} testID="deep-research-subqueries">
          <Text style={styles.subQueriesTitle}>Researching</Text>
          {state.subQueries.map((q, i) => (
            <Text key={`${i}:${q}`} style={styles.subQuery}>
              {`${i + 1}. ${q}`}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

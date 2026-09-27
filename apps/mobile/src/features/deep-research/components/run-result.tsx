import { memo, useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Theme } from '@/lib/design-tokens';
import { useTheme } from '@/providers/theme-provider';

import { ContentDisclaimer } from '../../documents/components/content-disclaimer';
import { buildSourceIndex, sourceMetaLine } from '../citations';
import type { DeepResearchClaim, DeepResearchResult, DeepResearchSource } from '../types';
import { CitationSheet, type OpenCitation } from './citation-sheet';

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    wrap: { gap: 14 },
    summaryCard: {
      backgroundColor: theme.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.line,
      padding: 14,
    },
    eyebrow: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 11,
      letterSpacing: 1,
      textTransform: 'uppercase',
      color: theme.inkFaint,
      marginBottom: 6,
    },
    summary: { fontFamily: theme.serif, fontSize: 17, lineHeight: 25, color: theme.ink },
    section: { gap: 8 },
    heading: { fontFamily: theme.serif, fontSize: 20, lineHeight: 26, color: theme.ink },
    claim: { flexDirection: 'row', gap: 8 },
    bullet: { fontFamily: 'Inter_700Bold', fontSize: 15, color: theme.accent, lineHeight: 22 },
    claimBody: { flex: 1 },
    claimText: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 22, color: theme.ink },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
    chip: {
      minWidth: 26,
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: 8,
      backgroundColor: theme.accentSoft,
      alignItems: 'center',
    },
    chipText: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: theme.ink },
    removed: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      lineHeight: 19,
      color: theme.inkSoft,
      fontStyle: 'italic',
    },
    sourcesCard: {
      backgroundColor: theme.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.line,
      padding: 14,
      gap: 10,
    },
    sourcesTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: theme.ink },
    sourceRow: { flexDirection: 'row', gap: 8 },
    sourceNum: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: theme.accent, width: 24 },
    sourceBody: { flex: 1 },
    sourceTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: theme.ink },
    sourceMeta: { fontFamily: 'Inter_400Regular', fontSize: 12, color: theme.inkSoft, marginTop: 2 },
  });
}

type Styles = ReturnType<typeof makeStyles>;

interface ChipRef {
  number: number;
  sourceId: string;
  quote: string;
}

/** The claim's citations as unique numbered chips, first quote per source. */
function claimChips(claim: DeepResearchClaim, index: Map<string, number>): ChipRef[] {
  const seen = new Set<number>();
  const out: ChipRef[] = [];
  for (const c of claim.citations) {
    const n = index.get(c.sourceId);
    if (n === undefined || seen.has(n)) continue;
    seen.add(n);
    out.push({ number: n, sourceId: c.sourceId, quote: c.quote });
  }
  return out.sort((a, b) => a.number - b.number);
}

const CitationChip = memo(function CitationChip({
  chip,
  styles,
  onPress,
}: {
  chip: ChipRef;
  styles: Styles;
  onPress: (chip: ChipRef) => void;
}) {
  const handlePress = useCallback(() => onPress(chip), [chip, onPress]);
  return (
    <Pressable
      style={styles.chip}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`Source ${chip.number}`}
      testID={`citation-chip-${chip.number}`}
      hitSlop={6}
    >
      <Text style={styles.chipText}>{chip.number}</Text>
    </Pressable>
  );
});

const Claim = memo(function Claim({
  claim,
  index,
  styles,
  onChip,
}: {
  claim: DeepResearchClaim;
  index: Map<string, number>;
  styles: Styles;
  onChip: (chip: ChipRef) => void;
}) {
  const chips = useMemo(() => claimChips(claim, index), [claim, index]);
  return (
    <View style={styles.claim}>
      <Text style={styles.bullet}>•</Text>
      <View style={styles.claimBody}>
        <Text style={styles.claimText}>{claim.text}</Text>
        {chips.length > 0 ? (
          <View style={styles.chips}>
            {chips.map((chip) => (
              <CitationChip key={chip.number} chip={chip} styles={styles} onPress={onChip} />
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
});

/**
 * The verified answer: summary, sections of claims with numbered citation
 * chips, the removed-statements note, the Sources list and the AI disclaimer.
 */
export function RunResult({
  result,
  sources,
}: {
  result: DeepResearchResult;
  sources: DeepResearchSource[];
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const index = useMemo(() => buildSourceIndex(sources), [sources]);
  const bySourceId = useMemo(() => new Map(sources.map((s) => [s.sourceId, s])), [sources]);
  const [open, setOpen] = useState<OpenCitation | null>(null);

  const handleChip = useCallback(
    (chip: ChipRef) => {
      const source = bySourceId.get(chip.sourceId);
      if (source) setOpen({ number: chip.number, source, quote: chip.quote });
    },
    [bySourceId],
  );
  const handleClose = useCallback(() => setOpen(null), []);

  const removed = result.removedClaims;

  return (
    <View style={styles.wrap} testID="deep-research-result">
      <View style={styles.summaryCard}>
        <Text style={styles.eyebrow}>Summary</Text>
        <Text style={styles.summary}>{result.summary}</Text>
      </View>

      {result.sections.map((section, si) => (
        <View key={`${si}:${section.heading}`} style={styles.section}>
          <Text style={styles.heading}>{section.heading}</Text>
          {section.claims.map((claim, ci) => (
            <Claim
              key={`${si}:${ci}`}
              claim={claim}
              index={index}
              styles={styles}
              onChip={handleChip}
            />
          ))}
        </View>
      ))}

      {removed > 0 ? (
        <Text style={styles.removed} testID="deep-research-removed">
          {removed === 1
            ? '1 unsupported statement removed during verification.'
            : `${removed} unsupported statements removed during verification.`}
        </Text>
      ) : null}

      {sources.length > 0 ? (
        <View style={styles.sourcesCard} testID="deep-research-sources">
          <Text style={styles.sourcesTitle}>{`Sources (${sources.length})`}</Text>
          {sources.map((source, i) => {
            const meta = sourceMetaLine(source);
            return (
              <View key={source.sourceId} style={styles.sourceRow}>
                <Text style={styles.sourceNum}>{`${i + 1}.`}</Text>
                <View style={styles.sourceBody}>
                  <Text style={styles.sourceTitle} numberOfLines={2}>
                    {source.title || 'Untitled source'}
                  </Text>
                  {meta ? <Text style={styles.sourceMeta}>{meta}</Text> : null}
                </View>
              </View>
            );
          })}
        </View>
      ) : null}

      <ContentDisclaimer contentClass="ai_generated" />

      <CitationSheet citation={open} onClose={handleClose} />
    </View>
  );
}

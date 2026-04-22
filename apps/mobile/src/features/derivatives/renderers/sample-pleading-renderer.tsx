import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { DerivativeDetail } from '../types';
import { GatedNotice } from './gated-notice';
import { Unavailable } from './unavailable';

interface PleadingCaption {
  court?: string;
  caseTitle?: string;
  caseNumber?: string;
}

interface PleadingParties {
  plaintiff?: string;
  defendant?: string;
  counsel?: string;
}

interface PleadingSection {
  heading?: string;
  paragraphs?: string[];
}

interface SamplePleadingContent {
  pleadingType?: string;
  caption?: PleadingCaption;
  parties?: PleadingParties;
  preamble?: string;
  sections?: PleadingSection[];
  prayer?: string;
  verification?: string;
  proofOfService?: string;
}

function asPleading(value: unknown): SamplePleadingContent | null {
  if (!value || typeof value !== 'object') return null;
  return value as SamplePleadingContent;
}

function captionIsEmpty(c: PleadingCaption | undefined): boolean {
  if (!c) return true;
  return !c.court?.trim() && !c.caseTitle?.trim() && !c.caseNumber?.trim();
}

export function SamplePleadingRenderer({ data }: { data: DerivativeDetail }) {
  const content = asPleading(data.contentJson);
  if (!content) return <Unavailable />;

  const hasPleadingType = Boolean(content.pleadingType?.trim());
  if (!hasPleadingType && captionIsEmpty(content.caption)) return <Unavailable />;

  const caption = content.caption ?? {};
  const parties = content.parties ?? {};
  const sections = (content.sections ?? []).filter(
    (s) => s && (s.heading?.trim() || (s.paragraphs ?? []).some((p) => p?.trim())),
  );

  const hasPartyInfo =
    Boolean(parties.plaintiff?.trim()) ||
    Boolean(parties.defendant?.trim()) ||
    Boolean(parties.counsel?.trim());

  const hasVerification =
    Boolean(content.verification?.trim()) || Boolean(content.proofOfService?.trim());

  return (
    <View style={styles.article}>
      {content.pleadingType?.trim() ? (
        <Text style={styles.pleadingType}>{content.pleadingType}</Text>
      ) : null}

      <View style={styles.captionBlock}>
        {caption.court?.trim() ? (
          <Text style={styles.captionCourt}>{caption.court}</Text>
        ) : null}
        {caption.caseTitle?.trim() ? (
          <Text style={styles.captionLine}>{caption.caseTitle}</Text>
        ) : null}
        {caption.caseNumber?.trim() ? (
          <Text style={styles.captionLine}>{caption.caseNumber}</Text>
        ) : null}
      </View>

      {data.isGated ? (
        <GatedNotice typeLabel="Sample pleading" upgradeTier={data.upgradeTier} />
      ) : (
        <>
          {hasPartyInfo ? (
            <View style={styles.section}>
              <Text style={styles.headingH3} accessibilityRole="header">
                Parties
              </Text>
              <View style={styles.partiesList}>
                {parties.plaintiff?.trim() ? (
                  <View style={styles.partyRow}>
                    <Text style={styles.partyLabel}>Plaintiff / Petitioner</Text>
                    <Text style={styles.partyValue}>{parties.plaintiff}</Text>
                  </View>
                ) : null}
                {parties.defendant?.trim() ? (
                  <View style={styles.partyRow}>
                    <Text style={styles.partyLabel}>Defendant / Respondent</Text>
                    <Text style={styles.partyValue}>{parties.defendant}</Text>
                  </View>
                ) : null}
                {parties.counsel?.trim() ? (
                  <View style={styles.partyRow}>
                    <Text style={styles.partyLabel}>Counsel</Text>
                    <Text style={styles.partyValue}>{parties.counsel}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          ) : null}

          {content.preamble?.trim() ? (
            <Text style={styles.para}>{content.preamble}</Text>
          ) : null}

          {sections.length > 0 ? (
            <View style={styles.orderedList}>
              {sections.map((sec, i) => (
                <View key={`sec-${i}`} style={styles.orderedRow}>
                  <Text style={styles.orderedIndex}>{`${i + 1}.`}</Text>
                  <View style={styles.orderedBody}>
                    {sec.heading?.trim() ? (
                      <Text style={styles.headingH4} accessibilityRole="header">
                        {sec.heading}
                      </Text>
                    ) : null}
                    {(sec.paragraphs ?? []).map((p, j) => (
                      <Text key={`p-${i}-${j}`} style={styles.para}>
                        {p}
                      </Text>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          {content.prayer?.trim() ? (
            <View style={styles.section}>
              <Text style={styles.headingH3} accessibilityRole="header">
                Prayer
              </Text>
              <Text style={styles.para}>{content.prayer}</Text>
            </View>
          ) : null}

          {hasVerification ? (
            <VerificationBlock
              verification={content.verification}
              proofOfService={content.proofOfService}
            />
          ) : null}
        </>
      )}
    </View>
  );
}

function VerificationBlock({
  verification,
  proofOfService,
}: {
  verification?: string;
  proofOfService?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.details}>
      <Pressable
        style={({ pressed }) => [styles.detailsSummary, pressed && styles.detailsSummaryPressed]}
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={open ? 'Hide verification and proof of service' : 'Show verification and proof of service'}
      >
        <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={14} color="#374151" />
        <Text style={styles.detailsSummaryText}>Verification & Proof of Service</Text>
      </Pressable>
      {open ? (
        <View style={styles.detailsBody}>
          {verification?.trim() ? (
            <View style={styles.detailsSection}>
              <Text style={styles.headingH4} accessibilityRole="header">
                Verification
              </Text>
              <Text style={styles.para}>{verification}</Text>
            </View>
          ) : null}
          {proofOfService?.trim() ? (
            <View style={styles.detailsSection}>
              <Text style={styles.headingH4} accessibilityRole="header">
                Proof of Service
              </Text>
              <Text style={styles.para}>{proofOfService}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  article: { gap: 16 },
  section: { gap: 8 },
  pleadingType: {
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    color: '#6b7280',
    textTransform: 'uppercase',
  },
  captionBlock: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#f9fafb',
    borderRadius: 8,
    padding: 14,
    gap: 8,
  },
  captionCourt: {
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '700',
    color: '#111827',
    textTransform: 'uppercase',
  },
  captionLine: {
    textAlign: 'center',
    fontSize: 12,
    color: '#1f2937',
  },
  headingH3: { fontSize: 17, fontWeight: '700', color: '#111827' },
  headingH4: { fontSize: 15, fontWeight: '600', color: '#111827' },
  para: { fontSize: 14, color: '#1f2937', lineHeight: 21 },
  partiesList: { gap: 6 },
  partyRow: { flexDirection: 'row', gap: 12 },
  partyLabel: { fontSize: 13, fontWeight: '600', color: '#374151', minWidth: 140 },
  partyValue: { flex: 1, fontSize: 13, color: '#1f2937' },
  orderedList: { gap: 12 },
  orderedRow: { flexDirection: 'row', gap: 8 },
  orderedIndex: { fontSize: 14, color: '#6b7280', lineHeight: 21, minWidth: 24 },
  orderedBody: { flex: 1, gap: 6 },
  details: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    padding: 12,
    gap: 10,
  },
  detailsSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  detailsSummaryPressed: { opacity: 0.7 },
  detailsSummaryText: { fontSize: 13, fontWeight: '600', color: '#111827' },
  detailsBody: { gap: 10 },
  detailsSection: { gap: 4 },
});

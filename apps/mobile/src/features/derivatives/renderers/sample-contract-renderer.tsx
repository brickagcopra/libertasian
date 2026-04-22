import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { DerivativeDetail } from '../types';
import { GatedNotice } from './gated-notice';
import { Unavailable } from './unavailable';

interface ContractParty {
  role?: string;
  name?: string;
  address?: string;
}

interface ContractSubclause {
  heading?: string;
  text?: string;
}

interface ContractClause {
  heading?: string;
  text?: string;
  subclauses?: ContractSubclause[];
}

interface ContractSchedule {
  heading?: string;
  text?: string;
}

interface ContractSignatureBlock {
  role?: string;
  name?: string;
}

interface SampleContractContent {
  contractType?: string;
  parties?: ContractParty[];
  recitals?: string[];
  clauses?: ContractClause[];
  schedules?: ContractSchedule[];
  signatureBlocks?: ContractSignatureBlock[];
}

function asContract(value: unknown): SampleContractContent | null {
  if (!value || typeof value !== 'object') return null;
  return value as SampleContractContent;
}

const LOWER_ALPHA = 'abcdefghijklmnopqrstuvwxyz';

function subIndex(i: number): string {
  if (i < LOWER_ALPHA.length) return `${LOWER_ALPHA[i]}.`;
  return `${i + 1}.`;
}

export function SampleContractRenderer({ data }: { data: DerivativeDetail }) {
  const content = asContract(data.contentJson);
  if (!content) return <Unavailable />;

  const contractType = content.contractType?.trim() ?? '';
  if (!contractType) return <Unavailable />;

  const parties = (content.parties ?? []).filter(
    (p) => p && (p.role?.trim() || p.name?.trim() || p.address?.trim()),
  );
  const recitals = (content.recitals ?? []).filter((r) => r?.trim());
  const clauses = (content.clauses ?? []).filter(
    (c) => c && (c.heading?.trim() || c.text?.trim() || (c.subclauses ?? []).length > 0),
  );
  const schedules = (content.schedules ?? []).filter(
    (s) => s && (s.heading?.trim() || s.text?.trim()),
  );
  const signatures = (content.signatureBlocks ?? []).filter(
    (s) => s && (s.role?.trim() || s.name?.trim()),
  );

  return (
    <View style={styles.article}>
      <Text style={styles.title} accessibilityRole="header">
        {contractType}
      </Text>

      {parties.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.headingH4} accessibilityRole="header">
            Parties
          </Text>
          <View style={styles.partyList}>
            {parties.map((p, i) => (
              <View key={`party-${i}`} style={styles.partyRow}>
                <Text style={styles.partyRole}>{p.role ?? '—'}</Text>
                <Text style={styles.partyName}>{p.name ?? '—'}</Text>
                {p.address?.trim() ? (
                  <Text style={styles.partyAddress}>{p.address}</Text>
                ) : null}
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {data.isGated ? (
        <GatedNotice typeLabel="Sample contract" upgradeTier={data.upgradeTier} />
      ) : (
        <>
          {recitals.length > 0 ? (
            <View style={styles.recitalsBox}>
              <Text style={styles.recitalsLabel}>Recitals</Text>
              {recitals.map((r, i) => (
                <Text key={`rec-${i}`} style={styles.para}>
                  <Text style={styles.whereas}>WHEREAS,</Text>
                  {` ${r}`}
                </Text>
              ))}
            </View>
          ) : null}

          {clauses.length > 0 ? (
            <View style={styles.orderedList}>
              {clauses.map((c, i) => (
                <View key={`clause-${i}`} style={styles.orderedRow}>
                  <Text style={styles.orderedIndex}>{`${i + 1}.`}</Text>
                  <View style={styles.orderedBody}>
                    {c.heading?.trim() ? (
                      <Text style={styles.headingH4} accessibilityRole="header">
                        {c.heading}
                      </Text>
                    ) : null}
                    {c.text?.trim() ? <Text style={styles.para}>{c.text}</Text> : null}
                    {(c.subclauses ?? []).length > 0 ? (
                      <View style={styles.subList}>
                        {(c.subclauses ?? []).map((sub, j) => (
                          <View key={`sub-${i}-${j}`} style={styles.subRow}>
                            <Text style={styles.subIndex}>{subIndex(j)}</Text>
                            <Text style={styles.subText}>
                              {sub.heading?.trim() ? (
                                <Text style={styles.subHeading}>{`${sub.heading}. `}</Text>
                              ) : null}
                              {sub.text?.trim() ?? ''}
                            </Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          {schedules.length > 0 ? (
            <View style={styles.scheduleList}>
              {schedules.map((s, i) => (
                <ScheduleBlock key={`sched-${i}`} schedule={s} index={i} />
              ))}
            </View>
          ) : null}

          {signatures.length > 0 ? (
            <View style={styles.signatureGrid}>
              {signatures.map((s, i) => (
                <View key={`sig-${i}`} style={styles.signatureCell}>
                  <Text style={styles.signatureName}>
                    {s.name ?? '______________________'}
                  </Text>
                  {s.role?.trim() ? (
                    <Text style={styles.signatureRole}>{s.role}</Text>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

function ScheduleBlock({ schedule, index }: { schedule: ContractSchedule; index: number }) {
  const [open, setOpen] = useState(false);
  const heading = schedule.heading?.trim() ? schedule.heading : `Schedule ${index + 1}`;
  return (
    <View style={styles.scheduleCard}>
      <Pressable
        style={({ pressed }) => [styles.scheduleHeader, pressed && styles.scheduleHeaderPressed]}
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={open ? `Hide ${heading}` : `Show ${heading}`}
      >
        <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={14} color="#374151" />
        <Text style={styles.scheduleHeading}>{heading}</Text>
      </Pressable>
      {open && schedule.text?.trim() ? (
        <Text style={styles.scheduleBody}>{schedule.text}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  article: { gap: 16 },
  section: { gap: 8 },
  title: {
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  headingH4: { fontSize: 15, fontWeight: '600', color: '#111827' },
  para: { fontSize: 14, color: '#1f2937', lineHeight: 21 },
  partyList: { gap: 8 },
  partyRow: {
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    paddingBottom: 8,
    gap: 2,
  },
  partyRole: { fontSize: 13, fontWeight: '600', color: '#111827' },
  partyName: { fontSize: 13, color: '#1f2937' },
  partyAddress: { fontSize: 12, color: '#6b7280' },
  recitalsBox: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#f9fafb',
    borderRadius: 8,
    padding: 12,
    gap: 8,
  },
  recitalsLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    color: '#6b7280',
    textTransform: 'uppercase',
  },
  whereas: { fontWeight: '700' },
  orderedList: { gap: 12 },
  orderedRow: { flexDirection: 'row', gap: 8 },
  orderedIndex: { fontSize: 14, color: '#6b7280', lineHeight: 21, minWidth: 24 },
  orderedBody: { flex: 1, gap: 6 },
  subList: { gap: 6, marginTop: 4, paddingLeft: 4 },
  subRow: { flexDirection: 'row', gap: 6 },
  subIndex: { fontSize: 13, color: '#6b7280', lineHeight: 20, minWidth: 20 },
  subText: { flex: 1, fontSize: 13, color: '#1f2937', lineHeight: 20 },
  subHeading: { fontWeight: '700' },
  scheduleList: { gap: 6 },
  scheduleCard: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    padding: 10,
    gap: 8,
  },
  scheduleHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  scheduleHeaderPressed: { opacity: 0.7 },
  scheduleHeading: { fontSize: 13, fontWeight: '600', color: '#111827' },
  scheduleBody: { fontSize: 13, color: '#1f2937', lineHeight: 20, paddingLeft: 20 },
  signatureGrid: { gap: 12, marginTop: 12 },
  signatureCell: {
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    paddingTop: 6,
  },
  signatureName: { fontSize: 13, fontWeight: '600', color: '#111827' },
  signatureRole: { fontSize: 12, color: '#6b7280' },
});

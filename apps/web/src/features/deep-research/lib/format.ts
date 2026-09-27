import type {
  DeepResearchResult,
  DeepResearchSource,
} from '../schemas';

/** Statutory / constitutional document types — shown first in "Sources". */
const PRIMARY_LAW_TYPES = new Set([
  'constitution',
  'codal',
  'statute',
  'republic_act',
  'commonwealth_act',
  'batas_pambansa',
  'executive_order',
  'presidential_decree',
  'proclamation',
  'administrative_order',
  'rules_of_court',
  'rule',
]);

export type SourceGroupKey = 'law' | 'sc' | 'other';

export const SOURCE_GROUP_LABELS: Record<SourceGroupKey, string> = {
  law: 'Constitution & Statutes',
  sc: 'Supreme Court decisions',
  other: 'Others',
};

export function sourceGroup(source: DeepResearchSource): SourceGroupKey {
  const type = (source.documentType ?? '').toLowerCase();
  if (PRIMARY_LAW_TYPES.has(type)) return 'law';
  const court = (source.court ?? '').toLowerCase().replace(/_/g, ' ');
  if (court.includes('supreme')) return 'sc';
  return 'other';
}

/**
 * Stable 1-based chip numbers: the order of the `sources` event. The server
 * labels are `S1…Sn` in that same order, but the number is derived from the
 * position so an unexpected label still gets a chip.
 */
export function numberSources(sources: DeepResearchSource[]): Map<string, number> {
  const numbers = new Map<string, number>();
  sources.forEach((s, i) => {
    if (!numbers.has(s.sourceId)) numbers.set(s.sourceId, i + 1);
  });
  return numbers;
}

/** Sources the answer actually cites, in chip-number order. */
export function citedSources(
  result: DeepResearchResult,
  sources: DeepResearchSource[],
): DeepResearchSource[] {
  const cited = new Set<string>();
  for (const section of result.sections) {
    for (const claim of section.claims) {
      for (const c of claim.citations) cited.add(c.sourceId);
    }
  }
  return sources.filter((s) => cited.has(s.sourceId));
}

export function groupSources(
  sources: DeepResearchSource[],
): { key: SourceGroupKey; label: string; sources: DeepResearchSource[] }[] {
  const order: SourceGroupKey[] = ['law', 'sc', 'other'];
  return order
    .map((key) => ({
      key,
      label: SOURCE_GROUP_LABELS[key],
      sources: sources.filter((s) => sourceGroup(s) === key),
    }))
    .filter((g) => g.sources.length > 0);
}

export function formatSourceDate(date: string | null | undefined): string | null {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function formatCourt(court: string | null | undefined): string | null {
  if (!court) return null;
  return court.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function sourceLine(n: number, s: DeepResearchSource): string {
  const parts = [s.title, s.citation ?? s.grNo, formatCourt(s.court), formatSourceDate(s.date)]
    .filter((p): p is string => !!p);
  return `[${n}] ${parts.join(', ')}`;
}

/** Answer + numbered citation list as plain text, for the Copy action. */
export function toPlainText(
  question: string | null,
  result: DeepResearchResult,
  sources: DeepResearchSource[],
): string {
  const numbers = numberSources(sources);
  const lines: string[] = [];
  if (question) lines.push(question, '');
  lines.push(result.summary.trim(), '');
  for (const section of result.sections) {
    lines.push(section.heading);
    for (const claim of section.claims) {
      const refs = [...new Set(claim.citations.map((c) => numbers.get(c.sourceId)))]
        .filter((n): n is number => n !== undefined)
        .sort((a, b) => a - b) // same order as the chips on screen
        .map((n) => `[${n}]`)
        .join('');
      lines.push(`- ${claim.text.trim()}${refs ? ` ${refs}` : ''}`);
    }
    lines.push('');
  }
  const cited = citedSources(result, sources);
  if (cited.length > 0) {
    lines.push('Sources');
    for (const s of cited) lines.push(sourceLine(numbers.get(s.sourceId) ?? 0, s));
  }
  return lines.join('\n').trim();
}

/** Reader deep link that pinpoints the quoted passage. */
export function readerPinpointHref(source: DeepResearchSource, quote?: string): string {
  const params = new URLSearchParams();
  if (source.sectionId) params.set('section', source.sectionId);
  if (quote && quote.trim()) params.set('highlight', quote.trim());
  const qs = params.toString();
  return `/reader/${encodeURIComponent(source.documentId)}${qs ? `?${qs}` : ''}`;
}

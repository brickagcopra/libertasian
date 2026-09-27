import type { DeepResearchResult, DeepResearchSource } from './types';

/**
 * Citation numbering, shared by the chips, the Sources list and Share.
 *
 * A source's number is its 1-based position in the `sources` event. The chips
 * and the list read the same map, so `[3]` on a claim is always the third row
 * below the answer. A citation whose `sourceId` is not in the list (the
 * verifier drops those, but a persisted run may predate it) gets no number and
 * no chip rather than a number pointing at nothing.
 */
export function buildSourceIndex(sources: DeepResearchSource[]): Map<string, number> {
  const index = new Map<string, number>();
  sources.forEach((source, i) => {
    if (!index.has(source.sourceId)) index.set(source.sourceId, i + 1);
  });
  return index;
}

/** One line describing a source: citation, court and date, when present. */
export function sourceMetaLine(source: DeepResearchSource): string {
  const parts = [
    source.citation ?? source.grNo ?? null,
    source.court ? source.court.replace(/_/g, ' ') : null,
    formatSourceDate(source.date),
  ].filter((p): p is string => !!p && p.trim().length > 0);
  return parts.join(' · ');
}

/**
 * Human form of a decision date off the wire; the raw value if unparseable.
 *
 * Formatted in UTC: `2020-01-15` is a calendar DATE, which `Date.parse` reads
 * as UTC midnight — rendered in a timezone west of UTC it would show the 14th.
 */
export function formatSourceDate(date: string | null | undefined): string | null {
  if (!date) return null;
  const t = Date.parse(date);
  if (Number.isNaN(t)) return date;
  return new Date(t).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * The run as plain text for the system share sheet: question, summary, each
 * section with its claims and `[n]` markers, then the numbered sources. No
 * markup — it lands in Messages, Mail, Viber, notes apps.
 */
export function buildShareText(
  question: string,
  result: DeepResearchResult,
  sources: DeepResearchSource[],
): string {
  const index = buildSourceIndex(sources);
  const lines: string[] = [`Deep Research: ${question}`, '', result.summary.trim()];

  for (const section of result.sections) {
    lines.push('', section.heading.toUpperCase());
    for (const claim of section.claims) {
      const refs = uniqueNumbers(claim.citations.map((c) => index.get(c.sourceId))).sort(
        (a, b) => a - b,
      );
      const marker = refs.length > 0 ? ` ${refs.map((n) => `[${n}]`).join('')}` : '';
      lines.push(`- ${claim.text.trim()}${marker}`);
    }
  }

  const cited = sources.filter((s) => index.has(s.sourceId));
  if (cited.length > 0) {
    lines.push('', 'SOURCES');
    cited.forEach((source) => {
      const meta = sourceMetaLine(source);
      lines.push(`[${index.get(source.sourceId)}] ${source.title}${meta ? ` — ${meta}` : ''}`);
    });
  }

  lines.push('', 'AI-generated research. Verify with official sources.');
  return lines.join('\n');
}

export function uniqueNumbers(values: (number | undefined)[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const v of values) {
    if (v === undefined || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

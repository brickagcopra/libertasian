import type { DerivativeDetail } from '../types';
import { GatedNotice } from './gated-notice';
import { Unavailable } from './unavailable';

interface SummaryHighlight {
  term?: string;
  definition?: string;
}

interface QuickReferenceRow {
  label?: string;
  value?: string;
}

interface OnePageSummaryContent {
  topic?: string;
  bottomLine?: string;
  keyPoints?: string[];
  highlights?: SummaryHighlight[];
  quickReference?: QuickReferenceRow[];
}

function asSummary(value: unknown): OnePageSummaryContent | null {
  if (!value || typeof value !== 'object') return null;
  return value as OnePageSummaryContent;
}

export function OnePageSummaryRenderer({ data }: { data: DerivativeDetail }) {
  const content = asSummary(data.contentJson);
  if (!content) return <Unavailable />;

  const bottomLine = content.bottomLine?.trim() ?? '';
  if (!bottomLine) return <Unavailable />;

  const keyPoints = (content.keyPoints ?? []).filter((p) => p?.trim());
  const highlights = (content.highlights ?? []).filter(
    (h) => h && (h.term?.trim() || h.definition?.trim()),
  );
  const quickRef = (content.quickReference ?? []).filter(
    (r) => r && (r.label?.trim() || r.value?.trim()),
  );

  return (
    <article className="prose prose-sm max-w-none dark:prose-invert">
      {content.topic?.trim() && (
        <p className="not-prose mb-3 text-xs uppercase tracking-widest text-muted-foreground">
          {content.topic}
        </p>
      )}

      <section className="not-prose rounded-lg border-2 border-primary/50 bg-primary/5 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">
          Bottom Line
        </p>
        <p className="mt-2 text-lg font-semibold leading-snug">{bottomLine}</p>
      </section>

      {data.isGated ? (
        <div className="not-prose mt-6">
          <GatedNotice typeLabel="One-page summary" upgradeTier={data.upgradeTier} />
        </div>
      ) : (
        <>
          {keyPoints.length > 0 && (
            <section className="mt-6">
              <h3 className="not-prose text-lg font-semibold">Key Points</h3>
              <ol className="mt-2 list-decimal space-y-1 pl-6">
                {keyPoints.map((p, i) => (
                  <li key={`kp-${i}`}>{p}</li>
                ))}
              </ol>
            </section>
          )}

          {highlights.length > 0 && (
            <section className="mt-6">
              <h3 className="not-prose text-lg font-semibold">Highlights</h3>
              <dl className="not-prose mt-2 space-y-3">
                {highlights.map((h, i) => (
                  <div
                    key={`hl-${i}`}
                    className="rounded-md border border-border p-3 text-sm"
                  >
                    {h.term?.trim() && <dt className="font-semibold">{h.term}</dt>}
                    {h.definition?.trim() && (
                      <dd className="mt-1 text-muted-foreground">{h.definition}</dd>
                    )}
                  </div>
                ))}
              </dl>
            </section>
          )}

          {quickRef.length > 0 && (
            <section className="mt-6">
              <h3 className="not-prose text-lg font-semibold">Quick Reference</h3>
              <table className="not-prose mt-2 w-full border-collapse text-sm">
                <tbody>
                  {quickRef.map((row, i) => (
                    <tr key={`qr-${i}`} className="border-b border-border">
                      <th className="py-2 pr-4 text-left align-top font-semibold">
                        {row.label ?? '—'}
                      </th>
                      <td className="py-2 align-top">{row.value ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </article>
  );
}

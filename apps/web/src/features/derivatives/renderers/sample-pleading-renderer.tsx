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

  return (
    <article className="prose prose-sm max-w-none dark:prose-invert">
      {content.pleadingType?.trim() && (
        <p className="not-prose mb-3 text-center text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {content.pleadingType}
        </p>
      )}

      <div className="not-prose rounded-md border border-border bg-muted/40 p-4 font-mono text-xs leading-relaxed">
        {caption.court?.trim() && (
          <p className="text-center font-bold uppercase">{caption.court}</p>
        )}
        {caption.caseTitle?.trim() && (
          <p className="mt-2 text-center">{caption.caseTitle}</p>
        )}
        {caption.caseNumber?.trim() && (
          <p className="mt-2 text-center">{caption.caseNumber}</p>
        )}
      </div>

      {data.isGated ? (
        <div className="not-prose mt-6">
          <GatedNotice typeLabel="Sample pleading" upgradeTier={data.upgradeTier} />
        </div>
      ) : (
        <>
          {(parties.plaintiff?.trim() ||
            parties.defendant?.trim() ||
            parties.counsel?.trim()) && (
            <section className="mt-6">
              <h3 className="not-prose text-lg font-semibold">Parties</h3>
              <dl className="not-prose mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
                {parties.plaintiff?.trim() && (
                  <>
                    <dt className="font-semibold">Plaintiff / Petitioner</dt>
                    <dd>{parties.plaintiff}</dd>
                  </>
                )}
                {parties.defendant?.trim() && (
                  <>
                    <dt className="font-semibold">Defendant / Respondent</dt>
                    <dd>{parties.defendant}</dd>
                  </>
                )}
                {parties.counsel?.trim() && (
                  <>
                    <dt className="font-semibold">Counsel</dt>
                    <dd>{parties.counsel}</dd>
                  </>
                )}
              </dl>
            </section>
          )}

          {content.preamble?.trim() && (
            <section className="mt-6">
              <p className="whitespace-pre-wrap">{content.preamble}</p>
            </section>
          )}

          {sections.length > 0 && (
            <section className="mt-6">
              <ol className="list-decimal space-y-4 pl-6">
                {sections.map((sec, i) => (
                  <li key={`sec-${i}`}>
                    {sec.heading?.trim() && (
                      <h4 className="not-prose text-base font-semibold">{sec.heading}</h4>
                    )}
                    {(sec.paragraphs ?? []).map((p, j) => (
                      <p key={`p-${i}-${j}`} className="mt-2 whitespace-pre-wrap">
                        {p}
                      </p>
                    ))}
                  </li>
                ))}
              </ol>
            </section>
          )}

          {content.prayer?.trim() && (
            <section className="mt-6">
              <h3 className="not-prose text-lg font-semibold">Prayer</h3>
              <p className="mt-2 whitespace-pre-wrap">{content.prayer}</p>
            </section>
          )}

          {(content.verification?.trim() || content.proofOfService?.trim()) && (
            <details className="not-prose mt-6 rounded-md border border-border p-3 text-sm">
              <summary className="cursor-pointer font-semibold">
                Verification &amp; Proof of Service
              </summary>
              {content.verification?.trim() && (
                <div className="mt-3">
                  <h4 className="text-sm font-semibold">Verification</h4>
                  <p className="mt-1 whitespace-pre-wrap">{content.verification}</p>
                </div>
              )}
              {content.proofOfService?.trim() && (
                <div className="mt-3">
                  <h4 className="text-sm font-semibold">Proof of Service</h4>
                  <p className="mt-1 whitespace-pre-wrap">{content.proofOfService}</p>
                </div>
              )}
            </details>
          )}
        </>
      )}
    </article>
  );
}

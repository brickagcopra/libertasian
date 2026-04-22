import type { DerivativeDetail } from '../types';
import { GatedNotice } from './gated-notice';
import { Unavailable } from './unavailable';

interface OutlineSection {
  heading?: string;
  paragraphs?: string[];
  citedSectionIds?: string[];
}

interface EssayModelAnswerContent {
  promptRef?: string;
  format?: string;
  answer?: { outlineSections?: OutlineSection[] };
  writingTips?: string[];
  commonPitfalls?: string[];
}

function asEssayModelAnswer(value: unknown): EssayModelAnswerContent | null {
  if (!value || typeof value !== 'object') return null;
  return value as EssayModelAnswerContent;
}

const ALAC_HEADINGS = ['Answer', 'Law', 'Analysis', 'Conclusion'] as const;

function labelForAlacSection(index: number, heading?: string): string {
  if (heading && heading.trim()) return heading;
  return ALAC_HEADINGS[index] ?? `Section ${index + 1}`;
}

export function EssayModelAnswerRenderer({ data }: { data: DerivativeDetail }) {
  const content = asEssayModelAnswer(data.contentJson);
  if (!content) return <Unavailable />;

  const promptRef = content.promptRef?.trim() ?? '';
  const outline = content.answer?.outlineSections ?? [];
  const writingTips = (content.writingTips ?? []).filter((t) => t?.trim());
  const pitfalls = (content.commonPitfalls ?? []).filter((p) => p?.trim());
  const isAlac = content.format === 'alac';

  if (!promptRef && outline.length === 0) return <Unavailable />;

  return (
    <article className="prose prose-sm max-w-none dark:prose-invert">
      {promptRef && (
        <section>
          <h3 className="not-prose text-lg font-semibold">Prompt Reference</h3>
          <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{promptRef}</p>
        </section>
      )}

      {data.isGated ? (
        <div className="not-prose mt-6">
          <GatedNotice typeLabel="Model Answer" upgradeTier={data.upgradeTier} />
        </div>
      ) : (
        <>
          {outline.length > 0 && (
            <section className="mt-6">
              <h3 className="not-prose text-lg font-semibold">
                Model Answer{isAlac ? ' (ALAC Format)' : ''}
              </h3>
              {outline.map((sec, i) => (
                <div key={`alac-${i}`} className="mt-4">
                  <h4 className="not-prose text-base font-semibold">
                    {isAlac ? labelForAlacSection(i, sec.heading) : sec.heading ?? `Section ${i + 1}`}
                  </h4>
                  {(sec.paragraphs ?? []).map((p, j) => (
                    <p key={`p-${i}-${j}`} className="mt-2 whitespace-pre-wrap">
                      {p}
                    </p>
                  ))}
                </div>
              ))}
            </section>
          )}

          {writingTips.length > 0 && (
            <section className="mt-6">
              <h3 className="not-prose text-lg font-semibold">Writing Tips</h3>
              <ul className="mt-2 list-disc pl-6">
                {writingTips.map((tip, i) => (
                  <li key={`tip-${i}`} className="mt-1">
                    {tip}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {pitfalls.length > 0 && (
            <section className="mt-6">
              <h3 className="not-prose text-lg font-semibold">Common Pitfalls</h3>
              <ul className="mt-2 list-disc pl-6">
                {pitfalls.map((pit, i) => (
                  <li key={`pit-${i}`} className="mt-1">
                    {pit}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </article>
  );
}

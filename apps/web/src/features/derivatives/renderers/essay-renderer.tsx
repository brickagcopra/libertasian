import type { DerivativeDetail } from '../types';
import { GatedNotice } from './gated-notice';
import { Unavailable } from './unavailable';

interface OutlineSection {
  heading?: string;
  paragraphs?: string[];
  citedSectionIds?: string[];
}

interface RubricCriterion {
  name?: string;
  maxPoints?: number;
  description?: string;
}

interface EssayContent {
  promptText?: string;
  suggestedTimeMinutes?: number;
  modelAnswer?: { outlineSections?: OutlineSection[] };
  rubric?: { totalPoints?: number; criteria?: RubricCriterion[] };
}

function asEssay(value: unknown): EssayContent | null {
  if (!value || typeof value !== 'object') return null;
  return value as EssayContent;
}

export function EssayRenderer({ data }: { data: DerivativeDetail }) {
  const content = asEssay(data.contentJson);
  if (!content) return <Unavailable />;

  const prompt = content.promptText ?? '';
  if (!prompt) return <Unavailable />;

  const outline = content.modelAnswer?.outlineSections ?? [];
  const rubric = content.rubric;

  return (
    <article className="prose prose-sm max-w-none dark:prose-invert">
      <h3 className="not-prose text-lg font-semibold">Prompt</h3>
      <p className="whitespace-pre-wrap">{prompt}</p>

      {content.suggestedTimeMinutes && (
        <p className="text-xs text-muted-foreground">
          Suggested time: {content.suggestedTimeMinutes} minutes
        </p>
      )}

      {data.isGated ? (
        <div className="not-prose mt-6">
          <GatedNotice typeLabel="Essay prompt" upgradeTier={data.upgradeTier} />
        </div>
      ) : (
        <>
          {outline.length > 0 && (
            <section className="mt-6">
              <h3 className="not-prose text-lg font-semibold">Model Answer</h3>
              {outline.map((sec, i) => (
                <div key={`${sec.heading ?? 'section'}-${i}`} className="mt-4">
                  <h4 className="not-prose text-base font-semibold">
                    {sec.heading ?? `Section ${i + 1}`}
                  </h4>
                  {(sec.paragraphs ?? []).map((p, j) => (
                    <p key={`p-${i}-${j}`} className="mt-2">
                      {p}
                    </p>
                  ))}
                </div>
              ))}
            </section>
          )}

          {rubric && (rubric.criteria ?? []).length > 0 && (
            <section className="mt-6">
              <h3 className="not-prose text-lg font-semibold">
                Rubric{rubric.totalPoints ? ` (${rubric.totalPoints} pts)` : ''}
              </h3>
              <ul className="not-prose mt-2 space-y-2">
                {(rubric.criteria ?? []).map((c, i) => (
                  <li
                    key={`c-${i}`}
                    className="rounded-md border border-border p-3 text-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium">{c.name ?? `Criterion ${i + 1}`}</span>
                      {c.maxPoints != null && (
                        <span className="text-xs text-muted-foreground">
                          {c.maxPoints} pts
                        </span>
                      )}
                    </div>
                    {c.description && (
                      <p className="mt-1 text-xs text-muted-foreground">{c.description}</p>
                    )}
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

import type { DerivativeDetail } from '../types';
import { GatedNotice } from './gated-notice';
import { Unavailable } from './unavailable';

interface BarAnnotation {
  quote?: string;
  commentary?: string;
}

interface SuggestedBarAnswerContent {
  barYear?: number | string;
  examSubject?: string;
  questionText?: string;
  suggestedAnswer?: string;
  annotations?: BarAnnotation[];
  sourceAttribution?: string;
}

function asBarAnswer(value: unknown): SuggestedBarAnswerContent | null {
  if (!value || typeof value !== 'object') return null;
  return value as SuggestedBarAnswerContent;
}

export function SuggestedBarAnswerRenderer({ data }: { data: DerivativeDetail }) {
  const content = asBarAnswer(data.contentJson);
  if (!content) return <Unavailable />;

  const question = content.questionText?.trim() ?? '';
  if (!question) return <Unavailable />;

  const answer = content.suggestedAnswer?.trim() ?? '';
  const annotations = (content.annotations ?? []).filter(
    (a) => a && (a.quote?.trim() || a.commentary?.trim()),
  );
  const hasExamMeta = Boolean(content.barYear) || Boolean(content.examSubject?.trim());

  return (
    <article className="prose prose-sm max-w-none dark:prose-invert">
      {hasExamMeta && (
        <div className="not-prose mb-4 flex flex-wrap gap-2">
          {content.barYear && (
            <span className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-medium">
              Bar {content.barYear}
            </span>
          )}
          {content.examSubject?.trim() && (
            <span className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-medium">
              {content.examSubject}
            </span>
          )}
        </div>
      )}

      <section>
        <h3 className="not-prose text-lg font-semibold">Question</h3>
        <p className="mt-2 whitespace-pre-wrap">{question}</p>
      </section>

      {data.isGated ? (
        <div className="not-prose mt-6">
          <GatedNotice typeLabel="Suggested bar answer" upgradeTier={data.upgradeTier} />
        </div>
      ) : (
        <>
          {answer && (
            <section className="mt-6">
              <h3 className="not-prose text-lg font-semibold">Suggested Answer</h3>
              <p className="mt-2 whitespace-pre-wrap">{answer}</p>
            </section>
          )}

          {annotations.length > 0 && (
            <section className="mt-6">
              <h3 className="not-prose text-lg font-semibold">Annotations</h3>
              <ul className="not-prose mt-2 space-y-3">
                {annotations.map((a, i) => (
                  <li
                    key={`anno-${i}`}
                    className="rounded-md border border-border bg-muted/30 p-3 text-sm"
                  >
                    {a.quote?.trim() && (
                      <blockquote className="border-l-2 border-primary/40 pl-3 italic text-muted-foreground">
                        {a.quote}
                      </blockquote>
                    )}
                    {a.commentary?.trim() && (
                      <p className="mt-2 text-sm">{a.commentary}</p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {content.sourceAttribution?.trim() && (
        <p className="mt-6 text-xs text-muted-foreground">
          Source: {content.sourceAttribution}
        </p>
      )}
    </article>
  );
}

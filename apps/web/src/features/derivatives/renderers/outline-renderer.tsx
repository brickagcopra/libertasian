import type { DerivativeDetail } from '../types';
import { Unavailable } from './unavailable';

interface OutlineSubSection {
  heading?: string;
  paragraphs?: string[];
}

interface OutlineSection {
  heading?: string;
  subjectTopicCode?: string;
  paragraphs?: string[];
  subSections?: OutlineSubSection[];
}

interface OutlineContent {
  sections?: OutlineSection[];
  topic?: string;
}

function asOutline(value: unknown): OutlineContent | null {
  if (!value || typeof value !== 'object') return null;
  return value as OutlineContent;
}

export function OutlineRenderer({ data }: { data: DerivativeDetail }) {
  const content = asOutline(data.contentJson);
  const sections = content?.sections ?? [];
  if (sections.length === 0) return <Unavailable />;

  return (
    <article className="prose prose-sm max-w-none dark:prose-invert">
      {content?.topic && (
        <p className="not-prose mb-4 text-sm uppercase tracking-wide text-muted-foreground">
          {content.topic}
        </p>
      )}
      {sections.map((sec, i) => (
        <section key={`s-${i}`} className="mt-6 first:mt-0">
          <h3 className="not-prose text-lg font-semibold">
            {sec.heading ?? `Section ${i + 1}`}
          </h3>
          {(sec.paragraphs ?? []).map((p, j) => (
            <p key={`p-${i}-${j}`} className="mt-2 whitespace-pre-wrap">
              {p}
            </p>
          ))}
          {(sec.subSections ?? []).map((sub, k) => (
            <div key={`sub-${i}-${k}`} className="mt-4 border-l-2 border-muted pl-4">
              <h4 className="not-prose text-base font-semibold">
                {sub.heading ?? `Subsection ${k + 1}`}
              </h4>
              {(sub.paragraphs ?? []).map((p, m) => (
                <p key={`subp-${i}-${k}-${m}`} className="mt-2 whitespace-pre-wrap">
                  {p}
                </p>
              ))}
            </div>
          ))}
        </section>
      ))}
    </article>
  );
}

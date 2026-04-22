import type { DerivativeDetail } from '../types';
import { Unavailable } from './unavailable';

interface DigestContent {
  summary?: string;
  facts?: string;
  petitionerArguments?: string;
  respondentArguments?: string;
  issues?: string | string[];
  ruling?: string;
  doctrine?: string;
  dispositive?: string;
}

function asDigest(value: unknown): DigestContent | null {
  if (!value || typeof value !== 'object') return null;
  return value as DigestContent;
}

function formatIssues(issues: string | string[] | undefined): string[] {
  if (!issues) return [];
  if (Array.isArray(issues)) return issues.filter((x) => typeof x === 'string' && x.trim());
  return [issues];
}

export function DigestRenderer({ data }: { data: DerivativeDetail }) {
  const content = asDigest(data.contentJson);
  if (!content) return <Unavailable />;

  const sections: Array<{ title: string; body: string | string[] | undefined }> = [
    { title: 'Summary', body: content.summary },
    { title: 'Facts', body: content.facts },
    { title: "Petitioner's Arguments", body: content.petitionerArguments },
    { title: "Respondent's Arguments", body: content.respondentArguments },
    { title: 'Issues', body: formatIssues(content.issues) },
    { title: 'Ruling', body: content.ruling },
    { title: 'Doctrine', body: content.doctrine },
    { title: 'Dispositive', body: content.dispositive },
  ];

  const anyContent = sections.some((s) =>
    Array.isArray(s.body) ? s.body.length > 0 : typeof s.body === 'string' && s.body.trim(),
  );
  if (!anyContent) return <Unavailable />;

  return (
    <article className="prose prose-sm max-w-none dark:prose-invert">
      {sections.map((s) => {
        if (Array.isArray(s.body)) {
          if (s.body.length === 0) return null;
          return (
            <section key={s.title} className="mt-6 first:mt-0">
              <h3 className="not-prose text-lg font-semibold">{s.title}</h3>
              <ol className="mt-2 list-decimal pl-6">
                {s.body.map((p, i) => (
                  <li key={`${s.title}-${i}`} className="mt-1">
                    {p}
                  </li>
                ))}
              </ol>
            </section>
          );
        }
        const text = (s.body ?? '').trim();
        if (!text) return null;
        return (
          <section key={s.title} className="mt-6 first:mt-0">
            <h3 className="not-prose text-lg font-semibold">{s.title}</h3>
            <p className="mt-2 whitespace-pre-wrap">{text}</p>
          </section>
        );
      })}
    </article>
  );
}

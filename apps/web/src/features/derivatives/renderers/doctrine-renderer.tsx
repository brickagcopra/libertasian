import type { DerivativeDetail } from '../types';
import { Unavailable } from './unavailable';

interface DoctrineEntry {
  text?: string;
  doctrine_type?: string;
  doctrineType?: string;
  normalized_text?: string;
  normalizedText?: string;
  confidence?: number;
}

interface DoctrineContent {
  doctrines?: DoctrineEntry[];
}

function asDoctrine(value: unknown): DoctrineContent | null {
  if (!value || typeof value !== 'object') return null;
  return value as DoctrineContent;
}

export function DoctrineRenderer({ data }: { data: DerivativeDetail }) {
  const content = asDoctrine(data.contentJson);
  const entries = content?.doctrines ?? [];
  if (entries.length === 0) return <Unavailable />;

  return (
    <article className="prose prose-sm max-w-none dark:prose-invert">
      <ol className="not-prose list-decimal space-y-4 pl-6">
        {entries.map((d, i) => {
          const text = d.text ?? '';
          if (!text) return null;
          const type = d.doctrineType ?? d.doctrine_type;
          const normalized = d.normalizedText ?? d.normalized_text;
          return (
            <li key={`d-${i}`} className="rounded-md border border-border p-4">
              <p className="font-medium">{text}</p>
              {normalized && normalized !== text && (
                <p className="mt-2 text-xs text-muted-foreground">
                  <span className="font-medium">Normalized:</span> {normalized}
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                {type && (
                  <span className="rounded-full bg-muted px-2 py-0.5">{type}</span>
                )}
                {typeof d.confidence === 'number' && (
                  <span className="rounded-full bg-muted px-2 py-0.5">
                    {Math.round(d.confidence * 100)}% confidence
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </article>
  );
}

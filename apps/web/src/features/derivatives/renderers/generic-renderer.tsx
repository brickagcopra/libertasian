import type { DerivativeDetail } from '../types';
import { Unavailable } from './unavailable';

function humanizeKey(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

function renderValue(value: unknown, depth = 0): React.ReactNode {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    return <p className="whitespace-pre-wrap">{trimmed}</p>;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return <p>{String(value)}</p>;
  }
  if (Array.isArray(value)) {
    const items = value.filter((x) => x !== null && x !== undefined && x !== '');
    if (items.length === 0) return null;
    const allScalar = items.every(
      (x) => typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean',
    );
    if (allScalar) {
      return (
        <ul className="list-disc pl-6">
          {items.map((x, i) => (
            <li key={i}>{String(x)}</li>
          ))}
        </ul>
      );
    }
    return (
      <ol className="list-decimal space-y-3 pl-6">
        {items.map((x, i) => (
          <li key={i}>{renderValue(x, depth + 1)}</li>
        ))}
      </ol>
    );
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, v]) => v !== null && v !== undefined && v !== '',
    );
    if (entries.length === 0) return null;
    const HeadingTag = depth === 0 ? 'h3' : 'h4';
    return (
      <div className="space-y-4">
        {entries.map(([key, val]) => (
          <section key={key}>
            <HeadingTag
              className={
                depth === 0
                  ? 'not-prose text-lg font-semibold'
                  : 'not-prose text-base font-semibold'
              }
            >
              {humanizeKey(key)}
            </HeadingTag>
            <div className="mt-2">{renderValue(val, depth + 1)}</div>
          </section>
        ))}
      </div>
    );
  }
  return null;
}

export function GenericRenderer({ data }: { data: DerivativeDetail }) {
  if (data.contentPlainText && data.contentPlainText.trim()) {
    return (
      <article className="prose prose-sm max-w-none dark:prose-invert">
        <pre className="whitespace-pre-wrap font-sans text-sm">{data.contentPlainText}</pre>
      </article>
    );
  }

  const body = renderValue(data.contentJson);
  if (!body) return <Unavailable />;

  return (
    <article className="prose prose-sm max-w-none dark:prose-invert">{body}</article>
  );
}

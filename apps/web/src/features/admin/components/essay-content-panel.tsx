import type { JobEssayResponse } from '../types';

const REVIEW_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  ai_generated: 'bg-blue-100 text-blue-700',
  needs_human_review: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

type Essay = NonNullable<JobEssayResponse['essay']>;

/** Check if value is a non-null plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** ALAC heading keys (case-insensitive match). */
const ALAC_KEYS = ['answer', 'law', 'application', 'conclusion'] as const;

function hasAlacShape(obj: Record<string, unknown>): boolean {
  const keys = Object.keys(obj).map((k) => k.toLowerCase());
  return ALAC_KEYS.some((k) => keys.includes(k));
}

function renderStringOrJson(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

// ─── Model Answer Renderer ───────────────────────────────

function ModelAnswerContent({ data }: { data: unknown }) {
  if (data === null || data === undefined) {
    return <p className="text-sm italic text-gray-400">No model answer provided</p>;
  }

  if (typeof data === 'string') {
    return <p className="text-sm text-gray-800" style={{ whiteSpace: 'pre-line' }}>{data}</p>;
  }

  if (isRecord(data)) {
    // ALAC-shaped object
    if (hasAlacShape(data)) {
      return (
        <div className="space-y-3">
          {ALAC_KEYS.map((key) => {
            // Find matching key (case-insensitive)
            const matchedKey = Object.keys(data).find((k) => k.toLowerCase() === key);
            if (!matchedKey) return null;
            const value = data[matchedKey];
            if (!value) return null;
            return (
              <div key={key} className="rounded border bg-gray-50 p-3">
                <h5 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {key}
                </h5>
                <p className="mt-1 text-sm text-gray-800" style={{ whiteSpace: 'pre-line' }}>
                  {renderStringOrJson(value)}
                </p>
              </div>
            );
          })}
          {/* Render any non-ALAC keys */}
          {Object.entries(data)
            .filter(([k]) => !ALAC_KEYS.includes(k.toLowerCase() as (typeof ALAC_KEYS)[number]))
            .map(([k, v]) => (
              <div key={k} className="rounded border bg-gray-50 p-3">
                <h5 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {k}
                </h5>
                <p className="mt-1 text-sm text-gray-800" style={{ whiteSpace: 'pre-line' }}>
                  {renderStringOrJson(v)}
                </p>
              </div>
            ))}
        </div>
      );
    }

    // Generic object — render each key/value as labeled paragraphs
    return (
      <div className="space-y-3">
        {Object.entries(data).map(([k, v]) => (
          <div key={k} className="rounded border bg-gray-50 p-3">
            <h5 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{k}</h5>
            <p className="mt-1 text-sm text-gray-800" style={{ whiteSpace: 'pre-line' }}>
              {renderStringOrJson(v)}
            </p>
          </div>
        ))}
      </div>
    );
  }

  // Fallback: JSON.stringify
  return (
    <pre className="max-h-60 overflow-auto rounded border bg-gray-50 p-3 text-xs text-gray-700">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

// ─── Rubric Renderer ─────────────────────────────────────

function RubricContent({ data }: { data: unknown }) {
  if (data === null || data === undefined) {
    return <p className="text-sm italic text-gray-400">No rubric provided</p>;
  }

  if (isRecord(data) && Array.isArray(data['criteria'])) {
    const criteria = data['criteria'] as unknown[];
    const totalPoints = typeof data['totalPoints'] === 'number' ? data['totalPoints'] : null;
    return (
      <div>
        {totalPoints !== null && (
          <p className="mb-2 text-xs text-gray-500">Total points: {totalPoints}</p>
        )}
        <ol className="list-inside list-decimal space-y-1 text-sm text-gray-800">
          {criteria.map((item, i) => (
            <li key={i}>
              {isRecord(item)
                ? `${item['name'] ?? `Criterion ${i + 1}`} (${item['maxPoints'] ?? '?'} pts) — ${item['description'] ?? ''}`
                : renderStringOrJson(item)}
            </li>
          ))}
        </ol>
      </div>
    );
  }

  if (Array.isArray(data)) {
    return (
      <ol className="list-inside list-decimal space-y-1 text-sm text-gray-800">
        {data.map((item, i) => (
          <li key={i}>{renderStringOrJson(item)}</li>
        ))}
      </ol>
    );
  }

  return (
    <pre className="max-h-60 overflow-auto rounded border bg-gray-50 p-3 text-xs text-gray-700">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

// ─── Main Component ──────────────────────────────────────

export function EssayContentPanel({ essay }: { essay: Essay }) {
  const prompt = essay.essayPrompt;

  return (
    <div className="space-y-4">
      {/* Header badges */}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${REVIEW_STATUS_COLORS[essay.reviewStatus] ?? 'bg-gray-100 text-gray-700'}`}
        >
          {essay.reviewStatus}
        </span>
        {essay.validatorVerdict && (
          <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
            {essay.validatorVerdict}
          </span>
        )}
        {essay.confidenceScore !== null && (
          <span className="text-xs text-gray-500">
            {(essay.confidenceScore * 100).toFixed(0)}% confidence
          </span>
        )}
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
          {essay.visibility}
        </span>
      </div>

      {/* Title */}
      {essay.title && (
        <h4 className="text-base font-semibold text-gray-900">{essay.title}</h4>
      )}

      {/* Prompt section */}
      {prompt && (
        <div className="rounded border bg-gray-50 p-4">
          <h4 className="mb-2 text-sm font-semibold text-gray-700">Prompt</h4>
          <p className="text-sm text-gray-800" style={{ whiteSpace: 'pre-line' }}>
            {prompt.promptText}
          </p>
          {prompt.suggestedTimeMinutes !== null && (
            <p className="mt-2 text-xs text-gray-500">
              Suggested time: {prompt.suggestedTimeMinutes} minutes
            </p>
          )}
        </div>
      )}

      {/* Model Answer */}
      {prompt && (
        <details className="rounded border">
          <summary className="cursor-pointer bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-700">
            Model Answer
          </summary>
          <div className="p-4">
            <ModelAnswerContent data={prompt.modelAnswerJson} />
          </div>
        </details>
      )}

      {/* Rubric */}
      {prompt && (
        <details className="rounded border">
          <summary className="cursor-pointer bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-700">
            Rubric
          </summary>
          <div className="p-4">
            <RubricContent data={prompt.rubricJson} />
          </div>
        </details>
      )}

      {/* Footer metadata */}
      {prompt && (prompt.subjectTopicId || prompt.barExamSittingId) && (
        <div className="text-xs text-gray-400">
          {prompt.subjectTopicId && <span>Subject Topic: {prompt.subjectTopicId}</span>}
          {prompt.subjectTopicId && prompt.barExamSittingId && <span className="mx-2">|</span>}
          {prompt.barExamSittingId && <span>Bar Exam Sitting: {prompt.barExamSittingId}</span>}
        </div>
      )}

      {/* Content disclaimer */}
      {essay.contentDisclaimer?.bodyPlain && (
        <p className="text-xs italic text-gray-500">{essay.contentDisclaimer.bodyPlain}</p>
      )}
    </div>
  );
}

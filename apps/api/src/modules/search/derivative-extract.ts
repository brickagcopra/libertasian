/**
 * Pure extraction layer for `derivative_artifacts.content_json`.
 *
 * Phase C federates ~100k derivative artifacts into OpenSearch. Today they are
 * invisible to search — the derivative endpoints fall back to
 * `title ILIKE '%q%'`, so the body of every digest, outline and model answer is
 * unreachable. This module turns one `content_json` blob into the ordered
 * plain-text blocks that become the indexed body.
 *
 * Contract:
 *  - **Pure.** No I/O, no database, no LLM, no clock. Same input, same output.
 *  - **Total.** An unknown `type`, a null/array/scalar `content`, a missing key
 *    or a wrong-typed value yields `[]` or a shorter list. It never throws.
 *    Extraction runs inside the bulk indexing loop; one malformed row out of
 *    ~100k must not abort the batch.
 *  - **Ordered.** Blocks come back in reading order, so a snippet built by
 *    joining them reads the way the renderer displays the artifact.
 *
 * The 11 shapes are pinned by `@libertasian/types/derivative-content`, which is
 * the same definition `apps/web`'s renderers are tested against. Three traps
 * are load-bearing and are covered by the spec:
 *  1. `doctrine_extract` uses snake_case keys; the other ten are camelCase.
 *     Every key read accepts both spellings rather than assuming one casing.
 *  2. `subSections`, `subclauses` and `outlineSections` nest arbitrarily deep,
 *     so section walking is recursive rather than one-level.
 *  3. `mcq_question` carries answer keys — see MCQ_FORBIDDEN_KEYS below.
 *
 * SECURITY — the MCQ rule. For `mcq_question` only the stem and the option
 * *text* are extracted. `isCorrect`, `rationale` and `explanation` are never
 * returned, and the derivatives mapping has no field to hold them. This is
 * deliberately enforced at extraction, not at query time: anything that reaches
 * the index leaks through highlight fragments, `_source` on a hit, `fields`,
 * and aggregations — excluding it per-query means every present and future call
 * site has to remember, and one miss publishes an answer key. An admin-facing
 * rationale search, if it is ever built, is a SEPARATE index.
 */

/**
 * Depth ceiling for the recursive shapes. `content_json` is JSONB so it cannot
 * contain a true cycle, but this function takes `unknown` and must stay total
 * for any caller. Real outlines nest 3–4 deep; 32 is far beyond legitimate use
 * while still bounding a pathological blob.
 */
const MAX_DEPTH = 32;

/**
 * Fields that must never appear in extractor output for `mcq_question`.
 * Referenced by name in the spec so the rule is asserted, not just documented.
 */
export const MCQ_FORBIDDEN_KEYS: readonly string[] = [
  'isCorrect',
  'is_correct',
  'rationale',
  'explanation',
];

/** Keys whose array values hold further nested sections/clauses. */
const NESTED_SECTION_KEYS: readonly string[] = [
  'subSections',
  'sub_sections',
  'subclauses',
  'sub_clauses',
  'outlineSections',
  'outline_sections',
  'sections',
  'children',
];

const HTML_ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
  '&nbsp;': ' ',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reduce a markdown/HTML string to plain text and collapse whitespace.
 *
 * Editorial content arrives with light markdown (bold, headings, bullets) and
 * occasional inline HTML. Markers are noise in a BM25 body and worse in a
 * highlight fragment, where a stray `**` shows up in the UI.
 */
function stripToPlainText(raw: string): string {
  let text = raw;

  // Code fences and inline HTML tags first — before marker stripping, so an
  // attribute value containing `*` cannot survive as emphasis.
  text = text.replace(/```[a-zA-Z0-9]*\r?\n?/g, ' ');
  text = text.replace(/<[^>]*>/g, ' ');

  // Images before links: `![alt](src)` keeps the alt text, not the URL.
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');

  text = text.replace(
    /&(?:amp|lt|gt|quot|apos|nbsp|#39);/g,
    (entity) => HTML_ENTITIES[entity] ?? ' ',
  );

  // Line-leading structure: headings, blockquotes, bullets, ordered markers.
  text = text.replace(/^[ \t]*#{1,6}[ \t]+/gm, '');
  text = text.replace(/^[ \t]*>[ \t]?/gm, '');
  text = text.replace(/^[ \t]*(?:[-*+]|\d+\.)[ \t]+/gm, '');
  text = text.replace(/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm, ' ');

  // Paired emphasis markers.
  text = text.replace(/\*\*|__|~~|`/g, '');
  // Single-marker emphasis, only when it wraps a word — this must not touch
  // `doctrine_type` or `G.R._No`, where the underscore is inside a token.
  text = text.replace(/(^|\s)[*_]([^*_\n]+)[*_](?=\s|$|[.,;:!?])/g, '$1$2');

  return text.replace(/\s+/g, ' ').trim();
}

/** Append `value` as a block when it is a non-empty string. */
function pushText(out: string[], value: unknown): void {
  if (typeof value !== 'string') return;
  const text = stripToPlainText(value);
  if (text.length > 0) out.push(text);
}

/** Append each string element of an array value. */
function pushEach(out: string[], value: unknown): void {
  if (!Array.isArray(value)) return;
  for (const item of value) pushText(out, item);
}

/**
 * Read the first present, non-null value among `names`. Every call site passes
 * both the camelCase and snake_case spelling, which is what makes
 * `doctrine_extract` work without a shape-specific branch.
 */
function readField(
  source: Record<string, unknown>,
  ...names: readonly string[]
): unknown {
  for (const name of names) {
    const value = source[name];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

/** Read an array field, or `[]` when absent or wrong-typed. */
function readArray(
  source: Record<string, unknown>,
  ...names: readonly string[]
): readonly unknown[] {
  const value = readField(source, ...names);
  return Array.isArray(value) ? value : [];
}

/**
 * Recursively collect a heading/text/paragraphs node and any nested sections.
 * Shared by `subject_outline`, `sample_pleading`, `sample_contract` and both
 * essay shapes — they differ only in which key holds the children, and
 * NESTED_SECTION_KEYS covers all of them.
 */
function collectSection(out: string[], node: unknown, depth: number): void {
  if (depth > MAX_DEPTH || !isRecord(node)) return;

  pushText(out, readField(node, 'heading', 'title'));
  pushText(out, readField(node, 'text', 'body'));
  pushEach(out, readField(node, 'paragraphs'));

  for (const key of NESTED_SECTION_KEYS) {
    for (const child of readArray(node, key)) {
      collectSection(out, child, depth + 1);
    }
  }
}

/** Collect `{ heading?, text? }`-ish label/value pairs from an array field. */
function collectPairs(
  out: string[],
  items: readonly unknown[],
  ...keys: readonly string[]
): void {
  for (const item of items) {
    if (!isRecord(item)) continue;
    for (const key of keys) pushText(out, item[key]);
  }
}

type ContentExtractor = (content: Record<string, unknown>) => string[];

const EXTRACTORS: Readonly<Record<string, ContentExtractor>> = {
  case_digest: (content) => {
    const out: string[] = [];
    pushText(out, readField(content, 'summary'));
    pushText(out, readField(content, 'facts'));
    pushText(out, readField(content, 'petitionerArguments', 'petitioner_arguments'));
    pushText(out, readField(content, 'respondentArguments', 'respondent_arguments'));
    pushEach(out, readField(content, 'issues'));
    pushText(out, readField(content, 'ruling'));
    pushText(out, readField(content, 'doctrine'));
    pushText(out, readField(content, 'dispositive'));
    return out;
  },

  // The snake_case shape. `doctrine_type` and `confidence` are classification
  // metadata, not prose, and are left for C2 to map as filters.
  doctrine_extract: (content) => {
    const out: string[] = [];
    for (const entry of readArray(content, 'doctrines')) {
      if (!isRecord(entry)) continue;
      pushText(out, readField(entry, 'text', 'doctrine_text', 'doctrineText'));
    }
    return out;
  },

  // SECURITY: stem + option text ONLY. See MCQ_FORBIDDEN_KEYS above.
  mcq_question: (content) => {
    const out: string[] = [];
    pushText(out, readField(content, 'questionStem', 'question_stem'));
    for (const option of readArray(content, 'options')) {
      if (!isRecord(option)) continue;
      // `option.text` and nothing else. Not `label` (positional noise), and
      // never `isCorrect` / `rationale`.
      pushText(out, readField(option, 'text'));
    }
    return out;
  },

  essay_prompt: (content) => {
    const out: string[] = [];
    pushText(out, readField(content, 'promptText', 'prompt_text'));

    const modelAnswer = readField(content, 'modelAnswer', 'model_answer');
    if (isRecord(modelAnswer)) {
      for (const section of readArray(modelAnswer, 'outlineSections', 'outline_sections')) {
        collectSection(out, section, 0);
      }
    }

    const rubric = readField(content, 'rubric');
    if (isRecord(rubric)) {
      collectPairs(out, readArray(rubric, 'criteria'), 'name', 'description');
    }
    return out;
  },

  essay_model_answer: (content) => {
    const out: string[] = [];
    pushText(out, readField(content, 'promptRef', 'prompt_ref'));

    const answer = readField(content, 'answer');
    if (isRecord(answer)) {
      for (const section of readArray(answer, 'outlineSections', 'outline_sections')) {
        collectSection(out, section, 0);
      }
    }

    pushEach(out, readField(content, 'writingTips', 'writing_tips'));
    pushEach(out, readField(content, 'commonPitfalls', 'common_pitfalls'));
    return out;
  },

  suggested_bar_answer: (content) => {
    const out: string[] = [];
    pushText(out, readField(content, 'examSubject', 'exam_subject'));
    pushText(out, readField(content, 'questionText', 'question_text'));
    pushText(out, readField(content, 'suggestedAnswer', 'suggested_answer'));
    collectPairs(out, readArray(content, 'annotations'), 'quote', 'commentary');
    pushText(out, readField(content, 'sourceAttribution', 'source_attribution'));
    return out;
  },

  flashcard: (content) => {
    const out: string[] = [];
    collectPairs(out, readArray(content, 'cards'), 'front', 'back');
    return out;
  },

  subject_outline: (content) => {
    const out: string[] = [];
    pushText(out, readField(content, 'topic'));
    for (const section of readArray(content, 'sections')) {
      collectSection(out, section, 0);
    }
    return out;
  },

  sample_pleading: (content) => {
    const out: string[] = [];
    pushText(out, readField(content, 'pleadingType', 'pleading_type'));

    const caption = readField(content, 'caption');
    if (isRecord(caption)) {
      pushText(out, readField(caption, 'court'));
      pushText(out, readField(caption, 'caseTitle', 'case_title'));
      pushText(out, readField(caption, 'caseNumber', 'case_number'));
    }

    const parties = readField(content, 'parties');
    if (isRecord(parties)) {
      pushText(out, readField(parties, 'plaintiff'));
      pushText(out, readField(parties, 'defendant'));
      pushText(out, readField(parties, 'counsel'));
    }

    pushText(out, readField(content, 'preamble'));
    for (const section of readArray(content, 'sections')) {
      collectSection(out, section, 0);
    }
    pushText(out, readField(content, 'prayer'));
    pushText(out, readField(content, 'verification'));
    pushText(out, readField(content, 'proofOfService', 'proof_of_service'));
    return out;
  },

  sample_contract: (content) => {
    const out: string[] = [];
    pushText(out, readField(content, 'contractType', 'contract_type'));
    // Contract parties are an ARRAY of {role,name,address}; pleading parties
    // are an OBJECT of named roles. Same word, different shape.
    collectPairs(out, readArray(content, 'parties'), 'role', 'name', 'address');
    pushEach(out, readField(content, 'recitals'));
    for (const clause of readArray(content, 'clauses')) {
      collectSection(out, clause, 0);
    }
    for (const schedule of readArray(content, 'schedules')) {
      collectSection(out, schedule, 0);
    }
    collectPairs(out, readArray(content, 'signatureBlocks', 'signature_blocks'), 'role', 'name');
    return out;
  },

  one_page_summary: (content) => {
    const out: string[] = [];
    pushText(out, readField(content, 'topic'));
    pushText(out, readField(content, 'bottomLine', 'bottom_line'));
    pushEach(out, readField(content, 'keyPoints', 'key_points'));
    collectPairs(out, readArray(content, 'highlights'), 'term', 'definition');
    collectPairs(out, readArray(content, 'quickReference', 'quick_reference'), 'label', 'value');
    return out;
  },
};

/** The derivative types this module knows how to extract. */
export const EXTRACTABLE_TYPES: readonly string[] = Object.keys(EXTRACTORS);

/**
 * Extract ordered, plain-text, searchable blocks from one artifact's
 * `content_json`.
 *
 * Returns `[]` — never throws — for an unrecognised `type` or for content that
 * is not a JSON object. There is deliberately no generic fallback walker for
 * unknown types: a walker would happily hoover up whatever new key a future
 * shape introduces, which is exactly how an answer key ends up in the index.
 * A new shape must be added here explicitly.
 */
export function extractSearchableText(type: string, content: unknown): string[] {
  const extractor = EXTRACTORS[type];
  if (extractor === undefined || !isRecord(content)) return [];
  return extractor(content);
}

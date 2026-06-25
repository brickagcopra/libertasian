/**
 * Legal SSML normalizer — production-grade legal narration.
 *
 * Pure, dependency-free transformation of raw legal prose (digests and bar-exam
 * answers) into Amazon Polly-ready SSML plus a plain normalized-text projection.
 * No NestJS, no class-validator, no I/O — safe to unit-test and to call from a
 * worker without bootstrapping the DI container.
 *
 * The two outputs serve different consumers:
 *   - `ssml`           → fed to Polly's SynthesizeSpeech (TextType: 'ssml').
 *   - `normalizedText` → the human-readable spoken form; used for charCount,
 *                        content hashing, and transcript display.
 *
 * SSML is structure-aware: a {@link SpokenDocument} renders a title, named
 * section headings, paragraphs (`<p>`) and sentences (`<s>`) with deliberate
 * pacing — far less robotic than a flat blob with fixed breaks. Only tags the
 * neural engine accepts are used (`<p>`, `<s>`, `<break>`, `<prosody rate>`,
 * `<say-as>`, `<phoneme>`, `<sub>`); `<emphasis>`/`<prosody pitch>` are avoided.
 */

/** A Latin legal term and the pronunciation hint Polly should use for it. */
export interface LatinTerm {
  /** The Latin phrase as it appears in text (lowercase, canonical spacing). */
  readonly term: string;
  /** IPA pronunciation — rendered as `<phoneme alphabet="ipa">` when present. */
  readonly ipa?: string;
  /** Spoken respelling — rendered as `<sub alias>` when no `ipa` is supplied. */
  readonly alias?: string;
}

/**
 * A structured document to narrate: an optional spoken title followed by named
 * sections. Headings are spoken as section markers; bodies are split into
 * paragraphs and sentences. Empty fields are skipped by the builder.
 */
export interface SpokenDocument {
  /** Spoken aloud first, slightly slowed, with a long pause after. */
  readonly title?: string;
  /** Ordered sections (e.g. Facts / Issues / Ruling). */
  readonly sections: ReadonlyArray<{
    /** Spoken as a section marker before the body (e.g. "Facts."). */
    readonly heading?: string;
    /** The prose to narrate. */
    readonly body: string;
  }>;
}

/** Reserved options bag for future pacing/prosody tuning of {@link toSsmlDocument}. */
export interface ToSsmlOptions {
  /** Reserved — no tunables are exposed yet. */
  readonly reserved?: never;
}

/**
 * Latin lexicon for Philippine legal audio. Terms Polly mispronounces by
 * default are given either an IPA phoneme or a spoken-respelling alias.
 * Ordered longest-phrase-first so multi-word terms win over any substring.
 */
export const LATIN_LEXICON: readonly LatinTerm[] = [
  { term: 'res ipsa loquitur', ipa: 'reɪz ˈɪpsə ˈloʊkwɪtər' },
  { term: 'ratio decidendi', alias: 'RAY-shee-oh des-ih-DEN-dee' },
  { term: 'amicus curiae', alias: 'uh-MEE-kus KYOOR-ee-eye' },
  { term: 'habeas corpus', alias: 'HAY-bee-us KOR-pus' },
  { term: 'obiter dictum', alias: 'OH-bih-ter DIK-tum' },
  { term: 'stare decisis', ipa: 'ˈstɑːriː dɪˈsaɪsɪs' },
  { term: 'prima facie', alias: 'PRY-muh FAY-shee' },
  { term: 'certiorari', ipa: 'ˌsɜːrʃiəˈrɛəri' },
  { term: 'ex parte', alias: 'eks PAR-tay' },
  { term: 'mandamus', alias: 'man-DAY-mus' },
  { term: 'ponente', alias: 'poh-NEN-teh' },
  { term: 'en banc', alias: 'on bonk' },
];

/**
 * Private-use sentinels bracketing a citation/number digit run inside the
 * intermediate form. Defined via char codes (U+E000/U+E001) so no invisible
 * literal — and no whitespace — sits in source; they survive XML escaping and
 * `\s` collapsing untouched, and are expanded differently per projection:
 * plain digits for normalizedText, a `<say-as interpret-as="digits">` wrapper
 * for SSML.
 */
const NUM_OPEN = String.fromCharCode(0xe000);
const NUM_CLOSE = String.fromCharCode(0xe001);
const NUM_TOKEN_RE = new RegExp(`${NUM_OPEN}(\\d+)${NUM_CLOSE}`, 'g');
const SENTINEL_RE = new RegExp(`[${NUM_OPEN}${NUM_CLOSE}]`, 'g');
const numToken = (digits: string): string => `${NUM_OPEN}${digits}${NUM_CLOSE}`;

/** Matches "G.R. No. 168338" (and GR/G.R./GRN spacing variants). */
const GR_CITATION_RE = /\bG\.?\s?R\.?\s*No\.?\s*([\d,]+)/gi;
/** Case "v." separator — "Roe v. Wade" → "Roe versus Wade". */
const VERSUS_RE = /\bv\.(?=\s)/g;
/** Footnote markers: bracketed numbers "[12]" and superscript digits "¹²³". */
const FOOTNOTE_RE = /\[\d{1,4}\]|[¹²³⁰-⁹]+/g;
/** Standalone "No. 123" (after citations have consumed their own numbers). */
const STANDALONE_NO_RE = /\bNo\.\s*([\d,]+)/g;
/**
 * Currency prefix immediately before an amount: "₱500", "PHP 1,000", "P2.8".
 * A bare "P" must abut a digit, so a middle initial ("Juan P. Cruz") is safe.
 */
const PESO_RE =
  /(?:₱|PHP|\bP)\s?(\d[\d,]*(?:\.\d+)?)(\s+(?:million|billion|trillion|thousand))?/g;
/** All-caps word of length > 3 — title-cased to avoid shouted delivery. */
const ALLCAPS_RE = /\b[A-Z][A-Z&'-]{3,}\b/g;

/** Statute citation abbreviations → spoken name; numbers digit-ized like G.R. */
const STATUTE_CITATIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bR\.?\s?A\.?\s*(?:No\.?\s*)?([\d,]+)/gi, 'Republic Act'],
  [/\bP\.?\s?D\.?\s*(?:No\.?\s*)?([\d,]+)/gi, 'Presidential Decree'],
  [/\bB\.?\s?P\.?\s*(?:No\.?\s*)?([\d,]+)/gi, 'Batas Pambansa'],
  [/\bE\.?\s?O\.?\s*(?:No\.?\s*)?([\d,]+)/gi, 'Executive Order'],
];

/**
 * Detects a Python-repr dict `{'issue': '...', 'holding': '...'}` (single OR
 * double quotes, optional leading bullet). ~304 legacy digests embed these.
 */
const DICT_BLOB_RE =
  /-?\s*\{\s*(['"])issue\1\s*:\s*(['"])([\s\S]*?)\2\s*,\s*(['"])holding\4\s*:\s*(['"])([\s\S]*?)\5\s*\}/gi;

/** Abbreviation tokens that must NOT terminate a spoken sentence. */
const GUARD_ABBREVS = new Set<string>([
  'no.', 'inc.', 'corp.', 'co.', 'ltd.', 'sr.', 'jr.', 'mr.', 'mrs.', 'ms.',
  'dr.', 'st.', 'ave.', 'phil.', 'rep.', 'pp.', 'vol.', 'al.', 'etc.',
]);

/** Sentence boundary: end punctuation, optional closing quote, space, capital. */
const SENTENCE_SPLIT_RE = /(?<=[.?!])["')\]]?\s+(?=["'(\[]?[A-Z0-9])/;

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Escape XML metacharacters in free text before splicing in SSML tags. */
const escapeXml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const stripFootnotes = (value: string): string => value.replace(FOOTNOTE_RE, '');

const digitsOnly = (value: string): string => value.replace(/[^\d]/g, '');

/** Trim and ensure the string ends with sentence-final punctuation. */
const ensureStop = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.length === 0) return trimmed;
  return /[.?!]$/.test(trimmed) ? trimmed : `${trimmed}.`;
};

/**
 * Rewrite embedded `{'issue': ..., 'holding': ...}` dict blobs to prose:
 * "Issue: {issue} The Court held: {holding}". Quotes/braces are dropped.
 */
const rewriteDictBlobs = (value: string): string =>
  value.replace(
    DICT_BLOB_RE,
    (_match, _q1, _q2, issue: string, _q4, _q5, holding: string) =>
      `Issue: ${ensureStop(issue)} The Court held: ${ensureStop(holding)}`,
  );

/**
 * Strip residual structural artifacts so no braces/brackets or wrapper quotes
 * reach Polly. Possessive/contraction apostrophes (letter-flanked) are kept.
 */
const stripBraceArtifacts = (value: string): string =>
  value
    .replace(/[{}[\]]/g, ' ')
    .replace(/(^|[^A-Za-z0-9])'+/g, '$1')
    .replace(/'+([^A-Za-z0-9]|$)/g, '$1');

/** Title-case an all-caps word (length > 3) to avoid a shouted reading. */
const titleCaseAllCaps = (value: string): string =>
  value.replace(ALLCAPS_RE, (word) => word.charAt(0) + word.slice(1).toLowerCase());

/**
 * Apply every textual normalization, leaving citation/number runs wrapped in
 * sentinels. Runs once per body/heading/title; the result feeds both
 * projections (plain digits vs `<say-as>` digits) and sentence splitting.
 *
 * Order matters: dict hygiene first; citations (which consume their own "No.")
 * before the standalone-"No." rule; abbreviation expansions before sentence
 * splitting; de-shouting last so inserted words ("Number") are untouched.
 */
const expandText = (raw: string): string => {
  let value = stripFootnotes((raw ?? '').replace(SENTINEL_RE, ''));
  value = rewriteDictBlobs(value);
  value = stripBraceArtifacts(value);

  value = value.replace(
    GR_CITATION_RE,
    (_match, num: string) => `G R Number ${numToken(digitsOnly(num))}`,
  );
  for (const [pattern, label] of STATUTE_CITATIONS) {
    value = value.replace(
      pattern,
      (_match, num: string) => `${label} Number ${numToken(digitsOnly(num))}`,
    );
  }

  value = value
    .replace(VERSUS_RE, 'versus')
    .replace(/\bSecs\./g, 'Sections')
    .replace(/\bSec\./g, 'Section')
    .replace(/\bArts\./g, 'Articles')
    .replace(/\bArt\./g, 'Article')
    .replace(/\bC\.J\./g, 'Chief Justice')
    .replace(/\bHon\./g, 'Honorable')
    // Negative lookahead spares initial chains: "J.B.L." keeps its "J.".
    .replace(/\bJ\.(?![A-Z]\.)/g, 'Justice');

  value = value.replace(
    STANDALONE_NO_RE,
    (_match, num: string) => `Number ${numToken(digitsOnly(num))}`,
  );

  value = value.replace(/§\s*/g, 'Section ').replace(/\s*%/g, ' percent');

  value = value.replace(
    PESO_RE,
    (_match, amount: string, scale: string | undefined) =>
      `${amount}${scale ?? ''} pesos`,
  );

  return titleCaseAllCaps(value);
};

/**
 * Split into trimmed paragraphs on blank lines, collapsing intra-paragraph
 * whitespace runs to single spaces. Empty paragraphs are dropped.
 */
const toParagraphs = (value: string): string[] =>
  value
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter((paragraph) => paragraph.length > 0);

/** Lowercased final token of a piece, with trailing quotes/brackets stripped. */
const lastToken = (value: string): string => {
  const match = value.trim().match(/(\S+)\s*$/);
  return match ? (match[1] ?? '').replace(/["')\]]+$/, '').toLowerCase() : '';
};

/** A token guards against a split if it is a known abbrev or an initial chain. */
const isGuardToken = (token: string): boolean =>
  GUARD_ABBREVS.has(token) || /^(?:[a-z]\.)+$/.test(token);

const wordCount = (value: string): number => {
  const trimmed = value.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
};

/**
 * Split a single paragraph into sentences. Splits on terminal punctuation
 * followed by an uppercase/digit start, but never after a guard abbreviation,
 * and folds any sub-two-word fragment into a neighbour.
 */
const splitSentences = (paragraph: string): string[] => {
  const pieces = paragraph
    .split(SENTENCE_SPLIT_RE)
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0);
  if (pieces.length <= 1) return pieces;

  // Re-glue a piece onto the previous one when the previous ended on a guard.
  const guarded: string[] = [];
  for (const piece of pieces) {
    const prev = guarded[guarded.length - 1];
    if (prev !== undefined && isGuardToken(lastToken(prev))) {
      guarded[guarded.length - 1] = `${prev} ${piece}`;
    } else {
      guarded.push(piece);
    }
  }

  // Fold tiny fragments into the next sentence (or the previous, at the tail).
  const merged: string[] = [];
  for (let i = 0; i < guarded.length; i += 1) {
    const piece = guarded[i] ?? '';
    const next = guarded[i + 1];
    const tail = merged[merged.length - 1];
    if (wordCount(piece) < 2 && next !== undefined) {
      guarded[i + 1] = `${piece} ${next}`;
    } else if (wordCount(piece) < 2 && tail !== undefined) {
      merged[merged.length - 1] = `${tail} ${piece}`;
    } else {
      merged.push(piece);
    }
  }
  return merged;
};

/** Wrap a matched Latin term in the appropriate SSML pronunciation tag. */
const latinTag = (entry: LatinTerm, matched: string): string =>
  entry.ipa
    ? `<phoneme alphabet="ipa" ph="${entry.ipa}">${matched}</phoneme>`
    : `<sub alias="${entry.alias ?? matched}">${matched}</sub>`;

/** Wrap every known Latin term occurrence in its pronunciation tag (SSML only). */
const wrapLatinTerms = (value: string): string =>
  LATIN_LEXICON.reduce((acc, entry) => {
    const pattern = new RegExp(`\\b${escapeRegExp(entry.term)}\\b`, 'gi');
    return acc.replace(pattern, (matched) => latinTag(entry, matched));
  }, value);

const toPlainNums = (value: string): string => value.replace(NUM_TOKEN_RE, '$1');
const toSsmlNums = (value: string): string =>
  value.replace(NUM_TOKEN_RE, '<say-as interpret-as="digits">$1</say-as>');

/** Render an inline fragment (title/heading): collapsed, no `<p>`/`<s>` frame. */
const renderInline = (text: string): { plain: string; ssml: string } => {
  const collapsed = expandText(text).replace(/\s+/g, ' ').trim();
  return {
    plain: toPlainNums(collapsed),
    ssml: wrapLatinTerms(toSsmlNums(escapeXml(collapsed))),
  };
};

/** Render a body into per-paragraph plain text and `<p><s>…</s></p>` SSML. */
const renderBody = (body: string): { plain: string[]; ssml: string[] } => {
  const plain: string[] = [];
  const ssml: string[] = [];
  for (const paragraph of toParagraphs(expandText(body))) {
    const sentences = splitSentences(paragraph);
    if (sentences.length === 0) continue;
    plain.push(toPlainNums(sentences.join(' ')));
    const wrapped = sentences
      .map((sentence) => `<s>${wrapLatinTerms(toSsmlNums(escapeXml(sentence)))}</s>`)
      .join('');
    ssml.push(`<p>${wrapped}</p>`);
  }
  return { plain, ssml };
};

/** Result of {@link toSsmlDocument}: Polly-ready SSML plus its plain projection. */
export interface SsmlResult {
  readonly ssml: string;
  readonly normalizedText: string;
}

/**
 * Render a structured {@link SpokenDocument} to Polly SSML plus a plain spoken
 * projection. The title is slightly slowed with a long trailing pause; each
 * heading is paced as a section marker; bodies become `<p>`/`<s>` structures.
 *
 * Normalizations applied to both projections (tags are SSML-only):
 *   - Footnote markers stripped; `{'issue':…,'holding':…}` blobs rewritten to
 *     prose; residual braces/wrapper-quotes removed.
 *   - `G.R.`/`R.A.`/`P.D.`/`B.P.`/`E.O.` citations expanded with digit-spoken
 *     numbers; standalone `No. N` → "Number N"; `§` → "Section"; `%` → "percent".
 *   - Peso amounts (`₱`/`PHP`/`P`) re-voiced as "… pesos".
 *   - All-caps words de-shouted to Title Case; Latin terms given pronunciations.
 */
export function toSsmlDocument(
  doc: SpokenDocument,
  _opts?: ToSsmlOptions,
): SsmlResult {
  const sections = Array.isArray(doc?.sections) ? doc.sections : [];
  const plainBlocks: string[] = [];
  const ssmlParts: string[] = [];

  const titleText = (doc?.title ?? '').trim();
  if (titleText.length > 0) {
    const { plain, ssml } = renderInline(titleText);
    if (plain.length > 0) {
      plainBlocks.push(plain);
      ssmlParts.push(
        `<p><prosody rate="96%">${ssml}</prosody></p><break time="900ms"/>`,
      );
    }
  }

  for (const section of sections) {
    // Skip a section whose body renders to nothing — its heading would be a
    // dangling marker with no content to introduce.
    const rendered = renderBody(section?.body ?? '');
    if (rendered.plain.length === 0) continue;

    const headingText = (section?.heading ?? '').trim();
    if (headingText.length > 0) {
      const { plain, ssml } = renderInline(headingText);
      if (plain.length > 0) {
        plainBlocks.push(ensureStop(plain));
        ssmlParts.push(
          `<break time="600ms"/><p><prosody rate="92%">${ensureStop(ssml)}</prosody></p><break time="350ms"/>`,
        );
      }
    }
    plainBlocks.push(...rendered.plain);
    ssmlParts.push(...rendered.ssml);
  }

  return {
    ssml: `<speak>${ssmlParts.join('')}</speak>`,
    normalizedText: plainBlocks.join('\n\n'),
  };
}

/**
 * Back-compat entry point: normalize a single untitled blob of legal text.
 * Delegates to {@link toSsmlDocument} with one heading-less section.
 */
export function toSsml(text: string): SsmlResult {
  return toSsmlDocument({ sections: [{ body: text ?? '' }] });
}

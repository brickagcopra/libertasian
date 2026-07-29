/**
 * Legal SSML normalizer — production-grade legal narration.
 *
 * Transformation of raw legal prose (digests, bar-exam answers and legal
 * document sections) into Amazon Polly-ready SSML, a plain normalized-text
 * projection, and a spoken-literal projection for non-SSML TTS backends.
 * No class-validator, no I/O, and no DI container required — safe to unit-test
 * and to call from a worker. (A bare `Logger` is used for one debug-level
 * lexicon warning; it needs no DI bootstrap.)
 *
 * The three outputs serve different consumers:
 *   - `ssml`           → fed to Polly's SynthesizeSpeech (TextType: 'ssml').
 *   - `normalizedText` → the human-readable spoken form; used for charCount,
 *                        content hashing, and transcript display.
 *   - spoken segments  → plain text for backends with no SSML support (Kokoro),
 *                        via {@link toSpokenSegments}.
 *
 * SSML is structure-aware: a {@link SpokenDocument} renders a title, named
 * section headings, paragraphs (`<p>`) and sentences (`<s>`) with deliberate
 * pacing — far less robotic than a flat blob with fixed breaks. Only tags the
 * neural engine accepts are used (`<p>`, `<s>`, `<break>`, `<prosody rate>`,
 * `<say-as>`, `<phoneme>`, `<sub>`); `<emphasis>`/`<prosody pitch>` are avoided.
 *
 * INVARIANT: `normalizedText` is the content-hash input for every existing
 * rendition. The spoken-literal projection is strictly additive — it must never
 * feed back into `plain`/`ssml`, or every stored contentHash would change and
 * the whole corpus would silently re-synthesize.
 */
import { Logger } from '@nestjs/common';

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
    /**
     * Stable key carried verbatim into every manifest segment of this section
     * so the web client can group segments back onto its own section blocks.
     * Falls back to a slug of the heading (or `section-{index}`) when omitted.
     */
    readonly key?: string;
    /** The prose to narrate. */
    readonly body: string;
  }>;
}

/** The kind of a syncable read-along unit. */
export type ManifestKind = 'title' | 'heading' | 'sentence';

/**
 * One read-along segment: the stable `<mark>` id, what kind of unit it is, the
 * section it belongs to, and the ORIGINAL (un-normalized, display-ready) text
 * of that unit. The mark id and the manifest entry are produced together in a
 * single pass through {@link toSsmlDocument} so the manifest order, the mark
 * order, and (after joining onto speech-mark timestamps) the segment order are
 * always identical.
 */
export interface ManifestEntry {
  readonly id: string;
  readonly kind: ManifestKind;
  readonly sectionKey: string;
  readonly text: string;
  /**
   * 0-based paragraph index of a `sentence` segment WITHIN its section (reset
   * per section). Lets the web client regroup the flat sentence list back into
   * the original DB paragraphs so the inline read-along preserves paragraph
   * breaks. Undefined for `title`/`heading` segments.
   */
  readonly paragraphIndex?: number;
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
  // Carries BOTH: Polly keeps the `<phoneme>` (latinTag prefers `ipa`, so its
  // SSML is unchanged), while the non-SSML path uses the alias. Measured in the
  // Kokoro spike: without an alias its G2P renders this as the English verb
  // "stare" + "de-SIS-iz" (stˈɛɹ dᵻsˈɪsiz).
  { term: 'stare decisis', ipa: 'ˈstɑːriː dɪˈsaɪsɪs', alias: 'STAH-ree dih-SY-sis' },
  { term: 'prima facie', alias: 'PRY-muh FAY-shee' },
  // `certiorari` and `res ipsa loquitur` need no alias — Kokoro's own G2P
  // already matches these IPA strings closely (verified in the spike).
  { term: 'certiorari', ipa: 'ˌsɜːrʃiəˈrɛəri' },
  { term: 'ex parte', alias: 'eks PAR-tay' },
  { term: 'mandamus', alias: 'man-DAY-mus' },
  { term: 'ponente', alias: 'poh-NEN-teh' },
  { term: 'en banc', alias: 'on bonk' },
];

/** Pause lengths, shared by the SSML `<break>` tags and `leadSilenceMs`. */
const TITLE_TRAIL_BREAK_MS = 900;
const HEADING_LEAD_BREAK_MS = 700;
const HEADING_TRAIL_BREAK_MS = 400;

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

/**
 * Abbreviation tokens that must NOT terminate a spoken sentence. Sentence
 * splitting now runs on the lightly-cleaned (un-expanded) text — so periods
 * after legal abbreviations like "Art."/"Sec."/"Hon." are still present at
 * split time and must be guarded here (previously the citation expansion ran
 * first and dissolved them). Initial chains (e.g. "G.R.", "J.B.L.") are guarded
 * separately by {@link isGuardToken}.
 */
const GUARD_ABBREVS = new Set<string>([
  'no.', 'inc.', 'corp.', 'co.', 'ltd.', 'sr.', 'jr.', 'mr.', 'mrs.', 'ms.',
  'dr.', 'st.', 'ave.', 'phil.', 'rep.', 'pp.', 'vol.', 'al.', 'etc.',
  'art.', 'arts.', 'sec.', 'secs.', 'hon.',
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
 * Display-safe prose hygiene shared by BOTH projections (spoken SSML and the
 * read-along manifest). Strips footnote markers, rewrites `{issue,holding}`
 * dict blobs to prose, and removes residual brace/wrapper-quote artifacts —
 * nothing here changes wording or pronunciation, so the cleaned text is a
 * faithful, un-normalized display form. Sentence splitting runs on THIS output
 * so display sentences and spoken sentences share identical boundaries.
 */
const cleanProse = (raw: string): string => {
  let value = stripFootnotes((raw ?? '').replace(SENTINEL_RE, ''));
  value = rewriteDictBlobs(value);
  value = stripBraceArtifacts(value);
  return value;
};

/**
 * Spoken-only normalization, applied per sentence AFTER cleaning + splitting,
 * leaving citation/number runs wrapped in sentinels. This is the layer that
 * makes the audio natural but the text unsuitable for on-page display:
 * citations expanded ("G.R. No." → "G R Number"), digits spelled, peso/percent
 * re-voiced, all-caps de-shouted.
 *
 * Order matters: citations (which consume their own "No.") before the
 * standalone-"No." rule; de-shouting last so inserted words ("Number") survive.
 */
const expandSpoken = (cleaned: string): string => {
  let value = (cleaned ?? '').replace(
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

const spokenLogger = new Logger('LegalSsmlUtil');

const DIGIT_WORDS = [
  'zero', 'one', 'two', 'three', 'four',
  'five', 'six', 'seven', 'eight', 'nine',
] as const;

/** "168338" → "one six eight three three eight" (the `<say-as digits>` equivalent). */
const spellDigits = (digits: string): string =>
  digits
    .split('')
    .map((d) => DIGIT_WORDS[Number(d)] ?? d)
    .join(' ');

const toLiteralNums = (value: string): string =>
  value.replace(NUM_TOKEN_RE, (_match, digits: string) => spellDigits(digits));

/**
 * Statutory paragraph form: "5(2)" → "five, paragraph two". Polly renders this
 * acceptably from the raw text, but Kokoro speaks the parenthesis inline
 * ("five(two"), so the non-SSML projection spells it out. Runs BEFORE
 * {@link toLiteralNums} so it only ever sees bare (un-sentinelled) digit runs.
 */
const PARAGRAPH_FORM_RE = /(\d+)\s*\((\d+)\)/g;
const expandParagraphForms = (value: string): string =>
  value.replace(
    PARAGRAPH_FORM_RE,
    (_match, outer: string, inner: string) =>
      `${spellDigits(outer)}, paragraph ${spellDigits(inner)}`,
  );

/**
 * Philippine civil-service position levels ("Cashier I", "Administrative
 * Officer V"). Without this Kokoro reads the trailing numeral as the letter
 * "eye". Deliberately gated on an explicit position-noun allowlist so a
 * sentence-medial pronoun "I" is never rewritten.
 */
const ROMAN_WORDS: Readonly<Record<string, string>> = {
  I: 'One', II: 'Two', III: 'Three', IV: 'Four', V: 'Five',
  VI: 'Six', VII: 'Seven', VIII: 'Eight', IX: 'Nine', X: 'Ten',
};
const POSITION_TITLES = [
  'Accountant', 'Administrator', 'Aide', 'Analyst', 'Architect', 'Assistant',
  'Associate', 'Attorney', 'Auditor', 'Cashier', 'Chemist', 'Clerk', 'Dentist',
  'Director', 'Economist', 'Engineer', 'Examiner', 'Inspector', 'Instructor',
  'Librarian', 'Manager', 'Nurse', 'Officer', 'Physician', 'Planner',
  'Psychologist', 'Specialist', 'Statistician', 'Stenographer', 'Supervisor',
  'Teacher', 'Technician', 'Trainer', 'Utility', 'Veterinarian', 'Warden',
];
// Numeral alternatives are longest-first so "IV"/"IX" are not shadowed by "I".
const POSITION_ROMAN_RE = new RegExp(
  `\\b(${POSITION_TITLES.join('|')})\\s+(VIII|VII|VI|IV|IX|III|II|I|X|V)\\b`,
  'g',
);
const expandPositionRomans = (value: string): string =>
  value.replace(
    POSITION_ROMAN_RE,
    (_match, title: string, roman: string) =>
      `${title} ${ROMAN_WORDS[roman] ?? roman}`,
  );

/** Terms already reported as alias-less — keeps the debug log to once per term. */
const aliasGapLogged = new Set<string>();

/**
 * Replace each Latin term with its spoken respelling. An entry carrying only
 * `ipa` has no plain-text equivalent, so the matched word is emitted unchanged
 * and reported once at debug so aliases can be backfilled.
 */
const substituteLatinAliases = (value: string): string =>
  LATIN_LEXICON.reduce((acc, entry) => {
    const pattern = new RegExp(`\\b${escapeRegExp(entry.term)}\\b`, 'gi');
    return acc.replace(pattern, (matched) => {
      if (entry.alias) return entry.alias;
      if (!aliasGapLogged.has(entry.term)) {
        aliasGapLogged.add(entry.term);
        spokenLogger.debug(
          `Latin term "${entry.term}" has ipa but no alias; emitting verbatim on the non-SSML path`,
        );
      }
      return matched;
    });
  }, value);

/** Plain-text projection for TTS backends with no SSML support. */
const toSpokenLiteral = (spoken: string): string =>
  toLiteralNums(
    expandParagraphForms(expandPositionRomans(substituteLatinAliases(spoken))),
  );

/** Spoken projections (plain + SSML + literal) of a single cleaned fragment. */
const renderSpoken = (
  cleaned: string,
): { plain: string; ssml: string; literal: string } => {
  const spoken = expandSpoken(cleaned);
  return {
    plain: toPlainNums(spoken),
    ssml: wrapLatinTerms(toSsmlNums(escapeXml(spoken))),
    literal: toSpokenLiteral(spoken),
  };
};

/** Render an inline fragment (title/heading): collapsed, no `<p>`/`<s>` frame. */
const renderInline = (
  text: string,
): { plain: string; ssml: string; literal: string } => {
  const collapsed = cleanProse(text).replace(/\s+/g, ' ').trim();
  return renderSpoken(collapsed);
};

/** One read-along unit: its original display text + spoken projections. */
interface RenderedSentence {
  /** Original, un-normalized sentence text — the manifest/display source. */
  readonly display: string;
  /** Spoken plain projection (digits expanded) — for normalizedText + hashing. */
  readonly plain: string;
  /** Spoken SSML fragment (no `<s>` frame, no `<mark>`). */
  readonly ssml: string;
  /** Spoken plain-text fragment for non-SSML backends. */
  readonly literal: string;
}

/**
 * Render a body into paragraphs of sentences. Splitting runs on the cleaned
 * (un-expanded) text so each sentence's `display` form is faithful to the
 * source while its `plain`/`ssml` forms carry the spoken normalization.
 */
const renderBody = (body: string): RenderedSentence[][] => {
  const paragraphs: RenderedSentence[][] = [];
  for (const paragraph of toParagraphs(cleanProse(body))) {
    const sentences = splitSentences(paragraph);
    if (sentences.length === 0) continue;
    paragraphs.push(
      sentences.map((sentence) => ({
        display: sentence,
        ...renderSpoken(sentence),
      })),
    );
  }
  return paragraphs;
};

/** Slugify a heading into a stable section key (fallback when none supplied). */
const slugKey = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Result of {@link toSsmlDocument}: Polly-ready SSML plus its plain projection. */
export interface SsmlResult {
  readonly ssml: string;
  readonly normalizedText: string;
  /**
   * Ordered read-along segments, one per `<mark>` emitted into the SSML (same
   * order). Empty when the document renders to nothing. Joined onto Polly's
   * `ssml`-type speech marks downstream to produce the read-along manifest.
   */
  readonly manifest: ManifestEntry[];
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
/**
 * One ordered, id-assigned unit of a walked {@link SpokenDocument}. Ids are
 * assigned HERE and nowhere else, so every projection built from the same walk
 * is guaranteed to agree on id values and order by construction.
 */
type DocNode =
  | {
      readonly kind: 'title';
      readonly id: string;
      readonly display: string;
      readonly plain: string;
      readonly ssml: string;
      readonly literal: string;
    }
  | {
      readonly kind: 'heading';
      readonly id: string;
      readonly sectionKey: string;
      readonly display: string;
      readonly plain: string;
      readonly ssml: string;
      readonly literal: string;
    }
  | {
      readonly kind: 'paragraph';
      readonly sectionKey: string;
      readonly paragraphIndex: number;
      readonly sentences: ReadonlyArray<{ readonly id: string } & RenderedSentence>;
    };

/**
 * Walk a document once, assigning the monotonic `seg-N` ids. Both
 * {@link toSsmlDocument} and {@link toSpokenSegments} consume this, which is
 * what makes their id sequences identical rather than merely parallel.
 */
const walkDocument = (doc: SpokenDocument): DocNode[] => {
  const nodes: DocNode[] = [];
  let seq = 0;
  const nextId = (): string => `seg-${seq++}`;

  const titleText = (doc?.title ?? '').trim();
  if (titleText.length > 0) {
    const rendered = renderInline(titleText);
    if (rendered.plain.length > 0) {
      nodes.push({ kind: 'title', id: nextId(), display: titleText, ...rendered });
    }
  }

  const sections = Array.isArray(doc?.sections) ? doc.sections : [];
  sections.forEach((section, index) => {
    // Skip a section whose body renders to nothing — its heading would be a
    // dangling marker with no content to introduce.
    const paragraphs = renderBody(section?.body ?? '');
    if (paragraphs.length === 0) return;

    const headingText = (section?.heading ?? '').trim();
    const sectionKey =
      (section?.key ?? '').trim() ||
      (headingText ? slugKey(headingText) : '') ||
      `section-${index}`;

    if (headingText.length > 0) {
      const rendered = renderInline(headingText);
      if (rendered.plain.length > 0) {
        nodes.push({
          kind: 'heading',
          id: nextId(),
          sectionKey,
          display: headingText,
          ...rendered,
        });
      }
    }

    paragraphs.forEach((sentences, paragraphIndex) => {
      nodes.push({
        kind: 'paragraph',
        sectionKey,
        paragraphIndex,
        sentences: sentences.map((sentence) => ({ id: nextId(), ...sentence })),
      });
    });
  });

  return nodes;
};

export function toSsmlDocument(
  doc: SpokenDocument,
  _opts?: ToSsmlOptions,
): SsmlResult {
  const plainBlocks: string[] = [];
  const ssmlParts: string[] = [];
  const manifest: ManifestEntry[] = [];

  for (const node of walkDocument(doc)) {
    if (node.kind === 'title') {
      plainBlocks.push(node.plain);
      // Title keeps its slower 96% rate; drc + x-loud make it audibly distinct.
      ssmlParts.push(
        `<mark name="${node.id}"/><p><amazon:effect name="drc"><prosody volume="x-loud" rate="96%">${node.ssml}</prosody></amazon:effect></p><break time="${TITLE_TRAIL_BREAK_MS}ms"/>`,
      );
      manifest.push({
        id: node.id,
        kind: 'title',
        sectionKey: 'title',
        text: node.display,
      });
      continue;
    }

    if (node.kind === 'heading') {
      plainBlocks.push(ensureStop(node.plain));
      // Section markers: a long lead-in pause, then a drc + x-loud + slowed
      // delivery so the heading stands out from the body it introduces.
      // (`<emphasis>` / `<prosody pitch>` are rejected on neural — never used.)
      ssmlParts.push(
        `<break time="${HEADING_LEAD_BREAK_MS}ms"/><mark name="${node.id}"/><amazon:effect name="drc"><prosody volume="x-loud" rate="90%"><p>${ensureStop(node.ssml)}</p></prosody></amazon:effect><break time="${HEADING_TRAIL_BREAK_MS}ms"/>`,
      );
      manifest.push({
        id: node.id,
        kind: 'heading',
        sectionKey: node.sectionKey,
        // The exact on-page display heading — NOT the spoken/normalized form.
        text: node.display,
      });
      continue;
    }

    const parts: string[] = [];
    const plain: string[] = [];
    for (const sentence of node.sentences) {
      parts.push(`<mark name="${sentence.id}"/><s>${sentence.ssml}</s>`);
      plain.push(sentence.plain);
      manifest.push({
        id: sentence.id,
        kind: 'sentence',
        sectionKey: node.sectionKey,
        text: sentence.display,
        paragraphIndex: node.paragraphIndex,
      });
    }
    plainBlocks.push(plain.join(' '));
    ssmlParts.push(`<p>${parts.join('')}</p>`);
  }

  return {
    ssml: `<speak>${ssmlParts.join('')}</speak>`,
    normalizedText: plainBlocks.join('\n\n'),
    manifest,
  };
}

/** One plain-text unit for a non-SSML TTS backend. */
export interface SpokenSegment {
  /** Matches the `<mark name="seg-N"/>` id `toSsmlDocument` emits, same order. */
  readonly id: string;
  /** Plain spoken text — no tags, digits spelled, Latin aliases substituted. */
  readonly text: string;
  /** Silence to prepend before this segment, mirroring the SSML `<break>`s. */
  readonly leadSilenceMs: number;
}

/**
 * Project a document to plain spoken segments for a backend with no SSML
 * support. Every `<break>` in the SSML becomes `leadSilenceMs` on the segment
 * that follows it, so pacing survives the loss of the tags; `<prosody>`,
 * `<amazon:effect>`, `<p>` and `<s>` have no plain-text equivalent and are
 * dropped.
 */
export function toSpokenSegments(doc: SpokenDocument): SpokenSegment[] {
  const segments: SpokenSegment[] = [];
  let pendingSilenceMs = 0;

  const push = (id: string, text: string): void => {
    segments.push({ id, text, leadSilenceMs: pendingSilenceMs });
    pendingSilenceMs = 0;
  };

  for (const node of walkDocument(doc)) {
    if (node.kind === 'title') {
      push(node.id, node.literal);
      // `<break>` follows the title mark → lands on the NEXT segment.
      pendingSilenceMs += TITLE_TRAIL_BREAK_MS;
      continue;
    }
    if (node.kind === 'heading') {
      // `<break>` precedes the heading mark → lands on the heading itself.
      pendingSilenceMs += HEADING_LEAD_BREAK_MS;
      push(node.id, ensureStop(node.literal));
      pendingSilenceMs += HEADING_TRAIL_BREAK_MS;
      continue;
    }
    for (const sentence of node.sentences) {
      push(sentence.id, sentence.literal);
    }
  }

  return segments;
}

/**
 * Back-compat entry point: normalize a single untitled blob of legal text.
 * Delegates to {@link toSsmlDocument} with one heading-less section.
 */
export function toSsml(text: string): SsmlResult {
  return toSsmlDocument({ sections: [{ body: text ?? '' }] });
}

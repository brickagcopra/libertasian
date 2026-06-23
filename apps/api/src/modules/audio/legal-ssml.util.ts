/**
 * Legal SSML normalizer — Audio Corpus Phase 1 foundation.
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
 * Latin lexicon for Philippine legal audio. Terms Polly mispronounces by
 * default are given either an IPA phoneme or a spoken-respelling alias.
 * Ordered longest-phrase-first so multi-word terms win over any substring.
 */
export const LATIN_LEXICON: readonly LatinTerm[] = [
  { term: 'res ipsa loquitur', ipa: 'reɪz ˈɪpsə ˈloʊkwɪtər' },
  { term: 'stare decisis', ipa: 'ˈstɑːriː dɪˈsaɪsɪs' },
  { term: 'certiorari', ipa: 'ˌsɜːrʃiəˈrɛəri' },
  { term: 'ponente', alias: 'poh-NEN-teh' },
  { term: 'en banc', alias: 'on bonk' },
];

/** Pause inserted between paragraphs in the synthesized audio. */
const PARAGRAPH_BREAK = '<break time="700ms"/>';

/** Matches "G.R. No. 168338" (and GR/G.R./GRN spacing variants). */
const GR_CITATION_RE = /\bG\.?\s?R\.?\s*No\.?\s*([\d,]+)/gi;
/** Case "v." separator — "Roe v. Wade" → "Roe versus Wade". */
const VERSUS_RE = /\bv\.(?=\s)/g;
/** Footnote markers: bracketed numbers "[12]" and superscript digits "¹²³". */
const FOOTNOTE_RE = /\[\d{1,4}\]|[¹²³⁰-⁹]+/g;

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Escape XML metacharacters in free text before splicing in SSML tags. */
const escapeXml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const stripFootnotes = (value: string): string => value.replace(FOOTNOTE_RE, '');

const digitsOnly = (value: string): string => value.replace(/[^\d]/g, '');

/**
 * Expand the legal abbreviations that read identically in plain and spoken
 * form. Title order matters: "C.J." must expand before the "J." rule, else the
 * trailing "J." inside "C.J." would be rewritten first.
 */
const expandAbbreviations = (value: string): string =>
  value
    .replace(VERSUS_RE, 'versus')
    .replace(/\bSecs\./g, 'Sections')
    .replace(/\bSec\./g, 'Section')
    .replace(/\bArts\./g, 'Articles')
    .replace(/\bArt\./g, 'Article')
    .replace(/\bC\.J\./g, 'Chief Justice')
    .replace(/\bHon\./g, 'Honorable')
    .replace(/\bJ\./g, 'Justice');

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

/** Wrap a matched Latin term in the appropriate SSML pronunciation tag. */
const latinTag = (entry: LatinTerm, matched: string): string =>
  entry.ipa
    ? `<phoneme alphabet="ipa" ph="${entry.ipa}">${matched}</phoneme>`
    : `<sub alias="${entry.alias ?? matched}">${matched}</sub>`;

/** Wrap every known Latin term occurrence in its pronunciation tag. */
const wrapLatinTerms = (value: string): string =>
  LATIN_LEXICON.reduce((acc, entry) => {
    const pattern = new RegExp(`\\b${escapeRegExp(entry.term)}\\b`, 'gi');
    return acc.replace(pattern, (matched) => latinTag(entry, matched));
  }, value);

/** Result of {@link toSsml}: Polly-ready SSML plus its plain-text projection. */
export interface SsmlResult {
  readonly ssml: string;
  readonly normalizedText: string;
}

/**
 * Normalize raw legal text into Polly SSML and a plain spoken-text projection.
 *
 * Rules applied:
 *   - Footnote markers (`[12]`, superscripts) stripped.
 *   - `G.R. No. X` → "G R Number X" (digits spoken individually in SSML).
 *   - `v.` → "versus"; `Sec./Art.` → "Section/Article"; `C.J./J./Hon.` → titles.
 *   - Latin terms wrapped in `<phoneme>`/`<sub>` (SSML only).
 *   - Paragraph breaks become `<break>` pauses.
 */
export function toSsml(text: string): SsmlResult {
  const source = stripFootnotes(text ?? '');

  // Plain-text projection: digits stay as written so charCount/hash are stable.
  const normalizedParagraphs = toParagraphs(
    expandAbbreviations(
      source.replace(
        GR_CITATION_RE,
        (_match, num: string) => `G R Number ${digitsOnly(num)}`,
      ),
    ),
  );
  const normalizedText = normalizedParagraphs.join('\n\n');

  // SSML projection: escape first, then splice in tags (digits via say-as).
  const ssmlBody = wrapLatinTerms(
    expandAbbreviations(
      escapeXml(source).replace(
        GR_CITATION_RE,
        (_match, num: string) =>
          `G R Number <say-as interpret-as="digits">${digitsOnly(num)}</say-as>`,
      ),
    ),
  );
  const ssml = `<speak>${toParagraphs(ssmlBody).join(PARAGRAPH_BREAK)}</speak>`;

  return { ssml, normalizedText };
}

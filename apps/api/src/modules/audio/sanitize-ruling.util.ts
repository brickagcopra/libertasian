/**
 * Server mirror of the web `sanitizeRulingText`
 * (apps/web/src/features/digests/lib/sanitize-ruling.ts).
 *
 * The digest page renders the ruling as `sanitizeRulingText(digest.ruling)`,
 * so the read-along manifest — built from the SAME ruling string — must apply
 * the identical cleanup BEFORE the SSML normalizer segments it, otherwise the
 * ruling text would visibly change the instant the user clicks Listen. Kept in
 * lockstep with the web copy (pure regex, no deps); duplicated rather than
 * shared because the prod Docker build does not build a shared package's dist.
 */
export function sanitizeRulingText(input: string | null | undefined): string {
  if (!input) return '';

  let out = input;

  // Unescape literal "\n" / "\r" sequences (two characters) to real newlines.
  out = out.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\r/g, '\n');

  // Smart quotes -> straight quotes.
  out = out
    .replace(/[“”‟″❝❞]/g, '"')
    .replace(/[‘’‛′❛❜]/g, "'");

  // Em-dash / en-dash / minus-ish -> " — " with single spaces.
  out = out.replace(/\s*[—–−]\s*/g, ' — ');

  // Strip markdown artifacts leaked from LLM output.
  out = out
    .replace(/```+/g, '') // triple+ backtick fences
    .replace(/`+/g, '') // stray inline backticks
    .replace(/\*\*/g, '') // bold markers
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, ''); // ATX headers at line start

  // Bullet glyphs -> "- ".
  out = out.replace(/[•●▪◦·]\s*/g, '- ');

  // Collapse 3+ consecutive newlines down to 2.
  out = out.replace(/\n{3,}/g, '\n\n');

  // Trim trailing whitespace on each line without collapsing blank-line gaps.
  out = out.replace(/[ \t]+$/gm, '');

  return out.trim();
}

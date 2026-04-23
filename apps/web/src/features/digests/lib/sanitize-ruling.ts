/**
 * Normalize the special characters and stray markdown artifacts LLMs often emit
 * in digest ruling text so the rendered output stays readable.
 */
export function sanitizeRulingText(input: string | null | undefined): string {
  if (!input) return '';

  let out = input;

  // Unescape literal "\n" / "\r" sequences (two characters) to real newlines.
  out = out.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\r/g, '\n');

  // Smart quotes -> straight quotes.
  out = out
    .replace(/[\u201C\u201D\u201F\u2033\u275D\u275E]/g, '"')
    .replace(/[\u2018\u2019\u201B\u2032\u275B\u275C]/g, "'");

  // Em-dash / en-dash / minus-ish -> " — " with single spaces.
  out = out.replace(/\s*[\u2014\u2013\u2212]\s*/g, ' — ');

  // Strip markdown artifacts leaked from LLM output.
  out = out
    .replace(/```+/g, '')          // triple+ backtick fences
    .replace(/`+/g, '')            // stray inline backticks
    .replace(/\*\*/g, '')          // bold markers
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, ''); // ATX headers at line start

  // Bullet glyphs -> "- ".
  out = out.replace(/[\u2022\u25CF\u25AA\u25E6\u00B7]\s*/g, '- ');

  // Collapse 3+ consecutive newlines down to 2.
  out = out.replace(/\n{3,}/g, '\n\n');

  // Trim trailing whitespace on each line without collapsing blank-line gaps.
  out = out.replace(/[ \t]+$/gm, '');

  return out.trim();
}

import { BadRequestException } from '@nestjs/common';

/**
 * Objectionable-content filter for user-generated text (App Store Guideline
 * 1.2: apps with UGC must filter objectionable material before it is posted).
 *
 * Scope is deliberately narrow: slurs, explicit sexual vulgarity, severe
 * profanity and self-harm incitement, in English and Filipino. It must NOT
 * block legal vocabulary. This is a legal platform, so words like "rape",
 * "murder", "kill", "sexual assault", "prostitution" and "drugs" appear in
 * ordinary case discussion and are intentionally absent from the list.
 * Words that are also names, ordinary words, idioms or historical legal
 * terms ("dick", "cock", "puke", "gaga", "spic(y)", "chink(s) in the armor",
 * "retarded" in older jurisprudence, "bakla") are left out for the same
 * reason: a false positive here blocks a legitimate legal discussion.
 *
 * Matching is whole-word, case-insensitive, accent-insensitive, tolerant of
 * common leetspeak (f4ck, sh1t) and stretched letters (fuuuck). Anything this
 * misses is handled by user reports and the moderation queue.
 */

/** Optional inflection suffixes accepted after a term. */
const SUFFIX = '(?:s|es|ed|er|ers|ing|in|y|ty)?';

/** Single-word terms. Each letter may repeat (f+u+c+k+). */
const WORD_TERMS: readonly string[] = [
  // English: severe profanity and sexual vulgarity
  'fuck',
  'fuk',
  'fck',
  'motherfuck',
  'motherfucker',
  'shit',
  'bullshit',
  'cunt',
  'bitch',
  'asshole',
  'whore',
  'slut',
  'cocksucker',
  'jizz',
  // English: slurs
  'nigger',
  'nigga',
  'faggot',
  'fag',
  'kike',
  'tranny',
  'wetback',
  // Filipino: profanity, slurs and sexual vulgarity
  'putangina',
  'tangina',
  'pakyu',
  'puta',
  'gago',
  'tarantado',
  'ulol',
  'pokpok',
  'kantot',
  'kantutan',
  'hindot',
  'jakol',
  'tite',
  'burat',
  'kupal',
];

/** Multi-word phrases. Words may be separated by whitespace or run together. */
const PHRASE_TERMS: readonly string[][] = [
  ['putang', 'ina'],
  ['tang', 'ina'],
  ['kill', 'yourself'],
  ['kill', 'urself'],
  ['kys'],
];

const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '!': 'i',
  '3': 'e',
  '4': 'a',
  '@': 'a',
  '5': 's',
  $: 's',
  '7': 't',
};

function stretch(word: string): string {
  return word
    .split('')
    .map((ch) => `${ch}+`)
    .join('');
}

const PATTERN = new RegExp(
  [
    ...WORD_TERMS.map((t) => `\\b${stretch(t)}${SUFFIX}\\b`),
    ...PHRASE_TERMS.map((words) => `\\b${words.map(stretch).join('\\s*')}\\b`),
  ].join('|'),
  'i',
);

/** Lowercase, strip accents, and undo leetspeak inside words. */
export function normalizeForFilter(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[a-z0-9!@$]+/g, (token) => {
      // Translate leetspeak only inside tokens that contain a letter, so
      // plain numbers ("Art. 315", "G.R. No. 123456") are untouched. A
      // trailing run of "!" is punctuation, not a letter: "shit!" must stay
      // "shit!", not become "shiti".
      if (!/[a-z]/.test(token)) return token;
      const bang = /!+$/.exec(token)?.[0] ?? '';
      const body = token.slice(0, token.length - bang.length);
      return body.replace(/[0134579!@$]/g, (ch) => LEET[ch] ?? ch) + bang;
    });
}

/** True if the text contains a term the filter blocks. */
export function containsObjectionableContent(text: string | null | undefined): boolean {
  if (!text) return false;
  return PATTERN.test(normalizeForFilter(text));
}

/**
 * Throw 400 if any of the given texts contains objectionable content.
 * `noun` names the thing being written, for the user-facing message.
 */
export function assertAcceptableUserContent(
  noun: 'post' | 'comment' | 'review',
  ...texts: Array<string | null | undefined>
): void {
  if (texts.some((t) => containsObjectionableContent(t))) {
    throw new BadRequestException(
      `Your ${noun} contains language that isn't allowed under our Community Guidelines. Please revise it.`,
    );
  }
}

/**
 * Duplicated web<->mobile; keep in sync.
 * (apps/web/src/components/chat/chat-knowledge-base.ts <->
 *  apps/mobile/src/features/chat/chat-knowledge-base.ts — do NOT move into
 *  packages/*: shared-package runtime imports break the web Docker build.)
 *
 * Phase-1 rule-based FAQ knowledge base for the support chat widget.
 *
 * Everything here runs client-side and is fully deterministic — no AI, no
 * network calls. Phase 2 will swap `matchFaq` for a NestJS endpoint that
 * proxies the cheapest OpenAI model server-side (see `resolveAnswer` in
 * chat-widget.tsx). Keep this module dependency-free and tree-shakeable.
 */

export interface FaqEntry {
  id: string;
  topic: string;
  keywords: string[];
  question: string;
  answer: string;
}

export const FAQ_ENTRIES: FaqEntry[] = [
  {
    id: 'what-is',
    topic: 'About LIBERTASIAN',
    keywords: ['what', 'libertasian', 'about', 'platform', 'overview', 'features', 'do'],
    question: 'What is LIBERTASIAN?',
    answer:
      'LIBERTASIAN is a Philippine legal-research platform — AI-powered search, auto-generated case digests, codal reading, and a bar-exam reviewer, all grounded in authoritative PH sources.',
  },
  {
    id: 'pricing',
    topic: 'Plans & pricing',
    keywords: ['price', 'pricing', 'plan', 'plans', 'cost', 'free', 'pro', 'subscription', 'upgrade', 'billing'],
    question: 'Plans & pricing',
    answer:
      'There are two plans: Free gives you about 15 AI answers and 50 searches a day, while Pro raises that to roughly 200 AI answers a day with unlimited search. See the full breakdown at /pricing.',
  },
  {
    id: 'search',
    topic: 'Search',
    keywords: ['search', 'query', 'find', 'look', 'lookup', 'question', 'ask'],
    question: 'How do I search?',
    answer:
      'Just type your question in plain language — e.g. "requisites of a valid contract" — and LIBERTASIAN retrieves and cites authoritative Philippine sources for you.',
  },
  {
    id: 'digests',
    topic: 'Case digests',
    keywords: ['digest', 'digests', 'case', 'summary', 'summarize', 'ruling', 'doctrine'],
    question: 'Case digests',
    answer:
      'LIBERTASIAN auto-generates case digests (facts, issues, ruling, doctrine) with source provenance, so every part of the digest links back to the passage it came from.',
  },
  {
    id: 'bar-exams',
    topic: 'Bar exam reviewer',
    keywords: ['bar', 'exam', 'exams', 'reviewer', 'review', 'study', 'past', 'questions'],
    question: 'Bar exam reviewer',
    answer:
      'The bar-exam reviewer collects past bar questions and pairs them with AI-suggested answers, so you can practice and check your reasoning as you study.',
  },
  {
    id: 'scan-upload',
    topic: 'Scan & uploads',
    keywords: ['scan', 'camera', 'upload', 'uploads', 'document', 'photo', 'pdf', 'capture'],
    question: 'Camera scan / uploads',
    answer:
      'You can scan a document with your camera or upload a file and LIBERTASIAN will generate a digest from it. Your scans and uploads are private by default.',
  },
  {
    id: 'privacy',
    topic: 'Privacy',
    keywords: ['privacy', 'private', 'data', 'secure', 'security', 'training', 'confidential', 'safe'],
    question: 'Is my data private?',
    answer:
      'Yes — your uploads, notes, and scans are private and scoped to your organization by default, and they are never used to train any model.',
  },
  {
    id: 'account',
    topic: 'Account',
    keywords: ['account', 'sign', 'signup', 'register', 'login', 'log', 'create', 'join'],
    question: 'Sign up / sign in',
    answer:
      'New here? Create an account at /register. Already have one? Sign in at /login.',
  },
  {
    id: 'change-password',
    topic: 'Account',
    keywords: ['password', 'change', 'reset', 'forgot', 'credentials', 'security'],
    question: 'Change my password',
    answer:
      'You can change your password under Settings → Security.',
  },
  {
    id: 'legal-disclaimer',
    topic: 'Legal disclaimer',
    keywords: ['legal', 'advice', 'lawyer', 'attorney', 'disclaimer', 'substitute', 'counsel'],
    question: 'Is this legal advice?',
    answer:
      'No. LIBERTASIAN is a research aid only — it is not legal advice and not a substitute for a licensed lawyer.',
  },
  {
    id: 'contact',
    topic: 'Talk to a human',
    keywords: ['contact', 'support', 'human', 'help', 'email', 'team', 'agent', 'talk', 'reach'],
    question: 'Talk to a human / support',
    answer:
      'Happy to point you to the team — email us at info.libertasian@gmail.com and a human will get back to you.',
  },
];

/**
 * Topic-word hits are scored at a lower weight than explicit keyword hits so
 * that the curated keyword list dominates matching while topic words still
 * help disambiguate.
 */
const KEYWORD_WEIGHT = 2;
const TOPIC_WEIGHT = 1;
const MATCH_THRESHOLD = 2;

/** Stop-words that should never count toward a match. */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'do', 'does', 'how', 'what', 'my', 'i', 'to',
  'of', 'for', 'in', 'on', 'and', 'or', 'can', 'me', 'you', 'it', 'this', 'that',
]);

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

/**
 * Match free-text input against the FAQ knowledge base.
 *
 * Lowercases + strips punctuation, tokenizes, then scores each entry by
 * keyword hits (weight 2) and topic-word hits (weight 1). Returns the
 * highest-scoring entry above a small threshold, or `null` when nothing
 * clears the bar (caller shows the support-email fallback).
 *
 * Examples:
 *   matchFaq('how much does it cost?')   -> 'pricing'
 *   matchFaq('is my scan private')       -> 'privacy'  (scan + private both hit)
 *   matchFaq('asdfghjkl')                -> null
 */
export function matchFaq(input: string): FaqEntry | null {
  const tokens = tokenize(input);
  if (tokens.length === 0) return null;

  const tokenSet = new Set(tokens.filter((token) => !STOP_WORDS.has(token)));
  if (tokenSet.size === 0) return null;

  let best: FaqEntry | null = null;
  let bestScore = 0;

  for (const entry of FAQ_ENTRIES) {
    let score = 0;

    for (const keyword of entry.keywords) {
      if (tokenSet.has(keyword)) score += KEYWORD_WEIGHT;
    }

    for (const topicWord of tokenize(entry.topic)) {
      if (STOP_WORDS.has(topicWord)) continue;
      if (tokenSet.has(topicWord)) score += TOPIC_WEIGHT;
    }

    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }

  return bestScore >= MATCH_THRESHOLD ? best : null;
}

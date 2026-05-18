// ---- Homepage Content Types ----

export interface HomepageContent {
  hero: {
    tagline: string;
    headline: string;
    headlineAccent: string;
    description: string;
    primaryCta: { text: string; href: string };
    secondaryCta: { text: string; href: string };
    finePrint: string;
    /** Warm-editorial redesign overrides — optional, render only on the new homepage. */
    warm?: {
      headlineTop: string;
      headlineBottom: string;
      speechBubble: string;
      body: string;
      primaryCta?: { text: string; href: string };
      secondaryCta?: { text: string; href: string };
    };
  };
  /** Warm-editorial stats strip (4 numbered tiles, ink background). */
  stats?: {
    items: Array<{ value: string; label: string }>;
  };
  /** Warm-editorial study picker (4 subject cards). */
  studyPicker?: {
    sectionTitle: string;
    sectionLinkText: string;
    sectionLinkHref: string;
    items: Array<{
      label: string;
      count: string;
      tone: 'accent' | 'cream' | 'ink' | 'accentSoft';
      /** SVG path-data keyword routing to one of the inline glyphs. */
      glyph: 'gavel' | 'scales' | 'book' | 'hardhat';
    }>;
  };
  /** Warm-editorial numbered features accordion (01-05). */
  featuresAccordion?: {
    eyebrow: string;
    sectionTitleLine1: string;
    sectionTitleLine2: string;
    sectionTitleLine3: string;
    items: Array<{
      number: string;
      label: string;
      detail: string;
      openByDefault?: boolean;
    }>;
    preview: {
      eyebrow: string;
      headline: string;
      body: string;
      progress: number[];
      ctaText: string;
      badgeText: string;
    };
  };
  /** Warm-editorial contributors row (4 gradient placeholder cards). */
  contributors?: {
    eyebrow: string;
    sectionTitleLine1: string;
    sectionTitleLine2: string;
    items: Array<{
      name: string;
      role: string;
      tone: 'sage' | 'plum' | 'warm' | 'cool';
    }>;
    ctaText: string;
    ctaHref: string;
  };
  /** Warm-editorial signup form (cream3 panel with chips). */
  signupForm?: {
    headlineLine1: string;
    headlineAccent: string;
    body: string;
    nameLabel: string;
    emailLabel: string;
    stageLabel: string;
    stages: string[];
    subjectsLabel: string;
    subjects: string[];
    ctaText: string;
    ctaHref: string;
    finePrint: string;
  };
  /** @deprecated Replaced by `featuresAccordion`. Optional — no longer shipped in defaults or rendered by the public homepage. */
  features?: {
    sectionTitle: string;
    sectionSubtitle: string;
    items: Array<{ title: string; description: string; icon: string }>;
  };
  /** @deprecated Removed from the warm-editorial public landing. Optional for forward-compat with legacy stored content. */
  differentiators?: {
    sectionTitle: string;
    sectionSubtitle: string;
    items: Array<{ capability: string; libertasian: boolean; others: string; note: string }>;
  };
  /** @deprecated Removed from the warm-editorial public landing. Optional for forward-compat with legacy stored content. */
  trust?: {
    sectionTitle: string;
    sectionSubtitle: string;
    items: Array<{ title: string; description: string }>;
  };
  /** @deprecated Removed from the warm-editorial public landing. Optional for forward-compat with legacy stored content. */
  personas?: {
    sectionTitle: string;
    sectionSubtitle: string;
    items: Array<{ title: string; plan: string; price: string; features: string[] }>;
  };
  /** @deprecated Removed from the warm-editorial public landing. Optional for forward-compat with legacy stored content. */
  cta?: {
    headline: string;
    description: string;
    primaryCta: { text: string; href: string };
    secondaryCta: { text: string; href: string };
  };
  disclaimer: string;
  footer: {
    brandDescription: string;
    contactEmail: string;
    productLinks: Array<{ label: string; href: string }>;
    legalLinks: Array<{ label: string; href: string }>;
    /** Warm-editorial footer — optional extra columns. */
    companyLinks?: Array<{ label: string; href: string }>;
    tagline?: string;
  };
}

// ---- Default Content (mirrors original hardcoded values) ----

export const DEFAULT_HOMEPAGE_CONTENT: HomepageContent = {
  hero: {
    tagline: 'Philippine Legal AI Platform',
    headline: 'Legal research,',
    headlineAccent: 'reimagined.',
    description:
      'AI-powered search, case digest generation, camera scan-to-digest, bar review tools, and a full practice workspace. Built exclusively for Philippine law. Grounded in authoritative sources. Private by default.',
    primaryCta: { text: 'Get Started Free', href: '/auth/callback?mode=register' },
    secondaryCta: { text: 'View Plans', href: '/pricing' },
    finePrint: 'Free plan includes corpus access, 15 AI credits, and basic search. No credit card required.',
    warm: {
      headlineTop: 'LAW YOU CAN,',
      headlineBottom: 'ACTUALLY READ!',
      speechBubble:
        'Over 90,000 cases targeted and 1,500+ bar exam questions — written for Filipino law students and lawyers.',
      body:
        'LIBERTASIAN is a friendly legal research library built for Filipino law students and practitioners. Plain-language digests, codals, and bar drills — in one place.',
      primaryCta: { text: 'Start reading — free →', href: '/auth/callback?mode=register' },
      secondaryCta: { text: 'See pricing', href: '/pricing' },
    },
  },
  stats: {
    items: [
      { value: '90,000+', label: 'Cases targeted' },
      { value: '1,500+', label: 'Bar exam Qs' },
      { value: '100+', label: 'Law schools' },
      { value: '4.9★', label: 'App store' },
    ],
  },
  studyPicker: {
    sectionTitle: 'What are you studying?',
    sectionLinkText: 'See all 8 bar subjects →',
    sectionLinkHref: '/bar-exams',
    items: [
      { label: 'Political Law', count: 'Constitution + Admin', tone: 'accent', glyph: 'gavel' },
      { label: 'Civil Law', count: 'Persons · Property · Obligations', tone: 'cream', glyph: 'scales' },
      { label: 'Criminal Law', count: 'RPC + special penal laws', tone: 'ink', glyph: 'book' },
      { label: 'Labor Law', count: 'Labor Code + jurisprudence', tone: 'accentSoft', glyph: 'hardhat' },
    ],
  },
  featuresAccordion: {
    eyebrow: '§ Features',
    sectionTitleLine1: "Everything you'd",
    sectionTitleLine2: 'highlight, already',
    sectionTitleLine3: 'highlighted.',
    items: [
      {
        number: '01',
        label: 'PAST BAR EXAMS',
        detail:
          '97 sittings, 1,536 questions from 1953–2024 with AI-generated ALAC answers for paid users.',
        openByDefault: true,
      },
      {
        number: '02',
        label: 'CASE DIGESTS',
        detail:
          '90,000+ Philippine Supreme Court cases targeted — DFIR digests with facts, issues, ruling, doctrine, and provenance.',
      },
      {
        number: '03',
        label: 'CODAL READER',
        detail:
          'Republic Acts, the 1987 Constitution, and the Rules of Court — organized by bar subject with cross-references.',
      },
      {
        number: '04',
        label: 'AI STUDY ASSISTANT',
        detail:
          'Chat and Q&A on whatever you are reading. Sourced answers only — never fabrications.',
      },
      {
        number: '05',
        label: 'MOBILE APPS',
        detail:
          'iOS and Android. Camera scan-to-digest. Offline codal cache. Sync everything.',
      },
    ],
    preview: {
      eyebrow: 'BAR PREP · MOCK DRILL',
      headline: "You're 68% on Remedial.",
      body:
        'Civil procedure outlines are your weak spot. We have queued 20 questions and a 6-min refresher.',
      progress: [1, 1, 1, 1, 1, 0, 0, 1, 1, 0],
      ctaText: 'Start drill →',
      badgeText: 'NEW! Adaptive plans',
    },
  },
  contributors: {
    eyebrow: '§ Writers',
    sectionTitleLine1: 'Real humans.',
    sectionTitleLine2: 'Citations included.',
    items: [
      { name: 'Editorial Lead', role: 'Civil Law', tone: 'sage' },
      { name: 'Bar Coach', role: 'Remedial Law', tone: 'plum' },
      { name: 'Senior Reviewer', role: 'Constitutional Law', tone: 'warm' },
      { name: 'Labor Editor', role: 'Labor & Tax', tone: 'cool' },
    ],
    ctaText: 'Meet the editorial team',
    ctaHref: '/blog',
  },
  signupForm: {
    headlineLine1: 'Start your free',
    headlineAccent: 'study plan',
    body:
      'Tell us what you are studying. We will queue your first five reads, line up the right bar drills, and stay out of your way.',
    nameLabel: 'Your name',
    emailLabel: 'Email',
    stageLabel: 'What stage are you at?',
    stages: ['1st year', '2nd year', '3rd year', '4th year', 'Bar reviewee', 'Practicing', 'Just curious'],
    subjectsLabel: 'Subjects you care about',
    subjects: [
      'Political Law',
      'Civil Law',
      'Criminal Law',
      'Labor Law',
      'Taxation',
      'Mercantile Law',
      'Remedial Law',
      'Legal Ethics',
    ],
    ctaText: "Build my study plan — it's free →",
    ctaHref: '/auth/callback?mode=register',
    finePrint: 'No credit card. Cancel any time. We respect the Data Privacy Act.',
  },
  disclaimer:
    'LIBERTASIAN provides AI-powered legal research tools for informational purposes only. AI outputs are not legal advice and do not create an attorney-client relationship. Always consult a qualified Philippine lawyer for legal matters. The practice of law in the Philippines is reserved for members of the Philippine Bar.',
  footer: {
    brandDescription: 'Philippine Legal AI Platform. Democratizing access to legal knowledge.',
    contactEmail: 'support@libertasian.com',
    productLinks: [
      { label: 'Bar Exams', href: '/bar-exams' },
      { label: 'Case Digests', href: '/#features' },
      { label: 'Codal Reader', href: '/#features' },
      { label: 'AI Study Assistant', href: '/#features' },
      { label: 'iOS App', href: '/#features' },
      { label: 'Android App', href: '/#features' },
    ],
    legalLinks: [
      { label: 'Terms of Service', href: '/terms' },
      { label: 'Privacy Policy', href: '/privacy' },
    ],
    companyLinks: [
      { label: 'Blog', href: '/blog' },
      { label: 'Pricing', href: '/pricing' },
      { label: 'About', href: '/blog' },
    ],
    tagline: 'A friendly Philippine legal research library. Not legal advice — but a great place to start.',
  },
};

// ---- Deep Merge Utility ----

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepMerge<T>(defaults: T, overrides: Partial<T>): T {
  const result = { ...defaults } as Record<string, unknown>;

  for (const key of Object.keys(overrides as Record<string, unknown>)) {
    const defaultVal = (defaults as Record<string, unknown>)[key];
    const overrideVal = (overrides as Record<string, unknown>)[key];

    if (isPlainObject(defaultVal) && isPlainObject(overrideVal)) {
      result[key] = deepMerge(defaultVal, overrideVal);
    } else if (overrideVal !== undefined) {
      result[key] = overrideVal;
    }
  }

  return result as T;
}

// ---- Server-side Content Fetch ----

export async function getHomepageContent(): Promise<HomepageContent> {
  try {
    const apiUrl = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001/api/v1';
    const res = await fetch(`${apiUrl}/site-content/homepage`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return DEFAULT_HOMEPAGE_CONTENT;
    const data = (await res.json()) as { success: boolean; data: { content: Partial<HomepageContent> } };
    if (!data.success || !data.data?.content) return DEFAULT_HOMEPAGE_CONTENT;
    return deepMerge(DEFAULT_HOMEPAGE_CONTENT, data.data.content);
  } catch {
    return DEFAULT_HOMEPAGE_CONTENT;
  }
}

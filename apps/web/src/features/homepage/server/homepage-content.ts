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
  /** @deprecated Replaced by `featuresAccordion`. Kept so the admin editor and API still hydrate. */
  features: {
    sectionTitle: string;
    sectionSubtitle: string;
    items: Array<{ title: string; description: string; icon: string }>;
  };
  /** @deprecated Removed from the warm-editorial public landing. Types kept for admin editor compatibility. */
  differentiators: {
    sectionTitle: string;
    sectionSubtitle: string;
    items: Array<{ capability: string; libertasian: boolean; others: string; note: string }>;
  };
  /** @deprecated Removed from the warm-editorial public landing. Types kept for admin editor compatibility. */
  trust: {
    sectionTitle: string;
    sectionSubtitle: string;
    items: Array<{ title: string; description: string }>;
  };
  /** @deprecated Removed from the warm-editorial public landing. Types kept for admin editor compatibility. */
  personas: {
    sectionTitle: string;
    sectionSubtitle: string;
    items: Array<{ title: string; plan: string; price: string; features: string[] }>;
  };
  /** @deprecated Removed from the warm-editorial public landing. Types kept for admin editor compatibility. */
  cta: {
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
  features: {
    sectionTitle: 'Everything you need for Philippine legal work',
    sectionSubtitle: 'From first-year law student to senior partner. One platform, every tool.',
    items: [
      {
        title: 'AI Legal Research',
        description:
          'Get AI-powered answers to legal questions with full source citations. Hybrid BM25 + semantic retrieval from 90,000+ Philippine legal documents.',
        icon: 'M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z',
      },
      {
        title: 'Case Digest Generation',
        description:
          'Generate structured DFIR+ digests automatically — summary, facts, arguments, issues, ruling, doctrine, and dispositive with provenance mapping.',
        icon: 'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z',
      },
      {
        title: 'Camera Scan to Digest',
        description:
          'Scan printed legal documents with your phone. On-device edge detection, deskew, and enhancement. Server-side OCR generates searchable, citable digests.',
        icon: 'M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z M15 12.75a3 3 0 11-6 0 3 3 0 016 0z',
      },
      {
        title: 'Study & Bar Review',
        description:
          'Codal reader organized by bar subject, AI-generated flashcards with spaced repetition, reviewer packs, syllabus mode, and offline mobile reading.',
        icon: 'M4.26 10.147a60.438 60.438 0 00-.491 6.347A48.62 48.62 0 0112 20.904a48.62 48.62 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.636 50.636 0 00-2.658-.813A59.906 59.906 0 0112 3.493a59.903 59.903 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5',
      },
      {
        title: 'Practice Workspace',
        description:
          'Manage matters, draft legal memos, compare cases, generate pleadings, and collaborate with your team. Tasks, calendar, audit logs, and role-based access.',
        icon: 'M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38m0 0A2.18 2.18 0 013 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 013.413-.387m7.5 0V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25v.894m7.5 0a48.667 48.667 0 00-7.5 0',
      },
      {
        title: 'Editorial Corpus',
        description:
          'Sourced from the Supreme Court E-Library, Lawphil, and Official Gazette. Automated ingestion, truthfulness validation, and editorial review queue.',
        icon: 'M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0012 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75z',
      },
    ],
  },
  differentiators: {
    sectionTitle: 'Why LIBERTASIAN?',
    sectionSubtitle: 'No single competitor combines all these capabilities. We do.',
    items: [
      {
        capability: 'AI legal research & answers',
        libertasian: true,
        others: 'Partial',
        note: 'Only LIBERTASIAN combines all features in one platform',
      },
      {
        capability: 'Camera scan to digest',
        libertasian: true,
        others: 'None',
        note: 'No competitor offers mobile camera scan-to-digest',
      },
      {
        capability: 'Codal reader (by bar subject)',
        libertasian: true,
        others: 'eCodal+ only',
        note: 'Combined with AI search and flashcards',
      },
      {
        capability: 'Practice workspace (matters, tasks)',
        libertasian: true,
        others: 'None',
        note: 'No competitor offers matter management',
      },
      {
        capability: 'Flashcards & spaced repetition',
        libertasian: true,
        others: 'None',
        note: 'Auto-generated from digests with SM-2 algorithm',
      },
      {
        capability: 'Offline mobile reading',
        libertasian: true,
        others: 'eCodal+ only',
        note: 'Full codal + digest offline cache',
      },
      {
        capability: 'Team collaboration',
        libertasian: true,
        others: 'JurisChat V2',
        note: 'With audit logs, RBAC, and client-safe sharing',
      },
      {
        capability: 'Transparent truthfulness controls',
        libertasian: true,
        others: 'Internal only',
        note: 'Public confidence thresholds and review workflows',
      },
    ],
  },
  trust: {
    sectionTitle: 'Built on trust and truthfulness',
    sectionSubtitle: 'Legal AI demands accuracy. We take that seriously.',
    items: [
      {
        title: 'Zero Fabricated Citations',
        description:
          'Every AI-generated claim links to a verifiable source passage. If support is insufficient, the system abstains rather than hallucinate.',
      },
      {
        title: 'Official Sources First',
        description:
          'Authoritative government publications take precedence. Supreme Court E-Library, Lawphil, and Official Gazette are primary sources.',
      },
      {
        title: 'Private by Default',
        description:
          'Your camera scans, uploads, and notes never enter the public corpus without explicit permission and editorial rights review.',
      },
      {
        title: 'Full Provenance',
        description:
          'Every digest, summary, and AI output traces back to specific source sections. Source Excerpt, Grounded Summary, and Inferred Analysis are clearly labeled.',
      },
    ],
  },
  personas: {
    sectionTitle: 'For every legal professional',
    sectionSubtitle: 'Purpose-built for the Philippine legal ecosystem.',
    items: [
      {
        title: 'Bar Examinees & Students',
        plan: 'Edu',
        price: '499',
        features: [
          'Codal reader by bar subject',
          'AI flashcards with spaced repetition',
          'Reviewer packs & syllabus mode',
          'Offline mobile reading',
          'Study progress tracking',
        ],
      },
      {
        title: 'Solo Practitioners',
        plan: 'Pro',
        price: '999',
        features: [
          'Unlimited AI answers & digests',
          'Camera scan-to-digest',
          'Memo drafting assistance',
          'Case comparison & analysis',
          'Matter folders (20 active)',
        ],
      },
      {
        title: 'Small Firms',
        plan: 'Team',
        price: '799/seat',
        features: [
          'Team workspace & collaboration',
          'Shared digests & knowledge base',
          'Task management & calendar',
          'Role-based access control',
          'Audit logs & client-safe sharing',
        ],
      },
      {
        title: 'Enterprise & Editorial',
        plan: 'Enterprise',
        price: 'Custom',
        features: [
          'Official source ingestion tools',
          'Editorial review queue',
          'Publish to shared corpus',
          'Corpus health monitoring',
          'API access & custom integrations',
        ],
      },
    ],
  },
  cta: {
    headline: 'Start your legal research today',
    description:
      'Join thousands of Filipino legal professionals using AI-powered research. Free plan available. No credit card required.',
    primaryCta: { text: 'Create Free Account', href: '/auth/callback?mode=register' },
    secondaryCta: { text: 'Compare Plans', href: '/pricing' },
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
